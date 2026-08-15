from decimal import Decimal

from app.api.rd_prepayment_lifecycle import _business_due_date, _invoice_parts, _pool_status


def test_business_due_date_skips_weekend():
    assert _business_due_date("2026-08-14", 1) == "2026-08-17"
    assert _business_due_date("2026-08-14", 5) == "2026-08-21"


def test_untriggered_installment_is_not_funding_gap_state():
    status, label, tone = _pool_status(
        strict_mode=True,
        frozen=False,
        plan_total=Decimal("50000"),
        triggered_total=Decimal("0"),
        invoice_blocked=Decimal("0"),
        funding_gap=Decimal("0"),
        overdue_amount=Decimal("0"),
        invoice_gap=Decimal("0"),
        funded=Decimal("0"),
        deducted=Decimal("0"),
        available=Decimal("0"),
        refund_due=Decimal("0"),
        refunded=Decimal("0"),
        shortfall=Decimal("0"),
    )
    assert status == "pending_trigger"
    assert label == "预付款尚未触发"
    assert tone == "neutral"


def test_frozen_pool_prioritizes_refund_status():
    status, label, tone = _pool_status(
        strict_mode=True,
        frozen=True,
        plan_total=Decimal("50000"),
        triggered_total=Decimal("50000"),
        invoice_blocked=Decimal("0"),
        funding_gap=Decimal("0"),
        overdue_amount=Decimal("0"),
        invoice_gap=Decimal("0"),
        funded=Decimal("50000"),
        deducted=Decimal("18000"),
        available=Decimal("0"),
        refund_due=Decimal("32000"),
        refunded=Decimal("0"),
        shortfall=Decimal("0"),
    )
    assert status == "refund_pending"
    assert label == "冻结待退款"
    assert tone == "danger"


def test_invoice_release_preserves_gross_and_tax_split():
    net, tax, gross = _invoice_parts(Decimal("1060"), {
        "amount_with_tax": 10600,
        "invoice_amount": 10000,
        "tax_amount": 600,
    })
    assert gross == Decimal("1060")
    assert net == Decimal("1000.00")
    assert tax == Decimal("60.00")
