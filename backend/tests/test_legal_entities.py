"""No live database required: revenue-month party-rule regression tests."""
import unittest

from app.services.legal_entities import (
    month_before, normalized_bank_account, normalized_legal_name,
    overlaps, plan_period_insert, resolve_months, role_at_month, valid_month,
)
from app.services.bank_partner_match import PartnerResolution, _candidate_matches_partner
from app.services.bank_partner_match import _guard_mismatched_cash_entities


def rule(id, role, name, start, end=None):
    return {"id": id, "role": role, "entity_id": name, "legal_name": name,
            "effective_month": start, "end_month": end}


class LegalEntityPeriodTest(unittest.TestCase):
    def test_switch_in_august_closes_earlier_payer_only(self):
        existing = [rule("old", "payer", "湖南天宇互娱网络科技有限公司", "2020-01")]
        end, updates = plan_period_insert(existing, "2026-08", None)
        self.assertIsNone(end)
        self.assertEqual(updates, [("old", "2026-07")])
        existing[0]["end_month"] = updates[0][1]
        links = existing + [
            rule("new", "payer", "湖南晨宇互娱网络科技有限公司", "2026-08"),
            rule("contract", "contract", "湖南天宇互娱网络科技有限公司", "2020-01"),
        ]
        july = resolve_months(links, ["2026-07"])
        august = resolve_months(links, ["2026-08"])
        self.assertEqual(july["payer"]["legal_name"], "湖南天宇互娱网络科技有限公司")
        self.assertEqual(august["payer"]["legal_name"], "湖南晨宇互娱网络科技有限公司")
        self.assertEqual(july["contract"]["entity_id"], august["contract"]["entity_id"])
        self.assertFalse(august["payer_mixed"])

    def test_multi_period_different_payers_is_ambiguous(self):
        links = [rule("a", "payer", "甲公司", "2026-01", "2026-07"),
                 rule("b", "payer", "乙公司", "2026-08")]
        state = resolve_months(links, ["2026-07", "2026-08"])
        self.assertTrue(state["payer_mixed"])
        self.assertIsNone(state["payer"])

    def test_interval_collision_and_gap(self):
        links = [rule("a", "payer", "甲", "2026-08")]
        end, updates = plan_period_insert(links, "2026-01", None)
        self.assertEqual((end, updates), ("2026-07", []))
        with self.assertRaises(ValueError):
            plan_period_insert(links, "2026-01", "2026-09")
        with self.assertRaises(ValueError):
            plan_period_insert(links, "2026-08", None)

    def test_month_and_name_normalization(self):
        self.assertEqual(valid_month("2026-08"), "2026-08")
        for invalid in ["2026-8", "2026-13", "2026/08", "2026-00"]:
            with self.assertRaises(ValueError):
                valid_month(invalid)
        self.assertEqual(month_before("2026-01"), "2025-12")
        self.assertEqual(normalized_legal_name(" 湖南晨宇互娱网络科技有限公司 "), "湖南晨宇互娱网络科技有限公司")
        self.assertEqual(normalized_bank_account(" 1234-5678 "), "12345678")
        self.assertFalse(overlaps("2026-01", "2026-07", "2026-08", None))

    def test_stable_partner_id_preferred_over_company_similarity(self):
        identified = PartnerResolution("stable-1", "天宇互动", "天宇", "legal_entity")
        self.assertTrue(_candidate_matches_partner(
            {"partner_id": "stable-1", "partner_name": "不一致的历史名称"}, identified))
        self.assertFalse(_candidate_matches_partner(
            {"partner_id": "different-client", "partner_name": "天宇互动"}, identified))

    def test_bank_cash_identity_mismatch_requires_review(self):
        item = {"auto_ready": True, "candidates": [{
            "bill_type": "channel", "partner_id": "stable-1",
            "expected_payer_entity_id": "new-payer",
            "expected_receiving_entity_id": "our-company-A",
            "reasons": [],
        }]}
        _guard_mismatched_cash_entities(item, "old-payer", "our-company-B")
        self.assertFalse(item["auto_ready"])
        self.assertIn("需人工确认", item["blocked_reason"])
        self.assertTrue(item["candidates"][0]["payer_identity_mismatch"])
        self.assertTrue(item["candidates"][0]["receiver_identity_mismatch"])

    def test_no_evidence_does_not_invent_mismatch(self):
        item = {"auto_ready": True, "candidates": [{
            "bill_type": "channel", "expected_payer_entity_id": "new-payer",
            "expected_receiving_entity_id": "our-company-A",
        }]}
        _guard_mismatched_cash_entities(item, None, None)
        self.assertTrue(item["auto_ready"])
        self.assertNotIn("blocked_reason", item)


if __name__ == "__main__":
    unittest.main()
