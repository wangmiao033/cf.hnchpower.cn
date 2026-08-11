import unittest
from types import SimpleNamespace

from app.services.channel_cumulative_policy import basis_amount_for_bill, normalize_partner_key


class ChannelCumulativeSettlementPolicyTest(unittest.TestCase):
    def test_company_name_normalizes_to_seed_key(self):
        self.assertEqual(
            normalize_partner_key("上海畅指网络科技有限公司"),
            "上海畅指网络科技",
        )
        self.assertEqual(
            normalize_partner_key(" 上海畅指网络科技（有限公司） "),
            "上海畅指网络科技",
        )

    def test_threshold_basis_can_use_flow_or_settlement_amount(self):
        row = SimpleNamespace(billing_flow=262, settlement_amount=71.82)
        self.assertEqual(basis_amount_for_bill(row, "billing_flow"), 262.00)
        self.assertEqual(basis_amount_for_bill(row, "settlement_amount"), 71.82)

    def test_negative_values_do_not_build_threshold_progress(self):
        row = SimpleNamespace(billing_flow=-10, settlement_amount=-8)
        self.assertEqual(basis_amount_for_bill(row, "billing_flow"), 0.0)
        self.assertEqual(basis_amount_for_bill(row, "settlement_amount"), 0.0)


if __name__ == "__main__":
    unittest.main()
