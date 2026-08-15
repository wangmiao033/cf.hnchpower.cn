from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, got {count}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Contract-side prepayment deduction ledger. Contract prepayment_amount is the
# product-level rule/limit; this table records actual consumption by R&D bill.
# ---------------------------------------------------------------------------
write(
    "contract_terms/rd_prepayment.py",
    '''"""Product-level R&D prepayment deduction ledger."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import uuid4

CENT = Decimal("0.01")
ZERO = Decimal("0")


def _decimal(value: Any) -> Decimal:
    try:
        parsed = Decimal(str(value or 0))
    except Exception:
        return ZERO
    if not parsed.is_finite():
        return ZERO
    return parsed


def _money(value: Any) -> Decimal:
    return _decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def ensure_rd_prepayment_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cf_rd_prepayment_deductions (
          id TEXT PRIMARY KEY,
          bill_id TEXT NOT NULL,
          line_index INTEGER NOT NULL DEFAULT 0,
          line_id TEXT NOT NULL DEFAULT '',
          access_item_id TEXT NOT NULL,
          contract_id TEXT NOT NULL DEFAULT '',
          settlement_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
          deduction_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (bill_id, line_index)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_deductions_access
        ON cf_rd_prepayment_deductions (access_item_id, created_at)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_cf_rd_prepayment_deductions_bill
        ON cf_rd_prepayment_deductions (bill_id)
        """
    )


def enrich_prepayment_candidates(
    conn,
    candidates: list[dict],
    *,
    exclude_bill_id: str | None = None,
) -> list[dict]:
    """Attach used/available product prepayment to contract access candidates."""
    ensure_rd_prepayment_table(conn)
    access_ids = list(
        dict.fromkeys(
            str(item.get("access_item_id") or "").strip()
            for item in candidates
            if str(item.get("access_item_id") or "").strip()
        )
    )
    used_map: dict[str, Decimal] = {}
    if access_ids:
        placeholders = ",".join(["%s"] * len(access_ids))
        sql = f"""
            SELECT access_item_id, COALESCE(SUM(deduction_amount), 0) AS used_amount
            FROM cf_rd_prepayment_deductions
            WHERE access_item_id IN ({placeholders})
        """
        params: list[Any] = list(access_ids)
        if exclude_bill_id:
            sql += " AND bill_id <> %s"
            params.append(exclude_bill_id)
        sql += " GROUP BY access_item_id"
        for row in conn.execute(sql, params).fetchall():
            used_map[str(row["access_item_id"])] = _money(row.get("used_amount"))

    out: list[dict] = []
    for source in candidates:
        item = dict(source)
        access_id = str(item.get("access_item_id") or "").strip()
        agreed = max(ZERO, _money(item.get("prepayment_amount")))
        used = max(ZERO, used_map.get(access_id, ZERO))
        available = max(ZERO, agreed - used)
        item["prepayment_used_amount"] = float(used)
        item["prepayment_available_amount"] = float(available)
        out.append(item)
    return out


def _line_rows(conn, bill_id: str) -> list[dict]:
    return list(
        conn.execute(
            """
            SELECT id, settlement_amount, sort_order
            FROM reconciliation_line_items
            WHERE reconciliation_id = %s
            ORDER BY sort_order, created_at, id
            """,
            [bill_id],
        ).fetchall()
    )


def replace_bill_prepayment_deductions(
    conn,
    bill_id: str,
    metadata: list[dict],
    actor: str,
) -> list[dict]:
    """Atomically rebuild deductions for one bill and return audited metadata."""
    ensure_rd_prepayment_table(conn)
    conn.execute("DELETE FROM cf_rd_prepayment_deductions WHERE bill_id = %s", [bill_id])
    lines = _line_rows(conn, bill_id)
    updated: list[dict] = []

    for position, source in enumerate(metadata or []):
        item = dict(source or {})
        try:
            line_index = int(item.get("line_index", position))
        except (TypeError, ValueError):
            line_index = position
        line = lines[line_index] if 0 <= line_index < len(lines) else None
        settlement = max(ZERO, _money(line.get("settlement_amount") if line else 0))
        access_item_id = str(item.get("access_item_id") or "").strip()

        item.update(
            {
                "prepayment_enabled": False,
                "prepayment_agreed_amount": 0.0,
                "prepayment_used_amount": 0.0,
                "prepayment_available_before": 0.0,
                "prepayment_deduction": 0.0,
                "prepayment_available_after": 0.0,
                "actual_payable": float(settlement),
            }
        )
        if not line or not access_item_id:
            updated.append(item)
            continue

        term = conn.execute(
            """
            SELECT terms.prepayment_amount, access.contract_id
            FROM cf_contract_access_terms AS terms
            JOIN cf_contract_access_items AS access ON access.id = terms.access_item_id
            WHERE terms.access_item_id = %s
            FOR UPDATE OF terms
            """,
            [access_item_id],
        ).fetchone()
        agreed = max(ZERO, _money(term.get("prepayment_amount") if term else 0))
        if term is None or agreed <= ZERO:
            updated.append(item)
            continue

        used_row = conn.execute(
            """
            SELECT COALESCE(SUM(deduction_amount), 0) AS used_amount
            FROM cf_rd_prepayment_deductions
            WHERE access_item_id = %s
            """,
            [access_item_id],
        ).fetchone()
        used = max(ZERO, _money(used_row.get("used_amount") if used_row else 0))
        available = max(ZERO, agreed - used)
        deduction = min(settlement, available)
        after = max(ZERO, available - deduction)
        actual = max(ZERO, settlement - deduction)

        if deduction > ZERO:
            conn.execute(
                """
                INSERT INTO cf_rd_prepayment_deductions (
                  id, bill_id, line_index, line_id, access_item_id, contract_id,
                  settlement_amount, deduction_amount, created_by, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                """,
                [
                    uuid4().hex,
                    bill_id,
                    line_index,
                    str(line.get("id") or ""),
                    access_item_id,
                    str(term.get("contract_id") or item.get("contract_id") or ""),
                    settlement,
                    deduction,
                    actor,
                ],
            )

        item.update(
            {
                "prepayment_enabled": True,
                "prepayment_agreed_amount": float(agreed),
                "prepayment_used_amount": float(used),
                "prepayment_available_before": float(available),
                "prepayment_deduction": float(deduction),
                "prepayment_available_after": float(after),
                "actual_payable": float(actual),
            }
        )
        updated.append(item)

    return updated
''',
)

