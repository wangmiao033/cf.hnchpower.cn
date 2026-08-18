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
            "line-july": "特殊申请，按照IP结算",
            "line-august": "特殊申请，按照IP结算（实收1000，大熊补贴200，研发实际收款1200）",
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
        with patch.object(
            v11_main,
            "_special_overrides_for_bill",
            return_value=({"line-1": "特殊申请，按照IP结算"}, "snapshot-1"),
        ), patch.object(v11_main._v8, "_handle_difference_case") as handler:
            accepted = v11_main._auto_accept_special_settlements(object(), "bill-1", result)

        self.assertEqual(accepted, 0)
        handler.assert_not_called()


if __name__ == "__main__":
    unittest.main()
