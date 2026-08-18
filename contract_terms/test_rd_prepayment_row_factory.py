from __future__ import annotations

import unittest

import rd_prepayment


class RdPrepaymentRowFactoryTests(unittest.TestCase):
    def test_relation_probe_supports_dict_rows(self):
        self.assertTrue(rd_prepayment._relation_exists({"relation_name": "cf_rd_prepayment_fundings"}))
        self.assertFalse(rd_prepayment._relation_exists({"relation_name": None}))

    def test_relation_probe_supports_positional_rows(self):
        self.assertTrue(rd_prepayment._relation_exists(("cf_rd_prepayment_fundings",)))
        self.assertFalse(rd_prepayment._relation_exists((None,)))

    def test_relation_probe_handles_missing_rows(self):
        self.assertFalse(rd_prepayment._relation_exists(None))
        self.assertFalse(rd_prepayment._relation_exists({}))


if __name__ == "__main__":
    unittest.main()
