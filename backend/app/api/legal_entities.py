"""Partner legal entities, valid-time payment rules and own receiving accounts.

All writes are explicit, authenticated and additive. No bank transaction, contract,
invoice or already confirmed bill is updated by these endpoints.
"""
from __future__ import annotations

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_db
from app.models.bank_transaction import BankTransaction
from app.services.bank_partner_match import BankPartnerResolver
from app.services.contract_party_source import resolve_contract_source
from app.services.legal_entities import (
    entity_links,
    normalized_bank_account,
    normalized_legal_name,
    party_identity,
    plan_period_insert,
    valid_month,
)
from app.services.permissions import require_permission

router = APIRouter()


class PartnerEntityLinkCreate(BaseModel):
    legal_name: str = Field(min_length=2, max_length=250)
    role: Literal["contract", "payer", "invoice"]
    effective_month: str = "2000-01"
    end_month: str | None = None
    tax_registration_no: str = Field(default="", max_length=100)
    note: str = Field(default="", max_length=1000)


class PartnerEntityLinkUpdate(BaseModel):
    end_month: str | None = None
    note: str = Field(default="", max_length=1000)


class OwnBankAccountCreate(BaseModel):
    legal_name: str = Field(min_length=2, max_length=250)
    account_no: str = Field(min_length=6, max_length=100)
    bank_name: str = Field(default="", max_length=250)
    account_label: str = Field(default="", max_length=250)
    currency: str = Field(default="CNY", min_length=3, max_length=12)
    tax_registration_no: str = Field(default="", max_length=100)


def _partner(db: Session, partner_id: str, *, lock: bool = False) -> dict:
    sql = "SELECT id, name, short_name FROM cf_partner_records WHERE id = :id"
    if lock:
        sql += " FOR UPDATE"
    row = db.execute(text(sql), {"id": partner_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="合作客户不存在，请先在客户库中选择")
    return dict(row)


def _entity(db: Session, legal_name: str, tax_registration_no: str = "", *, own: bool = False) -> dict:
    name = legal_name.strip()
    key = normalized_legal_name(name)
    if len(key) < 2:
        raise HTTPException(status_code=422, detail="法律主体名称无效")
    tax_id = tax_registration_no.strip()
    row = db.execute(
        text("""
            INSERT INTO cf_legal_entities
              (id, legal_name, normalized_name, tax_registration_no, entity_kind)
            VALUES (:id, :name, :key, :tax_id, :kind)
            ON CONFLICT (normalized_name) DO UPDATE
              SET updated_at = cf_legal_entities.updated_at
            RETURNING id, legal_name, normalized_name, tax_registration_no, entity_kind
        """),
        {"id": str(uuid4()), "name": name, "key": key, "tax_id": tax_id,
         "kind": "own" if own else "counterparty"},
    ).mappings().one()
    result = dict(row)
    existing_tax_id = str(result.get("tax_registration_no") or "")
    if tax_id and existing_tax_id and tax_id != existing_tax_id:
        raise HTTPException(status_code=409, detail="该法律主体已登记不同的税号，请先核对")
    if own and result["entity_kind"] == "counterparty":
        db.execute(text("UPDATE cf_legal_entities SET entity_kind = 'both', updated_at = NOW() WHERE id = :id"),
                   {"id": result["id"]})
    if tax_id and not existing_tax_id:
        db.execute(text("UPDATE cf_legal_entities SET tax_registration_no = :tax, updated_at = NOW() WHERE id = :id"),
                   {"tax": tax_id, "id": result["id"]})
    return result


@router.get("/partners/{partner_id}")
def get_partner_entities(
    partner_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("partners.view")),
) -> dict:
    partner = _partner(db, partner_id)
    links = entity_links(db, partner_id)
    return {"partner": partner, "links": links}


