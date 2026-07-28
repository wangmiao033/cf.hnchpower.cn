"""QuickSDK flow library API."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.quicksdk import QuickSdkFlow, QuickSdkImportBatch
from app.schemas.quicksdk import (
    QuickSdkAnalyticsResponse,
    QuickSdkBatchListResponse,
    QuickSdkBatchRead,
    QuickSdkFlowListResponse,
    QuickSdkFlowRead,
    QuickSdkGameFlowResponse,
    QuickSdkImportRequest,
    QuickSdkRankItem,
    QuickSdkRdLineListResponse,
    QuickSdkRdLineSuggestion,
    QuickSdkSummaryResponse,
)

router = APIRouter()


def _normalize_month(raw: str | None) -> str | None:
    """Normalize 2026年5月 / 2026-5 / 202605 to 2026-05."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    match = re.match(r"^(\d{4})年(\d{1,2})月?$", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}"
    match = re.match(r"^(\d{4})[-/.](\d{1,2})$", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}"
    match = re.match(r"^(\d{4})(\d{2})$", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}"
    return text


def _normalize_product_name(raw: str | None) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    normalized = re.sub(r"005专服\d+.*$", "", text)
    normalized = re.sub(r"005折混服.*$", "", normalized)
    normalized = re.sub(r"005$", "", normalized)
    normalized = normalized.strip()
    return normalized or text


def _matches_query(summary_name: str, source_names: set[str], query: str | None) -> bool:
    if not query:
        return True
    q = query.strip().lower()
    if not q:
        return True
    if q in summary_name.lower():
        return True
    return any(q in name.lower() for name in source_names)


