"""Assign immutable-by-default legal-party snapshots to channel bills.

A bill's customer and contract share rules are never recalculated here.
Historical statements without a stable customer ID are left unchanged.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import text

from app.services.legal_entities import entity_links, resolve_months, valid_month


def _entity_name(db, entity_id: str, *, own: bool = False) -> str:
    stmt = "SELECT legal_name, entity_kind FROM cf_legal_entities WHERE id = :id"
    item = db.execute(text(stmt), {"id": entity_id}).mappings().first()
    if not item:
        raise HTTPException(status_code=422, detail="指定的法律主体不存在")
    if own and item["entity_kind"] not in {"own", "both"}:
        raise HTTPException(status_code=422, detail="收款主体不是已登记的我方公司")
    return str(item["legal_name"])


def resolve_channel_bill_parties(
    db,
    *,
    partner_id: str | None,
    settlement_months: list[str],
    requested_payer_id: str | None = None,
    payer_override_reason: str | None = None,
    requested_receiving_id: str | None = None,
    requested_invoice_id: str | None = None,
) -> dict:
    result = {
        "partner_id": partner_id or None,
        "contract_entity_id": None,
        "contract_entity_snapshot": None,
        "expected_payer_entity_id": None,
        "expected_payer_snapshot": None,
        "expected_receiving_entity_id": None,
        "expected_receiving_snapshot": None,
        "invoice_entity_id": None,
        "invoice_entity_snapshot": None,
        "payer_override_reason": None,
    }
    if not partner_id:
        if requested_payer_id or requested_invoice_id or requested_receiving_id:
            raise HTTPException(status_code=422, detail="请先选择合作客户后再设置结算主体")
        return result

    customer = db.execute(
        text("SELECT id FROM cf_partner_records WHERE id = :id"), {"id": partner_id}
    ).mappings().first()
    if not customer:
        raise HTTPException(status_code=422, detail="账单关联的客户库记录不存在")

    months = sorted({valid_month(month) for month in settlement_months if month})
    links = entity_links(db, partner_id)
    try:
        resolved = resolve_months(links, months)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    contract = resolved["contract"]
    if contract:
        result["contract_entity_id"] = contract["entity_id"]
        result["contract_entity_snapshot"] = contract["legal_name"]

    if resolved["payer_mixed"] and not requested_payer_id:
        raise HTTPException(
            status_code=422,
            detail="一张账单跨越不同付款主体的生效月份，请分开账单或明确指定付款方并说明原因",
        )
    payer = resolved["payer"]
    if requested_payer_id:
        allowed = any(
            link["role"] == "payer" and link["entity_id"] == requested_payer_id
            for link in links
        )
        if not allowed:
            raise HTTPException(status_code=422, detail="请先在原客户下面关联该付款公司")
        if resolved["payer_mixed"] or not payer or payer["entity_id"] != requested_payer_id:
            if not str(payer_override_reason or "").strip():
                raise HTTPException(status_code=422, detail="指定非默认付款公司时，必须填写主体调整原因")
        result["expected_payer_entity_id"] = requested_payer_id
        result["expected_payer_snapshot"] = _entity_name(db, requested_payer_id)
        result["payer_override_reason"] = str(payer_override_reason or "").strip() or None
    elif payer:
        result["expected_payer_entity_id"] = payer["entity_id"]
        result["expected_payer_snapshot"] = payer["legal_name"]

    if requested_receiving_id:
        result["expected_receiving_entity_id"] = requested_receiving_id
        result["expected_receiving_snapshot"] = _entity_name(db, requested_receiving_id, own=True)

    if requested_invoice_id:
        if not any(link["role"] == "invoice" and link["entity_id"] == requested_invoice_id for link in links):
            raise HTTPException(status_code=422, detail="请先在客户主体管理中关联该开票抬头")
        result["invoice_entity_id"] = requested_invoice_id
        result["invoice_entity_snapshot"] = _entity_name(db, requested_invoice_id)

    return result


IDENTITY_FIELDS = (
    "partner_id", "contract_entity_id", "contract_entity_snapshot",
    "expected_payer_entity_id", "expected_payer_snapshot",
    "expected_receiving_entity_id", "expected_receiving_snapshot",
    "invoice_entity_id", "invoice_entity_snapshot", "payer_override_reason",
)


def apply_channel_bill_parties(row, identities: dict, *, locked: bool = False) -> None:
    differences = [
        field for field in IDENTITY_FIELDS
        if getattr(row, field, None) != identities.get(field)
    ]
    if locked and differences:
        raise HTTPException(
            status_code=409,
            detail="账单已确认或已有回款，不能覆盖历史收付款主体；请由财务先复核已核销记录",
        )
    for field in IDENTITY_FIELDS:
        setattr(row, field, identities.get(field))
