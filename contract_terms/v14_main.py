"""Production contract service V14: align Anjiu contract recommendation with its dedicated formula.

V13 keeps contract-first matching plus game-registry fallback. V14 changes only
one presentation/authority detail for Guangdong Anjiu / 游戏fan（安久）: that
channel's dedicated settlement formula intentionally treats the configured tax
rate as part of the settlement calculation, so its recommendation must expose
``tax_mode=share`` instead of the generic record-only ``none`` value.

No other partner/channel is modified, and no contract rate is changed here.
"""

from __future__ import annotations

from copy import deepcopy

from fastapi import Request

try:
    from . import v13_main as _v13
except ImportError:  # Vercel imports modules from the service root.
    import v13_main as _v13

app = _v13.app
_CHANNEL_RULE_PATH = _v13._CHANNEL_RULE_PATH


def _compact(value: object) -> str:
    return str(value or "").strip().lower().replace(" ", "")


def _is_anjiu(partner_name: str, channel_name: str) -> bool:
    partner = _compact(partner_name)
    channel = _compact(channel_name)
    return (
        "广东安久科技有限公司" in partner
        or "游戏fan（安久）" in channel
        or "游戏fan(安久)" in channel
    )


def align_anjiu_tax_mode(result: dict, *, partner_name: str, channel_name: str) -> dict:
    """Return a copy with Anjiu's dedicated tax-processing mode aligned.

    Share rate, tax rate, channel fee and every contract identity field remain
    untouched. Only ``tax_mode`` is changed from the generic record-only mode to
    ``share`` so the frontend does not mistake the dedicated channel formula for
    a manual contract override.
    """
    if not _is_anjiu(partner_name, channel_name):
        return result

    out = deepcopy(result or {})
    for item in out.get("lines") or []:
        recommended = item.get("recommended")
        if isinstance(recommended, dict):
            recommended["tax_mode"] = "share"

    header = out.get("header_recommendation")
    if isinstance(header, dict):
        header["tax_mode"] = "share"

    partner_recommendation = out.get("partner_recommendation")
    if isinstance(partner_recommendation, dict):
        partner_recommendation["tax_mode"] = "share"

    out["anjiu_formula_alignment"] = True
    return out


# V13 already owns this POST route. Replace only that route; every other V13/V12
# reconciliation, audit and database-safety behavior remains unchanged.
app.router.routes[:] = [
    route
    for route in app.router.routes
    if not (
        getattr(route, "path", None) == _CHANNEL_RULE_PATH
        and "POST" in (getattr(route, "methods", None) or set())
    )
]


@app.post(_CHANNEL_RULE_PATH)
def anjiu_aligned_channel_rule(request: Request, payload: dict) -> dict:
    result = _v13.contract_first_registry_fallback_channel_rule(request, payload)
    partner_name = str(payload.get("partner_name") or "").strip()
    channel_name = str(payload.get("channel_name") or "").strip()
    return align_anjiu_tax_mode(
        result,
        partner_name=partner_name,
        channel_name=channel_name,
    )
