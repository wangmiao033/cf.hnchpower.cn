"""Read the narrow set of columns used by the two management-profit reports.

Previously both reports loaded every field of four full historical tables,
including long free-text notes and unrelated settlement metadata. We retain
the complete historical time range to preserve available-month/year logic and
multi-period RD allocation, but avoid transferring unused column values.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, load_only, selectinload

from app.models.channel import ChannelRecord, ChannelRecordLineItem
from app.models.reconciliation import ReconciliationRecord, ReconciliationLineItem
from app.models.server_cost import ServerCost
from app.models.operating_expense import OperatingExpense


def load_profit_records(db: Session) -> tuple[list, list, list, list]:
    """Return (RD, channel, server, operating expense) without changing scope."""
    rd_records = db.execute(
        select(ReconciliationRecord).options(
            load_only(
                ReconciliationRecord.id, ReconciliationRecord.status,
                ReconciliationRecord.settlement_month,
                ReconciliationRecord.settlement_amount,
                ReconciliationRecord.game_name, ReconciliationRecord.game_flow,
            ),
            selectinload(ReconciliationRecord.line_items).load_only(
                ReconciliationLineItem.id, ReconciliationLineItem.reconciliation_id,
                ReconciliationLineItem.settlement_cycle,
                ReconciliationLineItem.settlement_amount,
                ReconciliationLineItem.revenue, ReconciliationLineItem.game_name,
            ),
        )
    ).scalars().all()
    channel_records = db.execute(
        select(ChannelRecord).options(
            load_only(
                ChannelRecord.id, ChannelRecord.status,
                ChannelRecord.settlement_month, ChannelRecord.settlement_amount,
                ChannelRecord.game_name, ChannelRecord.billing_flow,
                ChannelRecord.server_cost,
                ChannelRecord.settlement_adjustment_amount,
                ChannelRecord.settlement_final_override,
            ),
            selectinload(ChannelRecord.line_items).load_only(
                ChannelRecordLineItem.id, ChannelRecordLineItem.channel_record_id,
                ChannelRecordLineItem.settlement_amount,
                ChannelRecordLineItem.game_name, ChannelRecordLineItem.billing_flow,
            ),
        )
    ).scalars().all()
    server_costs = db.execute(
        select(ServerCost).options(
            load_only(ServerCost.id, ServerCost.status, ServerCost.expense_month,
                      ServerCost.amount, ServerCost.game_name)
        )
    ).scalars().all()
    expenses = db.execute(
        select(OperatingExpense).options(
            load_only(OperatingExpense.id, OperatingExpense.expense_month,
                      OperatingExpense.amount, OperatingExpense.category,
                      OperatingExpense.game_name)
        )
    ).scalars().all()
    return rd_records, channel_records, server_costs, expenses
