import unittest

from app.schemas.customer360 import Customer360Response
from app.services.customer360 import (
    _exact_match_clause,
    _name_key,
    _partner_match_keys,
    _section_access,
    build_customer360,
)


class FakeResult:
    def __init__(self, *, scalar=None, first=None, rows=None):
        self._scalar = scalar
        self._first = first
        self._rows = rows or []

    def scalar_one_or_none(self):
        return self._scalar

    def mappings(self):
        return self

    def first(self):
        return self._first

    def all(self):
        return self._rows


class PartnerOnlyDb:
    """Allow customer master data reads and reject every business-module query."""

    def __init__(self, duplicate_short_name=False):
        self.duplicate_short_name = duplicate_short_name
        self.queries = []

    def execute(self, statement, params=None):
        sql = str(statement)
        self.queries.append(sql)
        if "to_regclass('public.cf_partner_records')" in sql:
            return FakeResult(scalar="cf_partner_records")
        if "FROM cf_partner_records" in sql and "WHERE id =" in sql:
            return FakeResult(
                first={
                    "id": "p-1",
                    "name": "广州熊动科技有限公司",
                    "short_name": "熊动",
                    "category": "研发商",
                    "tag": "",
                    "tax_registration_no": "",
                    "bank_name": "",
                    "bank_account": "",
                    "invoice_content": "",
                    "recipient": "",
                    "recipient_phone": "",
                    "mailing_address": "",
                    "created_at": None,
                    "updated_at": None,
                }
            )
        if "SELECT id, short_name" in sql and "FROM cf_partner_records" in sql:
            rows = [{"id": "p-1", "short_name": "熊动"}]
            if self.duplicate_short_name:
                rows.append({"id": "p-2", "short_name": " 熊动 "})
            return FakeResult(rows=rows)
        raise AssertionError(f"unauthorized business query executed: {sql}")


class Customer360Test(unittest.TestCase):
    def test_name_key_only_normalizes_spaces_case_and_parentheses(self):
        self.assertEqual(_name_key(" 广州熊动（科技）有限公司 "), "广州熊动(科技)有限公司")
        self.assertEqual(_name_key("ABC  Co"), "abcco")
        self.assertNotEqual(_name_key("广州熊动科技有限公司"), _name_key("广州熊动"))

    def test_legacy_matching_uses_equality_not_contains(self):
        clause, params = _exact_match_clause(
            ["bill.partner_name", "bill.channel_name"],
            ["广州熊动科技有限公司", "熊动"],
        )
        self.assertIn(" = :customer_name_key_0", clause)
        self.assertIn(" = :customer_name_key_1", clause)
        self.assertNotIn("ILIKE", clause.upper())
        self.assertNotIn(" LIKE ", clause.upper())
        self.assertEqual(params["customer_name_key_1"], "熊动")

    def test_duplicate_short_name_is_not_used_for_automatic_matching(self):
        db = PartnerOnlyDb(duplicate_short_name=True)
        keys = _partner_match_keys(
            db,
            {"id": "p-1", "name": "广州熊动科技有限公司", "short_name": "熊动"},
        )
        self.assertEqual(keys, ["广州熊动科技有限公司"])

    def test_no_module_permissions_do_not_query_business_tables(self):
        db = PartnerOnlyDb()
        payload = build_customer360(db, {"partners.view"}, "p-1")
        self.assertIsNotNone(payload)
        self.assertEqual(payload["contracts"], [])
        self.assertEqual(payload["rd_bills"], [])
        self.assertEqual(payload["channel_bills"], [])
        self.assertEqual(payload["invoices"], [])
        self.assertEqual(payload["bank_transactions"], [])
        self.assertEqual(_section_access({"partners.view"}), {
            "contracts": False,
            "reconciliation": False,
            "invoices": False,
            "funds": False,
        })

    def test_response_schema_accepts_empty_customer360(self):
        payload = {
            "partner": {
                "id": "p-1",
                "name": "广州熊动科技有限公司",
                "short_name": "熊动",
            },
            "access": {
                "contracts": False,
                "reconciliation": False,
                "invoices": False,
                "funds": False,
            },
            "summary": {},
            "contracts": [],
            "rd_bills": [],
            "channel_bills": [],
            "invoices": [],
            "bank_transactions": [],
            "recent_activities": [],
        }
        parsed = Customer360Response.model_validate(payload)
        self.assertEqual(parsed.partner.id, "p-1")
        self.assertFalse(parsed.access.funds)


if __name__ == "__main__":
    unittest.main()