@router.get("/partners/{partner_id}/resolution")
def get_partner_entity_resolution(
    partner_id: str,
    month: str = Query(...),
    db: Session = Depends(get_db),
    _user=Depends(require_permission("partners.view")),
) -> dict:
    _partner(db, partner_id)
    try:
        month = valid_month(month)
        resolved = party_identity(db, partner_id, [month])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"partner_id": partner_id, "month": month,
            "contract": resolved["contract"], "payer": resolved["payer"], "invoice": resolved["invoice"]}


@router.post("/partners/{partner_id}/links", status_code=status.HTTP_201_CREATED)
def create_partner_entity_link(
    partner_id: str,
    payload: PartnerEntityLinkCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("partners.manage")),
) -> dict:
    try:
        start = valid_month(payload.effective_month)
        end = valid_month(payload.end_month) if payload.end_month else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    # Lock the CUSTOMER, not the entity: concurrent switches for different payers
    # under the same customer must not create overlapping effective periods.
    partner = _partner(db, partner_id, lock=True)
    existing = [link for link in entity_links(db, partner_id) if link["role"] == payload.role]
    try:
        end, shorten = plan_period_insert(existing, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    entity = _entity(db, payload.legal_name, payload.tax_registration_no)
    for link_id, previous_end in shorten:
        db.execute(
            text("""
                UPDATE cf_partner_legal_entity_links
                   SET end_month = :end, updated_at = NOW()
                 WHERE id = :id AND partner_id = :partner_id
            """),
            {"end": previous_end, "id": link_id, "partner_id": partner_id},
        )
    new_id = str(uuid4())
    try:
        db.execute(
            text("""
                INSERT INTO cf_partner_legal_entity_links
                  (id, partner_id, entity_id, role, effective_month, end_month, note)
                VALUES (:id, :partner_id, :entity_id, :role, :start, :end, :note)
            """),
            {"id": new_id, "partner_id": partner_id, "entity_id": entity["id"],
             "role": payload.role, "start": start, "end": end, "note": payload.note.strip()},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="相同生效月份的主体规则已存在") from exc
    return {"partner": partner, "links": entity_links(db, partner_id), "created_id": new_id}


@router.put("/partners/{partner_id}/links/{link_id}")
def update_partner_entity_link(
    partner_id: str,
    link_id: str,
    payload: PartnerEntityLinkUpdate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("partners.manage")),
) -> dict:
    _partner(db, partner_id, lock=True)
    links = entity_links(db, partner_id)
    current = next((item for item in links if item["id"] == link_id), None)
    if current is None:
        raise HTTPException(status_code=404, detail="主体规则不存在")
    try:
        end = valid_month(payload.end_month) if payload.end_month else None
        if end and end < current["effective_month"]:
            raise ValueError("结束账期不能早于开始账期")
        for item in links:
            if item["id"] == link_id or item["role"] != current["role"]:
                continue
            from app.services.legal_entities import overlaps
            if overlaps(current["effective_month"], end, item["effective_month"], item["end_month"]):
                raise ValueError("该截止月份与另一条主体规则重叠")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.execute(
        text("""
            UPDATE cf_partner_legal_entity_links
               SET end_month = :end, note = :note, updated_at = NOW()
             WHERE id = :id AND partner_id = :partner_id
        """),
        {"end": end, "note": payload.note.strip(), "id": link_id, "partner_id": partner_id},
    )
    db.commit()
    return {"links": entity_links(db, partner_id)}


@router.get("/own-accounts")
def get_own_bank_accounts(
    db: Session = Depends(get_db),
    _user=Depends(require_permission("funds.view")),
) -> dict:
    rows = db.execute(text("""
        SELECT account.id, account.entity_id, entity.legal_name, entity.tax_registration_no,
               account.account_no, account.bank_name, account.currency,
               account.account_label, account.is_active, account.created_at
          FROM cf_entity_bank_accounts AS account
          JOIN cf_legal_entities AS entity ON account.entity_id = entity.id
         WHERE entity.entity_kind IN ('own', 'both')
         ORDER BY entity.legal_name, account.bank_name, account.created_at
    """)).mappings().all()
    return {"items": [dict(row) for row in rows]}


