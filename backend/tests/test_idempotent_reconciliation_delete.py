from __future__ import annotations

import unittest

from app.main import _is_idempotent_reconciliation_delete_miss


class IdempotentReconciliationDeleteTest(unittest.TestCase):
    def test_repeated_research_bill_delete_is_successful_noop(self) -> None:
        self.assertTrue(
            _is_idempotent_reconciliation_delete_miss(
                "DELETE",
                "/api/reconciliation/d34aec41-70fc-425f-b826-ac7d439a1496",
                404,
            )
        )

    def test_other_404_responses_are_not_rewritten(self) -> None:
        self.assertFalse(
            _is_idempotent_reconciliation_delete_miss(
                "GET",
                "/api/reconciliation/d34aec41-70fc-425f-b826-ac7d439a1496",
                404,
            )
        )
        self.assertFalse(
            _is_idempotent_reconciliation_delete_miss(
                "DELETE",
                "/api/reconciliation/d34aec41-70fc-425f-b826-ac7d439a1496/payments",
                404,
            )
        )
        self.assertFalse(
            _is_idempotent_reconciliation_delete_miss(
                "DELETE",
                "/api/channel-records/missing",
                404,
            )
        )


if __name__ == "__main__":
    unittest.main()
