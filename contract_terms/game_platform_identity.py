"""Pure contract SKU/device identity helpers, without service or database imports.

Device suffixes are presentation metadata, not financial editions. Only an
explicit terminal ``-ios``, ``_ios``, ``(ios)`` or whitespace + ``ios`` (and the
same Android spellings) is separated. Every other commercial suffix is retained.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

_DEVICE_SUFFIX = re.compile(r"(?:[-_\s](ios|android)|\((ios|android)\))$", re.IGNORECASE)
_ALL_PLATFORMS = {"全版本", "all", "all platforms"}


def split_device_suffix(value: Any) -> tuple[str, str]:
    raw = unicodedata.normalize("NFKC", str(value or "")).strip()
    match = _DEVICE_SUFFIX.search(raw)
    if not match:
        return raw, ""
    return raw[:match.start()].strip(), (match.group(1) or match.group(2)).lower()


def financial_game_key(value: Any) -> str:
    """Normalize formatting/discount aliases while retaining financial editions."""
    name, _ = split_device_suffix(value)
    raw = re.sub(r"[()\[\]【】\s]", "", name.lower())

    def normalize_discount(match: re.Match) -> str:
        token = match.group(1)
        if "." not in token and len(token) > 1 and token.startswith("0"):
            token = f"0.{token[1:]}"
        return f"{float(token):g}折"

    return re.sub(r"(?<!\d)(\d+(?:\.\d+)?)折", normalize_discount, raw)


def _platform(value: Any) -> str:
    return unicodedata.normalize("NFKC", str(value or "")).strip().lower()


def _declared_devices(value: Any) -> set[str]:
    text = _platform(value)
    if text in {"ios", "android"}:
        return {text}
    if re.fullmatch(r"(?:android\s*/\s*ios|ios\s*/\s*android)", text):
        return {"android", "ios"}
    return set()


def declared_line_device(line_name: Any, line_platform: Any = "") -> str:
    """Return only supplied device evidence, never a candidate-derived guess."""
    _, suffix = split_device_suffix(line_name)
    declared = _declared_devices(line_platform)
    return suffix or (next(iter(declared)) if len(declared) == 1 else "")


def candidate_platform_scope(candidate: dict) -> tuple[str, ...]:
    """Comparable coverage for detecting ambiguous unknown-device candidates."""
    _, suffix = split_device_suffix(candidate.get("original_product_name") or candidate.get("product_name"))
    if suffix:
        return (suffix,)
    label = _platform(candidate.get("platform"))
    devices = _declared_devices(label)
    if label in _ALL_PLATFORMS:
        return ("all",)
    if devices:
        return tuple(sorted(devices))
    return ("unspecified", label)


def platform_compatible(
    line_name: Any,
    candidate_name: Any,
    line_platform: Any = "",
    candidate_platform: Any = "",
) -> bool:
    """Reject contradictory device evidence without inventing missing evidence.

    A product suffix is narrower than even an all-platform declaration. Blank
    legacy metadata is not evidence that an unsuffixed item covers iOS/Android.
    Explicit bill metadata is usable, but cannot contradict its own name suffix.
    A bill with no device evidence retains legacy compatibility. The caller must
    separately guard multiple differing candidates; compatibility is not a guess.
    """
    _, line_suffix = split_device_suffix(line_name)
    _, candidate_suffix = split_device_suffix(candidate_name)
    line_declared = _declared_devices(line_platform)
    candidate_declared = _declared_devices(candidate_platform)
    line_label = _platform(line_platform)
    candidate_label = _platform(candidate_platform)
    if line_suffix and line_label and line_label not in _ALL_PLATFORMS and line_suffix not in line_declared:
        return False
    line_device = line_suffix or (next(iter(line_declared)) if len(line_declared) == 1 else "")
    if candidate_suffix:
        return bool(
            (not line_device or line_device == candidate_suffix)
            and (
                not candidate_label
                or candidate_label in _ALL_PLATFORMS
                or candidate_suffix in candidate_declared
            )
        )
    if not line_device:
        return True
    return candidate_label in _ALL_PLATFORMS or line_device in candidate_declared


def contract_access_matches_line(line_name: Any, candidate: dict, line_platform: Any = "") -> bool:
    """Strict original-name identity used for an explicit access-item selection."""
    candidate_name = candidate.get("original_product_name") or candidate.get("product_name")
    key = financial_game_key(line_name)
    return bool(
        key
        and key == financial_game_key(candidate_name)
        and platform_compatible(line_name, candidate_name, line_platform, candidate.get("platform"))
    )
