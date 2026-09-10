from game_rule_fallback import apply_game_registry_fallback


def _base_result(message="该游戏/账期未找到匹配的可用合同合作清单"):
    return {
        "version": "contract-channel-rule-v2.9",
        "auto_apply": False,
        "matched_lines": 0,
        "total_lines": 1,
        "header_recommendation": None,
        "partner_rule_status": "none",
        "message": "合同规则存在歧义或结算字段不完整，请按具体游戏/账期确认",
        "lines": [
            {
                "line_index": 0,
                "game_name": "仙帝神兵",
                "settlement_cycle": "2026-07",
                "auto_apply": False,
                "confidence": "none",
                "score": 0,
                "message": message,
                "match": None,
                "recommended": None,
            }
        ],
    }


def _line():
    return {
        "line_index": 0,
        "game_name": "仙帝神兵",
        "settlement_cycle": "2026-07",
        "game_id": "game-1",
    }


def _rule(**overrides):
    value = {
        "id": "rule-1",
        "game_id": "game-1",
        "game_name": "仙帝神兵",
        "partner_name": "广东安久科技有限公司",
        "channel_name": "游戏fan",
        "start_month": "2026-01",
        "end_month": None,
        "share_rate": 30,
        "tax_rate": 0,
        "channel_fee_rate": 0,
        "settlement_rule_code": "share_only",
        "channel_fee_mode": "none",
        "tax_mode": "none",
        "source": "manual",
        "source_month_count": 1,
        "status": "active",
    }
    value.update(overrides)
    return value


def test_registry_rule_fills_line_when_contract_has_no_match():
    result = apply_game_registry_fallback(
        _base_result(),
        partner_name="广东安久科技有限公司",
        channel_name="游戏fan（安久）",
        lines=[_line()],
        registry_rules=[_rule()],
    )
    row = result["lines"][0]
    assert row["auto_apply"] is True
    assert row["rule_source"] == "game_registry"
    assert row["recommended"]["share_rate"] == 30
    assert result["registry_fallback_count"] == 1
    assert result["partner_rule_status"] == "registry"
    assert result["auto_apply"] is True
    assert result["header_recommendation"]["channel_fee_mode"] == "none"


def test_registry_never_overrides_real_contract_candidate():
    base = _base_result("已找到合同，但候选身份仍需人工确认")
    base["lines"][0]["match"] = {"contract_id": "contract-1", "contract_name": "正式合同"}
    result = apply_game_registry_fallback(
        base,
        partner_name="广东安久科技有限公司",
        channel_name="游戏fan",
        lines=[_line()],
        registry_rules=[_rule()],
    )
    row = result["lines"][0]
    assert row["auto_apply"] is False
    assert row.get("rule_source") != "game_registry"
    assert result["registry_fallback_count"] == 0


def test_registry_rule_respects_month_range():
    result = apply_game_registry_fallback(
        _base_result(),
        partner_name="广东安久科技有限公司",
        channel_name="游戏fan",
        lines=[_line()],
        registry_rules=[_rule(start_month="2026-08")],
    )
    row = result["lines"][0]
    assert row["auto_apply"] is False
    assert result["registry_fallback_count"] == 0


def test_registry_conflict_does_not_auto_apply():
    result = apply_game_registry_fallback(
        _base_result(),
        partner_name="广东安久科技有限公司",
        channel_name="游戏fan",
        lines=[_line()],
        registry_rules=[_rule(id="rule-1", share_rate=30), _rule(id="rule-2", share_rate=35)],
    )
    row = result["lines"][0]
    assert row["auto_apply"] is False
    assert result["registry_conflict_count"] == 1
    assert "规则" in row["message"]


def test_missing_game_identity_explains_alias_problem():
    line = _line()
    line.pop("game_id")
    result = apply_game_registry_fallback(
        _base_result(),
        partner_name="广东安久科技有限公司",
        channel_name="游戏fan",
        lines=[line],
        registry_rules=[_rule()],
    )
    assert "游戏库身份/别名" in result["lines"][0]["message"]
