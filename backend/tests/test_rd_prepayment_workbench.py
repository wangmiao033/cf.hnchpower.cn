from decimal import Decimal

from app.api.rd_prepayment_workbench import _candidate_score, _pool_status
from app.models.bank_transaction import BankTransaction


def test_pool_status_prioritizes_real_bank_funding_gap():
    status, label, tone = _pool_status({
        "prepayment_agreed_amount": 50000,
        "actual_funded_amount": 20000,
        "deducted_amount": 10000,
        "invoice_allocated_amount": 20000,
        "funding_shortfall": 0,
    })
    assert status == "funding_pending"
    assert label == "待补银行预付款"
    assert tone == "warning"


def test_pool_status_distinguishes_invoice_gap_after_funding_complete():
    status, label, tone = _pool_status({
        "prepayment_agreed_amount": 50000,
        "actual_funded_amount": 50000,
        "deducted_amount": 10000,
        "invoice_allocated_amount": 30000,
        "funding_shortfall": 0,
    })
    assert status == "invoice_pending"
    assert label == "待补进项发票"
    assert tone == "warning"


def test_bank_candidate_exact_partner_and_amount_is_high_confidence():
    pool = {
        "counterparty": "广州研发科技有限公司",
        "partner_name": "广州研发科技有限公司",
        "partner_short_name": "广州研发",
        "max_fundable_amount": 50000,
    }
    tx = BankTransaction(
        id="tx-1",
        type="statement_import",
        payee_name="广州研发科技有限公司",
        expense_amount=50000,
        summary="项目首笔预付款",
        currency="CNY",
    )
    score, reasons = _candidate_score(pool, tx, Decimal("50000"))
    assert score >= 95
    assert any("完全一致" in item for item in reasons)
    assert any("预付款" in item for item in reasons)
    assert any("金额" in item for item in reasons)
