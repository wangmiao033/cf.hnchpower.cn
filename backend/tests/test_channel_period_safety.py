from __future__ import annotations

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from app.schemas.channel import ChannelLineItemCreate, ChannelRecordCreate, ChannelRecordUpdate


def _current_month() -> tuple[int, int]:
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    return now.year, now.month


def _month_key(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def _next_month_key() -> str:
    year, month = _current_month()
    if month == 12:
        return _month_key(year + 1, 1)
    return _month_key(year, month + 1)


def _current_month_key() -> str:
    year, month = _current_month()
    return _month_key(year, month)


def _line(month: str) -> ChannelLineItemCreate:
    return ChannelLineItemCreate(settlement_cycle=month, game_name="测试游戏")


class ChannelPeriodSafetyTests(unittest.TestCase):
    def test_past_channel_months_are_allowed_and_normalized(self) -> None:
        self.assertEqual(_line("2024-3").settlement_cycle, "2024-03")
        self.assertEqual(_line("2025年10月").settlement_cycle, "2025-10")

    def test_current_channel_month_is_allowed(self) -> None:
        current = _current_month_key()
        self.assertEqual(_line(current).settlement_cycle, current)

    def test_future_channel_line_month_is_blocked(self) -> None:
        with self.assertRaisesRegex(ValidationError, "结算月份不能晚于当前月份"):
            _line(_next_month_key())

    def test_future_channel_header_month_is_blocked_on_create_and_update(self) -> None:
        future = _next_month_key()
        with self.assertRaisesRegex(ValidationError, "结算月份不能晚于当前月份"):
            ChannelRecordCreate(settlement_month=future, items=[_line("2024-01")])
        with self.assertRaisesRegex(ValidationError, "结算月份不能晚于当前月份"):
            ChannelRecordUpdate(settlement_month=future)

    def test_invalid_channel_month_format_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValidationError, "结算月份必须使用 YYYY-MM 格式"):
            _line("2025-13")


if __name__ == "__main__":
    unittest.main()
