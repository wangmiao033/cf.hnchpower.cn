"""Contract actions must not overwrite a competing official-source approval."""

import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

import v4_main


class DifferenceActionSerializationTests(unittest.TestCase):
    def test_read_only_case_lookup_does_not_lock(self):
        conn = Mock()
        conn.execute.return_value.fetchone.return_value = {"id": "CASE", "status": "pending"}
        self.assertEqual(v4_main._case_by_id(conn, "CASE")["id"], "CASE")
        self.assertNotIn("FOR UPDATE", conn.execute.call_args.args[0])

    def test_mutating_case_lookup_locks(self):
        conn = Mock()
        conn.execute.return_value.fetchone.return_value = {"id": "CASE", "status": "pending"}
        v4_main._case_by_id(conn, "CASE", for_update=True)
        self.assertIn("FOR UPDATE", conn.execute.call_args.args[0])

    def test_competing_actions_recheck_resolved_status_before_writing(self):
        for action in ("create_adjustment", "carry_forward", "edit_bill", "accept_difference"):
            with self.subTest(action=action):
                conn = Mock()
                conn.execute.return_value.fetchone.return_value = {
                    "id": "CASE", "status": "resolved", "handling_type": "accept_difference",
                    "substatus": "honor_official_statement",
                }
                context = Mock()
                context.__enter__ = Mock(return_value=conn)
                context.__exit__ = Mock(return_value=False)
                with (
                    patch.object(v4_main, "_require_permission", return_value="admin@example.test"),
                    patch.object(v4_main, "_database_url", return_value="unused"),
                    patch.object(v4_main, "_ensure_difference_tables"),
                    patch.object(v4_main.psycopg, "connect", return_value=context),
                ):
                    with self.assertRaises(HTTPException) as raised:
                        v4_main.handle_difference_case(Mock(), "CASE", {"action": action})
                self.assertEqual(raised.exception.status_code, 409)
                conn.execute.assert_called_once()
                self.assertIn("SELECT", conn.execute.call_args.args[0])
                self.assertIn("FOR UPDATE", conn.execute.call_args.args[0])
                conn.commit.assert_not_called()
