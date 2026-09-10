from __future__ import annotations

import unittest
from unittest.mock import patch

import v11_main


class RdSpecialSettlementV11Tests(unittest.TestCase):
    def test_explicit_special_application_is_recognized(self):
        self.assertTrue(
            v11_main._is_special_override(
                {
                    "override_reason": "特殊申请，按照IP结算（实收1000，大熊补贴200，研发实际收款1200）",
                    "deviations": ["分成比例", "通道费率"],
                }
            )
        )

    def test_normal_manual_note_is_not_silently_approved(self):
        self.assertFalse(
            v11_main._is_special_override(
                {
                    "override_reason": "历史口径待确认",
                    "deviations": ["分成比例"],
                }
            )
        )

    def test_saved_special_settlement_closes_pending_case_without_contract_manage_gate(self):
        result = {
            "lines": [
                {
                    "line_id": "line-july",
                    "difference_case": {
                        "id": "case-july",
                        "status": "pending",
                        "handling_type": "",
                    },
                },
                {
                    "line_id": "line-august",
                    "difference_case": {
                        "id": "case-august",
                        "status": "pending",
                        "handling_type": "edit_bill",
                    },
                },
            ]
        }
        saved = {
            "line-july": {
                "reason": "特殊申请，按照IP结算",
                "deviations": ["分成比例", "通道费率"],
            },
            "line-august": {
                "reason": "特殊申请，按照IP结算（实收1000，大熊补贴200，研发实际收款1200）",
                "deviations": ["分成比例", "通道费率"],
            },
        }

        with patch.object(
            v11_main,
            "_special_overrides_for_bill",
            return_value=(saved, "snapshot-1"),
        ), patch.object(v11_main._v8, "_handle_difference_case") as handler:
            accepted = v11_main._auto_accept_special_settlements(
                object(),
                "bill-1",
                result,
            )

        self.assertEqual(accepted, 2)
        self.assertEqual(handler.call_count, 2)
        first_payload = handler.call_args_list[0].args[2]
        second_payload = handler.call_args_list[1].args[2]
        for payload in (first_payload, second_payload):
            self.assertEqual(payload["action"], "accept_difference")
            self.assertEqual(payload["reason_type"], v11_main.SPECIAL_SETTLEMENT_REASON)
            self.assertTrue(payload["description"].startswith("特殊申请"))
            self.assertEqual(payload["evidence"][0]["source"], "rd_contract_entry_snapshot")

    def test_zero_amount_line_field_deviations_are_approved_by_saved_special_settlement(self):
        result = {
            "lines": [
                {
                    "line_id": "line-july",
                    "status": "fail",
                    "match": {"access_item_id": "access-1"},
                    "checks": [
                        {
                            "key": "authorization",
                            "label": "授权期",
                            "status": "pass",
                            "message": "账期处于合同授权期内。",
                        },
                        {
                            "key": "share_rate",
                            "label": "分成比例",
                            "status": "fail",
                            "message": "账单分成比例与合同相差 58 个百分点。",
                        },
                        {
                            "key": "channel_fee_rate",
                            "label": "渠道费率",
                            "status": "fail",
                            "message": "账单渠道费率与合同相差 5 个百分点。",
                        },
                        {
                            "key": "contract_standard_settlement",
                            "label": "合同标准结算额",
                            "status": "pass",
                            "message": "金额一致。",
                        },
                    ],
                    "contract_amount": {
                        "status": "pass",
                        "expected_amount": 0,
                        "actual_amount": 0,
                    },
                }
            ],
            "summary": {"fail_count": 1},
            "bill_checks": [],
        }
        overrides = {
            "line-july": {
                "reason": "特殊申请，按照IP结算",
                "deviations": ["分成比例", "通道费率"],
            }
        }

        updated = v11_main._apply_special_settlement_line_policy(result, overrides)

        self.assertEqual(updated["summary"]["fail_count"], 0)
        self.assertEqual(updated["summary"]["warning_count"], 1)
        self.assertEqual(updated["summary"]["special_settlement_lines"], 1)
        line = updated["lines"][0]
        self.assertEqual(line["status"], "warning")
        self.assertTrue(line["special_settlement"]["approved"])
        failed = [check for check in line["checks"] if check.get("status") == "fail"]
        self.assertEqual(failed, [])
        overridden = [
            check for check in line["checks"]
            if check.get("special_settlement_override")
        ]
        self.assertEqual({check["key"] for check in overridden}, {"share_rate", "channel_fee_rate"})

    def test_amount_and_field_deviations_are_approved_after_difference_case_resolution(self):
        result = {
            "lines": [
                {
                    "line_id": "line-august",
                    "status": "fail",
                    "match": {"access_item_id": "access-1"},
                    "difference_case": {
                        "id": "case-august",
                        "status": "resolved",
                        "handling_type": "accept_difference",
                    },
                    "checks": [
                        {"key": "authorization", "label": "授权期", "status": "pass"},
                        {"key": "share_rate", "label": "分成比例", "status": "fail"},
                        {"key": "channel_fee_rate", "label": "渠道费率", "status": "fail"},
                        {
                            "key": "contract_standard_settlement",
                            "label": "合同标准结算额",
                            "status": "fail",
                        },
                    ],
                    "contract_amount": {
                        "status": "fail",
                        "expected_amount": 6650,
                        "actual_amount": 1200,
                    },
                }
            ],
            "summary": {"fail_count": 1},
            "bill_checks": [],
        }
        overrides = {
            "line-august": {
                "reason": "特殊申请，按照IP结算（实收1000，大熊补贴200，研发实际收款1200）",
                "deviations": ["分成比例", "通道费率"],
            }
        }

        updated = v11_main._apply_special_settlement_line_policy(result, overrides)

        self.assertEqual(updated["summary"]["fail_count"], 0)
        self.assertEqual(updated["lines"][0]["status"], "warning")
        self.assertEqual(
            {check["key"] for check in updated["lines"][0]["checks"] if check.get("special_settlement_override")},
            {"share_rate", "channel_fee_rate", "contract_standard_settlement"},
        )

    def test_authorization_failure_remains_blocking_even_with_special_settlement(self):
        result = {
            "lines": [
                {
                    "line_id": "line-1",
                    "status": "fail",
                    "match": {"access_item_id": "access-1"},
                    "checks": [
                        {"key": "authorization", "label": "授权期", "status": "fail"},
                        {"key": "share_rate", "label": "分成比例", "status": "fail"},
                    ],
                }
            ],
            "summary": {"fail_count": 1},
            "bill_checks": [],
        }
        overrides = {
            "line-1": {
                "reason": "特殊申请，按照IP结算",
                "deviations": ["分成比例"],
            }
        }

        updated = v11_main._apply_special_settlement_line_policy(result, overrides)

        self.assertEqual(updated["summary"]["fail_count"], 1)
        self.assertEqual(updated["lines"][0]["status"], "fail")
        self.assertFalse(updated["lines"][0]["special_settlement"]["approved"])

    def test_adjustment_workflow_is_not_overwritten(self):
        result = {
            "lines": [
                {
                    "line_id": "line-1",
                    "difference_case": {
                        "id": "case-1",
                        "status": "processing",
                        "handling_type": "adjustment",
                    },
                }
            ]
        }
        saved = {
            "line-1": {
                "reason": "特殊申请，按照IP结算",
                "deviations": ["分成比例"],
            }
        }
        with patch.object(
            v11_main,
            "_special_overrides_for_bill",
            return_value=(saved, "snapshot-1"),
        ), patch.object(v11_main._v8, "_handle_difference_case") as handler:
            accepted = v11_main._auto_accept_special_settlements(object(), "bill-1", result)

        self.assertEqual(accepted, 0)
        handler.assert_not_called()


if __name__ == "__main__":
    unittest.main()