# ---------------------------------------------------------------------------
# Contract recommendation: expose prepayment state and calculate draft
# deduction/actual payable while preserving settlement_amount as R&D cost.
# ---------------------------------------------------------------------------
replace_once(
    "contract_terms/rd_rule_recommender.py",
    '        "testing_fee": candidate.get("testing_fee"),\n        "settlement_mode": candidate.get("settlement_mode"),',
    '        "testing_fee": candidate.get("testing_fee"),\n        "prepayment_amount": candidate.get("prepayment_amount"),\n        "prepayment_used_amount": candidate.get("prepayment_used_amount"),\n        "prepayment_available_amount": candidate.get("prepayment_available_amount"),\n        "settlement_mode": candidate.get("settlement_mode"),',
)
replace_once(
    "contract_terms/rd_rule_recommender.py",
    '    testing = _number(candidate.get("testing_fee"))\n    if share is None:',
    '    testing = _number(candidate.get("testing_fee"))\n    prepayment_agreed = max(0.0, _safe_number(candidate.get("prepayment_amount")))\n    prepayment_used = max(0.0, _safe_number(candidate.get("prepayment_used_amount")))\n    prepayment_available = max(\n        0.0,\n        _safe_number(\n            candidate.get("prepayment_available_amount"),\n            max(0.0, prepayment_agreed - prepayment_used),\n        ),\n    )\n    if share is None:',
)
replace_once(
    "contract_terms/rd_rule_recommender.py",
    '        "test_fee": None if testing is None else round(testing, 2),\n        "warnings": warnings,',
    '        "test_fee": None if testing is None else round(testing, 2),\n        "prepayment_enabled": prepayment_agreed > EPS,\n        "prepayment_agreed_amount": round(prepayment_agreed, 2),\n        "prepayment_used_amount": round(prepayment_used, 2),\n        "prepayment_available_before": round(prepayment_available, 2),\n        "prepayment_deduction": 0.0,\n        "prepayment_available_after": round(prepayment_available, 2),\n        "actual_payable": None,\n        "warnings": warnings,',
)
replace_once(
    "contract_terms/rd_rule_recommender.py",
    '    results: list[dict] = []\n    for index, raw in enumerate(lines or []):',
    '    results: list[dict] = []\n    remaining_prepayment: dict[str, float] = {}\n    for index, raw in enumerate(lines or []):',
)
replace_once(
    "contract_terms/rd_rule_recommender.py",
    '            contract_amount["message"] = "已找到合同参考金额，但合同身份尚未达到自动带入阈值，需人工确认。"\n\n        results.append({',
    '            contract_amount["message"] = "已找到合同参考金额，但合同身份尚未达到自动带入阈值，需人工确认。"\n\n        expected_amount = _number(contract_amount.get("expected_amount"))\n        current_amount = max(0.0, _safe_number(raw.get("settlement_amount")))\n        due_amount = max(\n            0.0,\n            expected_amount\n            if contract_amount.get("deterministic") and expected_amount is not None\n            else current_amount,\n        )\n        access_key = _text(candidate.get("access_item_id")) or f"line:{source_index}"\n        available_before = max(0.0, _safe_number(recommended.get("prepayment_available_before")))\n        if recommended.get("prepayment_enabled"):\n            available_before = remaining_prepayment.get(access_key, available_before)\n            deduction = min(due_amount, max(0.0, available_before))\n            available_after = max(0.0, available_before - deduction)\n            remaining_prepayment[access_key] = available_after\n        else:\n            deduction = 0.0\n            available_after = available_before\n        recommended["prepayment_available_before"] = round(available_before, 2)\n        recommended["prepayment_deduction"] = round(deduction, 2)\n        recommended["prepayment_available_after"] = round(available_after, 2)\n        recommended["actual_payable"] = round(max(0.0, due_amount - deduction), 2)\n\n        results.append({',
)
replace_once(
    "contract_terms/rd_rule_recommender.py",
    '        "version": "contract-rd-entry-v1",',
    '        "version": "contract-rd-entry-v2",',
)

