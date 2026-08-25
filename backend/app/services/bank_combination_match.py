"""银行中心主流程的精确多账单组合匹配。

该模块不写资金事实，只负责把 P2 候选中的“同合作方、多张未结金额之和 =
银行流水剩余金额”识别为一个主表候选。真正确认时仍由 bank_reconciliation_engine
重新计算组合并调用统一 P2 allocation 写入。
"""

from __future__ import annotations

from collections import defaultdict

from app.services.bank_auto_reconciliation import _normalize_party

MAX_CANDIDATES_PER_PARTNER = 18
MAX_BILLS_PER_COMBINATION = 6
MAX_EXACT_COMBINATIONS = 6
EPS_CENTS = 1


def _num(value) -> float:
    try:
        parsed = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _cents(value) -> int:
    return int(round(_num(value) * 100))


def _party_strength(counterparty: object, partner: object) -> int:
    left = _normalize_party(str(counterparty or ""))
    right = _normalize_party(str(partner or ""))
    if not left or not right:
        return 0
    if left == right:
        return 2
    if left in right or right in left:
        return 1
    return 0


def _month_rank(value: object) -> int:
    text = str(value or "").replace("年", "-").replace("月", "")
    text = text.replace("/", "-").replace(".", "-")
    parts = [part for part in text.split("-") if part]
    if len(parts) < 2:
        return 0
    try:
        return int(parts[0]) * 12 + int(parts[1])
    except (TypeError, ValueError):
        return 0


def _candidate_key(candidate: dict) -> tuple[str, str]:
    return str(candidate.get("bill_type") or ""), str(candidate.get("bill_id") or "")


def _sorted_members(items: list[dict]) -> list[dict]:
    return sorted(
        items,
        key=lambda item: (
            _month_rank(item.get("settlement_month")),
            str(item.get("bill_number") or item.get("bill_id") or ""),
        ),
    )


def _exact_pair_combinations(candidates: list[dict], target_cents: int) -> list[list[dict]]:
    """Find exact 2-bill sums across the complete partner pool.

    Two-bill settlements are common in bank receipts and can legitimately point
    to older bills that are not among the P2 dashboard's visible top candidates.
    Pair lookup is O(n²) and therefore safe to run before the bounded DFS used for
    3-6 bill combinations. This also keeps confirmation-time recomputation stable.
    """
    prepared = [
        (candidate, _cents(candidate.get("outstanding_amount")))
        for candidate in candidates
        if _cents(candidate.get("outstanding_amount")) > 0
        and _cents(candidate.get("outstanding_amount")) <= target_cents + EPS_CENTS
    ]
    found: list[list[dict]] = []
    for left_index in range(len(prepared)):
        left, left_cents = prepared[left_index]
        for right_index in range(left_index + 1, len(prepared)):
            right, right_cents = prepared[right_index]
            if abs(left_cents + right_cents - target_cents) <= EPS_CENTS:
                found.append([left, right])
                if len(found) >= MAX_EXACT_COMBINATIONS:
                    return found
    return found


def _exact_combinations(candidates: list[dict], target_cents: int) -> list[list[dict]]:
    # Always search exact pairs across the full same-partner pool first. The old
    # implementation truncated to the top 18 before searching, so historical
    # bills could disappear even when two balances added to the receipt exactly.
    pair_matches = _exact_pair_combinations(candidates, target_cents)
    if pair_matches:
        return pair_matches

    prepared = [
        (candidate, _cents(candidate.get("outstanding_amount")))
        for candidate in candidates
        if _cents(candidate.get("outstanding_amount")) > 0
        and _cents(candidate.get("outstanding_amount")) <= target_cents + EPS_CENTS
    ][:MAX_CANDIDATES_PER_PARTNER]

    found: list[list[dict]] = []
    chosen: list[tuple[dict, int]] = []

    def walk(start: int, remaining: int) -> None:
        if len(found) >= MAX_EXACT_COMBINATIONS:
            return
        if abs(remaining) <= EPS_CENTS:
            if len(chosen) >= 2:
                found.append([item[0] for item in chosen])
            return
        if remaining < -EPS_CENTS or len(chosen) >= MAX_BILLS_PER_COMBINATION:
            return

        for index in range(start, len(prepared)):
            candidate, amount_cents = prepared[index]
            if amount_cents > remaining + EPS_CENTS:
                continue
            chosen.append((candidate, amount_cents))
            walk(index + 1, remaining - amount_cents)
            chosen.pop()
            if len(found) >= MAX_EXACT_COMBINATIONS:
                return

    walk(0, target_cents)
    return found


