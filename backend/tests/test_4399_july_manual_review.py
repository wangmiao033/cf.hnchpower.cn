"""One-bill attachment exception, with full-revision and cash-fact regressions.

All databases below are local in-memory SQLite. The successful endpoint test
runs the real lifecycle transition; only PostgreSQL-only SQL and the unrelated
response enrichment are adapted. It is not a PostgreSQL concurrency test.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from fastapi import HTTPException
from sqlalchemy import JSON, DateTime, Integer, Numeric, create_engine, event, literal, select, text
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import TextClause

from app.api.bill_lifecycle import (
    ApprovedPlatformVarianceRequest,
    confirm_approved_channel_platform_variance,
    get_channel_manual_review_exception,
)
from app.models.bank_reconciliation_match import BankReconciliationMatch
from app.models.channel import ChannelReceipt, ChannelRecord, ChannelRecordLineItem
from app.models.operation_log import OperationLog
from app.services.channel_manual_review_exception import (
    CHANNEL_NAME, EXCEPTION_CODE, MONTH, ORIGIN_CUTOFF, PARTNER_NAME, STATEMENT_NO,
    resolve_manual_review_exception, validate_manual_review_exception,
)
from app.services.channel_platform_variance_approval import assess_channel_platform_variance
from app.services.channel_settlement_engine import aggregate_validation, calculate_channel_line


NOW = datetime(2026, 10, 22, 3, 0, tzinfo=timezone.utc)
PARTNER_ID = "test-4399-master"
ADMIN = SimpleNamespace(role="admin", id="test-admin", email="admin@example.test")
BASIS = "已逐游戏人工核对七月平台结算金额并保留真实差异"


def fixture():
    bill = SimpleNamespace(**{c.key: None for c in ChannelRecord.__table__.columns})
    for field in (
        "billing_flow", "voucher_cost", "no_worry_cost", "refund_cost", "test_cost",
        "welfare_cost", "coin_cost", "share_rate", "billing_amount", "share_amount",
        "tax_rate", "gateway_cost", "settlement_adjustment_amount", "channel_fee_rate",
    ):
        setattr(bill, field, Decimal("0"))
    bill.id = "test-4399-july-bill"
    bill.statement_no = STATEMENT_NO
    bill.partner_name = PARTNER_NAME
    bill.channel_name = CHANNEL_NAME
    bill.settlement_month = MONTH
    bill.status = "pending"
    bill.received_amount = Decimal("85.00")
    bill.receipt_status = "partial"
    bill.settlement_rule_code = "share_only"
    bill.channel_fee_mode = bill.tax_mode = "none"
    bill.validation_tolerance = Decimal("0.05")
    bill.created_at = NOW - timedelta(days=7)
    bill.updated_at = NOW
    bill.remark = "保留原账单备注"
    line = SimpleNamespace(**{c.key: None for c in ChannelRecordLineItem.__table__.columns})
    for field in (
        "voucher_cost", "no_worry_cost", "refund_cost", "test_cost", "welfare_cost",
        "coin_cost", "gateway_cost", "tax_rate", "channel_fee_rate",
    ):
        setattr(line, field, Decimal("0"))
    line.id = "test-4399-july-line"
    line.channel_record_id = bill.id
    line.sort_order = 0
    line.game_name = "合成测试游戏"
    line.settlement_cycle = MONTH
    line.billing_flow = Decimal("135.85")
    line.discount_factor = Decimal("1")
    line.share_rate = Decimal("100")
    line.settlement_rule_code = "share_only"
    line.channel_fee_mode = line.tax_mode = "none"
    line.validation_tolerance = Decimal("0.05")
    line.platform_settlement_amount = Decimal("144.40")
    line.created_at = bill.created_at
    line.updated_at = NOW
    recalculate(bill, [line])
    return bill, [line]


def recalculate(bill, lines):
    for line in lines:
        for key, value in calculate_channel_line(line, bill).items():
            setattr(line, key, value)
    totals = aggregate_validation(lines, bill)
    for attr, key in (
        ("system_settlement_amount", "system_total"),
        ("platform_settlement_amount", "platform_total"),
        ("settlement_difference", "difference_total"),
        ("settlement_amount", "settlement_total"),
        ("validation_status", "validation_status"),
    ):
        setattr(bill, attr, totals[key])


def origin_event(**changes):
    origin = dict(id="original-create-event", entity_id="test-4399-july-bill",
                  created_at=NOW - timedelta(days=7),
                  metadata={"table": "channel_records", "operation": "INSERT"})
    origin.update(changes)
    return origin


def mock_database(bill=None, lines=None, *, customers=None, cases=None, origins=None,
                  protected=True, dialect="postgresql"):
    db = Mock()
    db.info = {}
    db.get_bind.return_value.dialect.name = dialect
    origins = [origin_event()] if origins is None else origins
    customers = [{"id": PARTNER_ID, "name": PARTNER_NAME, "category": "渠道"}] if customers is None else customers
    cases = [] if cases is None else cases

    def execute(statement, params=None):
        sql = str(statement)
        result = Mock()
        if "FROM pg_trigger" in sql:
            result.scalar_one.return_value = protected
        elif "FROM operation_logs" in sql:
            result.mappings.return_value.all.return_value = origins
        elif sql == "LOCK TABLE cf_partner_records IN SHARE MODE":
            pass
        elif "FROM cf_partner_records" in sql:
            result.mappings.return_value.all.return_value = customers
        elif "to_regclass" in sql:
            result.scalar_one_or_none.return_value = "cf_contract_difference_cases"
        elif "FROM cf_contract_difference_cases" in sql:
            result.mappings.return_value.all.return_value = cases
        elif "FROM channel_record_line_items" in sql:
            result.scalars.return_value.all.return_value = lines or []
        elif "FROM channel_records" in sql:
            result.scalar_one_or_none.return_value = bill
        else:
            raise AssertionError(f"Unexpected SQL in isolated test: {sql}")
        return result

    db.execute.side_effect = execute
    return db


def payload_for(bill, lines, db=None, **changes):
    db = db or mock_database(bill, lines)
    policy = resolve_manual_review_exception(db, bill, lines)
    review = assess_channel_platform_variance(bill, lines, allow_documented_variance=True)
    data = dict(
        reason=BASIS,
        expected_system_amount=review["system_amount"],
        expected_platform_amount=review["platform_amount"],
        expected_settlement_amount=review["recorded_settlement_amount"],
        expected_signed_difference_cents=review["signed_difference_cents"],
        expected_line_ids=review["line_ids"],
        expected_partner_id=PARTNER_ID,
        manual_review_exception=EXCEPTION_CODE,
        manual_review_revision=policy["review_revision"],
        manual_review_confirmed=True,
        manual_review_reason=BASIS,
    )
    data.update(changes)
    return ApprovedPlatformVarianceRequest(**data)


def validation_args(policy, **changes):
    values = dict(code=EXCEPTION_CODE, revision=policy["review_revision"],
                  partner_id=PARTNER_ID, confirmed=True, reason=BASIS)
    values.update(changes)
    return values


def row_values(row, model):
    return {column.key: deepcopy(getattr(row, column.key)) for column in model.__mapper__.column_attrs}


class SingleBillPolicyTests(TestCase):
    def assert_error(self, expected_error, function, *args, status=409, **kwargs):
        with self.assertRaises(HTTPException) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.status_code, status)
        self.assertEqual(caught.exception.detail["error"], expected_error)

    def test_only_exact_saved_bill_has_a_read_only_revision(self):
        bill, lines = fixture()
        original = deepcopy([vars(bill), *map(vars, lines)])
        db = mock_database(bill, lines)
        policy = resolve_manual_review_exception(db, bill, lines)
        self.assertEqual(policy["code"], EXCEPTION_CODE)
        self.assertEqual(policy["partner_id"], PARTNER_ID)
        self.assertEqual(policy["bill_id"], bill.id)
        self.assertEqual(policy["statement_no"], STATEMENT_NO)
        self.assertEqual(policy["settlement_month"], MONTH)
        self.assertRegex(policy["review_revision"], r"^[0-9a-f]{64}$")
        self.assertEqual(policy, resolve_manual_review_exception(db, bill, lines))
        self.assertEqual(original, [vars(bill), *map(vars, lines)])
        self.assertEqual(db.execute.call_args.args[1], {"name": PARTNER_NAME})
        self.assertIn("WHERE name = :name", str(db.execute.call_args.args[0]))
        db.add.assert_not_called()
        db.commit.assert_not_called()

    def test_names_substrings_aliases_other_bills_months_and_statuses_do_not_qualify(self):
        variations = {
            "statement_no": ["QD-OTHER", STATEMENT_NO.lower(), STATEMENT_NO + " "],
            "partner_name": ["4399", "4399游戏", "四三九九", "其他公司", PARTNER_NAME + " "],
            "channel_name": ["", "4399游戏", "其他渠道", "4399 "],
            "settlement_month": ["2026-08", "2025-07", "2026-7"],
            "status": ["draft", "confirmed", "reconciled", "cancelled"],
            "updated_at": [None, NOW.isoformat()],
        }
        for field, values in variations.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    bill, lines = fixture()
                    setattr(bill, field, value)
                    db = mock_database(bill, lines)
                    self.assertIsNone(resolve_manual_review_exception(db, bill, lines))
                    db.execute.assert_not_called()
        for cycle in ["2026-08", "2026-7", None]:
            bill, lines = fixture()
            lines[0].settlement_cycle = cycle
            self.assertIsNone(resolve_manual_review_exception(mock_database(), bill, lines))
        bill, _ = fixture()
        self.assertIsNone(resolve_manual_review_exception(mock_database(), bill, []))

    def test_missing_duplicate_or_wrong_category_customer_fails_closed(self):
        for rows in [[], [{"id": "a", "category": "渠道"}, {"id": "b", "category": "渠道"}],
                     [{"id": "a", "category": "研发商"}], [{"id": "a", "category": None}]]:
            with self.subTest(rows=rows):
                bill, lines = fixture()
                self.assert_error("manual_review_customer_ambiguous", resolve_manual_review_exception,
                                  mock_database(customers=rows), bill, lines)

    def test_exact_amounts_are_not_a_general_large_variance_allowance(self):
        for flow, platform in [("135.84", "144.40"), ("135.85", "144.39"),
                               ("135.86", "144.41"), ("135.85", "143.40")]:
            with self.subTest(flow=flow, platform=platform):
                bill, lines = fixture()
                lines[0].billing_flow = Decimal(flow)
                lines[0].platform_settlement_amount = Decimal(platform)
                recalculate(bill, lines)
                self.assertIsNone(resolve_manual_review_exception(mock_database(), bill, lines))
        bill, lines = fixture()
        self.assert_error("platform_variance_too_large", assess_channel_platform_variance, bill, lines)
        self.assertEqual(float(bill.settlement_difference), -8.55)
        self.assertEqual(bill.validation_status, "fail")

    def test_code_partner_and_explicit_twelve_character_basis_are_required(self):
        bill, lines = fixture()
        db = mock_database(bill, lines)
        policy = resolve_manual_review_exception(db, bill, lines)
        for change in [{"code": "4399"}, {"code": "honor_official_statement_v1"},
                       {"partner_id": "another-master"}]:
            self.assert_error("manual_review_exception_invalid", validate_manual_review_exception,
                              db, bill, lines, **validation_args(policy, **change))
        for change in [{"confirmed": False}, {"reason": "核" * 11}, {"reason": " " * 30},
                       {"reason": "  " + "核" * 11 + "  "}]:
            self.assert_error("manual_review_basis_required", validate_manual_review_exception,
                              db, bill, lines, status=422, **validation_args(policy, **change))
        self.assertEqual(policy, validate_manual_review_exception(
            db, bill, lines, **validation_args(policy, reason="核" * 12)))
        for revision in [None, "", "0" * 64]:
            self.assert_error("manual_review_revision_changed", validate_manual_review_exception,
                              db, bill, lines, **validation_args(policy, revision=revision))

    def test_every_original_orm_column_invalidates_the_saved_review(self):
        # Numeric deltas below one cent deliberately preserve displayed totals.
        # Identity or calculation fields may fail stricter checks before the CAS.
        for model, target in [(ChannelRecord, "bill"), (ChannelRecordLineItem, "line")]:
            for column in model.__table__.columns:
                with self.subTest(model=model.__name__, field=column.key):
                    bill, lines = fixture()
                    db = mock_database(bill, lines)
                    policy = resolve_manual_review_exception(db, bill, lines)
                    row = bill if target == "bill" else lines[0]
                    old = getattr(row, column.key)
                    if isinstance(column.type, DateTime):
                        changed = (old or NOW) + timedelta(microseconds=1)
                    elif isinstance(column.type, Integer):
                        changed = int(old or 0) + 1
                    elif isinstance(column.type, Numeric):
                        changed = Decimal(str(old or 0)) + Decimal("0.001")
                    else:
                        changed = str(old or "") + "-changed"
                    setattr(row, column.key, changed)
                    with self.assertRaises(HTTPException) as caught:
                        validate_manual_review_exception(db, bill, lines, **validation_args(policy))
                    self.assertEqual(caught.exception.status_code, 409)

    def test_same_amount_customer_master_replacement_invalidates_review(self):
        bill, lines = fixture()
        policy = resolve_manual_review_exception(mock_database(), bill, lines)
        db = mock_database(customers=[{"id": "replacement", "name": PARTNER_NAME, "category": "渠道"}])
        self.assert_error("manual_review_exception_invalid", validate_manual_review_exception,
                          db, bill, lines, **validation_args(policy))
        self.assert_error("manual_review_revision_changed", validate_manual_review_exception,
                          db, bill, lines, **validation_args(policy, partner_id="replacement"))


    def test_reassigned_statement_number_cannot_transfer_exception_to_another_bill(self):
        bill, lines = fixture()
        original_policy = resolve_manual_review_exception(mock_database(), bill, lines)
        bill.id = "another-internal-bill"
        lines[0].channel_record_id = bill.id
        db = mock_database(bill, lines)
        self.assert_error("manual_review_origin_unverified", resolve_manual_review_exception,
                          db, bill, lines)
        self.assert_error("manual_review_origin_unverified", validate_manual_review_exception,
                          db, bill, lines, **validation_args(original_policy))
        db.add.assert_not_called()

    def test_missing_duplicate_wrong_source_or_late_original_event_fails_closed(self):
        invalid_origins = [
            [], [origin_event(), origin_event(id="duplicate-create-event")],
            [origin_event(entity_id="other-bill")],
            [origin_event(created_at=ORIGIN_CUTOFF)],
            [origin_event(created_at=ORIGIN_CUTOFF + timedelta(microseconds=1))],
            [origin_event(created_at=None)], [origin_event(created_at="2026-10-15")],
            [origin_event(metadata=None)], [origin_event(metadata=[])],
            [origin_event(metadata="{table:channel_records}")],
            [origin_event(metadata={"table": "channel_records", "operation": "UPDATE"})],
            [origin_event(metadata={"table": "other_table", "operation": "INSERT"})],
            [origin_event(metadata={"operation": "INSERT"})],
        ]
        for origins in invalid_origins:
            with self.subTest(origins=origins):
                bill, lines = fixture()
                db = mock_database(bill, lines, origins=origins)
                self.assert_error("manual_review_origin_unverified", resolve_manual_review_exception,
                                  db, bill, lines)
                self.assertFalse(any("FROM cf_partner_records" in str(call.args[0])
                                     for call in db.execute.call_args_list))
                db.add.assert_not_called()

    def test_original_bill_created_at_must_precede_cutoff_even_with_old_event(self):
        for created in [None, "2026-10-15", ORIGIN_CUTOFF,
                        ORIGIN_CUTOFF + timedelta(microseconds=1)]:
            with self.subTest(created=created):
                bill, lines = fixture()
                bill.created_at = created
                self.assert_error("manual_review_origin_unverified", resolve_manual_review_exception,
                                  mock_database(), bill, lines)

    def test_missing_disabled_or_unverified_append_only_guard_is_not_trusted(self):
        for protected in [False, None, 0, 1, "true"]:
            with self.subTest(protected=protected):
                bill, lines = fixture()
                db = mock_database(protected=protected)
                self.assert_error("manual_review_origin_unverified", resolve_manual_review_exception,
                                  db, bill, lines)
                self.assertEqual(db.execute.call_count, 1)
                query = str(db.execute.call_args.args[0])
                self.assertIn("trg_operation_logs_append_only", query)
                self.assertIn("t.tgenabled IN ('O', 'A')", query)
                self.assertIn("t.tgtype = 27", query)
                self.assertIn("app_reject_operation_log_mutation", query)

    def test_origin_is_bound_into_review_and_untouched_by_discovery(self):
        bill, lines = fixture()
        origin = origin_event()
        before = deepcopy(origin)
        db = mock_database(origins=[origin])
        policy = resolve_manual_review_exception(db, bill, lines)
        self.assertEqual(policy["origin"], dict(event_id=origin["id"], bill_id=bill.id,
                                              created_at=origin["created_at"].isoformat()))
        self.assertEqual(policy, resolve_manual_review_exception(db, bill, lines))
        self.assertEqual(origin, before)
        queries = [str(call.args[0]) for call in db.execute.call_args_list]
        origin_queries = [sql for sql in queries if "FROM operation_logs" in sql]
        self.assertTrue(all("action = 'create'" in sql and "entity_type = 'channel'" in sql
                            and "entity_number = :number" in sql and "LIMIT 2" in sql for sql in origin_queries))
        db.add.assert_not_called()
        db.commit.assert_not_called()
        for changed in [origin_event(id="different-create-event"),
                        origin_event(created_at=origin["created_at"] + timedelta(microseconds=1))]:
            with self.subTest(changed=changed):
                self.assert_error("manual_review_revision_changed", validate_manual_review_exception,
                                  mock_database(origins=[changed]), bill, lines, **validation_args(policy))

    def test_postgres_confirmation_locks_customer_table_before_rechecking_origin_and_uniqueness(self):
        bill, lines = fixture()
        db = mock_database(bill, lines, dialect="postgresql")
        policy = resolve_manual_review_exception(db, bill, lines)
        self.assertFalse(any("LOCK TABLE" in str(call.args[0]) for call in db.execute.call_args_list))
        db.execute.reset_mock()
        validate_manual_review_exception(db, bill, lines, **validation_args(policy))
        queries = [str(call.args[0]) for call in db.execute.call_args_list]
        self.assertEqual(queries[0], "LOCK TABLE cf_partner_records IN SHARE MODE")
        self.assertIn("FROM pg_trigger", queries[1])
        self.assertIn("FROM operation_logs", queries[2])
        self.assertIn("FROM cf_partner_records", queries[3])
        self.assertEqual(sum("LOCK TABLE" in sql for sql in queries), 1)
        db.commit.assert_not_called()
        db = mock_database(bill, lines, dialect="sqlite")
        validate_manual_review_exception(db, bill, lines, **validation_args(policy))
        self.assertFalse(any("LOCK TABLE" in str(call.args[0]) for call in db.execute.call_args_list))


class SingleBillEndpointTests(TestCase):
    assert_error = SingleBillPolicyTests.assert_error

    def test_admin_is_required_before_any_database_access(self):
        bill, lines = fixture()
        payload = payload_for(bill, lines)
        for role in ["finance", "viewer", "", None]:
            with self.subTest(role=role):
                db = mock_database(bill, lines)
                actor = SimpleNamespace(role=role)
                self.assert_error("admin_only", confirm_approved_channel_platform_variance,
                                  bill.id, payload, db=db, user=actor, status=403)
                self.assert_error("admin_only", get_channel_manual_review_exception,
                                  bill.id, NOW, db=db, user=actor, status=403)
                db.execute.assert_not_called()

    def test_discovery_locks_saved_rows_and_requires_the_exact_version(self):
        bill, lines = fixture()
        db = mock_database(bill, lines)
        result = get_channel_manual_review_exception(bill.id, NOW, db=db, user=ADMIN)
        self.assertEqual(result["exception"]["code"], EXCEPTION_CODE)
        statements = [str(call.args[0]) for call in db.execute.call_args_list]
        self.assertTrue(all("FOR UPDATE" in sql for sql in statements if "FROM channel_" in sql))
        db = mock_database(bill, lines)
        self.assert_error("manual_review_revision_changed", get_channel_manual_review_exception,
                          bill.id, NOW - timedelta(microseconds=1), db=db, user=ADMIN)
        self.assertEqual(db.execute.call_count, 1)
        self.assert_error("bill_not_found", get_channel_manual_review_exception,
                          bill.id, NOW, db=mock_database(), user=ADMIN, status=404)

    def test_manual_confirmation_is_not_implied_by_document_attestation(self):
        bill, lines = fixture()
        for changes in [dict(manual_review_confirmed=False, evidence_confirmed=True),
                        dict(manual_review_reason="核" * 11), dict(manual_review_reason="")]:
            db = mock_database(bill, lines)
            payload = payload_for(bill, lines, **changes)
            with patch("app.api.bill_lifecycle.transition_bill") as transition:
                self.assert_error("manual_review_basis_required", confirm_approved_channel_platform_variance,
                                  bill.id, payload, db=db, user=ADMIN, status=422)
                transition.assert_not_called()
            db.add.assert_not_called()
            db.commit.assert_not_called()

    def test_stale_same_total_original_fields_never_reach_transition_or_audit(self):
        for target, field, new in [
            ("bill", "remark", "其他备注"), ("bill", "updated_at", NOW + timedelta(microseconds=1)),
            ("bill", "received_amount", Decimal("86")),
            ("line", "game_name", "改名但金额不变"), ("line", "sort_order", 1),
            ("line", "channel_fee_rate", Decimal("0.0001")),
            ("line", "updated_at", NOW + timedelta(microseconds=1)),
        ]:
            with self.subTest(target=target, field=field):
                bill, lines = fixture()
                payload = payload_for(bill, lines)
                setattr(bill if target == "bill" else lines[0], field, new)
                db = mock_database(bill, lines)
                with patch("app.api.bill_lifecycle.transition_bill") as transition:
                    self.assert_error("manual_review_revision_changed", confirm_approved_channel_platform_variance,
                                      bill.id, payload, db=db, user=ADMIN)
                    transition.assert_not_called()
                db.add.assert_not_called()
                db.commit.assert_not_called()

    def test_existing_total_and_line_id_cas_still_apply_to_the_exception(self):
        bill, lines = fixture()
        for changes in [dict(expected_system_amount=135.84), dict(expected_platform_amount=144.39),
                        dict(expected_settlement_amount=144.39), dict(expected_signed_difference_cents=-854),
                        dict(expected_line_ids=["another-line"])]:
            with self.subTest(changes=changes):
                db = mock_database(bill, lines)
                self.assert_error("platform_variance_stale_review", confirm_approved_channel_platform_variance,
                                  bill.id, payload_for(bill, lines, **changes), db=db, user=ADMIN)
                db.add.assert_not_called()

    def test_other_bills_and_4399_without_explicit_exception_still_require_attachment(self):
        for channel, partner, number, month in [
            (CHANNEL_NAME, PARTNER_NAME, STATEMENT_NO, MONTH),
            (CHANNEL_NAME, PARTNER_NAME, "QD-ANOTHER-4399", MONTH),
            (CHANNEL_NAME, PARTNER_NAME, STATEMENT_NO, "2026-08"),
            ("小米", "小米", "QD-XIAOMI", MONTH),
        ]:
            with self.subTest(channel=channel, number=number, month=month):
                bill, lines = fixture()
                payload = payload_for(bill, lines, manual_review_exception=None, evidence_confirmed=True)
                bill.channel_name, bill.partner_name = channel, partner
                bill.statement_no, bill.settlement_month = number, month
                for line in lines:
                    line.settlement_cycle = month
                db = mock_database(bill, lines)
                self.assert_error("documented_platform_attachment_required", confirm_approved_channel_platform_variance,
                                  bill.id, payload, db=db, user=ADMIN, status=422)
                db.add.assert_not_called()

    def test_exception_cannot_be_reused_on_other_bill_or_mixed_with_honor_policy(self):
        bill, lines = fixture()
        payload = payload_for(bill, lines)
        bill.statement_no = "QD-ANOTHER-4399"
        db = mock_database(bill, lines)
        self.assert_error("manual_review_exception_invalid", confirm_approved_channel_platform_variance,
                          bill.id, payload, db=db, user=ADMIN)
        bill.statement_no = STATEMENT_NO
        payload = payload_for(bill, lines, official_statement_policy="honor_official_statement_v1")
        self.assert_error("manual_review_exception_invalid", confirm_approved_channel_platform_variance,
                          bill.id, payload, db=db, user=ADMIN)
        db.add.assert_not_called()

    def test_pending_contract_money_and_identity_or_authorization_failures_remain_blocked(self):
        bill, lines = fixture()
        base = dict(id="case", line_id=lines[0].id, game_name=lines[0].game_name,
                    settlement_cycle=MONTH, expected_amount=135.85, actual_amount=144.40)
        variations = [
            (dict(status="pending", source_snapshot_json={"checks": [{"key": "share_rate", "status": "fail"}]}), "contract_difference_unresolved"),
            (dict(status="resolved", source_snapshot_json={"checks": [{"key": "authorization", "status": "fail"}]}), "contract_identity_failed"),
            (dict(status="resolved", source_snapshot_json={"match": {"authorization_status": "expired"}}), "contract_authorization_failed"),
        ]
        for fields, code in variations:
            with self.subTest(code=code):
                db = mock_database(bill, lines, cases=[dict(base, **fields)])
                with patch("app.api.bill_lifecycle.transition_bill") as transition:
                    self.assert_error(code, confirm_approved_channel_platform_variance,
                                      bill.id, payload_for(bill, lines), db=db, user=ADMIN)
                    transition.assert_not_called()
                db.add.assert_not_called()
                self.assertFalse(any(str(call.args[0]).lstrip().upper().startswith(("UPDATE", "DELETE", "INSERT"))
                                     for call in db.execute.call_args_list))

    def test_lifecycle_guard_flag_is_removed_if_transition_fails(self):
        bill, lines = fixture()
        db = mock_database(bill, lines)
        with patch("app.api.bill_lifecycle.transition_bill", side_effect=RuntimeError("synthetic failure")):
            with self.assertRaisesRegex(RuntimeError, "synthetic failure"):
                confirm_approved_channel_platform_variance(bill.id, payload_for(bill, lines), db=db, user=ADMIN)
        self.assertNotIn("allow_lifecycle_transition", db.info)
        db.commit.assert_not_called()
        self.assertEqual(bill.status, "pending")


class SQLiteApprovalSession(Session):
    """Use real rows/commits, translating only PostgreSQL-specific primitives."""
    def execute(self, statement, params=None, *args, **kwargs):
        if isinstance(statement, TextClause):
            sql = str(statement)
            if "FROM pg_trigger" in sql:
                # Only the PostgreSQL catalog guard is simulated. Origins below
                # are real persisted local rows, with typed JSON/date decoding.
                statement = select(literal(True))
            elif "FROM operation_logs" in sql:
                statement = statement.columns(created_at=DateTime(timezone=True), metadata=JSON())
            elif "to_regclass('public.cf_contract_difference_cases')" in sql:
                statement = text("SELECT 'cf_contract_difference_cases'")
            elif "set_config('app.operation_reason'" in sql:
                statement = text("SELECT :reason")
            elif "FROM cf_contract_difference_cases" in sql:
                statement = text(sql.replace(" FOR UPDATE", ""))
        return super().execute(statement, params, *args, **kwargs)


class SingleBillCashFactsIntegrationTests(TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
        for model in [ChannelRecord, ChannelRecordLineItem, ChannelReceipt, BankReconciliationMatch]:
            model.__table__.create(self.engine)
        # JSONB is persisted as JSON text only in this local SQLite adapter.
        with self.engine.begin() as connection:
            connection.execute(text("CREATE TABLE cf_partner_records (id TEXT PRIMARY KEY, name TEXT, category TEXT)"))
            connection.execute(text("INSERT INTO cf_partner_records VALUES (:id, :name, '渠道')"),
                               {"id": PARTNER_ID, "name": PARTNER_NAME})
            connection.execute(text("""CREATE TABLE cf_contract_difference_cases (
                id TEXT, line_id TEXT, game_name TEXT, settlement_cycle TEXT, status TEXT,
                handling_type TEXT, expected_amount NUMERIC, actual_amount NUMERIC,
                difference_amount NUMERIC, source_snapshot_json TEXT, bill_type TEXT,
                bill_id TEXT, updated_at TEXT)"""))
            connection.execute(text("""CREATE TABLE operation_logs (
                id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
                entity_number TEXT, action TEXT NOT NULL, summary TEXT NOT NULL,
                actor_user_id TEXT, actor_email TEXT, changes TEXT NOT NULL,
                metadata TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL)"""))
        self.db = SQLiteApprovalSession(self.engine)
        bill, lines = fixture()
        self.bill = ChannelRecord(**vars(bill))
        self.db.add(self.bill)
        self.db.add(OperationLog(
            id="original-create-event", entity_type="channel", entity_id=bill.id,
            entity_number=STATEMENT_NO, action="create", summary="原始创建事件",
            actor_user_id=ADMIN.id, actor_email=ADMIN.email, changes={},
            metadata_json={"table": "channel_records", "operation": "INSERT"},
            created_at=bill.created_at,
        ))
        self.db.add_all([ChannelRecordLineItem(**vars(line)) for line in lines])
        self.db.add(ChannelReceipt(
            id="original-receipt", channel_record_id=bill.id, amount=Decimal("85"),
            receipt_date="2026-10-16", remark="原已核销收款，不能修改", created_at=NOW,
        ))
        self.db.add(BankReconciliationMatch(
            id="original-bank-match", bank_transaction_id="synthetic-bank-transaction",
            direction="collection", bill_type="channel", bill_id=bill.id,
            bill_number=STATEMENT_NO, linked_amount=Decimal("85"),
            confidence_score=100, confidence_level="high", generated_receipt_id="original-receipt",
            status="confirmed", original_transaction_type="statement_import", confirmed_at=NOW,
            created_at=NOW, updated_at=NOW,
        ))
        self.db.commit()
        self.lines = self.db.execute(select(ChannelRecordLineItem)).scalars().all()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def facts(self):
        return {
            "origin": row_values(self.db.get(OperationLog, "original-create-event"), OperationLog),
            "bill": row_values(self.db.get(ChannelRecord, self.bill.id), ChannelRecord),
            "lines": [row_values(row, ChannelRecordLineItem) for row in self.db.execute(select(ChannelRecordLineItem)).scalars()],
            "receipts": [row_values(row, ChannelReceipt) for row in self.db.execute(select(ChannelReceipt)).scalars()],
            "bank_matches": [row_values(row, BankReconciliationMatch) for row in self.db.execute(select(BankReconciliationMatch)).scalars()],
        }

    def test_real_original_create_event_prevents_number_reassignment_to_another_saved_bill(self):
        old_payload = payload_for(self.bill, self.lines, self.db)
        original_event = row_values(self.db.get(OperationLog, "original-create-event"), OperationLog)
        self.bill.statement_no = "QD-ORIGINAL-NUMBER-MOVED"
        self.db.flush()
        copied_bill, copied_lines = fixture()
        copied_bill.id = "other-existing-bill"
        copied_lines[0].id = "other-existing-line"
        copied_lines[0].channel_record_id = copied_bill.id
        replacement = ChannelRecord(**vars(copied_bill))
        replacement_lines = [ChannelRecordLineItem(**vars(row)) for row in copied_lines]
        self.db.add(replacement)
        self.db.add_all(replacement_lines)
        self.db.add(OperationLog(
            id="other-original-create-event", entity_type="channel", entity_id=replacement.id,
            entity_number="QD-OTHER-ORIGINAL-NUMBER", action="create", summary="其他账单原始创建事件",
            changes={}, metadata_json={"table": "channel_records", "operation": "INSERT"},
            created_at=copied_bill.created_at,
        ))
        self.db.commit()
        for operation in [
            lambda: resolve_manual_review_exception(self.db, replacement, replacement_lines),
            lambda: confirm_approved_channel_platform_variance(
                replacement.id, old_payload, db=self.db, user=ADMIN),
        ]:
            with self.assertRaises(HTTPException) as caught:
                operation()
            self.assertEqual(caught.exception.detail["error"], "manual_review_origin_unverified")
        self.assertEqual(replacement.status, "pending")
        self.assertEqual(row_values(self.db.get(OperationLog, "original-create-event"), OperationLog), original_event)
        logs = self.db.execute(select(OperationLog)).scalars().all()
        self.assertEqual(len(logs), 2)
        self.assertTrue(all(log.action == "create" for log in logs))

    def test_successful_real_transition_preserves_all_original_amounts_receipts_and_bank_matches(self):
        before = self.facts()
        payload = payload_for(self.bill, self.lines, self.db)
        response = dict(
            bill_type="channel", bill_id=self.bill.id, status="confirmed", status_label="已核对",
            locked=True, final=False, payment_phase="partial", payment_label="部分收款",
            bill_amount=144.40, paid_amount=85, invoice_coverage_status="none",
            invoice_coverage_percent=0, invoice_allocated_amount=0, invoice_remaining_amount=144.40,
            transitions=[],
        )
        statements = []
        def capture(_connection, _cursor, statement, _params, _context, _executemany):
            statements.append(statement)
        event.listen(self.engine, "before_cursor_execute", capture)
        with patch("app.services.bill_lifecycle.build_lifecycle_snapshot", return_value=response), \
             patch("app.api.bill_lifecycle._snapshot", return_value=response):
            result = confirm_approved_channel_platform_variance(
                self.bill.id, payload, db=self.db, user=ADMIN)
        self.assertEqual(result.status, "confirmed")
        self.db.expire_all()
        after = self.facts()
        self.assertEqual(after["bill"].pop("status"), "confirmed")
        self.assertEqual(before["bill"].pop("status"), "pending")
        self.assertNotEqual(after["bill"].pop("updated_at"), before["bill"].pop("updated_at"))
        self.assertEqual(after, before)
        self.assertEqual(self.bill.validation_status, "fail")
        self.assertEqual(float(self.bill.system_settlement_amount), 135.85)
        self.assertEqual(float(self.bill.platform_settlement_amount), 144.40)
        self.assertEqual(float(self.bill.settlement_difference), -8.55)
        self.assertEqual(float(self.bill.settlement_amount), 144.40)
        self.assertNotIn("allow_lifecycle_transition", self.db.info)
        logs = self.db.execute(select(OperationLog)).scalars().all()
        self.assertEqual(len(logs), 2)
        log = next(row for row in logs if row.action == "channel_single_bill_manual_confirm")
        self.assertEqual(log.action, "channel_single_bill_manual_confirm")
        self.assertEqual(log.entity_number, STATEMENT_NO)
        self.assertEqual(log.actor_user_id, ADMIN.id)
        self.assertEqual(log.changes, {})
        self.assertEqual(log.metadata_json["approval_source"], "single_bill_manual_basis")
        self.assertEqual(log.metadata_json["manual_review_reason"], BASIS)
        self.assertTrue(log.metadata_json["manual_review_confirmed"])
        self.assertTrue(log.metadata_json["attachment_exempted"])
        self.assertIsNone(log.metadata_json["evidence_attachment_id"])
        self.assertEqual(log.metadata_json["manual_review_exception"]["review_revision"], payload.manual_review_revision)
        self.assertEqual(log.metadata_json["manual_review_exception"]["origin"]["event_id"], "original-create-event")
        self.assertEqual(log.metadata_json["manual_review_exception"]["origin"]["bill_id"], self.bill.id)
        writes = [sql.lower() for sql in statements if sql.lstrip().upper().startswith(("UPDATE", "DELETE", "INSERT"))]
        self.assertTrue(any(sql.startswith("update channel_records set status=") for sql in writes))
        self.assertTrue(any(sql.startswith("insert into operation_logs") for sql in writes))
        self.assertFalse(any("channel_receipts" in sql or "bank_reconciliation_matches" in sql
                             or "channel_record_line_items" in sql for sql in writes))
        self.assertFalse(any(sql.startswith("delete") for sql in writes))


if __name__ == "__main__":
    import unittest
    unittest.main()
