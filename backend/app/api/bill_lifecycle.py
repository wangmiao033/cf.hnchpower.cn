"""账单状态流转、锁单状态与轻量归档 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from uuid import uuid4
import json
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.core.security import require_current_user
from app.models.user import AuthUser
from app.schemas.bill_lifecycle import BillLifecycleRead, BillTransitionRequest
from app.models.channel import ChannelRecord, ChannelRecordLineItem
from app.models.bill_attachment import BillAttachment
from app.models.operation_log import OperationLog
from app.services.channel_small_variance_approval import assess_channel_small_variance_approval
from app.services.channel_platform_variance_approval import (
    assess_channel_platform_variance,
    assert_no_open_contract_exceptions,
)
from app.services.honor_official_statement import (
    POLICY_CODE as HONOR_OFFICIAL_POLICY, resolve_honor_policy,
    validate_official_line_confirmations, load_and_validate_contract_snapshot,
    official_amount_case_ids,
)
from app.services import bill_lock_guard as _bill_lock_guard  # noqa: F401  注册 SQLAlchemy 锁单守卫
from app.services.bill_archive import archive_bill, archive_snapshot, unarchive_bill
from app.services.bill_lifecycle import build_lifecycle_snapshot, load_bill, transition_bill

router = APIRouter()


def _prefer_channel_line_item_settlement(bill_type: str, bill) -> None:
    if bill_type != "channel":
        return
    items = list(getattr(bill, "line_items", None) or [])
    if not items:
        return
    total = round(sum(float(getattr(item, "settlement_amount", 0) or 0) for item in items), 2)
    if abs(total) <= 0.01:
        return
    current = round(float(getattr(bill, "settlement_amount", 0) or 0), 2)
    if abs(current - total) > 0.01:
        bill.settlement_amount = total


def _apply_cross_link_guards(snapshot: dict) -> dict:
    paid_amount = float(snapshot.get("paid_amount") or 0)
    allocated_amount = float(snapshot.get("invoice_allocated_amount") or 0)
    reason = None
    if paid_amount > 0.01:
        reason = "账单已有收付款记录，请先解除或冲销资金关联后再取消。"
    elif allocated_amount > 0.01:
        reason = "账单已有发票关联，请先撤销发票分配后再取消。"
    if reason:
        for option in snapshot.get("transitions") or []:
            if option.get("status") == "cancelled":
                option["available"] = False
                option["blocked_reason"] = reason
    return snapshot


def _channel_validation_reason(bill_type: str, bill) -> str | None:
    if bill_type != "channel" or str(getattr(bill, "validation_status", "unvalidated")) != "fail":
        return None
    difference = float(getattr(bill, "settlement_difference", 0) or 0)
    return f"系统计算与平台账单存在差异 {difference:+.2f} 元，请先修正结算规则或平台金额。"


def _snapshot(db: Session, bill_type: str, bill, user: AuthUser) -> dict:
    _prefer_channel_line_item_settlement(bill_type, bill)
    snapshot = _apply_cross_link_guards(build_lifecycle_snapshot(db, bill_type, bill, user))
    reason = _channel_validation_reason(bill_type, bill)
    if reason:
        for option in snapshot.get("transitions") or []:
            if option.get("status") == "confirmed":
                option["available"] = False
                option["blocked_reason"] = reason
    return snapshot


class ApprovedSmallVarianceRequest(BaseModel):
    """Only a documented admin approval; not a way to edit contract/amount data."""
    reason: str = Field(min_length=2, max_length=500)


@router.post("/channel/{bill_id}/confirm-small-variance", response_model=BillLifecycleRead)
def confirm_approved_channel_small_variance(
    bill_id: str,
    payload: ApprovedSmallVarianceRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BillLifecycleRead:
    """Confirm a saved channel bill with <=¥0.50 explicitly approved contract variance.

    This is deliberately more restrictive than a normal lifecycle transition:
    only an administrator may use it, accepted finance exceptions must be linked
    to the actual current saved line economics, and a reason is audited alongside
    the resulting status transition in one database commit.
    """
    if str(user.role or "").strip().lower() != "admin":
        raise HTTPException(
            status_code=403,
            detail={"error": "admin_only", "message": "小额差异强制确认需要管理员权限"},
        )
    reason = str(payload.reason or "").strip()
    if len(reason) < 2:
        raise HTTPException(
            status_code=422,
            detail={"error": "reason_required", "message": "请填写本次强制确认核对的原因"},
        )

    bill = db.execute(
        select(ChannelRecord).where(ChannelRecord.id == bill_id).with_for_update()
    ).scalar_one_or_none()
    if bill is None:
        raise HTTPException(404, detail={"error": "bill_not_found", "message": "账单不存在，请刷新"})
    if str(bill.status or "pending").strip().lower() != "pending":
        raise HTTPException(
            409,
            detail={"error": "bill_status_changed", "message": "账单状态已发生变化，请刷新后重试"},
        )
    # Existing channel system-versus-platform validation still blocks:
    # this action is exclusively for previously accepted CONTRACT differences.
    platform_failure = _channel_validation_reason("channel", bill)
    if platform_failure:
        raise HTTPException(409, detail={"error": "platform_validation_failed", "message": platform_failure})

    rows = db.execute(
        select(ChannelRecordLineItem)
        .where(ChannelRecordLineItem.channel_record_id == bill_id)
        .order_by(ChannelRecordLineItem.sort_order, ChannelRecordLineItem.id)
    ).scalars().all()
    table_name = db.execute(
        text("SELECT to_regclass('public.cf_contract_difference_cases')")
    ).scalar_one_or_none()
    if not table_name:
        raise HTTPException(
            409,
            detail={"error": "contract_evidence_unavailable", "message": "合同差异处置表不存在，不能强制确认"},
        )
    cases = [dict(row) for row in db.execute(text("""
        SELECT id, bill_type, bill_id, line_id, game_name, settlement_cycle,
               expected_amount, actual_amount, status, handling_type, reason_type,
               description, source_snapshot_json
        FROM cf_contract_difference_cases
        WHERE bill_type = 'channel' AND bill_id = :bill_id
        ORDER BY updated_at DESC, id DESC
        LIMIT 300
    """), {"bill_id": bill_id}).mappings().all()]
    assessment = assess_channel_small_variance_approval(bill_id, rows, cases, bill.channel_fee_rate)

    db.add(OperationLog(
        id=str(uuid4()),
        entity_type="channel",
        entity_id=str(bill.id),
        entity_number=bill.statement_no,
        action="small_variance_confirm",
        summary=f"管理员按已核准小额合同差异强制确认渠道账单，差异 ¥{assessment['difference_cents'] / 100:.2f}",
        actor_user_id=str(user.id),
        actor_email=str(user.email or ""),
        changes={},
        metadata_json={
            "reason": reason,
            "approval_source": "existing_contract_difference_acceptance",
            "recorded_settlement_amount": float(bill.settlement_amount or 0),
            "variance_total_cents": assessment["difference_cents"],
            "max_variance_cents": 50,
            "approved_lines": assessment["approved_lines"],
        },
    ))
    db.info["allow_lifecycle_transition"] = True
    try:
        # Commit + lifecycle/status audit happen together; no calculation, fee,
        # discount, contract, invoice or receipt is rewritten by this operation.
        transition_bill(db, "channel", bill, "confirmed", reason, user)
    finally:
        db.info.pop("allow_lifecycle_transition", None)
    return BillLifecycleRead.model_validate(_snapshot(db, "channel", bill, user))



@router.get("/channel/{bill_id}/official-statement-policy")
def get_channel_official_statement_policy(
    bill_id: str, db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    del user
    bill = load_bill(db, "channel", bill_id)
    return {"policy": resolve_honor_policy(db, bill)}


class OfficialLineConfirmation(BaseModel):
    line_id: str = Field(min_length=1, max_length=128)
    game_name: str = Field(min_length=1, max_length=500)
    settlement_cycle: str = Field(min_length=1, max_length=16)
    system_amount: float
    platform_amount: float


class ApprovedPlatformVarianceRequest(BaseModel):
    """Explicit approval of the already-saved, recomputed platform amount."""
    reason: str = Field(min_length=6, max_length=500)
    expected_system_amount: float
    expected_platform_amount: float
    expected_settlement_amount: float
    expected_signed_difference_cents: int
    expected_line_ids: list[str] = Field(min_length=1, max_length=100)
    evidence_attachment_id: str | None = Field(default=None, max_length=128)
    evidence_confirmed: bool = False
    official_statement_policy: str | None = Field(default=None, max_length=80)
    expected_partner_id: str | None = Field(default=None, max_length=128)
    official_statement_reason: str = Field(default="", max_length=250)
    official_line_confirmations: list[OfficialLineConfirmation] = Field(default_factory=list, max_length=100)
    contract_snapshot_id: str | None = Field(default=None, max_length=128)


@router.post("/channel/{bill_id}/confirm-platform-variance", response_model=BillLifecycleRead)
def confirm_approved_channel_platform_variance(
    bill_id: str,
    payload: ApprovedPlatformVarianceRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BillLifecycleRead:
    """Confirm a verified platform amount with explicit human accountability.

    <= 50 cents: short remark. Larger discrepancies: uploaded source statement,
    explicit attestation, and substantive justification. The original amounts,
    contract, lines, invoice, receipts, and validation status remain unchanged.
    """
    if str(user.role or "").strip().lower() != "admin":
        raise HTTPException(403, detail={
            "error": "admin_only",
            "message": "平台尾差确认需要管理员权限",
        })
    reason = str(payload.reason or "").strip()
    if len(reason) < 6:
        raise HTTPException(422, detail={
            "error": "reason_required",
            "message": "请填写至少6个字的人工核对依据",
        })
    bill = db.execute(
        select(ChannelRecord).where(ChannelRecord.id == bill_id).with_for_update()
    ).scalar_one_or_none()
    if bill is None:
        raise HTTPException(404, detail={"error": "bill_not_found", "message": "账单不存在"})
    if str(bill.status or "pending").strip().lower() != "pending":
        raise HTTPException(409, detail={
            "error": "bill_status_changed", "message": "账单状态已变化，请重新打开",
        })

    rows = db.execute(
        select(ChannelRecordLineItem)
        .where(ChannelRecordLineItem.channel_record_id == bill_id)
        .order_by(ChannelRecordLineItem.sort_order, ChannelRecordLineItem.id)
    ).scalars().all()
    official = bool(payload.official_statement_policy)
    policy = None
    if official:
        policy = resolve_honor_policy(db, bill)
        if (not policy or payload.official_statement_policy != HONOR_OFFICIAL_POLICY
                or payload.expected_partner_id != policy["partner_id"]):
            raise HTTPException(409, detail={"error": "honor_policy_identity_mismatch", "message": "荣耀专属规则与当前客户身份不一致，请重新核对"})
        if len(payload.official_statement_reason.strip()) < 6:
            raise HTTPException(422, detail={"error": "honor_source_reason_required", "message": "请填写至少6个字的荣耀官方结算核对依据"})
        validate_official_line_confirmations(rows, [row.model_dump() for row in payload.official_line_confirmations])
    assessment = assess_channel_platform_variance(
        bill, rows, allow_documented_variance=True, official_statement=official
    )
    documented = assessment["review_kind"] == "documented"
    evidence_attachment = None
    if documented:
        if len(reason) < 12:
            raise HTTPException(422, detail={
                "error": "documented_platform_reason_required",
                "message": "金额差异超过¥0.50，请填写至少12个字的核对原因",
            })
        if not payload.evidence_confirmed:
            raise HTTPException(422, detail={
                "error": "documented_platform_attestation_required",
                "message": "请明确确认已经按平台原始结算单核对真实分成金额",
            })
        attachment_id = str(payload.evidence_attachment_id or "").strip()
        if not attachment_id:
            raise HTTPException(422, detail={
                "error": "documented_platform_attachment_required",
                "message": "金额差异超过¥0.50，请先上传平台原始结算凭证再确认",
            })
        evidence_attachment = db.execute(
            select(BillAttachment).where(
                BillAttachment.id == attachment_id,
                BillAttachment.bill_type == "channel",
                BillAttachment.bill_id == bill_id,
                BillAttachment.file_size > 0,
            )
        ).scalar_one_or_none()
        if evidence_attachment is None:
            raise HTTPException(409, detail={
                "error": "documented_platform_attachment_missing",
                "message": "所选结算凭证不属于本张账单或已删除，请重新上传并选择",
            })

    # A stale UI must not be able to approve a different set of lines or a
    # different payment amount when another tab just edited the record.
    from app.services.channel_platform_variance_approval import _cents
    if (
        sorted(payload.expected_line_ids) != assessment["line_ids"]
        or _cents(payload.expected_system_amount) != _cents(assessment["system_amount"])
        or _cents(payload.expected_platform_amount) != _cents(assessment["platform_amount"])
        or _cents(payload.expected_settlement_amount) != _cents(assessment["recorded_settlement_amount"])
        or payload.expected_signed_difference_cents != assessment["signed_difference_cents"]
    ):
        raise HTTPException(409, detail={
            "error": "platform_variance_stale_review",
            "message": "账单明细或金额已改变，请重新点击“保存并确认核对”后再核准",
        })

    # Contracts are verified through the standard preflight on the frontend,
    # and any known open/unsafe contract evidence independently blocks here.
    table_name = db.execute(
        text("SELECT to_regclass('public.cf_contract_difference_cases')")
    ).scalar_one_or_none()
    if not table_name:
        raise HTTPException(409, detail={
            "error": "contract_evidence_unavailable",
            "message": "合同差异审计表不可用，请稍后重试",
        })
    cases = [dict(item) for item in db.execute(text("""
        SELECT id, line_id, game_name, settlement_cycle, status,
               handling_type, expected_amount, actual_amount, difference_amount,
               source_snapshot_json
        FROM cf_contract_difference_cases
        WHERE bill_type = 'channel' AND bill_id = :bill_id
        ORDER BY updated_at DESC, id DESC LIMIT 301 FOR UPDATE
    """), {"bill_id": bill_id}).mappings().all()]
    if len(cases) > 300:
        raise HTTPException(409, detail={
            "error": "contract_evidence_too_many",
            "message": "当前合同差异记录过多，无法完整校验，暂不进行尾差确认",
        })
    official_case_ids = []
    if official:
        contract_snapshot = load_and_validate_contract_snapshot(
            db, payload.contract_snapshot_id, bill, rows, policy["partner_id"]
        )
        official_case_ids = official_amount_case_ids(cases, rows)
        # The fresh snapshot is authoritative for identity/terms. Only monetary
        # cases covered by this exact reviewed bill are accepted, in this transaction.
        for case_id in official_case_ids:
            updated_case = db.execute(text("""
                UPDATE cf_contract_difference_cases
                SET status = 'resolved', handling_type = 'accept_difference',
                    substatus = 'honor_official_statement', reason_type = '官方结算单',
                    description = :reason, updated_by = :actor,
                    updated_at = NOW(), resolved_at = NOW()
                WHERE id = :id AND bill_type = 'channel' AND bill_id = :bill_id
                  AND status = 'pending' AND (handling_type IS NULL OR handling_type = '')
            """), {"id": case_id, "bill_id": bill_id, "reason": reason, "actor": str(user.email or user.id)})
            if updated_case.rowcount != 1:
                db.rollback()
                raise HTTPException(409, detail={"error": "honor_contract_case_changed", "message": "合同差异处理状态已改变，本次未确认，请刷新后重试"})
            db.execute(text("""
                INSERT INTO cf_contract_difference_events
                (id, case_id, event_type, title, detail, payload_json, actor)
                VALUES (:id, :case_id, 'honor_official_statement', '按荣耀官方结算单确认',
                        :reason, CAST(:evidence AS jsonb), :actor)
            """), {"id": str(uuid4()), "case_id": case_id, "reason": reason,
                   "actor": str(user.email or user.id), "evidence": json.dumps({
                       "policy": policy, "attachment_id": payload.evidence_attachment_id,
                       "contract_snapshot_id": str(contract_snapshot["id"]),
                       "official_lines": [row.model_dump() for row in payload.official_line_confirmations],
                   }, ensure_ascii=False)})
    else:
        assert_no_open_contract_exceptions(cases, rows)

    db.add(OperationLog(
        id=str(uuid4()), entity_type="channel", entity_id=str(bill.id),
        entity_number=bill.statement_no,
        action="honor_official_statement_confirm" if official else "platform_documented_variance_confirm" if documented else "platform_small_variance_confirm",
        summary=(
            ("管理员按荣耀官方逐游戏结算单确认" if official else "管理员凭平台原始结算单核准大额金额差异" if documented else "管理员人工核准平台小额尾差")
            + f"，系统与平台差额 {assessment['signed_difference_cents'] / 100:+.2f} 元；实际应收未修改"
        ),
        actor_user_id=str(user.id), actor_email=str(user.email or ""),
        changes={},
        metadata_json={
            "reason": reason,
            "approval_source": "attached_platform_statement" if documented else "saved_channel_platform_bill",
            "max_small_variance_cents": 50,
            "evidence_attachment_id": str(evidence_attachment.id) if evidence_attachment else None,
            "evidence_file_name": str(evidence_attachment.file_name) if evidence_attachment else None,
            "evidence_confirmed": bool(payload.evidence_confirmed) if documented else None,
            **assessment,
            **({"official_statement_policy": policy,
                "official_statement_reason": payload.official_statement_reason.strip(),
                "official_line_confirmations": [row.model_dump() for row in payload.official_line_confirmations],
                "contract_snapshot_id": payload.contract_snapshot_id,
                "accepted_contract_case_ids": official_case_ids} if official else {}),
        },
    ))
    db.info["allow_lifecycle_transition"] = True
    try:
        # The status transition and approval log are committed atomically.
        transition_bill(db, "channel", bill, "confirmed", reason, user)
    finally:
        db.info.pop("allow_lifecycle_transition", None)
    return BillLifecycleRead.model_validate(_snapshot(db, "channel", bill, user))


@router.get("/archive")
def get_bill_archive_snapshot(
    bill_type: str = Query(..., pattern="^(rd|channel)$"),
    auto: bool = Query(default=True),
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    del user
    return archive_snapshot(db, bill_type, run_auto=auto)


@router.post("/archive/{bill_type}/{bill_id}")
def archive_one_bill(
    bill_type: str,
    bill_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    return archive_bill(db, bill_type, bill_id, user=user, source="manual")


@router.delete("/archive/{bill_type}/{bill_id}")
def unarchive_one_bill(
    bill_type: str,
    bill_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> dict:
    return unarchive_bill(db, bill_type, bill_id, user=user)


@router.get("/{bill_type}/{bill_id}", response_model=BillLifecycleRead)
def get_bill_lifecycle(
    bill_type: str,
    bill_id: str,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BillLifecycleRead:
    bill = load_bill(db, bill_type, bill_id)
    return BillLifecycleRead.model_validate(_snapshot(db, bill_type, bill, user))


@router.post("/{bill_type}/{bill_id}/transition", response_model=BillLifecycleRead)
def transition_bill_status(
    bill_type: str,
    bill_id: str,
    payload: BillTransitionRequest,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(require_current_user),
) -> BillLifecycleRead:
    bill = load_bill(db, bill_type, bill_id)
    before = _snapshot(db, bill_type, bill, user)
    target = str(payload.to_status or "").strip().lower()

    if target == "confirmed":
        reason = _channel_validation_reason(bill_type, bill)
        if reason:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "settlement_validation_failed", "message": reason},
            )

    if target == "cancelled":
        cancel_option = next((option for option in before.get("transitions") or [] if option.get("status") == "cancelled"), None)
        if cancel_option is not None and not cancel_option.get("available", False):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "transition_blocked",
                    "message": cancel_option.get("blocked_reason") or "当前账单不能取消。",
                    "current_status": before.get("status"),
                    "target_status": "cancelled",
                },
            )

    db.info["allow_lifecycle_transition"] = True
    try:
        transition_bill(db, bill_type, bill, payload.to_status, payload.reason, user)
    finally:
        db.info.pop("allow_lifecycle_transition", None)
    return BillLifecycleRead.model_validate(_snapshot(db, bill_type, bill, user))
