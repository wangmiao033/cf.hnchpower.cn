import base64
import unittest
from unittest.mock import AsyncMock, patch

import external_renderer_main as renderer_main


class ExternalPdfRendererTest(unittest.TestCase):
    def test_decode_renderer_pages_preserves_order(self):
        page1 = b"\xff\xd8\xffpage-one"
        page2 = b"\xff\xd8\xffpage-two"
        payload = {
            "pages": [
                {"index": 1, "jpeg_base64": base64.b64encode(page1).decode("ascii")},
                {"index": 2, "jpeg_base64": base64.b64encode(page2).decode("ascii")},
            ]
        }
        self.assertEqual(renderer_main._decode_renderer_pages(payload), [page1, page2])

    def test_decode_renderer_pages_rejects_bad_order(self):
        page = b"\xff\xd8\xffpage"
        payload = {
            "pages": [
                {"index": 2, "jpeg_base64": base64.b64encode(page).decode("ascii")},
            ]
        }
        with self.assertRaises(ValueError):
            renderer_main._decode_renderer_pages(payload)

    def test_pdf_payload_keeps_existing_contract_shape(self):
        page = b"\xff\xd8\xffpage"
        payload, page_count = renderer_main._workers_ai_payload_from_pdf_pages(
            "contract.pdf",
            [page],
        )
        self.assertEqual(page_count, 1)
        self.assertEqual(payload.get("tool_choice"), "required")
        self.assertFalse(payload.get("parallel_tool_calls"))
        self.assertEqual(payload["tools"][0]["function"]["name"], renderer_main.EXTRACTION_TOOL_NAME)

    def test_only_one_smart_scan_route_is_registered(self):
        routes = [
            route
            for route in renderer_main.app.router.routes
            if getattr(route, "path", None) == "/api/contracts/smart-scan"
        ]
        self.assertEqual(len(routes), 1)


class ExternalPdfRendererFallbackTest(unittest.IsolatedAsyncioTestCase):
    async def test_external_failure_falls_back_to_existing_renderer(self):
        with (
            patch.object(renderer_main, "PDF_RENDERER_URL", "https://renderer.example/render"),
            patch.object(renderer_main, "PDF_RENDERER_TOKEN", "test-token"),
            patch.object(
                renderer_main,
                "_render_pdf_pages_external",
                AsyncMock(side_effect=RuntimeError("unavailable")),
            ),
            patch.object(renderer_main, "_render_pdf_pages", return_value=[b"local-page"]) as local_renderer,
        ):
            pages = await renderer_main._render_pdf_pages_resilient(b"fake-pdf")

        self.assertEqual(pages, [b"local-page"])
        local_renderer.assert_called_once_with(b"fake-pdf")

    async def test_unconfigured_external_renderer_uses_existing_renderer(self):
        with (
            patch.object(renderer_main, "PDF_RENDERER_URL", ""),
            patch.object(renderer_main, "PDF_RENDERER_TOKEN", ""),
            patch.object(renderer_main, "_render_pdf_pages", return_value=[b"local-page"]) as local_renderer,
        ):
            pages = await renderer_main._render_pdf_pages_resilient(b"fake-pdf")

        self.assertEqual(pages, [b"local-page"])
        local_renderer.assert_called_once_with(b"fake-pdf")


if __name__ == "__main__":
    unittest.main()
