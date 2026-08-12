import unittest

from v8_main import app


class ContractDifferenceRouteTests(unittest.TestCase):
    def route_count(self, path, method):
        return sum(
            1
            for route in app.router.routes
            if getattr(route, "path", "") == path
            and method in (getattr(route, "methods", set()) or set())
        )

    def test_stable_reconcile_route_is_registered_once(self):
        self.assertEqual(
            self.route_count("/api/contract-terms/reconcile-v3", "GET"),
            1,
        )

    def test_difference_write_routes_are_registered_once(self):
        expected = [
            ("/api/contract-terms/difference-cases/{case_id}/actions", "POST"),
            ("/api/contract-terms/adjustments/{adjustment_id}/complete", "POST"),
            ("/api/contract-terms/carry-forwards/{carry_id}/apply", "POST"),
        ]
        for path, method in expected:
            with self.subTest(path=path):
                self.assertEqual(self.route_count(path, method), 1)

    def test_difference_read_routes_are_present(self):
        expected = [
            ("/api/contract-terms/difference-cases", "GET"),
            ("/api/contract-terms/difference-cases/{case_id}", "GET"),
            ("/api/contract-terms/carry-forwards", "GET"),
        ]
        for path, method in expected:
            with self.subTest(path=path):
                self.assertEqual(self.route_count(path, method), 1)


if __name__ == "__main__":
    unittest.main()
