import unittest

from app.schemas.anomaly_ai import AnomalyAiInputItem
from app.services.anomaly_ai import analyze_items


def item(
    anomaly_id,
    severity="warning",
    category="quality",
    amount=None,
    bill_id=None,
    partner=None,
    month="2026-07",
    title="测试异常",
):
    return AnomalyAiInputItem(
        id=anomaly_id,
        severity=severity,
        category=category,
        title=title,
        detail="测试说明",
        amount=amount,
        bill_type="rd" if bill_id else None,
        bill_id=bill_id,
        bill_number=f"RD-{bill_id}" if bill_id else None,
        partner_name=partner,
        settlement_month=month,
        status="pending",
    )


class AnomalyAiRiskEngineTest(unittest.TestCase):
    def test_critical_financial_anomaly_is_top_priority(self):
        result = analyze_items(
            [
                item("missing-number:rd:1", severity="info", category="quality", bill_id="1"),
                item(
                    "payment-over:rd:2",
                    severity="critical",
                    category="payment",
                    amount=120000,
                    bill_id="2",
                    title="付款金额超过应付金额",
                ),
            ]
        )
        top = result["items"][0]
        self.assertEqual(top["anomaly_id"], "payment-over:rd:2")
        self.assertGreaterEqual(top["priority_score"], 90)
        self.assertEqual(top["priority_label"], "立即处理")
        self.assertGreaterEqual(top["confidence"], 0.9)

    def test_multiple_anomalies_on_same_bill_raise_priority(self):
        single = analyze_items(
            [item("invoice-partial:rd:1", category="invoice", bill_id="1", amount=5000)]
        )["items"][0]["priority_score"]
        clustered = analyze_items(
            [
                item("invoice-partial:rd:1", category="invoice", bill_id="1", amount=5000),
                item("missing-period:rd:1", category="quality", bill_id="1"),
                item("contract-expired:rd:1", category="contract", bill_id="1"),
            ]
        )
        target = next(row for row in clustered["items"] if row["anomaly_id"] == "invoice-partial:rd:1")
        self.assertGreater(target["priority_score"], single)
        self.assertTrue(any("同一账单" in signal for signal in target["related_signals"]))

    def test_partner_cluster_is_marked_as_systemic(self):
        result = analyze_items(
            [
                item("missing-period:rd:1", partner="合作方A", bill_id="1"),
                item("missing-period:rd:2", partner="合作方A", bill_id="2"),
                item("contract-expired:rd:3", category="contract", partner="合作方A", bill_id="3"),
            ]
        )
        self.assertTrue(
            any(
                "系统性问题" in signal
                for row in result["items"]
                for signal in row["related_signals"]
            )
        )

    def test_exposure_amount_deduplicates_same_bill(self):
        result = analyze_items(
            [
                item("invoice-partial:rd:1", category="invoice", amount=10000, bill_id="1"),
                item("final-but-unpaid:rd:1", severity="critical", category="payment", amount=8000, bill_id="1"),
                item("invoice-over:rd:2", severity="critical", category="invoice", amount=5000, bill_id="2"),
            ]
        )
        self.assertEqual(result["summary"]["exposure_amount"], 15000)

    def test_system_signals_raise_company_risk_score_and_actions(self):
        base = analyze_items([item("missing-number:rd:1", severity="info", bill_id="1")])
        with_signals = analyze_items(
            [item("missing-number:rd:1", severity="info", bill_id="1")],
            system_signals=[
                {
                    "key": "operating-profit-negative",
                    "severity": "critical",
                    "title": "2026-07 经营利润为负",
                    "detail": "亏损",
                    "value": -10000,
                    "action": "进入利润分析定位亏损来源",
                },
                {
                    "key": "bank-backlog",
                    "severity": "warning",
                    "title": "银行流水待复核积压 20 笔",
                    "detail": "积压",
                    "value": 20,
                    "action": "进入银行核销处理积压",
                },
            ],
        )
        self.assertGreater(with_signals["summary"]["risk_score"], base["summary"]["risk_score"])
        self.assertTrue(any("利润" in risk for risk in with_signals["summary"]["top_risks"]))
        self.assertTrue(any("银行核销" in action for action in with_signals["summary"]["recommended_actions"]))

    def test_resolved_items_are_not_scored_as_current_risk(self):
        resolved = item("payment-over:rd:1", severity="critical", category="payment", amount=99999, bill_id="1")
        resolved.status = "resolved"
        result = analyze_items([resolved])
        self.assertEqual(result["summary"]["risk_score"], 0)
        self.assertEqual(result["summary"]["critical_count"], 0)
        self.assertEqual(result["items"], [])


if __name__ == "__main__":
    unittest.main()
