"""利润分析专用游戏名归并。

只改变利润统计时的分组 key，不改账单、QuickSDK、合同或经营费用里的原始游戏名。
规则保持保守：只去掉明确的折扣/专服/混服/渠道后缀，并用少量显式别名兜底。
"""

from __future__ import annotations

import re


_EXPLICIT_ALIASES = {
    "一起修仙": "一起来修仙",
}

_QUALIFIER_HINTS = (
    "折",
    "内置",
    "专服",
    "混服",
    "小混",
    "霸服",
    "翻服",
    "联运",
    "跑量",
    "正版",
    "taptap",
    "爱趣",
    "闪趣",
    "3733",
    "渠道",
    "版本",
)

_TRAILING_PAREN_RE = re.compile(r"[（(]([^()（）]*)[）)]\s*$")
_BOOK_TITLE_RE = re.compile(r"^《([^》]+)》\s*(.*)$")


def _looks_like_qualifier(value: str) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return False
    if any(hint.lower() in text for hint in _QUALIFIER_HINTS):
        return True
    # 仅月份/批次类括号也视为版本标签，例如（6月）、（2026年6月）。
    return bool(re.fullmatch(r"(?:20\d{2}年)?\d{1,2}月", text))


def normalize_profit_game_name(value: object) -> str:
    """Return the canonical/mother-game name used only by Profit Analysis."""
    raw = str(value or "").strip()
    if not raw:
        return "未填写产品"

    name = re.sub(r"\s+", " ", raw).strip()

    # 《六界飞仙》0.1折（6月） -> 六界飞仙；若书名号后仍是正文则不截断。
    book_match = _BOOK_TITLE_RE.match(name)
    if book_match:
        title, tail = book_match.groups()
        if not tail or _looks_like_qualifier(tail) or re.match(r"^(?:0?\.\d+|\d+(?:\.\d+)?)折", tail):
            name = title.strip()

    # 多轮剥离明确的尾部标签，避免“折扣 + 渠道括号”组合残留。
    for _ in range(5):
        before = name

        # 渠道/商店标签。
        name = re.sub(r"\s+taptap\s*$", "", name, flags=re.IGNORECASE)

        # 005 系列内部版本名。
        name = re.sub(r"005专服\d*.*$", "", name, flags=re.IGNORECASE)
        name = re.sub(r"005折(?:混服|专服\d*|翻服|霸服版|霸服|服)?\s*$", "", name, flags=re.IGNORECASE)
        name = re.sub(r"005(?:小混|混服|专服\d*|翻服|霸服版|霸服)\s*$", "", name, flags=re.IGNORECASE)

        # 0.05折 / 0.1折 / 01折 等尾部版本描述。
        name = re.sub(
            r"(?:0?\.\d+|\d+(?:\.\d+)?)折(?:霸服版|霸服|翻服|混服|专服\d*|正版跑量手游|正版|版|服)?\s*$",
            "",
            name,
            flags=re.IGNORECASE,
        )

        # 只有括号内容明显是渠道/版本标签时才去掉，不碰正常游戏副标题。
        paren_match = _TRAILING_PAREN_RE.search(name)
        if paren_match and _looks_like_qualifier(paren_match.group(1)):
            name = name[: paren_match.start()].rstrip()

        # 单独的内部 005 尾标。
        name = re.sub(r"005\s*$", "", name, flags=re.IGNORECASE)
        name = name.strip(" -_·")

        if name == before:
            break

    canonical = _EXPLICIT_ALIASES.get(name, name)
    return canonical or raw
