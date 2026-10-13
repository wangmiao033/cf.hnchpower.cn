"""An unchanged channel save must not rotate line IDs and reset accepted cases."""
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase

from app.api.channel import (
    _CHANNEL_COMPUTED_LINE_FIELDS,
    _channel_inputs_equal,
    _channel_line_inputs_match,
)
from app.schemas.channel import ChannelLineItemCreate


class ChannelLineIdentityTests(TestCase):
    def line(self):
        return ChannelLineItemCreate(
            settlement_cycle="2026-08",
            game_name="云上征途（0.05飞升启航版）",
            billing_flow=2.44,
            discount_factor=1,
            share_rate=28,
            tax_rate=0,
            channel_fee_mode="percent",
            channel_fee_rate=5,
            platform_settlement_amount=0.65,
        )

    def original(self, source):
        inputs = source.model_dump(exclude=_CHANNEL_COMPUTED_LINE_FIELDS)
        normalized = {
            key: Decimal(str(value)) if isinstance(value, (float, int)) else value
            for key, value in inputs.items()
        }
        return SimpleNamespace(
            id="persistent-original-line",
            sort_order=0,
            **normalized,
        )

    def test_identical_channel_payload_preserves_line_identity(self):
        payload = self.line()
        original = self.original(payload)
        self.assertTrue(_channel_line_inputs_match([original], [payload]))
        self.assertEqual(original.id, "persistent-original-line")

    def test_real_financial_change_requires_new_line_identity_and_new_approval(self):
        payload = self.line()
        original = self.original(payload)
        changed = payload.model_copy(update={"share_rate": 25})
        self.assertFalse(_channel_line_inputs_match([original], [changed]))
        changed_fee = payload.model_copy(update={"channel_fee_rate": 0})
        self.assertFalse(_channel_line_inputs_match([original], [changed_fee]))

    def test_game_period_or_row_count_change_requires_new_validation(self):
        payload = self.line()
        original = self.original(payload)
        changed = payload.model_copy(update={"settlement_cycle": "2026-07"})
        self.assertFalse(_channel_line_inputs_match([original], [changed]))
        self.assertFalse(_channel_line_inputs_match([original], [payload, payload]))

    def test_decimal_values_not_float_roundoff_are_compared(self):
        self.assertTrue(_channel_inputs_equal(Decimal("0.65"), 0.65))
        self.assertTrue(_channel_inputs_equal(Decimal("28.0000"), 28))
        self.assertFalse(_channel_inputs_equal(Decimal("0.65"), 0.66))


if __name__ == "__main__":
    import unittest
    unittest.main()
