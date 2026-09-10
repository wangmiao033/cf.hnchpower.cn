import unittest

from channel_line_verification import apply_channel_line_fee_authority


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class _Conn:
    def __init__(self, rows):
        self.rows = rows
        self.sql = ""
        self.params = None

    def execute(self, sql, params):
        self.sql = sql
        self.params = params
        return _Result(self.rows)


class ChannelLineVerificationIntegrationTests(unittest.TestCase):
    def test_channel_result_uses_persisted_line_fee_snapshot(self):
        conn = _Conn([
            {
                "id": "line-a",
                "settlement_rule_code": "share_only",
                "channel_fee_mode": "none",
                "channel_fee_rate": 0,
                "tax_mode": "none",
                "validation_tolerance": 0.05,
            }
        ])
        result = {
            "lines": [
                {
                    "line_id": "line-a",
                    "status": "fail",
                    "match": {"confidence": "high"},
                    "binding": {"match_method": "auto_locked"},
                    "checks": [
                        {
                            "key": "channel_fee_rate",
                            "status": "fail",
                            "bill_value": 5,
                            "contract_value": 0,
                            "difference": 5,
                            "message": "header mismatch",
                        }
                    ],
                    "contract_amount": {
                        "status": "pass",
                        "supported": True,
                        "deterministic": True,
                        "expected_amount": 1044.34,
                        "actual_amount": 1044.34,
                    },
                }
            ]
        }

        updated = apply_channel_line_fee_authority(conn, "channel", "bill-1", result)

        self.assertIn("channel_record_line_items", conn.sql)
        self.assertEqual(conn.params, ["bill-1"])
        self.assertEqual(updated["lines"][0]["status"], "pass")
        self.assertEqual(updated["lines"][0]["checks"][0]["bill_value"], 0)

    def test_rd_reconciliation_is_untouched(self):
        conn = _Conn([])
        result = {"lines": [{"status": "fail"}]}
        self.assertIs(apply_channel_line_fee_authority(conn, "rd", "bill-1", result), result)
        self.assertEqual(conn.sql, "")


if __name__ == "__main__":
    unittest.main()
