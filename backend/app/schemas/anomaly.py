"""异常中心读取模型。"""

from __future__ import annotations

from pydantic import BaseModel


class BillInvoiceOverview(BaseModel):
    bill_type: str
    bill_id: str
    bill_amount: float
    allocated_amount: float
    remaining_amount: float
    coverage_percent: float
    coverage_status: str
    allocation_count: int
