"""Production contract service V20: bridge trusted partner short aliases.

Some customer records use a short finance/master-data name (for example ``爱趣``)
while channel statements carry the full legal company name (for example
``昆山爱趣网络科技有限公司``).  The legacy matcher deliberately required a
5-character containment floor, so these already-linked short names were rejected
before game/version matching ran.

V20 keeps V19 discount-version compatibility and allows only explicit
``partner_short_name`` tokens to bridge a legal company name.  This remains
conservative: aliases must be at least two normalized characters, must occur
verbatim inside the legal name, and generic corporate words are never accepted
as two-character aliases.  Historical rows are not rewritten.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

try:
    from . import channel_rule_recommender as _channel
    from . import matcher as _matcher
    from . import v19_main as _v19
except ImportError:  # Vercel imports modules from the service root.
    import channel_rule_recommender as _channel
    import matcher as _matcher
    import v19_main as _v19

app = _v19.app

_ORIGINAL_SCORE_CANDIDATE = _matcher.score_candidate
_ORIGINAL_PARTNER_MATCHES = _channel._partner_matches
_GENERIC_TWO_CHAR_ALIASES = {
    "科技",
    "网络",
    "传媒",
    "文化",
    "游戏",
    "信息",
    "软件",
    "互娱",
    "数字",
    "娱乐",
    "有限",
    "公司",
}
_ALIAS_SPLIT_RE = re.compile(r"[()（）/\\|,，;；、\s]+")


def _short_alias_tokens(candidate: dict[str, Any]) -> list[str]:
    raw = unicodedata.normalize("NFKC", str(candidate.get("partner_short_name") or "")).strip()
    if not raw:
        return []
    tokens: list[str] = []
    for part in _ALIAS_SPLIT_RE.split(raw):
        normalized = _matcher.normalize_company(part)
        if not normalized or normalized in tokens:
            continue
        tokens.append(normalized)
    return tokens


def _matching_short_alias(partner_name: Any, candidate: dict[str, Any]) -> str:
    target = _matcher.normalize_company(partner_name)
    if not target:
        return ""
    for alias in _short_alias_tokens(candidate):
        if len(alias) < 2:
            continue
        if len(alias) == 2 and alias in _GENERIC_TWO_CHAR_ALIASES:
            continue
        if alias in target:
            return alias
    return ""


def partner_matches_v20(partner_name: str, candidate: dict) -> bool:
    if _ORIGINAL_PARTNER_MATCHES(partner_name, candidate):
        return True
    return bool(_matching_short_alias(partner_name, candidate))


def score_candidate_v20(bill: dict, line: dict, candidate: dict) -> dict:
    scored = _ORIGINAL_SCORE_CANDIDATE(bill, line, candidate)
    if scored.get("eligible"):
        return scored

    bill_partner = bill.get("partner_name")
    alias = _matching_short_alias(bill_partner, candidate)
    if not alias:
        return scored

    # Re-run the existing deterministic matcher with only partner identity bridged.
    # Product/version, authorization dates, channel and all financial fields remain
    # untouched, so a short-name hit cannot bypass a game-version conflict.
    bridged = dict(candidate)
    bridged["partner_name"] = bill_partner
    rescored = _ORIGINAL_SCORE_CANDIDATE(bill, line, bridged)
    if not rescored.get("eligible"):
        return scored

    reasons = [reason for reason in (rescored.get("reasons") or []) if reason != "合作方一致"]
    reasons.append(f"合作方简称命中（{alias}）")
    rescored["reasons"] = reasons
    rescored["partner_match_method"] = "trusted_short_alias"
    rescored["partner_short_alias"] = alias
    return rescored


# The recommender imported score_candidate directly, so patch both bindings.
_matcher.score_candidate = score_candidate_v20
_channel.score_candidate = score_candidate_v20
_channel._partner_matches = partner_matches_v20