# Wire prepayment into the deployed contract_terms entrypoint.
replace_once(
    "contract_terms/v9_main.py",
    '    from .rd_rule_recommender import recommend_rd_rules\n',
    '    from .rd_rule_recommender import recommend_rd_rules\n    from .rd_prepayment import enrich_prepayment_candidates, replace_bill_prepayment_deductions\n',
)
replace_once(
    "contract_terms/v9_main.py",
    '    from rd_rule_recommender import recommend_rd_rules\n',
    '    from rd_rule_recommender import recommend_rd_rules\n    from rd_prepayment import enrich_prepayment_candidates, replace_bill_prepayment_deductions\n',
)
replace_once(
    "contract_terms/v9_main.py",
    '    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:\n        candidates = _candidate_rows(conn)\n        result = recommend_rd_rules(partner_name, lines, candidates)\n    return {**result, "partner_name": partner_name, "generated_at": datetime.now(timezone.utc).isoformat()}',
    '    bill_id = _text(payload.get("bill_id"), 128)\n    with psycopg.connect(_database_url(), connect_timeout=15, row_factory=dict_row) as conn:\n        candidates = enrich_prepayment_candidates(\n            conn,\n            _candidate_rows(conn),\n            exclude_bill_id=bill_id or None,\n        )\n        result = recommend_rd_rules(partner_name, lines, candidates)\n        conn.commit()\n    return {**result, "partner_name": partner_name, "generated_at": datetime.now(timezone.utc).isoformat()}',
)
replace_once(
    "contract_terms/v9_main.py",
    '    snapshot_id = uuid4().hex\n    conn.execute(\n        """\n        INSERT INTO cf_rd_contract_entry_snapshots',
    '    finalized_metadata = replace_bill_prepayment_deductions(\n        conn,\n        str(bill["id"]),\n        finalized_metadata,\n        actor,\n    )\n\n    snapshot_id = uuid4().hex\n    conn.execute(\n        """\n        INSERT INTO cf_rd_contract_entry_snapshots',
)

# ---------------------------------------------------------------------------
# Core backend: payment/outstanding uses actual cash payable; invoice coverage
# continues to use the full R&D settlement amount.
# ---------------------------------------------------------------------------
write(
    "backend/app/services/rd_prepayment.py",
    '''"""Read R&D prepayment deductions without coupling core ORM to contract tables."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

EPS = Decimal("0.005")


def _decimal(value: Any) -> Decimal:
    try:
        parsed = Decimal(str(value or 0))
    except Exception:
        return Decimal("0")
    return parsed if parsed.is_finite() else Decimal("0")


def deductions_for_bill_ids(db: Session, bill_ids: list[str]) -> dict[str, Decimal]:
    ids = list(dict.fromkeys(str(value) for value in bill_ids if value))
    if not ids:
        return {}
    exists = db.execute(text("SELECT to_regclass('public.cf_rd_prepayment_deductions')")).scalar_one_or_none()
    if not exists:
        return {}
    stmt = text(
        """
        SELECT bill_id, COALESCE(SUM(deduction_amount), 0) AS deduction_amount
        FROM cf_rd_prepayment_deductions
        WHERE bill_id IN :bill_ids
        GROUP BY bill_id
        """
    ).bindparams(bindparam("bill_ids", expanding=True))
    return {
        str(row.bill_id): max(Decimal("0"), _decimal(row.deduction_amount))
        for row in db.execute(stmt, {"bill_ids": ids}).all()
    }


def financial_payable(settlement_amount: Any, prepayment_deduction: Any) -> tuple[Decimal, Decimal]:
    """Return capped deduction and remaining cash payable.

    Negative R&D settlements keep their previous absolute cash-payable behavior and
    never add value back to the prepayment pool.
    """
    signed = _decimal(settlement_amount)
    bill_amount = abs(signed)
    requested = max(Decimal("0"), _decimal(prepayment_deduction)) if signed > EPS else Decimal("0")
    deduction = min(bill_amount, requested)
    return deduction, max(Decimal("0"), bill_amount - deduction)
''',
)

replace_once(
    "backend/app/schemas/reconciliation.py",
    '    refund_amount: float\n    settlement_amount: float\n    status: str | None',
    '    refund_amount: float\n    settlement_amount: float\n    prepayment_deduction: float = 0\n    actual_payable: float = 0\n    status: str | None',
)
replace_once(
    "backend/app/api/reconciliation.py",
    'from app.services.rd_bank_payment_aggregate import (\n    RD_TYPE,\n    aggregate_rd_payments_for_ids,\n    fill_payable_for_row,\n)\n',
    'from app.services.rd_bank_payment_aggregate import (\n    RD_TYPE,\n    aggregate_rd_payments_for_ids,\n    fill_payable_for_row,\n)\nfrom app.services.rd_prepayment import deductions_for_bill_ids, financial_payable\n',
)
replace_once(
    "backend/app/api/reconciliation.py",
    '    st = compute_bank_payment_list_status(float(row.settlement_amount or 0), bp)\n    try:\n        agg_map = aggregate_rd_payments_for_ids(db, [row.id])\n    except (OperationalError, ProgrammingError):\n        agg_map = {}\n    pay = fill_payable_for_row(agg_map.get(row.id), row.settlement_amount)\n',
    '    prepayment_map = deductions_for_bill_ids(db, [row.id])\n    prepayment_deduction, actual_payable = financial_payable(\n        row.settlement_amount,\n        prepayment_map.get(row.id, 0),\n    )\n    st = compute_bank_payment_list_status(float(actual_payable), bp)\n    try:\n        agg_map = aggregate_rd_payments_for_ids(db, [row.id])\n    except (OperationalError, ProgrammingError):\n        agg_map = {}\n    pay = fill_payable_for_row(agg_map.get(row.id), actual_payable)\n',
)
replace_once(
    "backend/app/api/reconciliation.py",
    '            "bank_payment_list_status": st,\n            "paid_amount": float(pay.paid_amount),',
    '            "bank_payment_list_status": st,\n            "prepayment_deduction": float(prepayment_deduction),\n            "actual_payable": float(actual_payable),\n            "paid_amount": float(pay.paid_amount),',
)
replace_once(
    "backend/app/api/reconciliation.py",
    '    try:\n        agg_map = aggregate_rd_payments_for_ids(db, [r.id for r in rows])\n    except (OperationalError, ProgrammingError):\n        agg_map = {}\n    links = load_partner_links(db, [r.id for r in rows])',
    '    try:\n        agg_map = aggregate_rd_payments_for_ids(db, [r.id for r in rows])\n    except (OperationalError, ProgrammingError):\n        agg_map = {}\n    prepayment_map = deductions_for_bill_ids(db, [r.id for r in rows])\n    links = load_partner_links(db, [r.id for r in rows])',
)
replace_once(
    "backend/app/api/reconciliation.py",
    '        st = compute_bank_payment_list_status(float(r.settlement_amount or 0), bp_map.get(r.id))\n        pay = fill_payable_for_row(agg_map.get(r.id), r.settlement_amount)\n        link = links.get(r.id)',
    '        prepayment_deduction, actual_payable = financial_payable(\n            r.settlement_amount,\n            prepayment_map.get(r.id, 0),\n        )\n        st = compute_bank_payment_list_status(float(actual_payable), bp_map.get(r.id))\n        pay = fill_payable_for_row(agg_map.get(r.id), actual_payable)\n        link = links.get(r.id)',
)
replace_once(
    "backend/app/api/reconciliation.py",
    '                    "bank_payment_list_status": st,\n                    "paid_amount": float(pay.paid_amount),',
    '                    "bank_payment_list_status": st,\n                    "prepayment_deduction": float(prepayment_deduction),\n                    "actual_payable": float(actual_payable),\n                    "paid_amount": float(pay.paid_amount),',
)

