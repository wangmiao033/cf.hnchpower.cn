import unittest

from channel_line_verification import (
    normalize_anjiu_contract_amount,
    normalize_channel_line_fee_check,
)


class ChannelLineVerificationTests(unittest.TestCase):
    def line(self, *, bill_fee=5, contract_fee=0, amount_status="pass"):
        return {
            "line_id": "line-dragon",
            "status": "fail",
            "match": {"confidence": "high", "channel_fee_rate": contract_fee},
            "binding": {"match_method": "auto_locked"},
            "checks": [
                {
                    "key": "share_rate",
                    "label": "分成比例",
                    "status": "pass",
                    "bill_value": 30,
                    "contract_value": 30,
                    "difference": 0,
                    "message": "一致",
                },
                {
                    "key": "channel_fee_rate",
                    "label": "通道费率",
                    "status": "fail",
                    "bill_value": bill_fee,
                    "contract_value": contract_fee,
                    "difference": bill_fee - contract_fee,
                    "message": "账单头通道费与合同不一致",
                },
            ],
            "contract_amount": {
                "status": amount_status,
                "supported": True,
                "deterministic": True,
                "expected_amount": 1044.34,
                "actual_amount": 1044.34 if amount_status == "pass" else 992.12,
            },
        }

    def fee_check(self, line):
        return next(check for check in line["checks"] if check["key"] == "channel_fee_rate")

    def test_saved_no_fee_line_overrides_bill_header_five_percent(self):
        result = normalize_channel_line_fee_check(
            self.line(),
            {
                "settlement_rule_code": "share_only",
                "channel_fee_mode": "none",
                "channel_fee_rate": 0,
            },
        )

        check = self.fee_check(result)
        self.assertEqual(check["status"], "pass")
        self.assertEqual(check["bill_value"], 0)
        self.assertEqual(check["difference"], 0)
        self.assertEqual(result["status"], "pass")

    def test_saved_percent_line_compares_its_own_rate_not_header(self):
        result = normalize_channel_line_fee_check(
            self.line(bill_fee=0, contract_fee=5),
            {
                "settlement_rule_code": "five_percent_gateway_share",
                "channel_fee_mode": "percent",
                "channel_fee_rate": 5,
            },
        )

        check = self.fee_check(result)
        self.assertEqual(check["status"], "pass")
        self.assertEqual(check["bill_value"], 5)
        self.assertEqual(result["status"], "pass")

    def test_legacy_line_can_use_passing_contract_amount_instead_of_header_fee(self):
        result = normalize_channel_line_fee_check(self.line(), None)

        check = self.fee_check(result)
        self.assertEqual(check["status"], "pass")
        self.assertEqual(check["bill_value"], 0)
        self.assertEqual(check["difference"], 0)
        self.assertEqual(result["status"], "pass")
        self.assertIn("不再用账单头统一通道费", check["message"])

    def test_legacy_line_does_not_hide_real_amount_difference(self):
        result = normalize_channel_line_fee_check(self.line(amount_status="fail"), None)

        check = self.fee_check(result)
        self.assertEqual(check["status"], "fail")
        self.assertEqual(result["status"], "fail")

    def test_other_failed_contract_check_still_blocks_confirmation(self):
        source = self.line()
        source["checks"].append(
            {
                "key": "authorization",
                "label": "授权期",
                "status": "fail",
                "bill_value": "2026-01",
                "contract_value": "2025-01~2025-12",
                "difference": None,
                "message": "不在授权期",
            }
        )
        result = normalize_channel_line_fee_check(
            source,
            {
                "settlement_rule_code": "share_only",
                "channel_fee_mode": "none",
                "channel_fee_rate": 0,
            },
        )

        self.assertEqual(self.fee_check(result)["status"], "pass")
        self.assertEqual(result["status"], "fail")

    def test_anjiu_contract_amount_uses_deductions_before_discount(self):
        source = {
            "line_id": "line-anjiu",
            "status": "fail",
            "match": {"confidence": "high"},
            "binding": {"match_method": "auto_locked"},
            "checks": [
                {"key": "share_rate", "status": "pass"},
                {"key": "channel_fee_rate", "status": "pass"},
            ],
            "contract_amount": {
                "status": "fail",
                "supported": True,
                "deterministic": True,
                "expected_amount": 299.87,
                "actual_amount": 2321.19,
                "tolerance": 0.05,
            },
        }
        rule = {
            "settlement_rule_code": "anjiu_pre_discount_deduction",
            "channel_fee_mode": "percent",
            "channel_fee_rate": 5,
            "tax_mode": "share",
            "validation_tolerance": 0.05,
            "billing_flow": 1636031,
            "discount_factor": 0.005,
            "voucher_cost": 7128,
            "no_worry_cost": 0,
            "refund_cost": 0,
            "test_cost": 0,
            "welfare_cost": 0,
            "coin_cost": 0,
            "share_rate": 30,
            "tax_rate": 0,
            "gateway_cost": 0,
            "settlement_amount": 2321.19,
        }

        result = normalize_anjiu_contract_amount(source, rule)

        self.assertEqual(result["contract_amount"]["expected_amount"], 2321.19)
        self.assertEqual(result["contract_amount"]["difference_amount"], 0)
        self.assertEqual(result["contract_amount"]["status"], "pass")
        self.assertEqual(result["status"], "pass")
        self.assertEqual(
            result["contract_amount"]["formula_code"],
            "channel_anjiu_pre_discount_deduction",
        )


if __name__ == "__main__":
    unittest.main()
