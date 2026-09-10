import json
import unittest

from cloudflare_main import (
    EXTRACTION_TOOL_NAME,
    _workers_ai_payload,
    parse_workers_ai_result,
)


def sample_result():
    return {
        "contract": {
            "contract_name": "手机游戏联合运营合作协议",
            "contract_type": "无固定总价合同",
        },
        "confidence": {"contract_name": 0.98},
        "evidence": {"contract_name": "合同首页标题"},
        "parties": {
            "party_a": "甲方公司",
            "party_b": "广州熊动科技有限公司",
            "our_party": "广州熊动科技有限公司",
        },
        "access_items": [],
        "summary": "联合运营协议",
        "warnings": [],
    }


class CloudflareStructuredOutputTest(unittest.TestCase):
    def test_payload_forces_single_function_call(self):
        payload, page_count = _workers_ai_payload(
            "contract.jpg",
            "image/jpeg",
            b"fake-image",
        )
        self.assertEqual(page_count, 1)
        self.assertEqual(payload.get("tool_choice"), "required")
        self.assertFalse(payload.get("parallel_tool_calls"))
        self.assertNotIn("response_format", payload)
        tool = payload["tools"][0]
        self.assertEqual(tool["type"], "function")
        self.assertEqual(tool["function"]["name"], EXTRACTION_TOOL_NAME)
        self.assertEqual(tool["function"]["parameters"]["type"], "object")

    def test_parses_traditional_workers_ai_tool_call(self):
        expected = sample_result()
        payload = {
            "success": True,
            "result": {
                "tool_calls": [
                    {
                        "name": EXTRACTION_TOOL_NAME,
                        "arguments": expected,
                    }
                ]
            },
        }
        self.assertEqual(parse_workers_ai_result(payload), expected)

    def test_parses_openai_compatible_tool_call(self):
        expected = sample_result()
        payload = {
            "success": True,
            "result": {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [
                                {
                                    "type": "function",
                                    "function": {
                                        "name": EXTRACTION_TOOL_NAME,
                                        "arguments": json.dumps(expected, ensure_ascii=False),
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
        }
        self.assertEqual(parse_workers_ai_result(payload), expected)

    def test_parses_markdown_json_fallback(self):
        expected = sample_result()
        payload = {
            "success": True,
            "result": {
                "response": "```json\n" + json.dumps(expected, ensure_ascii=False) + "\n```"
            },
        }
        self.assertEqual(parse_workers_ai_result(payload), expected)


if __name__ == "__main__":
    unittest.main()