def _safe_float(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


@dataclass
class _FlowSummary:
    game_name: str
    settlement_month: str | None
    row_count: int = 0
    total_flow: float = 0
    channels: set[str] = field(default_factory=set)
    source_games: set[str] = field(default_factory=set)
    channel_totals: dict[str, float] = field(default_factory=dict)

    def add(self, source_game: str, channel: str, flow: float) -> None:
        self.row_count += 1
        self.total_flow += flow
        if source_game:
            self.source_games.add(source_game)
        if channel:
            self.channels.add(channel)
            self.channel_totals[channel] = self.channel_totals.get(channel, 0) + flow

    def to_response(self) -> QuickSdkRdLineSuggestion:
        top_channel = None
        top_channel_flow = 0.0
        if self.channel_totals:
            top_channel, top_channel_flow = max(
                self.channel_totals.items(), key=lambda item: item[1]
            )
        return QuickSdkRdLineSuggestion(
            game_name=self.game_name,
            settlement_month=self.settlement_month,
            row_count=self.row_count,
            channel_count=len(self.channels),
            source_game_count=len(self.source_games),
            total_flow=round(self.total_flow, 2),
            top_channel=top_channel,
            top_channel_flow=round(top_channel_flow, 2),
        )


def _build_flow_summaries(
    db: Session,
    *,
    settlement_month: str | None,
    q: str | None = None,
) -> list[_FlowSummary]:
    stmt = select(
        QuickSdkFlow.settlement_month,
        QuickSdkFlow.game_name,
        QuickSdkFlow.channel_name,
        QuickSdkFlow.gross_flow,
    )
    if settlement_month:
        stmt = stmt.where(QuickSdkFlow.settlement_month == settlement_month)

    rows = db.execute(stmt).all()
    grouped: dict[tuple[str | None, str], _FlowSummary] = {}
    for month, source_game, channel, gross_flow in rows:
        source_game_text = str(source_game or "").strip()
        product_name = _normalize_product_name(source_game_text)
        if not product_name:
            continue
        key = (month, product_name)
        item = grouped.get(key)
        if item is None:
            item = _FlowSummary(game_name=product_name, settlement_month=month)
            grouped[key] = item
        item.add(source_game_text, str(channel or "").strip(), _safe_float(gross_flow))

    summaries = [
        item
        for item in grouped.values()
        if _matches_query(item.game_name, item.source_games, q)
    ]
    summaries.sort(key=lambda item: (-item.total_flow, item.game_name))
    return summaries


@router.post("/imports", response_model=QuickSdkBatchRead, status_code=status.HTTP_201_CREATED)
def import_quicksdk_flows(
    payload: QuickSdkImportRequest,
    db: Session = Depends(get_db),
) -> QuickSdkBatchRead:
    if not payload.rows:
        raise HTTPException(status_code=400, detail="导入内容不能为空")

    months = {
        _normalize_month(row.settlement_month or payload.settlement_month or row.flow_date)
        for row in payload.rows
    }
    months.discard(None)
    settlement_month = _normalize_month(payload.settlement_month) or (months.pop() if len(months) == 1 else None)

    batch_id = str(uuid.uuid4())
    games: set[str] = set()
    channels: set[str] = set()
    total_flow = 0.0
    flows: list[QuickSdkFlow] = []

    for row in payload.rows:
        game_name = row.game_name.strip()
        channel_name = row.channel_name.strip()
        if not game_name or not channel_name:
            continue
        row_month = _normalize_month(row.settlement_month) or settlement_month
        flow = round(_safe_float(row.gross_flow), 2)
        games.add(game_name)
        channels.add(channel_name)
        total_flow += flow
        flows.append(
            QuickSdkFlow(
                id=str(uuid.uuid4()),
                batch_id=batch_id,
                flow_date=row.flow_date,
                settlement_month=row_month,
                game_name=game_name,
                channel_name=channel_name,
                gross_flow=flow,
            )
        )

    if not flows:
        raise HTTPException(status_code=400, detail="没有可导入的有效流水")

    batch = QuickSdkImportBatch(
        id=batch_id,
        source_file=(payload.source_file or "").strip() or None,
        settlement_month=settlement_month,
        row_count=len(flows),
        game_count=len(games),
        channel_count=len(channels),
        total_flow=round(total_flow, 2),
        note=(payload.note or "").strip() or None,
    )
    db.add(batch)
    db.add_all(flows)
    db.commit()
    db.refresh(batch)
    return QuickSdkBatchRead.model_validate(batch)


@router.get("/batches", response_model=QuickSdkBatchListResponse)
def list_quicksdk_batches(
    db: Session = Depends(get_db),
    settlement_month: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> QuickSdkBatchListResponse:
    month = _normalize_month(settlement_month)
    stmt = select(QuickSdkImportBatch)
    count_stmt = select(func.count(QuickSdkImportBatch.id))
    if month:
        stmt = stmt.where(QuickSdkImportBatch.settlement_month == month)
        count_stmt = count_stmt.where(QuickSdkImportBatch.settlement_month == month)
    total = int(db.execute(count_stmt).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(QuickSdkImportBatch.imported_at.desc()).limit(limit).offset(offset)
        )
        .scalars()
        .all()
    )
    return QuickSdkBatchListResponse(
        items=[QuickSdkBatchRead.model_validate(row) for row in rows],
        total=total,
    )


@router.get("/summary", response_model=QuickSdkSummaryResponse)
def get_quicksdk_summary(
    db: Session = Depends(get_db),
    settlement_month: str | None = Query(None),
) -> QuickSdkSummaryResponse:
    month = _normalize_month(settlement_month)
    stmt = select(
        func.count(func.distinct(QuickSdkImportBatch.id)),
        func.coalesce(func.sum(QuickSdkImportBatch.row_count), 0),
        func.coalesce(func.sum(QuickSdkImportBatch.total_flow), 0),
    )
    if month:
        stmt = stmt.where(QuickSdkImportBatch.settlement_month == month)
    batch_count, row_count, total_flow = db.execute(stmt).one()

    flow_stmt = select(
        func.count(func.distinct(QuickSdkFlow.game_name)),
        func.count(func.distinct(QuickSdkFlow.channel_name)),
    )
    if month:
        flow_stmt = flow_stmt.where(QuickSdkFlow.settlement_month == month)
    game_count, channel_count = db.execute(flow_stmt).one()
    return QuickSdkSummaryResponse(
        batch_count=int(batch_count or 0),
        row_count=int(row_count or 0),
        game_count=int(game_count or 0),
        channel_count=int(channel_count or 0),
        total_flow=round(_safe_float(total_flow), 2),
    )


@router.get("/flows", response_model=QuickSdkFlowListResponse)
def list_quicksdk_flows(
    db: Session = Depends(get_db),
    settlement_month: str | None = Query(None),
    game_name: str | None = Query(None),
    channel_name: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> QuickSdkFlowListResponse:
    month = _normalize_month(settlement_month)
    stmt = select(QuickSdkFlow)
    count_stmt = select(func.count(QuickSdkFlow.id))

    filters = []
    if month:
        filters.append(QuickSdkFlow.settlement_month == month)
    if game_name:
        filters.append(QuickSdkFlow.game_name.ilike(f"%{game_name.strip()}%"))
    if channel_name:
        filters.append(QuickSdkFlow.channel_name.ilike(f"%{channel_name.strip()}%"))
    if q:
        keyword = f"%{q.strip()}%"
        filters.append(or_(QuickSdkFlow.game_name.ilike(keyword), QuickSdkFlow.channel_name.ilike(keyword)))

    for item in filters:
        stmt = stmt.where(item)
        count_stmt = count_stmt.where(item)

    total = int(db.execute(count_stmt).scalar_one())
    rows = (
        db.execute(
            stmt.order_by(QuickSdkFlow.gross_flow.desc(), QuickSdkFlow.game_name.asc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
    return QuickSdkFlowListResponse(
        items=[QuickSdkFlowRead.model_validate(row) for row in rows],
        total=total,
    )


@router.get("/analytics", response_model=QuickSdkAnalyticsResponse)
def get_quicksdk_analytics(
    db: Session = Depends(get_db),
    settlement_month: str | None = Query(None),
    limit: int = Query(10, ge=1, le=500),
) -> QuickSdkAnalyticsResponse:
    month = _normalize_month(settlement_month)
    total_stmt = select(func.coalesce(func.sum(QuickSdkFlow.gross_flow), 0))
    if month:
        total_stmt = total_stmt.where(QuickSdkFlow.settlement_month == month)
    total_flow = _safe_float(db.execute(total_stmt).scalar_one())

    def rankings(column) -> list[QuickSdkRankItem]:
        stmt = select(
            column.label("name"),
            func.coalesce(func.sum(QuickSdkFlow.gross_flow), 0).label("flow"),
            func.count(QuickSdkFlow.id).label("row_count"),
        )
        if month:
            stmt = stmt.where(QuickSdkFlow.settlement_month == month)
        rows = (
            db.execute(stmt.group_by(column).order_by(func.sum(QuickSdkFlow.gross_flow).desc()).limit(limit))
            .all()
        )
        return [
            QuickSdkRankItem(
                name=str(name or "未填写"),
                flow=round(_safe_float(flow), 2),
                row_count=int(row_count or 0),
                percentage=round((_safe_float(flow) / total_flow * 100), 1) if total_flow else 0,
            )
            for name, flow, row_count in rows
        ]

    return QuickSdkAnalyticsResponse(
        game_rankings=rankings(QuickSdkFlow.game_name),
        channel_rankings=rankings(QuickSdkFlow.channel_name),
    )


@router.get("/rd-lines", response_model=QuickSdkRdLineListResponse)
def list_rd_line_suggestions(
    db: Session = Depends(get_db),
    settlement_month: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(300, ge=1, le=500),
) -> QuickSdkRdLineListResponse:
    month = _normalize_month(settlement_month)
    summaries = _build_flow_summaries(db, settlement_month=month, q=q)
    return QuickSdkRdLineListResponse(
        items=[item.to_response() for item in summaries[:limit]],
        total=len(summaries),
    )


@router.get("/game-flow", response_model=QuickSdkGameFlowResponse)
def get_game_flow(
    db: Session = Depends(get_db),
    game_name: str = Query(...),
    settlement_month: str | None = Query(None),
) -> QuickSdkGameFlowResponse:
    month = _normalize_month(settlement_month)
    target = str(game_name or "").strip()
    summaries = _build_flow_summaries(db, settlement_month=month, q=target)
    selected = next((item for item in summaries if item.game_name == target), None)
    if selected is None:
        selected = next((item for item in summaries if target in item.source_games), None)
    if selected is None:
        selected = summaries[0] if len(summaries) == 1 else None
    if selected is None:
        return QuickSdkGameFlowResponse(
            game_name=target,
            settlement_month=month,
        )
    item = selected.to_response()
    return QuickSdkGameFlowResponse(
        game_name=item.game_name,
        settlement_month=item.settlement_month,
        row_count=item.row_count,
        channel_count=item.channel_count,
        source_game_count=item.source_game_count,
        total_flow=item.total_flow,
        top_channel=item.top_channel,
        top_channel_flow=item.top_channel_flow,
    )