@router.post("/own-accounts", status_code=status.HTTP_201_CREATED)
def create_own_bank_account(
    payload: OwnBankAccountCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("funds.manage")),
) -> dict:
    key = normalized_bank_account(payload.account_no)
    if len(key) < 6:
        raise HTTPException(status_code=422, detail="请填写完整的收款银行账号")
    entity = _entity(db, payload.legal_name, payload.tax_registration_no, own=True)
    existing = db.execute(
        text("SELECT entity_id FROM cf_entity_bank_accounts WHERE normalized_account = :key"),
        {"key": key},
    ).mappings().first()
    if existing:
        raise HTTPException(status_code=409, detail="该账号已登记，请勿重复创建或归属到其他主体")
    new_id = str(uuid4())
    try:
        db.execute(text("""
            INSERT INTO cf_entity_bank_accounts
              (id, entity_id, account_no, normalized_account, bank_name, currency, account_label)
            VALUES (:id, :entity_id, :no, :key, :bank, :currency, :label)
        """), {"id": new_id, "entity_id": entity["id"], "no": payload.account_no.strip(),
               "key": key, "bank": payload.bank_name.strip(),
               "currency": payload.currency.strip().upper(), "label": payload.account_label.strip()})
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该银行账号已经存在") from exc
    return {"id": new_id, "entity_id": entity["id"], "legal_name": entity["legal_name"]}


@router.put("/own-accounts/{account_id}/active")
def set_own_bank_account_active(
    account_id: str,
    active: bool,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("funds.manage")),
) -> dict:
    row = db.execute(
        text("UPDATE cf_entity_bank_accounts SET is_active = :active, updated_at = NOW() WHERE id = :id RETURNING id"),
        {"active": active, "id": account_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="收款银行账户不存在")
    db.commit()
    return {"id": account_id, "is_active": active}


@router.get("/bank-transactions/{transaction_id}/identities")
def resolve_bank_transaction_identities(
    transaction_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_permission("funds.view")),
) -> dict:
    """Evidence view only; never confirms a receipt or alters an allocation."""
    row = db.get(BankTransaction, transaction_id)
    if row is None:
        raise HTTPException(status_code=404, detail="银行流水不存在")
    receiver_account = normalized_bank_account(row.payee_account or row.bank_account)
    own = db.execute(text("""
        SELECT entity.id AS entity_id, entity.legal_name,
               account.id AS bank_account_id, account.bank_name
          FROM cf_entity_bank_accounts AS account
          JOIN cf_legal_entities AS entity ON entity.id = account.entity_id
         WHERE account.normalized_account = :account AND account.is_active = TRUE
    """), {"account": receiver_account}).mappings().first() if receiver_account else None
    # Only an incoming collection has a customer payer. Outgoing payments must
    # never be presented as customer revenue by virtue of a matching name.
    is_income = float(row.income_amount or 0) > 0
    payer = BankPartnerResolver(db).resolve(row.payer_name, row.payer_account) if is_income else None
    return {
        "transaction_id": row.id,
        "direction": "collection" if is_income else "payment",
        "bank_payer_name": row.payer_name,
        "bank_payee_name": row.payee_name,
        "payer_customer": payer.payload() if payer else None,
        "own_receiver": dict(own) if own else None,
        "own_receiver_verified_by_account": bool(own),
        "warning": None if own or not is_income else "到账收款账号尚未登记或未能匹配，请人工复核",
    }


@router.get("/partners/{partner_id}/contract-source")
def get_partner_contract_source(
    partner_id: str,
    month: str = Query(...),
    db: Session = Depends(get_db),
    _partner_view=Depends(require_permission("partners.view")),
    _contract_view=Depends(require_permission("contracts.view")),
) -> dict:
    """Read the original contract signer independently of the bill's bank payer."""
    _partner(db, partner_id)
    try:
        return resolve_contract_source(db, partner_id, month)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