# Lifecycle/360/archive: cash closure respects prepayment while invoice coverage
# continues to compare against the full settlement amount.
replace_once(
    "backend/app/services/bill_lifecycle.py",
    'from app.services.rd_bank_payment_aggregate import (\n    aggregate_rd_payments_for_ids,\n    fill_payable_for_row,\n)\n',
    'from app.services.rd_bank_payment_aggregate import (\n    aggregate_rd_payments_for_ids,\n    fill_payable_for_row,\n)\nfrom app.services.rd_prepayment import deductions_for_bill_ids, financial_payable\n',
)
replace_once(
    "backend/app/services/bill_lifecycle.py",
    '    if bill_type == "rd":\n        aggregate = aggregate_rd_payments_for_ids(db, [str(bill.id)]).get(str(bill.id))\n        payment = fill_payable_for_row(aggregate, bill_amount)\n        paid = round(float(payment.paid_amount), 2)\n        if paid <= 0.01:\n            phase = "unpaid"\n        elif paid + 0.01 < bill_amount:\n            phase = "partial"\n        else:\n            phase = "paid"\n        label = {"unpaid": "未付款", "partial": "部分付款", "paid": "已付款"}[phase]\n',
    '    if bill_type == "rd":\n        bill_id = str(bill.id)\n        deduction_map = deductions_for_bill_ids(db, [bill_id])\n        prepayment_deduction, actual_payable = financial_payable(\n            bill_amount,\n            deduction_map.get(bill_id, 0),\n        )\n        aggregate = aggregate_rd_payments_for_ids(db, [bill_id]).get(bill_id)\n        payment = fill_payable_for_row(aggregate, actual_payable)\n        paid = round(float(payment.paid_amount), 2)\n        cash_payable = round(float(actual_payable), 2)\n        if cash_payable <= 0.01:\n            phase = "paid"\n            label = "预付款已抵扣" if prepayment_deduction > 0 else "无需付款"\n        elif paid <= 0.01:\n            phase = "unpaid"\n            label = "未付款"\n        elif paid + 0.01 < cash_payable:\n            phase = "partial"\n            label = "部分付款"\n        else:\n            phase = "paid"\n            label = "已付款"\n',
)

# ---------------------------------------------------------------------------
# Frontend API types and mapping.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/api/reconciliation.ts",
    '  settlement_amount: number\n  status: string | null',
    '  settlement_amount: number\n  prepayment_deduction?: number\n  actual_payable?: number\n  status: string | null',
)
replace_once(
    "src/lib/api/reconciliation.ts",
    "    settlementAmount:\n      row.settlement_amount != null ? Number(row.settlement_amount).toFixed(2) : '0.00',\n    status: row.status || 'pending',",
    "    settlementAmount:\n      row.settlement_amount != null ? Number(row.settlement_amount).toFixed(2) : '0.00',\n    prepaymentDeduction:\n      row.prepayment_deduction != null ? Number(row.prepayment_deduction).toFixed(2) : '0.00',\n    actualPayable:\n      row.actual_payable != null\n        ? Number(row.actual_payable).toFixed(2)\n        : Math.max(0, Number(row.settlement_amount || 0) - Number(row.prepayment_deduction || 0)).toFixed(2),\n    status: row.status || 'pending',",
)
replace_once(
    "src/lib/api/rdContractEntry.ts",
    '  testing_fee?: number | null\n  settlement_mode?: string | null',
    '  testing_fee?: number | null\n  prepayment_amount?: number | null\n  prepayment_used_amount?: number | null\n  prepayment_available_amount?: number | null\n  settlement_mode?: string | null',
)
replace_once(
    "src/lib/api/rdContractEntry.ts",
    '  test_fee: number | null\n  warnings: string[]',
    '  test_fee: number | null\n  prepayment_enabled: boolean\n  prepayment_agreed_amount: number\n  prepayment_used_amount: number\n  prepayment_available_before: number\n  prepayment_deduction: number\n  prepayment_available_after: number\n  actual_payable: number | null\n  warnings: string[]',
)
replace_once(
    "src/lib/api/rdContractEntry.ts",
    'export function recommendRdContractRules(payload: {\n  partner_name: string\n  lines: RdContractEntryLineInput[]\n}): Promise<RdContractRuleRecommendation>',
    'export function recommendRdContractRules(payload: {\n  partner_name: string\n  bill_id?: string\n  lines: RdContractEntryLineInput[]\n}): Promise<RdContractRuleRecommendation>',
)

