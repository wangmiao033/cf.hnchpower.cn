"""Samsung-only write boundary; no migrations or automatic historical conversion."""
from fastapi import HTTPException
from sqlalchemy import inspect, text

from app.services.samsung_settlement import SAMSUNG_STATEMENT_FEE_RULE, SAMSUNG_LEGAL_NAME, is_samsung_identity
from app.services.channel_settlement_engine import calculate_channel_line

RULE_FIELDS = {"settlement_rule_code": SAMSUNG_STATEMENT_FEE_RULE,
               "channel_fee_mode": "fixed", "channel_fee_rate": 4, "tax_mode": "none"}


def _error(message):
    raise HTTPException(422, detail={"error": "samsung_statement_rule_invalid", "message": message})


def uses_samsung(row, parent=None):
    return (getattr(row, "settlement_rule_code", None) or getattr(parent, "settlement_rule_code", None)) == SAMSUNG_STATEMENT_FEE_RULE


def preserve_samsung_inputs(incoming, saved_lines, bill):
    """Old clients may omit newly understood rule fields; never guess row identity.

    Explicit generic rule payloads are stale/unsupported, not consent to remove
    the saved statement rule. A complete reload is required instead of downgrade.
    """
    saved = {str(line.id): line for line in saved_lines if uses_samsung(line, bill)}
    if not saved:
        return incoming
    result = dict(incoming)
    if "settlement_rule_code" in result and result["settlement_rule_code"] != bill.settlement_rule_code:
        _error("已保存三星原账单规则，不能由通用规则覆盖；请重新载入账单")
    if result.get("items") is not None:
        items = []
        submitted_ids = {str(item.get("id") or "") for item in result["items"]}
        for raw in result["items"]:
            item = dict(raw)
            prior = saved.get(str(item.get("id") or ""))
            explicit_new_row = (not item.get("id") and set(saved).issubset(submitted_ids)
                                and item.get("settlement_rule_code") == SAMSUNG_STATEMENT_FEE_RULE
                                and "gateway_cost" in item)
            if not item.get("id") and not explicit_new_row:
                _error("账单已有三星原账单规则，旧客户端须携带稳定明细 ID 后才能保存")
            if prior:
                for key, value in RULE_FIELDS.items():
                    if key in item and item[key] != value:
                        _error("已保存三星原账单规则，合同回填不能覆盖；请重新载入账单")
                    item[key] = getattr(prior, key)
                if "gateway_cost" not in item:
                    item["gateway_cost"] = prior.gateway_cost
            items.append(item)
        result["items"] = items
    return result


def validate_samsung_write(db, bill, items):
    active = [item for item in items if uses_samsung(item, bill)]
    if not active and not uses_samsung(bill):
        return
    if not uses_samsung(bill):
        _error("三星原账单规则必须显式应用到账单和明细")
    for key, value in RULE_FIELDS.items():
        if getattr(bill, key, None) != value:
            _error("三星账单头规则不能被通用合同费率或税处理覆盖")
    if not is_samsung_identity(bill.partner_name, bill.channel_name):
        _error("三星原账单规则仅限北京鹏泰博兴科技有限公司 / 三星")
    # Resolve the existing authoritative customer ID by an exact unique legal
    # name. Never match a nickname, substring, guessed ID or client ID.
    if not inspect(db.connection()).has_table("cf_partner_records"):
        _error("客户库不可用，无法核实三星法人身份")
    lock = " FOR SHARE" if db.get_bind().dialect.name == "postgresql" else ""
    partners = db.execute(text("SELECT id FROM cf_partner_records WHERE name = :name" + lock),
                          {"name": SAMSUNG_LEGAL_NAME}).all()
    if len(partners) != 1:
        _error("三星法人未唯一关联客户库，请先核实客户身份")
    if uses_samsung(bill) and len(active) != len(items):
        _error("三星原账单规则须逐行保存，不能混入旧通道费口径")
    for item in active:
        for key, value in RULE_FIELDS.items():
            if getattr(item, key, None) != value:
                _error("三星原账单规则须保存固定金额、4%记录费率和不重复扣税口径")
        if "gateway_cost" not in getattr(item, "model_fields_set", {"gateway_cost"}):
            _error("请明确填写每行原账单通道费金额，免通道费时填写 0")
        try:
            calculate_channel_line(item, bill)
        except (ValueError, ArithmeticError, TypeError) as exc:
            _error(str(exc))
