"""Contract signer resolution is independent of the bank's payment party.

Only a verified customer->contract-entity link or an existing contract bound to
the same customer ID can supply the contract matching name. Neither fuzzy
company similarity nor a bank payer alone is valid contract evidence.
"""
from __future__ import annotations

from sqlalchemy import text

from app.services.legal_entities import entity_links, role_at_month, valid_month


def unique_contract_counterparty(names: list[str]) -> str | None:
    distinct = {str(name or "").strip() for name in names if str(name or "").strip()}
    return next(iter(distinct)) if len(distinct) == 1 else None


def resolve_contract_source(db, partner_id: str, month: str) -> dict:
    valid_month(month)
    configured = role_at_month(entity_links(db, partner_id), "contract", month)
    if configured:
        return {
            "partner_id": partner_id,
            "month": month,
            "contract_party_name": configured["legal_name"],
            "source": "configured_contract_entity",
            "message": "按合作客户配置的签约主体读取合同；付款公司不改变合同归属。",
        }

    rows = db.execute(text("""
        SELECT DISTINCT BTRIM(counterparty) AS counterparty
          FROM cf_contract_records
         WHERE partner_id = :id AND NULLIF(BTRIM(counterparty), '') IS NOT NULL
         ORDER BY counterparty
         LIMIT 3
    """), {"id": partner_id}).mappings().all()
    signatory = unique_contract_counterparty([row["counterparty"] for row in rows])
    if signatory:
        return {
            "partner_id": partner_id,
            "month": month,
            "contract_party_name": signatory,
            "source": "existing_customer_contract",
            "message": "从同一客户ID的原始已签合同识别签约方；不会创建新合同。",
        }
    return {
        "partner_id": partner_id,
        "month": month,
        "contract_party_name": None,
        "source": "unresolved",
        "message": "该客户未配置合同主体，或同一客户关联了多个不同签约方；请到客户中心核实原合同主体，不要重复建合同。",
    }
