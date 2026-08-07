"""管理口径经营利润分析。"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.channel import ChannelRecord
from app.models.operating_expense import OperatingExpense
from app.models.reconciliation import ReconciliationRecord
from app.services.monthly_business_dashboard import metric, month_key, month_window, shift_month

_BLOCKED_STATUSES = {
    "cancelled",
    "canceled",
    "deleted",
    "void",
    "archived",
    "作废",
    "已取消",
    "已删除",
    "已归档",
}


@dataclass
class ProfitMonthBucket:
    channel_settlement: float = 0
    rd_cost: float = 0
    server_cost: float = 0
    operating_expense: float = 0
    shared_expense: float = 0
    attributed_expense: float = 0
    expense_count: int = 0
    channel_bill_ids: set[str] = field(default_factory=set)
    rd_bill_ids: set[str] = field(default_factory=set)
    category_expenses: dict[str, float] = field(default_factory=lambda: defaultdict(float))


@dataclass
class ProfitGameBucket:
    channel_settlement: float = 0
    rd_cost: float = 0
    server_cost_allocated: float = 0
    attributed_expense: float = 0
    channel_flow: float = 0
    rd_flow: float = 0


def _num(value) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _active(record) -> bool:
    return str(getattr(record, "status", None) or "pending").strip().lower() not in _BLOCKED_STATUSES


def _game(value) -> str:
    return str(value or "").strip() or "未填写产品"


def _add_rd_costs(
    months: dict[str, ProfitMonthBucket],
    games: dict[str, dict[str, ProfitGameBucket]],
    records: list[ReconciliationRecord],
) -> None:
    for record in records:
        if not _active(record):
            continue
        items = list(getattr(record, "line_items", None) or [])
        if items:
            used = False
            for line in items:
                month = month_key(getattr(line, "settlement_cycle", None) or record.settlement_month)
                if not month:
                    continue
                used = True
                cost = abs(_num(getattr(line, "settlement_amount", 0)))
                flow = _num(getattr(line, "revenue", 0))
                months[month].rd_cost += cost
                months[month].rd_bill_ids.add(str(record.id))
                game = games[month][_game(getattr(line, "game_name", None) or record.game_name)]
                game.rd_cost += cost
                game.rd_flow += flow
            if used:
                continue

        month = month_key(record.settlement_month)
        if not month:
            continue
        cost = abs(_num(record.settlement_amount))
        months[month].rd_cost += cost
        months[month].rd_bill_ids.add(str(record.id))
        game = games[month][_game(record.game_name)]
        game.rd_cost += cost
        game.rd_flow += _num(record.game_flow)


def _channel_line_allocations(record) -> list[tuple[str, float, float, float]]:
    """Return (game, normalized settlement, flow, allocated server cost)."""
    items = list(getattr(record, "line_items", None) or [])
    total_settlement = abs(_num(getattr(record, "settlement_amount", 0)))
    server_cost = max(0.0, _num(getattr(record, "server_cost", 0)))
    if not items:
        return [
            (
                _game(getattr(record, "game_name", None)),
                total_settlement,
                _num(getattr(record, "billing_flow", 0)),
                server_cost,
            )
        ]

    rows: list[tuple[str, float, float]] = []
    for line in items:
        rows.append(
            (
                _game(getattr(line, "game_name", None) or getattr(record, "game_name", None)),
                abs(_num(getattr(line, "settlement_amount", 0))),
                _num(getattr(line, "billing_flow", 0)),
            )
        )

    raw_total = sum(row[1] for row in rows)
    if raw_total > 0.005 and total_settlement > 0.005:
        scale = total_settlement / raw_total
    else:
        scale = 1.0

    out: list[tuple[str, float, float, float]] = []
    count = len(rows)
    for game_name, raw_settlement, flow in rows:
        normalized_settlement = raw_settlement * scale
        if raw_total > 0.005:
            server_share = server_cost * raw_settlement / raw_total
        else:
            server_share = server_cost / count if count else 0
        out.append((game_name, normalized_settlement, flow, server_share))
    return out


def _add_channel_income(
    months: dict[str, ProfitMonthBucket],
    games: dict[str, dict[str, ProfitGameBucket]],
    records: list[ChannelRecord],
) -> None:
    for record in records:
        if not _active(record):
            continue
        month = month_key(record.settlement_month)
        if not month:
            continue
        total = abs(_num(record.settlement_amount))
        server = max(0.0, _num(record.server_cost))
        months[month].channel_settlement += total
        months[month].server_cost += server
        months[month].channel_bill_ids.add(str(record.id))

        for game_name, settlement, flow, server_share in _channel_line_allocations(record):
            game = games[month][game_name]
            game.channel_settlement += settlement
            game.channel_flow += flow
            game.server_cost_allocated += server_share


def _add_expenses(
    months: dict[str, ProfitMonthBucket],
    games: dict[str, dict[str, ProfitGameBucket]],
    expenses: list[OperatingExpense],
) -> None:
    for expense in expenses:
        month = month_key(expense.expense_month)
        if not month:
            continue
        amount = abs(_num(expense.amount))
        bucket = months[month]
        bucket.operating_expense += amount
        bucket.expense_count += 1
        bucket.category_expenses[str(expense.category or "other")] += amount
        game_name = str(expense.game_name or "").strip()
        if game_name:
            bucket.attributed_expense += amount
            games[month][_game(game_name)].attributed_expense += amount
        else:
            bucket.shared_expense += amount


def _derive(bucket: ProfitMonthBucket) -> dict[str, float]:
    pre_expense = bucket.channel_settlement - bucket.rd_cost - bucket.server_cost
    operating_profit = pre_expense - bucket.operating_expense
    margin = operating_profit / bucket.channel_settlement * 100 if abs(bucket.channel_settlement) > 0.005 else 0
    return {
        "pre_expense_contribution": round(pre_expense, 2),
        "operating_profit": round(operating_profit, 2),
        "profit_margin": round(margin, 2),
    }


def _category_rows(bucket: ProfitMonthBucket) -> list[dict]:
    total = bucket.operating_expense
    rows = []
    for category, amount in bucket.category_expenses.items():
        rows.append(
            {
                "category": category,
                "amount": round(amount, 2),
                "share_percent": round(amount / total * 100, 2) if total > 0.005 else 0,
            }
        )
    rows.sort(key=lambda item: item["amount"], reverse=True)
    return rows


def _game_rows(games: dict[str, ProfitGameBucket]) -> list[dict]:
    rows = []
    for game_name, game in games.items():
        profit = (
            game.channel_settlement
            - game.rd_cost
            - game.server_cost_allocated
            - game.attributed_expense
        )
        if (
            abs(game.channel_settlement) <= 0.005
            and abs(game.rd_cost) <= 0.005
            and abs(game.server_cost_allocated) <= 0.005
            and abs(game.attributed_expense) <= 0.005
        ):
            continue
        margin = profit / game.channel_settlement * 100 if abs(game.channel_settlement) > 0.005 else 0
        rows.append(
            {
                "game_name": game_name,
                "channel_settlement": round(game.channel_settlement, 2),
                "rd_cost": round(game.rd_cost, 2),
                "server_cost_allocated": round(game.server_cost_allocated, 2),
                "attributed_expense": round(game.attributed_expense, 2),
                "attributable_profit": round(profit, 2),
                "attributable_margin": round(margin, 2),
                "channel_flow": round(game.channel_flow, 2),
                "rd_flow": round(game.rd_flow, 2),
            }
        )
    rows.sort(key=lambda item: (item["attributable_profit"], item["channel_settlement"]), reverse=True)
    return rows


def build_profit_analysis(
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
    expenses = db.execute(
        select(OperatingExpense).order_by(OperatingExpense.expense_month.asc(), OperatingExpense.created_at.asc())
    ).scalars().all()

    months: dict[str, ProfitMonthBucket] = defaultdict(ProfitMonthBucket)
    games: dict[str, dict[str, ProfitGameBucket]] = defaultdict(lambda: defaultdict(ProfitGameBucket))
    _add_rd_costs(months, games, list(rd_records))
    _add_channel_income(months, games, list(channel_records))
    _add_expenses(months, games, list(expenses))

    available_months = sorted((month for month in months if month), reverse=True)
    latest_month = available_months[0] if available_months else None
    selected = month_key(requested_month) or latest_month
    if not selected:
        now = datetime.now()
        selected = f"{now.year:04d}-{now.month:02d}"
    previous_month = shift_month(selected, -1)
    current = months[selected]
    previous = months[previous_month]
    current_d = _derive(current)
    previous_d = _derive(previous)

    trend = []
    for month in month_window(selected, trend_months):
        bucket = months[month]
        derived = _derive(bucket)
        trend.append(
            {
                "month": month,
                "channel_settlement": round(bucket.channel_settlement, 2),
                "rd_cost": round(bucket.rd_cost, 2),
                "server_cost": round(bucket.server_cost, 2),
                "operating_expense": round(bucket.operating_expense, 2),
                "operating_profit": derived["operating_profit"],
                "profit_margin": derived["profit_margin"],
            }
        )

    return {
        "month": selected,
        "previous_month": previous_month,
        "available_months": available_months,
        "latest_month": latest_month,
        "channel_settlement": metric(current.channel_settlement, previous.channel_settlement),
        "rd_cost": metric(current.rd_cost, previous.rd_cost),
        "server_cost": metric(current.server_cost, previous.server_cost),
        "operating_expense": metric(current.operating_expense, previous.operating_expense),
        "pre_expense_contribution": metric(
            current_d["pre_expense_contribution"], previous_d["pre_expense_contribution"]
        ),
        "operating_profit": metric(current_d["operating_profit"], previous_d["operating_profit"]),
        "profit_margin": metric(current_d["profit_margin"], previous_d["profit_margin"]),
        "shared_expense": metric(current.shared_expense, previous.shared_expense),
        "attributed_expense": metric(current.attributed_expense, previous.attributed_expense),
        "channel_bill_count": len(current.channel_bill_ids),
        "rd_bill_count": len(current.rd_bill_ids),
        "expense_count": current.expense_count,
        "expense_categories": _category_rows(current),
        "games": _game_rows(games[selected])[:100],
        "trend": trend,
        "notes": [
            "管理口径经营利润 = 渠道结算 - 研发结算成本 - 账单服务器成本 - 经营费用。",
            "研发多周期账单继续按每条明细自己的 settlement_cycle 归属月份。",
            "多游戏渠道账单的服务器成本按各游戏结算金额占比分配；若明细结算均为 0，则按明细行平均分配。",
            "产品可归属利润只扣明确归属到该游戏的经营费用；公司公共费用不强行分摊到产品。",
            "该页面用于内部经营管理，不等同于法定会计报表净利润；折旧、所得税调整等未录入项目不会自动推算。",
        ],
    }
