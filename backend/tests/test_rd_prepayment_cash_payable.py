from decimal import Decimal

from app.services.rd_bank_payment_aggregate import RdPaymentAggregate, fill_payable_for_row


def _aggregate(*, paid=0, deduction=0, gross=0):
    return RdPaymentAggregate(
        paid_amount=Decimal(str(paid)),
        unpaid_amount=Decimal("0"),
        payment_status="未付款",
        payment_count=0,
        latest_payment_date=None,
        prepayment_deduction=Decimal(str(deduction)),
        cash_payable_amount=Decimal("0"),
        gross_payable_amount=Decimal(str(gross)),
    )


def test_full_prepayment_offset_requires_no_second_cash_payment():
    result = fill_payable_for_row(_aggregate(deduction=18000), 18000)
    assert result.prepayment_deduction == Decimal("18000")
    assert result.cash_payable_amount == Decimal("0")
    assert result.paid_amount == Decimal("0")
    assert result.unpaid_amount == Decimal("0")
    assert result.payment_status == "已付款"


def test_partial_prepayment_only_leaves_residual_cash_payable():
    result = fill_payable_for_row(_aggregate(deduction=6000), 20000)
    assert result.prepayment_deduction == Decimal("6000")
    assert result.cash_payable_amount == Decimal("14000")
    assert result.unpaid_amount == Decimal("14000")
    assert result.payment_status == "未付款"


def test_cash_payment_is_applied_after_prepayment_offset():
    result = fill_payable_for_row(_aggregate(paid=5000, deduction=6000), 20000)
    assert result.cash_payable_amount == Decimal("14000")
    assert result.paid_amount == Decimal("5000")
    assert result.unpaid_amount == Decimal("9000")
    assert result.payment_status == "部分付款"


def test_negative_settlement_never_consumes_prepayment_balance():
    result = fill_payable_for_row(_aggregate(deduction=6000), -20000)
    assert result.prepayment_deduction == Decimal("0")
    assert result.cash_payable_amount == Decimal("20000")
    assert result.unpaid_amount == Decimal("20000")


def test_legacy_net_payable_caller_does_not_apply_prepayment_twice():
    aggregate = _aggregate(deduction=6000, gross=20000)
    result = fill_payable_for_row(aggregate, 14000)
    assert result.prepayment_deduction == Decimal("6000")
    assert result.cash_payable_amount == Decimal("14000")
    assert result.unpaid_amount == Decimal("14000")
