"""经营利润分析 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.schemas.profit_analysis import ProfitAnalysisRead
from app.services.profit_analysis import build_profit_analysis

router = APIRouter()


@router.get("/monthly", response_model=ProfitAnalysisRead)
def get_monthly_profit_analysis(
    db: Session = Depends(get_db),
    month: str | None = Query(None),
    trend_months: int = Query(12, ge=1, le=36),
) -> ProfitAnalysisRead:
    return ProfitAnalysisRead.model_validate(
        build_profit_analysis(db, requested_month=month, trend_months=trend_months)
    )