# ---------------------------------------------------------------------------
# Contract-driven R&D entry panel.
# ---------------------------------------------------------------------------
replace_once(
    "src/components/reconciliation/ContractDrivenRdEntry.jsx",
    '        const result = await recommendRdContractRules({ partner_name: partner, lines: requestLines })',
    '        const result = await recommendRdContractRules({\n          partner_name: partner,\n          bill_id: mode === \'edit\' && editRecord?.id ? String(editRecord.id) : undefined,\n          lines: requestLines\n        })',
)
replace_once(
    "src/components/reconciliation/ContractDrivenRdEntry.jsx",
    '  }, [formState])\n\n  const forceApplyRecommendation',
    '  }, [formState, mode, editRecord?.id])\n\n  const forceApplyRecommendation',
)
replace_once(
    "src/components/reconciliation/ContractDrivenRdEntry.jsx",
    '        contract_expected_amount: result?.contract_amount?.expected_amount ?? null,\n        contract_amount_deterministic: Boolean(result?.contract_amount?.deterministic),\n        deviations,',
    '        contract_expected_amount: result?.contract_amount?.expected_amount ?? null,\n        contract_amount_deterministic: Boolean(result?.contract_amount?.deterministic),\n        prepayment_enabled: Boolean(recommended?.prepayment_enabled),\n        prepayment_agreed_amount: recommended?.prepayment_agreed_amount ?? 0,\n        prepayment_used_amount: recommended?.prepayment_used_amount ?? 0,\n        prepayment_available_before: recommended?.prepayment_available_before ?? 0,\n        prepayment_deduction: recommended?.prepayment_deduction ?? 0,\n        prepayment_available_after: recommended?.prepayment_available_after ?? 0,\n        actual_payable: recommended?.actual_payable ?? result?.contract_amount?.expected_amount ?? 0,\n        deviations,',
)
replace_once(
    "src/components/reconciliation/ContractDrivenRdEntry.jsx",
    '  }, [formState, recommendation])\n\n  const buildAuditMetadata',
    '  }, [formState, recommendation])\n\n  const prepaymentByLine = useMemo(() => {\n    if (!recommendationCurrent) return {}\n    return Object.fromEntries(\n      (recommendation?.lines || []).map((item) => {\n        const rec = item?.recommended || {}\n        return [item.line_index, {\n          enabled: Boolean(rec.prepayment_enabled),\n          agreedAmount: num(rec.prepayment_agreed_amount),\n          usedAmount: num(rec.prepayment_used_amount),\n          availableBefore: num(rec.prepayment_available_before),\n          deduction: num(rec.prepayment_deduction),\n          availableAfter: num(rec.prepayment_available_after),\n          actualPayable: num(rec.actual_payable)\n        }]\n      })\n    )\n  }, [recommendation, recommendationCurrent])\n  const hasPrepayment = Object.values(prepaymentByLine).some((item) => item?.enabled)\n  const prepaymentDeductionTotal = Object.values(prepaymentByLine).reduce(\n    (sum, item) => sum + num(item?.deduction),\n    0\n  )\n  const actualPayableTotal = Math.max(0, currentFinal - prepaymentDeductionTotal)\n\n  const buildAuditMetadata',
)
replace_once(
    "src/components/reconciliation/ContractDrivenRdEntry.jsx",
    '                        <div><span>合同测试费</span><strong>{rec?.test_fee == null ? \'保留当前值\' : money(rec.test_fee)}</strong></div>\n                        <div><span>合同应结</span><strong>{money(item.contract_amount?.expected_amount)}</strong></div>',
    '                        <div><span>合同测试费</span><strong>{rec?.test_fee == null ? \'保留当前值\' : money(rec.test_fee)}</strong></div>\n                        <div><span>合同应结</span><strong>{money(item.contract_amount?.expected_amount)}</strong></div>\n                        {rec?.prepayment_enabled ? <div><span>预付款抵扣</span><strong>-{money(rec.prepayment_deduction)}</strong></div> : null}\n                        {rec?.prepayment_enabled ? <div><span>本期实际应付</span><strong>{money(rec.actual_payable)}</strong></div> : null}',
)
replace_once(
    "src/components/reconciliation/ContractDrivenRdEntry.jsx",
    '            <div><span>当前账单</span><strong>{money(currentFinal)}</strong></div>\n            <div className={adjustment != null && Math.abs(adjustment) > 0.01 ? \'is-diff\' : \'\'}>',
    '            <div><span>当前账单</span><strong>{money(currentFinal)}</strong></div>\n            {hasPrepayment ? <div><span>预付款抵扣</span><strong>-{money(prepaymentDeductionTotal)}</strong></div> : null}\n            {hasPrepayment ? <div><span>实际应付</span><strong>{money(actualPayableTotal)}</strong></div> : null}\n            <div className={adjustment != null && Math.abs(adjustment) > 0.01 ? \'is-diff\' : \'\'}>',
)
replace_once(
    "src/components/reconciliation/ContractDrivenRdEntry.jsx",
    '        quickFillData={effectiveQuickFill}\n        onFormStateChange={handleFormStateChange}',
    '        quickFillData={effectiveQuickFill}\n        prepaymentByLine={prepaymentByLine}\n        onFormStateChange={handleFormStateChange}',
)

