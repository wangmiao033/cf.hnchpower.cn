"""A normal application release may preview cleanup, never delete deployments."""
from pathlib import Path
import unittest


class ReleaseSafetyTests(unittest.TestCase):
    def test_production_release_cleanup_is_dry_run(self):
        source = (Path(__file__).resolve().parents[2] / ".github/workflows/production-deploy.yml").read_text()
        start = source.index("      - name: Preview old deployments cleanup (no deletion)")
        step = source[start:source.index("      - name:", start + 1)]
        self.assertIn("DRY_RUN: 'true'", step)
        self.assertNotIn("DRY_RUN: 'false'", source)
        self.assertIn("python3 scripts/cleanup_vercel_deployments.py", step)
        self.assertIn("check_url 'https://cf.hnchpower.cn/health/db'", source)
        self.assertIn("npx --yes vercel@latest deploy --prod", source)
