"""按游戏项目汇总可归属毛利。"""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.channel import ChannelRecord
from app.models.operating_expense import OperatingExpense
from app.models.reconciliation import ReconciliationRecord
from app.models.server_cost import ServerCost
from app.services.profit_analysis import (
    ProfitGameBucket,
    ProfitMonthBucket,
    _add_channel_income,
    _add_expenses,
    _add_rd_costs,
    _add_server_costs,
)

_EPSILON = 0.005


def _has_value(game: ProfitGameBucket) -> bool:
    return any(
        abs(value) > _EPSILON
        for value in (
            game.channel_settlement,
            game.rd_cost,
            game.server_cost_allocated,
            game.attributed_expense,
        )
    )


def _month_row(month: str, game: ProfitGameBucket) -> dict:
    total_cost = game.rd_cost + game.server_cost_allocated + game.attributed_expense
    gross_profit = game.channel_settlement - total_cost
    gross_margin = (
        gross_profit / game.channel_settlement * 100
        if abs(game.channel_settlement) > _EPSILON
        else 0
    )
    return {
        "month": month,
        "channel_settlement": round(game.channel_settlement, 2),
        "rd_cost": round(game.rd_cost, 2),
        "server_cost": round(game.server_cost_allocated, 2),
        "attributed_expense": round(game.attributed_expense, 2),
        "total_attributable_cost": round(total_cost, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_margin": round(gross_margin, 2),
    }


def _load_buckets(db: Session) -> tuple[
    dict[str, ProfitMonthBucket],
    dict[str, dict[str, ProfitGameBucket]],
]:
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
    standalone_server_costs = db.execute(
        select(ServerCost).order_by(ServerCost.expense_month.asc(), ServerCost.created_at.asc())
    ).scalars().all()
    expenses = db.execute(
        select(OperatingExpense).order_by(OperatingExpense.expense_month.asc(), OperatingExpense.created_at.asc())
    ).scalars().all()

    months: dict[str, ProfitMonthBucket] = defaultdict(ProfitMonthBucket)
    games: dict[str, dict[str, ProfitGameBucket]] = defaultdict(
        lambda: defaultdict(ProfitGameBucket)
    )
    _add_rd_costs(months, games, list(rd_records))
    _add_channel_income(months, games, list(channel_records))
    _add_server_costs(months, games, list(standalone_server_costs))
    _add_expenses(months, games, list(expenses))
    return months, games


def build_project_profit_analysis(db: Session, year: str | None = None) -> dict:
    months, games = _load_buckets(db)
    available_years = sorted(
        {month[:4] for month in months if len(month) >= 7 and month[:4].isdigit()},
        reverse=True,
    )

    normalized_year = str(year or "").strip()
    if normalized_year and (len(normalized_year) != 4 or not normalized_year.isdigit()):
        normalized_year = ""

    selected_months = sorted(
        [
            month
            for month in set(months) | set(games)
            if month and (not normalized_year or month.startswith(f"{normalized_year}-"))
        ]
    )

    project_months: dict[str, list[dict]] = defaultdict(list)
    project_totals: dict[str, ProfitGameBucket] = defaultdict(ProfitGameBucket)

    for month in selected_months:
        for game_name, game in games[month].items():
            if not _has_value(game):
                continue
            project_months[game_name].append(_month_row(month, game))
            total = project_totals[game_name]
            total.channel_settlement += game.channel_settlement
            total.rd_cost += game.rd_cost
            total.server_cost_allocated += game.server_cost_allocated
            total.attributed_expense += game.attributed_expense
            total.channel_flow += game.channel_flow
            total.rd_flow += game.rd_flow

    projects: list[dict] = []
    for game_name, game in project_totals.items():
        monthly = project_months[game_name]
        total_cost = game.rd_cost + game.server_cost_allocated + game.attributed_expense
        gross_profit = game.channel_settlement - total_cost
        gross_margin = (
            gross_profit / game.channel_settlement * 100
            if abs(game.channel_settlement) > _EPSILON
            else 0
        )
        projects.append(
            {
                "game_name": game_name,
                "channel_settlement": round(game.channel_settlement, 2),
                "rd_cost": round(game.rd_cost, 2),
                "server_cost": round(game.server_cost_allocated, 2),
                "attributed_expense": round(game.attributed_expense, 2),
                "total_attributable_cost": round(total_cost, 2),
                "gross_profit": round(gross_profit, 2),
                "gross_margin": round(gross_margin, 2),
                "channel_flow": round(game.channel_flow, 2),
                "rd_flow": round(game.rd_flow, 2),
                "active_months": len(monthly),
                "first_month": monthly[0]["month"] if monthly else None,
                "last_month": monthly[-1]["month"] if monthly else None,
                "monthly": list(reversed(monthly)),
            }
        )

    projects.sort(
        key=lambda item: (item["gross_profit"], item["channel_settlement"]),
        reverse=True,
    )

    channel_settlement = sum(item["channel_settlement"] for item in projects)
    total_attributable_cost = sum(item["total_attributable_cost"] for item in projects)
    gross_profit = sum(item["gross_profit"] for item in projects)
    gross_margin = (
        gross_profit / channel_settlement * 100
        if abs(channel_settlement) > _EPSILON
        else 0
    )
    shared_server_cost = sum(months[month].shared_server_cost for month in selected_months)
    shared_expense = sum(months[month].shared_expense for month in selected_months)

    return {
        "scope": "year" if normalized_year else "lifetime",
        "year": normalized_year or None,
        "available_years": available_years,
        "summary": {
            "project_count": len(projects),
            "profitable_projects": sum(1 for item in projects if item["gross_profit"] > _EPSILON),
            "loss_projects": sum(1 for item in projects if item["gross_profit"] < -_EPSILON),
            "channel_settlement": round(channel_settlement, 2),
            "total_attributable_cost": round(total_attributable_cost, 2),
            "gross_profit": round(gross_profit, 2),
            "gross_margin": round(gross_margin, 2),
            "shared_server_cost": round(shared_server_cost, 2),
            "shared_expense": round(shared_expense, 2),
            "data_months": len(selected_months),
        },
        "projects": projects,
        "notes": [
            "项目毛利 = 渠道结算 - 研发成本 - 可归属服务器成本 - 可归属经营费用。",
            "公司公共服务器成本和未归属经营费用不强行摊到项目，避免人为改变单个游戏毛利。",
            "项目按利润分析中的母游戏归并规则汇总；原始版本名仍保留在来源账单中。",
            "项目毛利属于内部管理口径，不等同于法定会计口径毛利或净利润。",
        ],
    }