def build_exact_combination(item: dict) -> dict | None:
    """从一笔 P2 流水候选中找唯一/最优精确多账单组合。"""
    target_cents = _cents(item.get("remaining_amount", item.get("amount")))
    if target_cents <= 0:
        return None

    direction = str(item.get("direction") or "")
    expected_type = "channel" if direction == "collection" else "rd" if direction == "payment" else ""
    if not expected_type:
        return None

    groups: dict[str, list[dict]] = defaultdict(list)
    seen: set[tuple[str, str]] = set()
    for candidate in item.get("candidates") or []:
        if str(candidate.get("bill_type") or "") != expected_type:
            continue
        key = _candidate_key(candidate)
        if not key[1] or key in seen or _cents(candidate.get("outstanding_amount")) <= 0:
            continue
        seen.add(key)
        partner_key = _normalize_party(str(candidate.get("partner_name") or ""))
        if partner_key:
            groups[partner_key].append(candidate)

    exact: list[dict] = []
    for candidates in groups.values():
        if len(candidates) < 2:
            continue
        ranked = sorted(
            candidates,
            key=lambda candidate: (
                _party_strength(item.get("counterparty_name"), candidate.get("partner_name")),
                _num(candidate.get("score")),
                _num(candidate.get("outstanding_amount")),
            ),
            reverse=True,
        )
        for members in _exact_combinations(ranked, target_cents):
            exact.append(
                {
                    "members": _sorted_members(members),
                    "party_strength": _party_strength(
                        item.get("counterparty_name"), members[0].get("partner_name")
                    ),
                }
            )
            if len(exact) >= MAX_EXACT_COMBINATIONS:
                break
        if len(exact) >= MAX_EXACT_COMBINATIONS:
            break

    if not exact:
        return None

    exact.sort(
        key=lambda combo: (
            combo["party_strength"],
            -len(combo["members"]),
            sum(_num(candidate.get("score")) for candidate in combo["members"]),
        ),
        reverse=True,
    )
    best = exact[0]
    same_rank_count = sum(
        1
        for combo in exact
        if combo["party_strength"] == best["party_strength"]
        and len(combo["members"]) == len(best["members"])
    )
    ambiguous = same_rank_count > 1

    score = 65
    reasons = [
        "多张账单未结金额之和与银行流水金额完全一致",
        "组合内账单属于同一合作方",
    ]
    if best["party_strength"] == 2:
        score += 25
        reasons.append("银行对方户名与账单合作方一致")
    elif best["party_strength"] == 1:
        score += 18
        reasons.append("银行对方户名与账单合作方高度相似")
    else:
        reasons.append("银行对方户名未形成强匹配，提交前请人工确认合作方")
    if len(best["members"]) <= 4:
        score += 5
    if ambiguous:
        score = min(score, 79)
        reasons.append("存在多个同等级精确组合，需人工选择")
    else:
        score += 5
        reasons.append("当前候选中只有一个最优精确组合")
    score = min(100, score)

    confidence = "high" if score >= 90 and not ambiguous else "medium" if score >= 70 else "low"
    partner_name = str(best["members"][0].get("partner_name") or "").strip()
    return {
        "exact": True,
        "ambiguous": ambiguous,
        "auto_ready": confidence == "high" and not ambiguous,
        "confidence_level": confidence,
        "score": score,
        "partner_name": partner_name,
        "total_amount": target_cents / 100,
        "count": len(best["members"]),
        "reasons": reasons,
        "items": [
            {
                "candidate": candidate,
                "amount": _cents(candidate.get("outstanding_amount")) / 100,
            }
            for candidate in best["members"]
        ],
    }


