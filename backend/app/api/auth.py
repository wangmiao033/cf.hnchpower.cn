"""认证与账号管理 API。"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import (
    AUTH_COOKIE_NAME,
    clear_auth_cookie,
    clear_login_fail,
    create_session,
    decode_access_token,
    get_user_by_email,
    hash_password,
    is_locked,
    register_login_fail,
    require_current_user,
    set_auth_cookie,
)
from app.models.user import AuthSession, AuthUser
from app.schemas.auth import (
    AdminResetPasswordRequest,
    AuthMeResponse,
    AuthMessageResponse,
    AuthUserRead,
    AuthUsersListResponse,
    ChangePasswordRequest,
    PasswordLoginRequest,
    UserAccessUpdateRequest,
    UserCreateRequest,
    UserStatusRequest,
)
from app.services.permissions import (
    ROLE_ALIASES,
    ROLE_PRESETS,
    normalize_role,
    permission_catalog_payload,
    permission_snapshot,
    require_permission,
    set_user_access,
)

router = APIRouter()

BUILTIN_ACCOUNT = os.environ.get("AUTH_BUILTIN_ACCOUNT", "adam").strip().lower()
BUILTIN_PASSWORDS = tuple(
    password.strip()
    for password in os.environ.get("AUTH_BUILTIN_PASSWORDS", "").split(",")
    if password.strip()
)


def _normalize_account(value: str | None) -> str:
    return (value or "").strip().lower()


def _validated_role(value: str | None) -> str:
    raw = str(value or "operator").strip().lower() or "operator"
    normalized = ROLE_ALIASES.get(raw, raw)
    if normalized not in ROLE_PRESETS:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_role", "allowed": sorted(ROLE_PRESETS)},
        )
    return normalized


def _auth_me_response(db: Session, user: AuthUser) -> AuthMeResponse:
    snapshot = permission_snapshot(db, user)
    return AuthMeResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=snapshot["role"],
        role_label=snapshot["role_label"],
        permissions=snapshot["permissions"],
        permission_overrides=snapshot["permission_overrides"],
        is_active=user.is_active,
        last_login_at=user.last_login_at,
    )


def _auth_user_read(db: Session, user: AuthUser) -> AuthUserRead:
    snapshot = permission_snapshot(db, user)
    base = AuthUserRead.model_validate(user)
    return base.model_copy(
        update={
            "role": snapshot["role"],
            "role_label": snapshot["role_label"],
            "permissions": snapshot["permissions"],
            "permission_overrides": snapshot["permission_overrides"],
        }
    )


def _active_admin_count(db: Session) -> int:
    return int(
        db.execute(
            select(func.count()).select_from(AuthUser).where(
                AuthUser.is_active.is_(True),
                AuthUser.role == "admin",
            )
        ).scalar_one()
        or 0
    )


def _protect_last_active_admin(
    db: Session,
    user: AuthUser,
    *,
    next_active: bool | None = None,
    next_role: str | None = None,
) -> None:
    if not user.is_active or normalize_role(user.role) != "admin":
        return
    resulting_active = user.is_active if next_active is None else bool(next_active)
    resulting_role = normalize_role(user.role if next_role is None else next_role)
    if resulting_active and resulting_role == "admin":
        return
    if _active_admin_count(db) <= 1:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "last_admin_protected",
                "message": "系统必须至少保留一个启用中的管理员账号。",
            },
        )


def _get_or_create_builtin_user(db: Session) -> AuthUser:
    """Create the first administrator once; never re-apply the bootstrap password later."""
    user = get_user_by_email(db, BUILTIN_ACCOUNT) or db.get(AuthUser, "auth-user-adam")

    if user is None:
        if not BUILTIN_PASSWORDS:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="内置管理员尚未初始化，请配置 AUTH_BUILTIN_PASSWORDS",
            )
        user = AuthUser(
            id="auth-user-adam",
            email=BUILTIN_ACCOUNT,
            display_name=BUILTIN_ACCOUNT,
            role="admin",
            password_hash=hash_password(BUILTIN_PASSWORDS[0]),
            is_active=True,
        )
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            user = get_user_by_email(db, BUILTIN_ACCOUNT) or db.get(AuthUser, "auth-user-adam")
            if user is None:
                raise
    elif not user.password_hash and BUILTIN_PASSWORDS:
        user.password_hash = hash_password(BUILTIN_PASSWORDS[0])
        db.flush()

    return user


def _session_id_from_token(token: str | None) -> str:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    payload = decode_access_token(token)
    session_id = str(payload.get("sid") or "")
    if not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录凭证无效")
    return session_id


def _revoke_sessions(
    db: Session,
    user_id: str,
    *,
    except_session_id: str | None = None,
) -> int:
    stmt = select(AuthSession).where(
        AuthSession.user_id == user_id,
        AuthSession.revoked_at.is_(None),
    )
    if except_session_id:
        stmt = stmt.where(AuthSession.id != except_session_id)

    sessions = db.execute(stmt).scalars().all()
    revoked_at = datetime.now(timezone.utc)
    for session in sessions:
        session.revoked_at = revoked_at
    return len(sessions)


@router.post("/login-password", response_model=AuthMeResponse)
def login_password(payload: PasswordLoginRequest, db: Session = Depends(get_db)) -> JSONResponse:
    from app.core.security import verify_password

    account = _normalize_account(payload.account or payload.email)
    if not account:
        raise HTTPException(status_code=422, detail="请输入账号")

    user = _get_or_create_builtin_user(db) if account == BUILTIN_ACCOUNT else get_user_by_email(db, account)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误")
    if is_locked(user):
        raise HTTPException(status_code=423, detail="登录已锁定，请稍后再试")

    if not verify_password(payload.password, user.password_hash):
        register_login_fail(user)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误")

    clear_login_fail(user)
    token, _ = create_session(db, user)
    db.commit()

    body = _auth_me_response(db, user).model_dump(mode="json")
    resp = JSONResponse(content=body)
    set_auth_cookie(resp, token)
    return resp


@router.post("/logout", response_model=AuthMessageResponse)
def logout(
    user: AuthUser = Depends(require_current_user),
    db: Session = Depends(get_db),
    token: str | None = Cookie(default=None, alias=AUTH_COOKIE_NAME),
) -> JSONResponse:
    current_session_id = _session_id_from_token(token)
    session = db.get(AuthSession, current_session_id)
    if session is not None and session.user_id == user.id and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()
    resp = JSONResponse(content=AuthMessageResponse(message="已退出登录").model_dump(mode="json"))
    clear_auth_cookie(resp)
    return resp


@router.get("/me", response_model=AuthMeResponse)
def me(
    user: AuthUser = Depends(require_current_user),
    db: Session = Depends(get_db),
) -> AuthMeResponse:
    return _auth_me_response(db, user)


@router.post("/me/change-password", response_model=AuthMessageResponse)
def change_my_password(
    payload: ChangePasswordRequest,
    user: AuthUser = Depends(require_current_user),
    db: Session = Depends(get_db),
    token: str | None = Cookie(default=None, alias=AUTH_COOKIE_NAME),
) -> AuthMessageResponse:
    from app.core.security import verify_password

    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码错误")

    current_session_id = _session_id_from_token(token)
    user.password_hash = hash_password(payload.new_password)
    user.failed_login_count = 0
    user.locked_until = None
    _revoke_sessions(db, user.id, except_session_id=current_session_id)
    db.commit()
    return AuthMessageResponse(message="密码修改成功，其他设备已退出登录")


@router.get("/permissions")
def permission_catalog(
    _: AuthUser = Depends(require_permission("users.manage")),
) -> dict:
    return permission_catalog_payload()


@router.get("/users", response_model=AuthUsersListResponse)
def list_users(
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("users.manage")),
) -> AuthUsersListResponse:
    items = db.execute(select(AuthUser).order_by(AuthUser.created_at.desc())).scalars().all()
    total = db.execute(select(func.count()).select_from(AuthUser)).scalar_one()
    return AuthUsersListResponse(items=[_auth_user_read(db, item) for item in items], total=int(total or 0))


@router.post("/users", response_model=AuthUserRead)
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("users.manage")),
) -> AuthUserRead:
    email = payload.email.strip().lower()
    exists = get_user_by_email(db, email)
    if exists is not None:
        raise HTTPException(status_code=409, detail="账号已存在")
    user = AuthUser(
        id=str(uuid4()),
        email=email,
        display_name=(payload.display_name or "").strip() or None,
        role=_validated_role(payload.role),
        password_hash=hash_password(payload.password) if payload.password else None,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _auth_user_read(db, user)


@router.put("/users/{user_id}/status", response_model=AuthUserRead)
def set_user_status(
    user_id: str,
    payload: UserStatusRequest,
    db: Session = Depends(get_db),
    actor: AuthUser = Depends(require_permission("users.manage")),
) -> AuthUserRead:
    user = db.execute(select(AuthUser).where(AuthUser.id == user_id)).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.id == actor.id and not payload.is_active:
        raise HTTPException(status_code=409, detail="不能停用当前正在登录的账号")
    _protect_last_active_admin(db, user, next_active=payload.is_active)
    user.is_active = payload.is_active
    if not payload.is_active:
        _revoke_sessions(db, user.id)
    db.commit()
    db.refresh(user)
    return _auth_user_read(db, user)


@router.put("/users/{user_id}/access", response_model=AuthUserRead)
def update_user_access(
    user_id: str,
    payload: UserAccessUpdateRequest,
    db: Session = Depends(get_db),
    actor: AuthUser = Depends(require_permission("users.manage")),
) -> AuthUserRead:
    user = db.execute(select(AuthUser).where(AuthUser.id == user_id)).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    next_role = _validated_role(payload.role)
    if user.id == actor.id and normalize_role(actor.role) == "admin" and next_role != "admin":
        raise HTTPException(status_code=409, detail="当前登录管理员不能降低自己的角色")
    _protect_last_active_admin(db, user, next_role=next_role)
    set_user_access(
        db,
        user,
        role=next_role,
        overrides=payload.permission_overrides,
    )
    db.commit()
    db.refresh(user)
    return _auth_user_read(db, user)


@router.put("/users/{user_id}/reset-password", response_model=AuthMessageResponse)
def admin_reset_password(
    user_id: str,
    payload: AdminResetPasswordRequest,
    db: Session = Depends(get_db),
    _: AuthUser = Depends(require_permission("users.manage")),
) -> AuthMessageResponse:
    user = db.execute(select(AuthUser).where(AuthUser.id == user_id)).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.password_hash = hash_password(payload.new_password)
    user.failed_login_count = 0
    user.locked_until = None
    _revoke_sessions(db, user.id)
    db.commit()
    return AuthMessageResponse(message="密码已重置，该账号需重新登录")
