"""Production contract service V19: normalize legacy discount-version spellings.

Finance exports and historical contract lists use both decimal discount labels
(``0.05折``) and compact labels (``005折``).  They describe the same commercial
variant, but the legacy parser interpreted ``005`` as numeric ``5`` and rejected
an otherwise exact contract candidate as a version conflict.

V19 keeps the existing V18 API surface and applies one compatibility parser at
runtime to every production path that depends on commercial discount identity.
No historical bill text or contract rows are rewritten.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

try:
    from . import main as _main
    from . import matcher as _matcher
    from . import v18_main as _v18
except ImportError:  # Vercel imports modules from the service root.
    import main as _main
    import matcher as _matcher
    import v18_main as _v18

app = _v18.app

_VARIANT_RE = re.compile(r"(?<!\d)(\d+(?:\.\d+)?)\s*折", re.IGNORECASE)


def canonical_commercial_game_variant(value: Any) -> str:
    """Return one canonical commercial discount token.

    Examples used by historical channel statements:
    - 005折  -> 0.05折
    - 01折   -> 0.1折
    - 05折   -> 0.5折
    - 0.05折 -> 0.05折

    A non-leading-zero integer keeps its literal meaning, so ``5折`` stays
    ``5折`` and ``10折`` stays ``10折``. Existing named variants such as
    ``折扣版`` are preserved for backward compatibility.
    """
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    match = _VARIANT_RE.search(text)
    if match:
        token = match.group(1)
        if "." not in token and len(token) > 1 and token.startswith("0"):
            token = f"0.{token[1:]}"

        try:
            number = float(token)
        except (TypeError, ValueError):
            return ""
        return f"{number:g}折"

    compact = text.replace(" ", "")
    if "折扣版" in compact:
        return "折扣版"
    if "折服" in compact:
        return "折服"
    if "折版" in compact:
        return "折版"
    return ""


# score_candidate() resolves ``commercial_game_variant`` through matcher module
# globals at call time, so patching the module fixes channel recommendation and
# reconciliation without changing historical data.  The base PUT endpoint also
# resolves ``_infer_commercial_variant`` through main-module globals at call time.
_matcher.commercial_game_variant = canonical_commercial_game_variant
_main._infer_commercial_variant = canonical_commercial_game_variant

# V18 imported the function directly for its explicit alias guard.  Keep that
# guard on the same canonical semantics as the matcher and contract save path.
_v18.commercial_game_variant = canonical_commercial_game_variant