# ---------------------------------------------------------------------------
# R&D line-item form: only special/prepayment games reveal the extra columns.
# ---------------------------------------------------------------------------
replace_once(
    "src/components/reconciliation/ReconciliationLineItemsForm.jsx",
    '  settlementCycles = [],\n  onError,',
    '  settlementCycles = [],\n  prepaymentByLine = {},\n  onError,',
)
replace_once(
    "src/components/reconciliation/ReconciliationLineItemsForm.jsx",
    '  }, [lines, header.channelFeeRate])\n\n  useEffect(() => {\n    if (!onPreviewChange) return',
    '  }, [lines, header.channelFeeRate])\n\n  const showPrepaymentColumns = useMemo(\n    () => Object.values(prepaymentByLine || {}).some((item) => Boolean(item?.enabled)),\n    [prepaymentByLine]\n  )\n  const prepaymentTotals = useMemo(() => {\n    let deduction = 0\n    let actualPayable = 0\n    for (let index = 0; index < lines.length; index += 1) {\n      const settlement = Math.max(0, calculateRdSettlementRow(lines[index], header.channelFeeRate).settlementAmount)\n      const requested = Math.max(0, Number(prepaymentByLine?.[index]?.deduction || 0))\n      const applied = Math.min(settlement, requested)\n      deduction += applied\n      actualPayable += Math.max(0, settlement - applied)\n    }\n    return {\n      deduction: Math.round(deduction * 100) / 100,\n      actualPayable: Math.round(actualPayable * 100) / 100\n    }\n  }, [lines, header.channelFeeRate, prepaymentByLine])\n\n  useEffect(() => {\n    if (!onPreviewChange) return',
)
replace_once(
    "src/components/reconciliation/ReconciliationLineItemsForm.jsx",
    '<div className="rd-line-items-grid">\n              <div className="rd-line-items-grid-head" aria-hidden="true">',
    '<div className={`rd-line-items-grid${showPrepaymentColumns ? \' rd-line-items-grid--prepayment\' : \'\'}`}>\n              <div className="rd-line-items-grid-head" aria-hidden="true">',
)
replace_once(
    "src/components/reconciliation/ReconciliationLineItemsForm.jsx",
    '                <div className="channel-cell channel-cell--num">参与分成金额</div>\n                <div className="channel-cell channel-cell--num">结算金额</div>\n                <div className="channel-cell channel-cell--actions">操作</div>',
    '                <div className="channel-cell channel-cell--num">参与分成金额</div>\n                <div className="channel-cell channel-cell--num">研发应结</div>\n                {showPrepaymentColumns ? <div className="channel-cell channel-cell--num">预付款抵扣</div> : null}\n                {showPrepaymentColumns ? <div className="channel-cell channel-cell--num">实际应付</div> : null}\n                <div className="channel-cell channel-cell--actions">操作</div>',
)
replace_once(
    "src/components/reconciliation/ReconciliationLineItemsForm.jsx",
    '                const settlement = calc.settlementAmount\n                const flowStatus = flowStatuses[line.id]',
    '                const settlement = calc.settlementAmount\n                const prepayment = prepaymentByLine?.[index] || {}\n                const prepaymentDeduction = Math.min(\n                  Math.max(0, settlement),\n                  Math.max(0, Number(prepayment.deduction || 0))\n                )\n                const actualPayable = Math.max(0, settlement - prepaymentDeduction)\n                const flowStatus = flowStatuses[line.id]',
)
replace_once(
    "src/components/reconciliation/ReconciliationLineItemsForm.jsx",
    '                    <div className="channel-cell channel-cell--num"><input type="text" readOnly disabled aria-label={`第 ${index + 1} 行结算金额`} className="admin-input readonly-input channel-input-num" value={settlement.toFixed(2)} /></div>\n                    <div className="channel-cell channel-cell--actions">',
    '                    <div className="channel-cell channel-cell--num"><input type="text" readOnly disabled aria-label={`第 ${index + 1} 行研发应结`} className="admin-input readonly-input channel-input-num" value={settlement.toFixed(2)} /></div>\n                    {showPrepaymentColumns ? <div className="channel-cell channel-cell--num"><input type="text" readOnly disabled aria-label={`第 ${index + 1} 行预付款抵扣`} className="admin-input readonly-input channel-input-num" value={prepayment.enabled ? `-${prepaymentDeduction.toFixed(2)}` : \'—\'} /></div> : null}\n                    {showPrepaymentColumns ? <div className="channel-cell channel-cell--num"><input type="text" readOnly disabled aria-label={`第 ${index + 1} 行实际应付`} className="admin-input readonly-input channel-input-num" value={actualPayable.toFixed(2)} /></div> : null}\n                    <div className="channel-cell channel-cell--actions">',
)
replace_once(
    "src/components/reconciliation/ReconciliationLineItemsForm.jsx",
    '            <div className="summary-item summary-item--hero"><div className="label">总结算金额</div><div className="value">¥{totals.sumSettlement.toFixed(2)}</div></div>',
    '            <div className="summary-item summary-item--hero"><div className="label">研发应结</div><div className="value">¥{totals.sumSettlement.toFixed(2)}</div></div>\n            {showPrepaymentColumns ? <div className="summary-item"><div className="label">预付款抵扣</div><div className="value">-¥{prepaymentTotals.deduction.toFixed(2)}</div></div> : null}\n            {showPrepaymentColumns ? <div className="summary-item summary-item--hero"><div className="label">本期实际应付</div><div className="value">¥{prepaymentTotals.actualPayable.toFixed(2)}</div></div> : null}',
)
replace_once(
    "src/components/reconciliation/ReconciliationLineItemsForm.jsx",
    '<span style={{ color: \'var(--admin-text-sub)\', fontSize: 14 }}>预计结算金额</span>\n              <span style={{ fontSize: \'1.25rem\', fontWeight: 700, color: \'var(--admin-success)\' }}>{`\\u00a5${totals.sumSettlement.toFixed(2)}`}</span>',
    '<span style={{ color: \'var(--admin-text-sub)\', fontSize: 14 }}>{showPrepaymentColumns ? \'预计实际应付\' : \'预计研发应结\'}</span>\n              <span style={{ fontSize: \'1.25rem\', fontWeight: 700, color: \'var(--admin-success)\' }}>{`\\u00a5${(showPrepaymentColumns ? prepaymentTotals.actualPayable : totals.sumSettlement).toFixed(2)}`}</span>',
)
replace_once(
    "src/components/ChannelBilling.css",
    '.rd-line-items-grid {\n  min-width: 1320px;\n}\n\n.rd-line-items-grid-head,',
    '.rd-line-items-grid {\n  min-width: 1320px;\n}\n\n.rd-line-items-grid--prepayment {\n  min-width: 1520px;\n}\n\n.rd-line-items-grid-head,',
)
replace_once(
    "src/components/ChannelBilling.css",
    '  grid-template-columns:\n    118px minmax(160px, 1.45fr) 108px 80px 88px 84px 84px 84px 72px 72px 72px 96px 88px 76px;\n  gap: 8px 10px;',
    '  grid-template-columns:\n    118px minmax(160px, 1.45fr) 108px 80px 88px 84px 84px 84px 72px 72px 72px 96px 88px 76px;\n  gap: 8px 10px;',
)
# Modifier must come after the base head/row declaration so the extra columns win.
replace_once(
    "src/components/ChannelBilling.css",
    '.rd-line-items-grid-head {\n  background: var(--table-header-bg, #f9fafb);',
    '.rd-line-items-grid--prepayment .rd-line-items-grid-head,\n.rd-line-items-grid--prepayment .rd-line-items-grid-row {\n  grid-template-columns:\n    118px minmax(160px, 1.45fr) 108px 80px 88px 84px 84px 84px 72px 72px 72px 96px 88px 100px 100px 76px;\n}\n\n.rd-line-items-grid-head {\n  background: var(--table-header-bg, #f9fafb);',
)

