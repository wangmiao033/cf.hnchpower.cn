"""Regression: payment company switch must never erase the original contract signer."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services.contract_party_source import resolve_contract_source, unique_contract_counterparty


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows


class _DB:
    def __init__(self, counterparties):
        self.counterparties = counterparties
        self.queries = []

    def execute(self, sql, values):
        self.queries.append((str(sql), values))
        return _Rows([{"counterparty": name} for name in self.counterparties])


class ContractPartySourceTest(unittest.TestCase):
    def test_explicit_original_signer_outweighs_new_payer_name(self):
        links = [
            {"role": "contract", "legal_name": "湖南天宇互娱网络科技有限公司",
             "entity_id": "original", "effective_month": "2020-01", "end_month": None},
            {"role": "payer", "legal_name": "湖南晨宇互娱网络科技有限公司",
             "entity_id": "new-payer", "effective_month": "2026-08", "end_month": None},
        ]
        db = _DB([])
        with patch("app.services.contract_party_source.entity_links", return_value=links):
            resolved = resolve_contract_source(db, "same-customer", "2026-08")
        self.assertEqual(resolved["contract_party_name"], "湖南天宇互娱网络科技有限公司")
        self.assertEqual(resolved["source"], "configured_contract_entity")
        self.assertEqual(db.queries, [])

    def test_existing_original_contract_under_same_customer_id_is_safe_to_reuse(self):
        db = _DB(["湖南天宇互娱网络科技有限公司"])
        with patch("app.services.contract_party_source.entity_links", return_value=[]):
            resolved = resolve_contract_source(db, "existing-customer", "2026-08")
        self.assertEqual(resolved["contract_party_name"], "湖南天宇互娱网络科技有限公司")
        self.assertEqual(resolved["source"], "existing_customer_contract")
        self.assertEqual(db.queries[0][1], {"id": "existing-customer"})

    def test_different_contract_signers_cannot_be_fuzzily_merged(self):
        db = _DB(["湖南天宇互娱网络科技有限公司", "湖南晨宇互娱网络科技有限公司"])
        with patch("app.services.contract_party_source.entity_links", return_value=[]):
            resolved = resolve_contract_source(db, "existing-customer", "2026-08")
        self.assertIsNone(resolved["contract_party_name"])
        self.assertEqual(resolved["source"], "unresolved")

    def test_empty_or_ambiguous_signer_does_not_invent_an_identity(self):
        self.assertIsNone(unique_contract_counterparty(["", " ", None]))
        self.assertIsNone(unique_contract_counterparty(["甲有限公司", "乙有限公司"]))
        self.assertEqual(unique_contract_counterparty(["甲有限公司", " 甲有限公司 "]), "甲有限公司")

    def test_reject_invalid_billing_month(self):
        with self.assertRaisesRegex(ValueError, "YYYY-MM"):
            resolve_contract_source(_DB([]), "same-customer", "2026-15")


if __name__ == "__main__":
    unittest.main()
