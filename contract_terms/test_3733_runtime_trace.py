import unittest
from pathlib import Path


class RuntimeTraceScopeTests(unittest.TestCase):
    def test_trace_is_narrow_and_does_not_log_request_credentials(self):
        source = (Path(__file__).resolve().parent / 'v12_main.py').read_text(encoding='utf-8')
        self.assertIn('CHANNEL_RULE_3733_TRACE', source)
        self.assertIn('"三七三三" in partner_key', source)
        self.assertIn('any("一起来修仙" in game_key', source)
        self.assertIn('relevant_candidates', source)
        self.assertIn('partner_rule_status', source)
        self.assertNotIn('request.cookies', source)
        self.assertNotIn('request.headers.get("cookie")', source)
        self.assertNotIn('AUTH_JWT_SECRET', source)


if __name__ == '__main__':
    unittest.main()
