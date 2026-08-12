from types import SimpleNamespace

from app.api.bill_lifecycle import _channel_flow_input_reason


def _line(game_name: str, state: str):
    return SimpleNamespace(game_name=game_name, flow_input_state=state)


def test_channel_confirmation_blocks_missing_flow_rows():
    bill = SimpleNamespace(
        line_items=[
            _line("云上征途", "entered"),
            _line("大灵王", "missing"),
            _line("雷鸣三国", "confirmed_zero"),
        ]
    )
    reason = _channel_flow_input_reason("channel", bill)
    assert reason is not None
    assert "大灵王" in reason
    assert "确认本期流水为 0" in reason


def test_channel_confirmation_accepts_entered_and_confirmed_zero():
    bill = SimpleNamespace(
        line_items=[
            _line("云上征途", "entered"),
            _line("大灵王", "confirmed_zero"),
            _line("历史账单", "confirmed"),
        ]
    )
    assert _channel_flow_input_reason("channel", bill) is None


def test_flow_guard_does_not_apply_to_rd_bills():
    bill = SimpleNamespace(line_items=[_line("大灵王", "missing")])
    assert _channel_flow_input_reason("rd", bill) is None