# ---------------------------------------------------------------------------
# R&D list: preserve R&D accrual, expose deduction and cash payable separately.
# ---------------------------------------------------------------------------
replace_once(
    "src/pages/CoreReconciliationPage.jsx",
    'function paymentAmounts(row) {\n  const paid = Math.max(0, Number(row?.paidAmount || 0))\n  const storedUnpaid = Number(row?.unpaidAmount)\n  const fallbackUnpaid = recordSettlementAmount(row) - paid',
    'function recordPrepaymentDeduction(row) {\n  const stored = Number(row?.prepaymentDeduction ?? row?.prepayment_deduction ?? 0)\n  return Number.isFinite(stored) ? Math.max(0, stored) : 0\n}\n\nfunction recordActualPayable(row) {\n  const stored = Number(row?.actualPayable ?? row?.actual_payable)\n  if (Number.isFinite(stored)) return Math.max(0, stored)\n  return Math.max(0, recordSettlementAmount(row) - recordPrepaymentDeduction(row))\n}\n\nfunction paymentAmounts(row) {\n  const paid = Math.max(0, Number(row?.paidAmount || 0))\n  const storedUnpaid = Number(row?.unpaidAmount)\n  const fallbackUnpaid = recordActualPayable(row) - paid',
)
replace_once(
    "src/pages/CoreReconciliationPage.jsx",
    '    const paid = rows.reduce((sum, row) => sum + paymentAmounts(row).paid, 0)\n    const unpaid = rows.reduce((sum, row) => sum + paymentAmounts(row).unpaid, 0)',
    '    const prepayment = rows.reduce((sum, row) => sum + recordPrepaymentDeduction(row), 0)\n    const actualPayable = rows.reduce((sum, row) => sum + recordActualPayable(row), 0)\n    const paid = rows.reduce((sum, row) => sum + paymentAmounts(row).paid, 0)\n    const unpaid = rows.reduce((sum, row) => sum + paymentAmounts(row).unpaid, 0)',
)
replace_once(
    "src/pages/CoreReconciliationPage.jsx",
    "      { label: '研发应付', value: money(total) },",
    "      { label: '研发应结', value: money(total), note: prepayment > 0.01 ? `预付款抵扣 ${money(prepayment)} · 实际应付 ${money(actualPayable)}` : undefined },",
)
replace_once(
    "src/pages/CoreReconciliationPage.jsx",
    '              <col className="core-rd-col-settlement" />\n              <col className="core-rd-col-received" />',
    '              <col className="core-rd-col-settlement" />\n              <col className="core-rd-col-prepayment" />\n              <col className="core-rd-col-payable" />\n              <col className="core-rd-col-received" />',
)
replace_once(
    "src/pages/CoreReconciliationPage.jsx",
    '                <th className="core-recon-align-right">结算金额</th>\n                <th className="core-recon-align-right">已付 / 未付</th>',
    '                <th className="core-recon-align-right">研发应结</th>\n                <th className="core-recon-align-right">预付款抵扣</th>\n                <th className="core-recon-align-right">实际应付</th>\n                <th className="core-recon-align-right">已付 / 未付</th>',
)
replace_once(
    "src/pages/CoreReconciliationPage.jsx",
    '<td colSpan={10} className="core-recon-empty">',
    '<td colSpan={12} className="core-recon-empty">',
)
replace_once(
    "src/pages/CoreReconciliationPage.jsx",
    '                  const closure = listFundingClosureStatus({\n                    amount: recordSettlementAmount(row),',
    '                  const closure = listFundingClosureStatus({\n                    amount: recordActualPayable(row),',
)
replace_once(
    "src/pages/CoreReconciliationPage.jsx",
    '                      <td className="core-recon-money core-recon-money--settlement">\n                        {money(recordSettlementAmount(row))}\n                      </td>\n                      <td\n                        className="core-recon-money core-recon-money--received"',
    '                      <td className="core-recon-money core-recon-money--settlement">\n                        {money(recordSettlementAmount(row))}\n                      </td>\n                      <td className="core-recon-money">\n                        {recordPrepaymentDeduction(row) > 0.01 ? `-${money(recordPrepaymentDeduction(row))}` : \'—\'}\n                      </td>\n                      <td className="core-recon-money core-recon-money--settlement">\n                        {money(recordActualPayable(row))}\n                      </td>\n                      <td\n                        className="core-recon-money core-recon-money--received"',
)
replace_once(
    "src/pages/CoreReconciliationPages.css",
    '.core-rd-recon-table {\n  min-width: 1120px;',
    '.core-rd-recon-table {\n  min-width: 1340px;',
)
replace_once(
    "src/pages/CoreReconciliationPages.css",
    '.core-rd-recon-table .core-rd-col-settlement {\n  width: 120px;\n}\n\n.core-rd-recon-table .core-rd-col-received {',
    '.core-rd-recon-table .core-rd-col-settlement {\n  width: 112px;\n}\n\n.core-rd-recon-table .core-rd-col-prepayment,\n.core-rd-recon-table .core-rd-col-payable {\n  width: 112px;\n}\n\n.core-rd-recon-table .core-rd-col-received {',
)

