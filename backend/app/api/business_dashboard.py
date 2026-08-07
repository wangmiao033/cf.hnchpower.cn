"""月度经营驾驶舱 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.schemas.business_dashboard import MonthlyBusinessDashboardRead
from app.services.monthly_business_dashboard import build_monthly_business_dashboard

router = APIRouter()


@router.get("/monthly", response_model=MonthlyBusinessDashboardRead)
def get_monthly_business_dashboard(
    month: str | None = Query(None, description="YYYY-MM / YYYY年M月"),
    trend_months: int = Query(12, ge=3, le=24),
    db: Session = Depends(get_db),
) -> MonthlyBusinessDashboardRead:
    return MonthlyBusinessDashboardRead.model_validate(
        build_monthly_business_dashboard(
            db,
            requested_month=month,
            trend_months=trend_months,
        )
    )
