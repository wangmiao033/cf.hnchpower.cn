import unittest

from v9_main import app


class V31RdEntryRouteTests(unittest.TestCase):
    def route_count(self, path, method):
        return sum(
            1
            for route in app.router.routes
            if getattr(route, "path", "") == path
            and method in (getattr(route, "methods", set()) or set())
        )

    def test_reconcile_route_is_replaced_once(self):
        self.assertEqual(self.route_count("/api/contract-terms/reconcile-v3", "GET"), 1)

    def test_rd_entry_routes_are_unique(self):
        expected = [
            ("/api/contract-terms/rd-rule-recommendation", "POST"),
            ("/api/contract-terms/rd-entry/prepare", "POST"),
            ("/api/contract-terms/rd-entry/finalize", "POST"),
            ("/api/contract-terms/rd-entry/latest", "GET"),
        ]
        for path, method in expected:
            with self.subTest(path=path, method=method):
                self.assertEqual(self.route_count(path, method), 1)

    def test_v30_difference_routes_remain_available(self):
        expected = [
            ("/api/contract-terms/difference-cases/{case_id}/actions", "POST"),
            ("/api/contract-terms/adjustments/{adjustment_id}/complete", "POST"),
            ("/api/contract-terms/carry-forwards/{carry_id}/apply", "POST"),
        ]
        for path, method in expected:
            with self.subTest(path=path, method=method):
                self.assertEqual(self.route_count(path, method), 1)


if __name__ == "__main__":
    unittest.main()