# Clarify the already-existing per-product contract field without adding noise to
# contracts that do not use it.
replace_once(
    "src/components/contract/ContractAccessEditor.jsx",
    '<Field label="预付款"><input type="number" step="0.01" value={form.prepayment_amount} onChange={(e) => setForm((current) => ({ ...current, prepayment_amount: e.target.value }))} /></Field>',
    '<Field label="预付款（抵扣研发结算）"><input type="number" step="0.01" min="0" value={form.prepayment_amount} onChange={(e) => setForm((current) => ({ ...current, prepayment_amount: e.target.value }))} placeholder="不适用则留空" /></Field>',
)

# ---------------------------------------------------------------------------
# Regression tests.
# ---------------------------------------------------------------------------
write(
    "backend/tests/test_rd_prepayment.py",
    '''import unittest
from decimal import Decimal

from app.services.rd_prepayment import financial_payable


class RdPrepaymentTests(unittest.TestCase):
    def test_full_prepayment_deduction_keeps_zero_cash_payable(self):
        deduction, payable = financial_payable(20, 50)
        self.assertEqual(deduction, Decimal("20"))
        self.assertEqual(payable, Decimal("0"))

    def test_partial_prepayment_leaves_cash_payable(self):
        deduction, payable = financial_payable(20, 12)
        self.assertEqual(deduction, Decimal("12"))
        self.assertEqual(payable, Decimal("8"))

    def test_negative_settlement_never_recharges_prepayment(self):
        deduction, payable = financial_payable(-20, 12)
        self.assertEqual(deduction, Decimal("0"))
        self.assertEqual(payable, Decimal("20"))


if __name__ == "__main__":
    unittest.main()
''',
)
write(
    "contract_terms/test_rd_prepayment_recommender.py",
    '''import unittest

from rd_rule_recommender import recommend_rd_rules


class RdPrepaymentRecommenderTests(unittest.TestCase):
    def candidate(self, *, available=500, agreed=1000):
        return {
            "contract_id": "C1",
            "contract_name": "研发联运合同",
            "contract_no": "HT-2026-PREPAY",
            "access_item_id": "A1",
            "partner_name": "测试研发有限公司",
            "partner_short_name": "测试研发",
            "counterparty": "测试研发有限公司",
            "product_name": "云上征途",
            "channel_name": "",
            "authorization_start": "2026-01-01",
            "authorization_end": "2026-12-31",
            "share_rate": 20,
            "channel_fee_rate": 0,
            "invoice_tax_rate": 0,
            "testing_fee": 0,
            "settlement_mode": "流水分成",
            "settlement_basis": "按实付结算",
            "payment_terms": "月结",
            "prepayment_amount": agreed,
            "prepayment_used_amount": agreed - available,
            "prepayment_available_amount": available,
        }

    def line(self, *, index=0, revenue=100):
        return {
            "line_index": index,
            "game_name": "云上征途",
            "settlement_cycle": "2026年8月",
            "revenue": revenue,
            "discount_rate": 1,
            "coupon_amount": 0,
            "test_fee": 0,
            "extra_fee": 0,
            "share_ratio": 20,
            "tax_rate": 0,
            "channel_fee_rate": 0,
            "settlement_amount": revenue * 0.2,
        }

    def test_full_deduction_keeps_contract_settlement_as_cost(self):
        result = recommend_rd_rules("测试研发有限公司", [self.line()], [self.candidate()])
        row = result["lines"][0]
        self.assertEqual(row["contract_amount"]["expected_amount"], 20.0)
        self.assertEqual(row["recommended"]["prepayment_deduction"], 20.0)
        self.assertEqual(row["recommended"]["actual_payable"], 0.0)
        self.assertEqual(row["recommended"]["prepayment_available_after"], 480.0)

    def test_partial_deduction_leaves_cash_payable(self):
        result = recommend_rd_rules(
            "测试研发有限公司",
            [self.line()],
            [self.candidate(available=12, agreed=1000)],
        )
        row = result["lines"][0]
        self.assertEqual(row["recommended"]["prepayment_deduction"], 12.0)
        self.assertEqual(row["recommended"]["actual_payable"], 8.0)


if __name__ == "__main__":
    unittest.main()
''',
)

print("R&D prepayment upgrade patches applied successfully.")
