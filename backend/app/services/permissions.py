"""角色预设、用户级权限覆盖与 FastAPI 权限守卫。"""

from __future__ import annotations

from collections.abc import Callable
from uuid import uuid4

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.models.user_permission import UserPermissionOverride

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

PERMISSION_CATALOG: tuple[dict[str, str], ...] = (
    {"code": "analytics.view", "group": "经营分析", "label": "查看经营分析", "description": "查看经营驾驶舱和利润分析。"},
    {"code": "analytics.manage", "group": "经营分析", "label": "管理经营费用", "description": "新增、修改、删除经营费用台账。"},
    {"code": "anomalies.view", "group": "异常中心", "label": "查看异常", "description": "查看巡检结果与智能风险分析。"},
    {"code": "anomalies.manage", "group": "异常中心", "label": "处理异常", "description": "标记解决、忽略或重新打开异常。"},
    {"code": "reconciliation.view", "group": "核心对账", "label": "查看账单", "description": "查看研发/渠道账单、360详情、附件和状态。"},
    {"code": "reconciliation.manage", "group": "核心对账", "label": "管理账单", "description": "新增、编辑、删除账单及执行状态流转。"},
    {"code": "funds.view", "group": "资金管理", "label": "查看资金", "description": "查看银行流水、收付款和核销关系。"},
    {"code": "funds.manage", "group": "资金管理", "label": "管理资金", "description": "录入流水、确认/撤销核销及维护收付款。"},
    {"code": "invoices.view", "group": "发票中心", "label": "查看发票", "description": "查看进销项发票和账单覆盖。"},
    {"code": "invoices.manage", "group": "发票中心", "label": "管理发票", "description": "新增、编辑、删除发票及调整账单分配。"},
    {"code": "contracts.view", "group": "合同中心", "label": "查看合同", "description": "查看合同台账、有效期和客户关联。"},
    {"code": "contracts.manage", "group": "合同中心", "label": "管理合同", "description": "新增、修改、删除合同及附件。"},
    {"code": "data.view", "group": "数据中心", "label": "查看数据", "description": "查看 QuickSDK、游戏、渠道和数据源。"},
    {"code": "data.manage", "group": "数据中心", "label": "管理数据", "description": "导入、修改、删除数据库批次和数据源。"},
    {"code": "partners.view", "group": "客户库", "label": "查看客户", "description": "查看合作方和客户资料。"},
    {"code": "partners.manage", "group": "客户库", "label": "管理客户", "description": "新增、修改、删除合作方和客户资料。"},
    {"code": "audit.view", "group": "审计", "label": "查看操作日志", "description": "查看账单和系统关键操作审计轨迹。"},
    {"code": "users.manage", "group": "系统权限", "label": "管理用户权限", "description": "创建用户、启停账号、分配角色和权限。"},
)

ALL_PERMISSIONS = frozenset(item["code"] for item in PERMISSION_CATALOG)
ROLE_LABELS = {
    "admin": "管理员",
    "finance": "财务",
    "operator": "运营",
    "viewer": "只读",
}
ROLE_ALIASES = {"user": "operator"}

ROLE_PRESETS: dict[str, frozenset[str]] = {
    "admin": ALL_PERMISSIONS,
    "finance": frozenset({
        "analytics.view", "analytics.manage",
        "anomalies.view", "anomalies.manage",
        "reconciliation.view", "reconciliation.manage",
        "funds.view", "funds.manage",
        "invoices.view", "invoices.manage",
        "contracts.view", "contracts.manage",
        "data.view",
        "partners.view", "partners.manage",
        "audit.view",
    }),
    "operator": frozenset({
        "analytics.view",
        "anomalies.view",
        "reconciliation.view", "reconciliation.manage",
        "invoices.view",
        "contracts.view",
        "data.view", "data.manage",
        "partners.view", "partners.manage",
        "audit.view",
    }),
    "viewer": frozenset({
        "analytics.view",
        "anomalies.view",
        "reconciliation.view",
        "funds.view",
        "invoices.view",
        "contracts.view",
        "data.view",
        "partners.view",
        "audit.view",
    }),
}


def normalize_role(role: str | None) -> str:
    raw = str(role or "operator").strip().lower() or "operator"
    raw = ROLE_ALIASES.get(raw, raw)
    return raw if raw in ROLE_PRESETS else "operator"


def role_label(role: str | None) -> str:
    return ROLE_LABELS.get(normalize_role(role), "运营")


def role_permissions(role: str | None) -> set[str]:
    return set(ROLE_PRESETS[normalize_role(role)])


def load_permission_overrides(db: Session, user_id: str) -> dict[str, str]:
    try:
        rows = db.execute(
            select(UserPermissionOverride).where(UserPermissionOverride.user_id == str(user_id))
        ).scalars().all()
    except (OperationalError, ProgrammingError):
        return {}
    return {
        str(row.permission): str(row.effect)
        for row in rows
        if row.permission in ALL_PERMISSIONS and row.effect in {"allow", "deny"}
    }


