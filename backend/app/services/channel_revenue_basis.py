"""Explicit input-money representation, separate from a game's discount identity."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

PRE_DISCOUNT = "pre_discount"
POST_DISCOUNT = "post_discount"
AIQU_CHANNEL_NAME = "爱趣"
AIQU_CHANNEL_NAMES = frozenset({AIQU_CHANNEL_NAME, "爱趣（爱趣聚合）"})
AIQU_PARTNER_NAME = "昆山爱趣网络科技有限公司"


def is_aiqu_record(record: Any) -> bool:
    # No substring, alias, game-name or contract-name inference is permitted.
    return (
        str(getattr(record, "channel_name", None) or "").strip() in AIQU_CHANNEL_NAMES
        and str(getattr(record, "partner_name", None) or "").strip() == AIQU_PARTNER_NAME
    )


def revenue_basis(item: Any) -> str:
    # Missing legacy metadata always keeps the original pre-discount behavior.
    return str(getattr(item, "revenue_basis", None) or PRE_DISCOUNT)


def effective_billing_flow(item: Any) -> Decimal:
    """Return paid flow without changing discount_factor or voucher semantics."""
    flow = Decimal(str(getattr(item, "billing_flow", None) or 0))
    discount = Decimal(str(getattr(item, "discount_factor", None) or 1))
    if discount <= 0:
        discount = Decimal("1")
    return flow if revenue_basis(item) == POST_DISCOUNT else flow * discount
