"""Explicit 233 source-incomplete drafts, using the existing rule snapshot.

The rule code is the durable missing-data marker: numeric zero storage is never
evidence that recharge/share/tax are known. No contract or historical row changes.
"""
from math import isfinite
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import inspect, or_, select, text

CODE = "channel_233_incomplete"
LEGAL_NAME = "北京龙威互动科技有限公司"
CHANNEL_NAME = "龙威233"
MESSAGE = "233资料未齐：请补齐原始充值、分成及税费依据后再确认核对、开票或核销。"


def incomplete(row, parent=None):
    return (getattr(row, "settlement_rule_code", None) == CODE
            or getattr(parent, "settlement_rule_code", None) == CODE)


def reject(message=MESSAGE, status=422):
    raise HTTPException(status, detail={"error": "channel_233_incomplete", "message": message})


def assert_complete(bill):
    if incomplete(bill):
        reject(status=409)


def _customer(db, bill):
    if str(bill.partner_name or "").strip() != LEGAL_NAME or str(bill.channel_name or "").strip() != CHANNEL_NAME:
        reject("资料未齐暂存仅限北京龙威互动科技有限公司的233内购账单")
    if not inspect(db.connection()).has_table("cf_partner_records"):
        reject("无法核实233客户身份")
    # Exact unique legal identity plus its authoritative registered channel label.
    # Lock that one customer to serialize monthly duplicate checks in PostgreSQL.
    lock = " FOR UPDATE" if db.get_bind().dialect.name == "postgresql" else ""
    rows = db.execute(text("SELECT id, short_name FROM cf_partner_records WHERE name=:name" + lock),
                      {"name": LEGAL_NAME}).all()
    if len(rows) != 1 or not rows[0].short_name or str(bill.channel_name or "").strip() != rows[0].short_name:
        reject("233客户须唯一且渠道名称须与客户库简称完全一致")


def validate_write(db, bill, items):
    if not incomplete(bill) and not any(incomplete(item) for item in items):
        return
    _customer(db, bill)
    if not incomplete(bill) or any(not incomplete(item) for item in items):
        reject("资料未齐标记必须同时保留在账单和全部明细")
    if (getattr(bill, "status", None) or "pending") != "pending":
        reject("资料未齐账单只能保持待核对")
    from app.models.channel import ChannelReceipt
    has_receipt = db.execute(select(ChannelReceipt.id).where(ChannelReceipt.channel_record_id == bill.id)).first()
    if has_receipt or float(getattr(bill, "received_amount", 0) or 0) != 0:
        reject("已有收款的账单不能改为资料未齐暂存")
    month = getattr(bill, "settlement_month", None)
    if not month or not items or any(item.settlement_cycle != month for item in items):
        reject("233暂存按真实结算月份逐月保存，明细月份须与账单一致")
    if not str(getattr(bill, "remark", None) or "").strip():
        reject("请备注缺失资料和原单依据；0仅系统占位")
    for item in items:
        amount = item.platform_settlement_amount
        if not str(item.game_name or "").strip() or amount is None or not isfinite(float(amount)):
            reject("逐行填写原单游戏名称和真实平台结算（允许负退款）")
        if getattr(item, "contract_access_item_id", None):
            reject("资料未齐暂存不能绑定或伪造合同清单")
        if any(float(getattr(item, key, 0) or 0) != 0 for key in ("billing_flow", "share_rate", "tax_rate")):
            reject("暂存中的原充值、分成和税率是待补占位；补齐请显式转正常规则")
    from app.models.channel import ChannelRecord
    duplicate = db.execute(select(ChannelRecord.id).where(
        ChannelRecord.partner_name == LEGAL_NAME,
        ChannelRecord.channel_name == CHANNEL_NAME,
        ChannelRecord.settlement_month == month,
        ChannelRecord.id != bill.id,
        or_(ChannelRecord.status.is_(None), ChannelRecord.status != "cancelled"),
    )).first()
    if duplicate:
        reject("233该月份已有账单，请打开原账单，不能重复暂存", 409)


def prepare_update(db, saved, incoming):
    """Validate before mutating; stale clients cannot erase the missing marker."""
    data = dict(incoming)
    completed = data.pop("complete_incomplete_draft", False)
    was_incomplete = incomplete(saved)
    if completed and not was_incomplete:
        reject("只有已保存的233资料未齐账单可以补齐转换")
    if was_incomplete:
        if data.get("partner_name", saved.partner_name) != saved.partner_name or data.get("channel_name", saved.channel_name) != saved.channel_name:
            reject("233暂存账单不能改换客户或渠道")
        if completed:
            _customer(db, saved)
            items = data.get("items")
            if not items or not data.get("settlement_rule_code") or data.get("settlement_rule_code") == CODE or not str(data.get("audit_reason") or "").strip():
                reject("补齐须提交全部明细、正常结算规则和资料来源说明")
            for item in items:
                if item.get("settlement_rule_code") in (None, "", CODE):
                    reject("补齐须逐行选择正常结算规则")
                keys = ["billing_flow", "share_rate", "tax_rate", "platform_settlement_amount"]
                mode = item.get("channel_fee_mode")
                if mode not in {"none", "fixed", "percent"} or item.get("tax_mode") not in {"none", "share", "after_fee"}:
                    reject("补齐须明确结算规则的通道费及税处理")
                if mode == "fixed": keys.append("gateway_cost")
                if mode == "percent": keys.append("channel_fee_rate")
                for key in keys:
                    if key not in item or item[key] is None or not isfinite(float(item[key])):
                        reject("补齐须明确提供原始充值、分成、税率及平台结算，不能沿用未知占位")
            # Ordinary contract, amount and lifecycle checks still apply afterwards.
            return data
        if data.get("settlement_rule_code", CODE) != CODE:
            reject("不能自动覆盖233资料未齐标记；请使用补齐资料入口")
        for item in data.get("items") or []:
            if item.get("settlement_rule_code") != CODE:
                reject("明细缺少233资料未齐标记，请刷新账单")
    fields = ("id", "partner_name", "channel_name", "settlement_month", "status", "received_amount", "remark", "settlement_rule_code")
    projected = SimpleNamespace(**{key: data.get(key, getattr(saved, key, None)) for key in fields})
    if incomplete(projected) or any(item.get("settlement_rule_code") == CODE for item in data.get("items") or []):
        from app.models.channel import ChannelRecordLineItem
        from app.schemas.channel import ChannelLineItemCreate
        items = ([ChannelLineItemCreate(**item) for item in data["items"]] if data.get("items") is not None else
                 list(db.execute(select(ChannelRecordLineItem).where(ChannelRecordLineItem.channel_record_id == saved.id)).scalars()))
        validate_write(db, projected, items)
    return data
