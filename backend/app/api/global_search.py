"""V2.5-2 全局业务搜索 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.schemas.global_search import GlobalSearchResponse
from app.services.global_search import search_business_data
from app.services.permissions import resolve_permissions

router = APIRouter()


@router.get("", response_model=GlobalSearchResponse)
def global_search(
    q: str = Query(..., min_length=1, max_length=120),
    limit: int = Query(30, ge=5, le=60),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> GlobalSearchResponse:
    permissions = resolve_permissions(db, user)
    payload = search_business_data(db, permissions, q, limit=limit)
    return GlobalSearchResponse.model_validate(payload)