def _synthetic_candidate(plan: dict) -> dict:
    members = [item["candidate"] for item in plan["items"]]
    first = members[0]
    months = list(
        dict.fromkeys(
            str(member.get("settlement_month") or "").strip()
            for member in members
            if str(member.get("settlement_month") or "").strip()
        )
    )
    games = list(
        dict.fromkeys(
            str(member.get("game_name") or "").strip()
            for member in members
            if str(member.get("game_name") or "").strip()
        )
    )
    month_text = " + ".join(months)
    bill_text = " + ".join(str(member.get("bill_number") or member.get("bill_id")) for member in members)
    detail_reasons = [
        f"{member.get('bill_number') or member.get('bill_id')}：未结 ¥{_num(member.get('outstanding_amount')):.2f}"
        for member in members
    ]
    return {
        "bill_type": str(first.get("bill_type") or ""),
        # 主表兼容字段使用组合第一张账单 ID；确认接口会重新计算组合，绝不会把整笔金额写到第一张账单。
        "bill_id": str(first.get("bill_id") or ""),
        "bill_number": f"组合{plan['count']}张 · {month_text or bill_text}",
        "partner_name": plan.get("partner_name") or "",
        "settlement_month": month_text or None,
        "game_name": f"组合核销：{' / '.join(games)}" if games else "组合核销",
        "bill_amount": round(_num(plan.get("total_amount")), 2),
        "outstanding_amount": round(_num(plan.get("total_amount")), 2),
        "score": float(plan.get("score") or 0),
        "confidence_level": str(plan.get("confidence_level") or "low"),
        "reasons": list(plan.get("reasons") or []) + detail_reasons,
    }


def enrich_auto_dashboard_with_p2(
    auto_result: dict,
    p2_result: dict,
    full_pool: dict[str, list[dict]] | None = None,
) -> dict:
    """把 P2 的精确组合候选注入旧主表响应，保持现有页面/权限/确认按钮兼容。

    ``full_pool`` is used only for exact combination discovery. The visible P2
    candidate list intentionally stays short for UI usability, but an older bill
    must not disappear from combination matching merely because it ranks outside
    that visible list.
    """
    p2_map = {
        str(item.get("transaction_id") or ""): item
        for item in p2_result.get("suggestions") or []
        if item.get("transaction_id")
    }

    suggestions = list(auto_result.get("suggestions") or [])
    for item in suggestions:
        # 已经存在明确的一对一高置信证据时，一对一优先，避免组合抢占更直接的匹配。
        if item.get("auto_ready") and item.get("candidates"):
            continue
        p2_item = p2_map.get(str(item.get("transaction_id") or ""))
        if not p2_item:
            continue

        combination_item = p2_item
        if full_pool is not None:
            direction = str(p2_item.get("direction") or item.get("direction") or "")
            pool_candidates = list(full_pool.get(direction, []) or [])
            if pool_candidates:
                combination_item = {**p2_item, "candidates": pool_candidates}

        plan = build_exact_combination(combination_item)
        if not plan:
            continue
        current_top = _num(item.get("top_score"))
        if item.get("candidates") and _num(plan.get("score")) <= current_top:
            continue

        synthetic = _synthetic_candidate(plan)
        existing = [
            candidate
            for candidate in item.get("candidates") or []
            if _candidate_key(candidate) != _candidate_key(synthetic)
        ]
        second_score = _num(existing[0].get("score")) if existing else 0.0
        item["candidates"] = [synthetic, *existing[:4]]
        item["top_score"] = float(plan["score"])
        item["ambiguity_margin"] = round(float(plan["score"]) - second_score, 2)
        item["confidence_level"] = plan["confidence_level"]
        item["auto_ready"] = bool(plan["auto_ready"])
        item["blocked_reason"] = (
            "存在多个同等级精确账单组合，请使用多对多核销人工选择。"
            if plan["ambiguous"]
            else None
        )

    stats = auto_result.setdefault("stats", {})
    stats["high_confidence"] = sum(1 for item in suggestions if item.get("confidence_level") == "high")
    stats["medium_confidence"] = sum(1 for item in suggestions if item.get("confidence_level") == "medium")
    stats["unmatched"] = sum(1 for item in suggestions if item.get("confidence_level") in {"low", "none"})
    auto_result["suggestions"] = suggestions
    return auto_result