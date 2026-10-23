"""Opt-in Samsung statement fee. Existing bills keep their saved rule."""
from decimal import Decimal, ROUND_HALF_UP

SAMSUNG_STATEMENT_FEE_RULE = "samsung_statement_fee"
SAMSUNG_LEGAL_NAME = "北京鹏泰博兴科技有限公司"


def is_samsung_identity(partner_name, channel_name):
    return (str(partner_name or "").strip() == SAMSUNG_LEGAL_NAME
            and str(channel_name or "").strip() in {"三星", "鹏泰博兴"})


def money(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def samsung_billing_base(before_fee, gateway_cost):
    """Fee is the statement's full currency amount, deducted before sharing.

    The recorded 4% is not an effective blended rate. Tax on an inclusive
    settlement is a breakdown, not another reduction of the receivable.
    """
    base = Decimal(str(before_fee))
    fee = Decimal(str(gateway_cost))
    if not base.is_finite() or not fee.is_finite() or fee < 0 or fee > base or fee != money(fee):
        raise ValueError("三星原账单通道费须为非负两位小数，且不能超过扣减后的流水")
    return base - fee
