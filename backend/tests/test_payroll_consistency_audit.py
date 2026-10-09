"""Read-only salary integrity scanner; no employee names returned by anomaly API."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.payroll_consistency import inspect_payroll_integrity
from app.api.anomaly import get_consistency_audit


def batch(**overrides):
    fields = dict(
        id="batch-001", operating_expense_id="expense-001",
        expense_month="2026-08", company_name="熊动科技",
        employee_count=1, gross_salary=15000,
        employee_deduction_total=1770.48,
        income_tax_total=822.95, net_salary_total=12406.57,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def expense(**overrides):
    fields = dict(
        id="expense-001", source="payroll_import",
        expense_month="2026-08", vendor_name="熊动科技",
        category="payroll", payment_status="unpaid",
        payment_date=None, amount=15000,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def employee(**overrides):
    fields = dict(
        id="person-001", payroll_batch_id="batch-001", employee_name="员工隐私",
        gross_salary=15000, deduction_total=1770.48,
        income_tax=822.95, net_salary=12406.57,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


class PayrollIntegrityTests(unittest.TestCase):
    def test_consistent_payroll_is_clean(self):
        self.assertEqual(inspect_payroll_integrity([batch()], [expense()], [employee()]), [])

    def test_month_company_duplicate_is_reported(self):
        issue_list = inspect_payroll_integrity([
            batch(), batch(id="batch-002", operating_expense_id="expense-002")
        ], [expense(), expense(id="expense-002")], [
            employee(), employee(id="person-002", payroll_batch_id="batch-002")
        ])
        self.assertEqual(len([i for i in issue_list if "重复" in i["title"]]), 1)

    def test_money_mismatch_and_orphaned_import_are_reported(self):
        a = inspect_payroll_integrity([batch()], [expense(amount=15020)], [employee()])
        self.assertTrue(any("应发额" in x["title"] and x["amount"] == 20 for x in a))
        b = inspect_payroll_integrity([], [expense()], [])
        self.assertEqual(len(b), 1)
        self.assertIn("缺少工资批次", b[0]["title"])

    def test_missing_detail_and_mismatched_employee_totals(self):
        issues = inspect_payroll_integrity([batch()], [expense()], [])
        self.assertTrue(any("缺少员工工资明细" in x["title"] for x in issues))
        wrong = inspect_payroll_integrity([batch()], [expense()], [employee(net_salary=12407.57)])
        self.assertTrue(any("实发工资" in x["title"] and x["amount"] == 1 for x in wrong))

    def test_issues_contain_no_individual_employee_names(self):
        issues = inspect_payroll_integrity(
            [batch()], [expense(amount=15022)], [employee(net_salary=12406.51)]
        )
        self.assertTrue(issues)
        self.assertNotIn("员工隐私", str(issues))
        self.assertTrue(all(x["category"] == "payroll" for x in issues))

    def test_paid_without_date_and_identity_disagreement(self):
        issues = inspect_payroll_integrity(
            [batch()], [expense(payment_status="paid", expense_month="2026-07", payment_date=None)], [employee()]
        )
        self.assertTrue(any("缺少支付日期" in x["title"] for x in issues))
        self.assertTrue(any("公司或月份不一致" in x["title"] for x in issues))

    def test_aggregate_findings_require_analytics_view_not_only_anomalies_access(self):
        db = object()
        user = object()
        with (
            patch("app.api.anomaly.resolve_permissions", return_value={"anomalies.view"}),
            patch("app.api.anomaly.build_data_consistency_audit", return_value={"summary": {}}) as audit,
        ):
            get_consistency_audit(limit=500, db=db, user=user)
            audit.assert_called_once_with(db, limit=500, include_payroll=False)

        with (
            patch("app.api.anomaly.resolve_permissions", return_value={"anomalies.view", "analytics.view"}),
            patch("app.api.anomaly.build_data_consistency_audit", return_value={"summary": {}}) as audit,
        ):
            get_consistency_audit(limit=500, db=db, user=user)
            audit.assert_called_once_with(db, limit=500, include_payroll=True)


if __name__ == "__main__":
    unittest.main()
