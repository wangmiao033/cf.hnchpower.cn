"""经营驾驶舱月度聚合口径。"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
import re

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.bank_transaction import BankTransaction
from app.models.channel import ChannelReceipt, ChannelRecord
from app.models.reconciliation import ReconciliationRecord

_BLOCKED_STATUSES = {
    "cancelled", "canceled", "deleted", "void", "archived",
    "作废", "已取消", "已删除", "已归档",
}
_FINAL_STATUSES = {"completed", "settled", "reconciled", "verified"}


@dataclass
class MonthBucket:
    channel_settlement: float = 0
    rd_settlement: float = 0
    server_cost: float = 0
    channel_receipts: float = 0
    rd_payments: float = 0
    channel_outstanding: float = 0
    channel_bill_ids: set[str] = field(default_factory=set)
    rd_bill_ids: set[str] = field(default_factory=set)
    channel_completed_ids: set[str] = field(default_factory=set)
    rd_completed_ids: set[str] = field(default_factory=set)


@dataclass
class GameBucket:
    channel_settlement: float = 0
    rd_settlement: float = 0
    channel_flow: float = 0
    rd_flow: float = 0


def _num(value) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def month_key(value) -> str:
    raw = str(value or "").strip()
    match = re.search(r"(20\d{2})\D{0,3}(1[0-2]|0?[1-9])(?:\D|$)", raw)
    if not match:
        compact = re.fullmatch(r"(20\d{2})(1[0-2]|0[1-9])", raw)
        if compact:
            return f"{compact.group(1)}-{int(compact.group(2)):02d}"
        return ""
    return f"{match.group(1)}-{int(match.group(2)):02d}"


def shift_month(value: str, delta: int) -> str:
    normalized = month_key(value)
    if not normalized:
        return ""
    year, month = (int(part) for part in normalized.split("-"))
    index = year * 12 + (month - 1) + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def month_window(end_month: str, count: int) -> list[str]:
    safe_count = max(1, min(36, int(count or 12)))
    return [shift_month(end_month, offset) for offset in range(-(safe_count - 1), 1)]


def _active(record) -> bool:
    return str(getattr(record, "status", None) or "pending").strip().lower() not in _BLOCKED_STATUSES


def _completed(record) -> bool:
    return str(getattr(record, "status", None) or "pending").strip().lower() in _FINAL_STATUSES


def _clean_game(value) -> str:
    return str(value or "").strip() or "未填写产品"


def _add_rd_records(
    buckets: dict[str, MonthBucket],
    games_by_month: dict[str, dict[str, GameBucket]],
    records: list[ReconciliationRecord],
) -> None:
    for record in records:
        if not _active(record):
            continue
        items = list(record.line_items or [])
        if items:
            seen_months: set[str] = set()
            for line in items:
                month = month_key(line.settlement_cycle or record.settlement_month)
                if not month:
                    continue
                settlement = abs(_num(line.settlement_amount))
                flow = _num(line.revenue)
                bucket = buckets[month]
                bucket.rd_settlement += settlement
                bucket.rd_bill_ids.add(str(record.id))
                if _completed(record):
                    bucket.rd_completed_ids.add(str(record.id))
                seen_months.add(month)
                game = games_by_month[month][_clean_game(line.game_name or record.game_name)]
                game.rd_settlement += settlement
                game.rd_flow += flow
            if not seen_months:
                month = month_key(record.settlement_month)
                if month:
                    settlement = abs(_num(record.settlement_amount))
                    bucket = buckets[month]
                    bucket.rd_settlement += settlement
                    bucket.rd_bill_ids.add(str(record.id))
                    if _completed(record):
                        bucket.rd_completed_ids.add(str(record.id))
                    game = games_by_month[month][_clean_game(record.game_name)]
                    game.rd_settlement += settlement
                    game.rd_flow += _num(record.game_flow)
            continue

        month = month_key(record.settlement_month)
        if not month:
            continue
        settlement = abs(_num(record.settlement_amount))
        bucket = buckets[month]
        bucket.rd_settlement += settlement
        bucket.rd_bill_ids.add(str(record.id))
        if _completed(record):
            bucket.rd_completed_ids.add(str(record.id))
        game = games_by_month[month][_clean_game(record.game_name)]
        game.rd_settlement += settlement
        game.rd_flow += _num(record.game_flow)


def _add_channel_records(
    buckets: dict[str, MonthBucket],
    games_by_month: dict[str, dict[str, GameBucket]],
    records: list[ChannelRecord],
) -> None:
    for record in records:
        if not _active(record):
            continue

        items = list(record.line_items or [])
        usable = []
        for line in items:
            month = month_key(getattr(line, "settlement_cycle", None) or record.settlement_month)
            if month:
                usable.append((line, month))

        if usable:
            month_settlements: dict[str, float] = defaultdict(float)
            for line, month in usable:
                settlement = abs(_num(line.settlement_amount))
                month_settlements[month] += settlement
                game = games_by_month[month][_clean_game(line.game_name or record.game_name)]
                game.channel_settlement += settlement
                game.channel_flow += _num(line.billing_flow)

            total_settlement = sum(month_settlements.values())
            received = max(0.0, abs(_num(record.received_amount)))
            server_cost = max(0.0, _num(record.server_cost))
            for month, settlement in month_settlements.items():
                ratio = settlement / total_settlement if total_settlement > 0.005 else 0.0
                bucket = buckets[month]
                bucket.channel_settlement += settlement
                bucket.server_cost += server_cost * ratio
                bucket.channel_outstanding += max(0.0, settlement - received * ratio)
                bucket.channel_bill_ids.add(str(record.id))
                if _completed(record):
                    bucket.channel_completed_ids.add(str(record.id))
            continue

        month = month_key(record.settlement_month)
        if not month:
            continue
        settlement = abs(_num(record.settlement_amount))
        bucket = buckets[month]
        bucket.channel_settlement += settlement
        bucket.server_cost += max(0.0, _num(record.server_cost))
        bucket.channel_outstanding += max(0.0, settlement - abs(_num(record.received_amount)))
        bucket.channel_bill_ids.add(str(record.id))
        if _completed(record):
            bucket.channel_completed_ids.add(str(record.id))
        game = games_by_month[month][_clean_game(record.game_name)]
        game.channel_settlement += settlement
        game.channel_flow += _num(record.billing_flow)


def _add_channel_receipts(buckets: dict[str, MonthBucket], receipts: list[ChannelReceipt]) -> None:
    for receipt in receipts:
        month = month_key(receipt.receipt_date)
        if month:
            buckets[month].channel_receipts += _num(receipt.amount)


def _rd_payment_amount(row: BankTransaction) -> float:
    for candidate in (row.linked_amount, row.expense_amount, row.amount):
        value = _num(candidate)
        if abs(value) > 0.005:
            return abs(value)
    return 0.0


def _add_rd_payments(buckets: dict[str, MonthBucket], transactions: list[BankTransaction]) -> None:
    for transaction in transactions:
        if transaction.type != "payment_register":
            continue
        if str(transaction.reconciliation_type or "").strip().lower() != "rd":
            continue
        month = month_key(transaction.trade_date)
        if month:
            buckets[month].rd_payments += _rd_payment_amount(transaction)


def _derived(bucket: MonthBucket) -> dict[str, float]:
    contribution = bucket.channel_settlement - bucket.rd_settlement - bucket.server_cost
    margin = contribution / bucket.channel_settlement * 100 if abs(bucket.channel_settlement) > 0.005 else 0
    cash_net = bucket.channel_receipts - bucket.rd_payments
    return {
        "contribution": round(contribution, 2),
        "contribution_margin": round(margin, 2),
        "cash_net": round(cash_net, 2),
    }


def metric(current: float, previous: float) -> dict:
    current_value = round(_num(current), 2)
    previous_value = round(_num(previous), 2)
    change = round(current_value - previous_value, 2)
    if abs(previous_value) <= 0.005:
        change_percent = 0.0 if abs(current_value) <= 0.005 else None
    else:
        change_percent = round(change / abs(previous_value) * 100, 2)
    return {
        "value": current_value,
        "previous_value": previous_value,
        "change_amount": change,
        "change_percent": change_percent,
    }


def build_monthly_business_dashboard(
    db: Session,
    requested_month: str | None = None,
    trend_months: int = 12,
) -> dict:
    rd_records = db.execute(
        select(ReconciliationRecord)
        .options(selectinload(ReconciliationRecord.line_items))
        .order_by(ReconciliationRecord.created_at.asc())
    ).scalars().all()
    channel_records = db.execute(
        select(ChannelRecord)
        .options(selectinload(ChannelRecord.line_items))
        .order_by(ChannelRecord.created_at.asc())
    ).scalars().all()
    channel_receipts = db.execute(select(ChannelReceipt).order_by(ChannelReceipt.created_at.asc())).scalars().all()
    rd_transactions = db.execute(
        select(BankTransaction).where(
            BankTransaction.type == "payment_register",
            BankTransaction.reconciliation_type == "rd",
        ).order_by(BankTransaction.created_at.asc())
    ).scalars().all()

    buckets: dict[str, MonthBucket] = defaultdict(MonthBucket)
    games_by_month: dict[str, dict[str, GameBucket]] = defaultdict(lambda: defaultdict(GameBucket))
    _add_rd_records(buckets, games_by_month, list(rd_records))
    _add_channel_records(buckets, games_by_month, list(channel_records))
    _add_channel_receipts(buckets, list(channel_receipts))
    _add_rd_payments(buckets, list(rd_transactions))

    available_months = sorted((month for month in buckets if month), reverse=True)
    latest_month = available_months[0] if available_months else None
    selected = month_key(requested_month) or latest_month
    if not selected:
        now = datetime.now()
        selected = f"{now.year:04d}-{now.month:02d}"
    previous_month = shift_month(selected, -1)
    current = buckets[selected]
    previous = buckets[previous_month]
    current_derived = _derived(current)
    previous_derived = _derived(previous)

    trend = []
    for month in month_window(selected, trend_months):
        bucket = buckets[month]
        derived = _derived(bucket)
        trend.append({
            "month": month,
            "channel_settlement": round(bucket.channel_settlement, 2),
            "rd_settlement": round(bucket.rd_settlement, 2),
            "server_cost": round(bucket.server_cost, 2),
            "contribution": derived["contribution"],
            "contribution_margin": derived["contribution_margin"],
            "channel_receipts": round(bucket.channel_receipts, 2),
            "rd_payments": round(bucket.rd_payments, 2),
            "cash_net": derived["cash_net"],
        })

    game_rows = []
    for game_name, game in games_by_month[selected].items():
        contribution = game.channel_settlement - game.rd_settlement
        if (
            abs(game.channel_settlement) <= 0.005 and abs(game.rd_settlement) <= 0.005
            and abs(game.channel_flow) <= 0.005 and abs(game.rd_flow) <= 0.005
        ):
            continue
        game_rows.append({
            "game_name": game_name,
            "channel_settlement": round(game.channel_settlement, 2),
            "rd_settlement": round(game.rd_settlement, 2),
            "contribution_before_server": round(contribution, 2),
            "channel_flow": round(game.channel_flow, 2),
            "rd_flow": round(game.rd_flow, 2),
        })
    game_rows.sort(key=lambda item: (item["contribution_before_server"], item["channel_settlement"]), reverse=True)

    return {
        "month": selected,
        "previous_month": previous_month,
        "available_months": available_months,
        "latest_month": latest_month,
        "channel_settlement": metric(current.channel_settlement, previous.channel_settlement),
        "rd_settlement": metric(current.rd_settlement, previous.rd_settlement),
        "server_cost": metric(current.server_cost, previous.server_cost),
        "contribution": metric(current_derived["contribution"], previous_derived["contribution"]),
        "contribution_margin": metric(current_derived["contribution_margin"], previous_derived["contribution_margin"]),
        "channel_receipts": metric(current.channel_receipts, previous.channel_receipts),
        "rd_payments": metric(current.rd_payments, previous.rd_payments),
        "cash_net": metric(current_derived["cash_net"], previous_derived["cash_net"]),
        "channel_outstanding": metric(current.channel_outstanding, previous.channel_outstanding),
        "channel_bill_count": len(current.channel_bill_ids),
        "rd_bill_count": len(current.rd_bill_ids),
        "channel_completed_count": len(current.channel_completed_ids),
        "rd_completed_count": len(current.rd_completed_ids),
        "trend": trend,
        "games": game_rows[:50],
        "notes": [
            "渠道应收与研发应付均按游戏明细 settlement_cycle 拆分到实际结算月份；历史无明细周期时回退主账单月份。",
            "跨月渠道账单的服务器成本与当前未收余额按各月结算金额占比分摊，仅用于经营分析口径。",
            "渠道已收按收款日期统计；研发已付按已关联研发账单的银行付款登记交易日期统计。",
            "结算贡献 = 渠道结算金额 - 研发结算金额 - 已录入服务器成本，不等同于会计净利润。",
            "当前未收为所选账期渠道账单截至现在的未收余额，不代表该月月末历史余额。",
        ],
    }