def resolve_permissions(db: Session, user: AuthUser) -> set[str]:
    role = normalize_role(user.role)
    if role == "admin":
        return set(ALL_PERMISSIONS)
    permissions = role_permissions(role)
    for permission, effect in load_permission_overrides(db, user.id).items():
        if effect == "allow":
            permissions.add(permission)
        else:
            permissions.discard(permission)
    return permissions


def has_permission(db: Session, user: AuthUser, permission: str) -> bool:
    return permission in resolve_permissions(db, user)


def permission_snapshot(db: Session, user: AuthUser) -> dict:
    overrides = load_permission_overrides(db, user.id)
    return {
        "role": normalize_role(user.role),
        "role_label": role_label(user.role),
        "permissions": sorted(resolve_permissions(db, user)),
        "permission_overrides": overrides,
    }


def set_user_access(
    db: Session,
    user: AuthUser,
    *,
    role: str,
    overrides: dict[str, str],
) -> None:
    raw_role = str(role or "").strip().lower()
    normalized_role = ROLE_ALIASES.get(raw_role, raw_role)
    if normalized_role not in ROLE_PRESETS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "invalid_role", "allowed": sorted(ROLE_PRESETS)},
        )
    invalid_permissions = sorted(set(overrides) - ALL_PERMISSIONS)
    invalid_effects = sorted({effect for effect in overrides.values() if effect not in {"allow", "deny"}})
    if invalid_permissions or invalid_effects:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "invalid_permission_override",
                "invalid_permissions": invalid_permissions,
                "invalid_effects": invalid_effects,
            },
        )

    user.role = normalized_role
    db.execute(delete(UserPermissionOverride).where(UserPermissionOverride.user_id == user.id))
    if normalized_role != "admin":
        for permission, effect in sorted(overrides.items()):
            db.add(
                UserPermissionOverride(
                    id=str(uuid4()),
                    user_id=str(user.id),
                    permission=permission,
                    effect=effect,
                )
            )


def require_permission(permission: str) -> Callable:
    if permission not in ALL_PERMISSIONS:
        raise ValueError(f"Unknown permission: {permission}")

    def dependency(
        user: AuthUser = Depends(require_current_user),
        db: Session = Depends(get_db),
    ) -> AuthUser:
        if not has_permission(db, user, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "permission_denied",
                    "permission": permission,
                    "message": "当前账号没有执行此操作的权限。",
                },
            )
        return user

    return dependency


def _path_override_permission(
    path: str,
    method: str,
    path_overrides: dict[str, tuple[str, str | None]] | None,
) -> str | None:
    if not path_overrides:
        return None
    normalized_path = str(path or "").rstrip("/") or "/"
    for prefix in sorted(path_overrides, key=len, reverse=True):
        normalized_prefix = str(prefix or "").rstrip("/") or "/"
        if normalized_path != normalized_prefix and not normalized_path.startswith(f"{normalized_prefix}/"):
            continue
        view_permission, manage_permission = path_overrides[prefix]
        return (
            manage_permission
            if method.upper() in UNSAFE_METHODS and manage_permission
            else view_permission
        )
    return None


def require_module_access(
    view_permission: str,
    manage_permission: str | None = None,
    *,
    path_overrides: dict[str, tuple[str, str | None]] | None = None,
) -> Callable:
    permissions_to_validate = {view_permission}
    if manage_permission is not None:
        permissions_to_validate.add(manage_permission)
    for override in (path_overrides or {}).values():
        permissions_to_validate.add(override[0])
        if override[1] is not None:
            permissions_to_validate.add(override[1])
    unknown = sorted(permission for permission in permissions_to_validate if permission not in ALL_PERMISSIONS)
    if unknown:
        raise ValueError(f"Unknown permission(s): {', '.join(unknown)}")

    def dependency(
        request: Request,
        user: AuthUser = Depends(require_current_user),
        db: Session = Depends(get_db),
    ) -> AuthUser:
        permission = _path_override_permission(
            request.url.path,
            request.method,
            path_overrides,
        ) or (
            manage_permission
            if request.method.upper() in UNSAFE_METHODS and manage_permission
            else view_permission
        )
        if not has_permission(db, user, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "permission_denied",
                    "permission": permission,
                    "message": "当前账号没有访问或修改该模块的权限。",
                },
            )
        return user

    return dependency


def permission_catalog_payload() -> dict:
    return {
        "roles": [
            {
                "role": role,
                "label": ROLE_LABELS[role],
                "permissions": sorted(permissions),
            }
            for role, permissions in ROLE_PRESETS.items()
        ],
        "permissions": list(PERMISSION_CATALOG),
    }
