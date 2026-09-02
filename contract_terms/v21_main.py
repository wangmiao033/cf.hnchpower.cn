"""Production contract service V21: exact contract identity fast-path.

V20 already normalizes legacy discount spellings and bridges trusted partner short
names.  V21 adds one conservative rule before fuzzy scoring: when the selected
partner + game + commercial variant identify an exact cooperation item, use that
identity directly and let the existing authorization/financial-consensus logic
decide whether it can auto-apply.

This avoids a stubborn class of false negatives where an otherwise exact active
cooperation item is discarded by a legacy similarity score.  It does not weaken
safety: explicit channel mismatches and commercial-version mismatches are still
rejected, multiple exact items remain subject to the existing ambiguity checks,
and out-of-range authorization still blocks automatic application.
"""

from __future__ import annotations

from typing import Any

try:
    from . import v20_main as _v20
    from . import channel_rule_recommender as _channel
    from . import matcher as _matcher
except ImportError:  # Vercel imports modules from the service root.
    import v20_main as _v20
    import channel_rule_recommender as _channel
    import matcher as _matcher

app = _v20.app

_ORIGINAL_RANK_CANDIDATES = _channel._rank_candidates


def _exact_identity_candidate(partner_name: str, game_name: str, candidate: dict[str, Any]) -> bool:
    if not _channel._partner_matches(partner_name, candidate):
        return False
    if not _channel._exact_game_matches(game_name, candidate):
        return False

    # Exact normalized names are not enough for discount SKUs because bracketed
    # marketing suffixes may be removed by normalize_game().  Require the
    # settlement-driving commercial variant to be exactly the same as well.
    line_variant = _matcher.commercial_game_variant(game_name)
    candidate_variant = _matcher.commercial_game_variant(candidate.get("product_name"))
    if line_variant != candidate_variant:
        return False
    return True


def _channel_compatible(bill_channel: Any, candidate_channel: Any) -> bool:
    bill_key = _matcher.normalize_channel(bill_channel)
    candidate_key = _matcher.normalize_channel(candidate_channel)
    # A blank contract channel is legacy/unspecified and remains usable.  When
    # both sides are explicit, do not cross-apply a rule from another channel.
    return not (bill_key and candidate_key and bill_key != candidate_key)


def _direct_exact_rank(
    bill: dict[str, Any],
    line: dict[str, Any],
    candidates: list[dict],
) -> list[tuple[dict, dict, dict]] | None:
    partner_name = str(bill.get("partner_name") or "").strip()
    game_name = str(line.get("game_name") or "").strip()
    if not partner_name or not game_name:
        return None

    identity_candidates = [
        candidate
        for candidate in candidates
        if _exact_identity_candidate(partner_name, game_name, candidate)
    ]
    if not identity_candidates:
        return None

    compatible = [
        candidate
        for candidate in identity_candidates
        if _channel_compatible(bill.get("channel_name"), candidate.get("channel_name"))
    ]
    # An explicit channel mismatch is stronger evidence than fuzzy similarity.
    # Returning an empty exact pool prevents falling back to a wrong channel.
    if not compatible:
        return []

    ranked: list[tuple[dict, dict, dict]] = []
    cycle = line.get("settlement_cycle") or bill.get("settlement_month")
    for candidate in compatible:
        authorization_status = _matcher.authorization_relation(
            cycle,
            candidate.get("authorization_start"),
            candidate.get("authorization_end"),
        )
        if _channel._candidate_unusable_for_period(candidate, authorization_status):
            continue

        if authorization_status == "covered":
            score = 100.0
        elif authorization_status == "unknown":
            score = 90.0
        else:
            score = 70.0

        reasons = ["合作方精确命中", "游戏与商业版本精确命中"]
        if authorization_status == "covered":
            reasons.append("账期在授权期内")
        elif authorization_status == "unknown":
            reasons.append("授权期信息不完整")
        else:
            reasons.append("账期不在授权期内")
        if _matcher.normalize_channel(candidate.get("channel_name")):
            reasons.append("渠道一致")

        ranked.append(
            (
                candidate,
                {
                    "eligible": True,
                    "score": score,
                    "confidence": "high",
                    "authorization_status": authorization_status,
                    "reasons": reasons,
                    "match_method": "exact_contract_identity_v21",
                },
                _channel._rule_fields(candidate),
            )
        )

    ranked.sort(
        key=lambda item: (
            float(item[1].get("score") or 0),
            1 if item[2].get("fields_complete") else 0,
        ),
        reverse=True,
    )
    return ranked


def rank_candidates_v21(bill: dict, line: dict, candidates: list[dict]) -> list[tuple[dict, dict, dict]]:
    exact = _direct_exact_rank(bill, line, candidates)
    if exact is not None:
        return exact
    return _ORIGINAL_RANK_CANDIDATES(bill, line, candidates)


# recommend_channel_rules() looks up _rank_candidates through this module's
# globals on every call, so replacing the binding upgrades the inherited route
# without duplicating the API surface.
_channel._rank_candidates = rank_candidates_v21
