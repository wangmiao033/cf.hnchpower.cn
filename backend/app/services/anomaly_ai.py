"""可解释智能风险引擎：为异常中心生成优先级、根因、建议和公司级风险摘要。"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy.orm import Session

from app.schemas.anomaly_ai import AnomalyAiInputItem

SEVERITY_BASE = {"critical": 80, "warning": 55, "info": 30}
SEVERITY_WEIGHT = {"critical": 15, "warning": 6, "info": 2}
SYSTEM_SIGNAL_WEIGHT = {"critical": 15, "warning": 7, "info": 2}

RULE_BONUS = {
    "payment-over": 15,
    "final-but-unpaid": 15,
    "duplicate-number": 15,
    "invoice-over": 12,
    "invoice-none": 7,
    "invoice-partial": 7,
    "quicksdk-month-missing": 8,
    "contract-expired": 7,
    "contract-unlinked": 4,
    "missing-partner": 5,
    "missing-period": 5,
    "missing-number": 3,
}

RULE_ROOT_CAUSES: dict[str, list[str]] = {
    "payment-over": ["收付款登记金额可能重复录入", "银行流水与账单可能存在重复核销或金额录入错误"],
    "final-but-unpaid": ["账单状态已提前进入完成/结算阶段", "收付款登记可能缺失或尚未与账单关联"],
    "duplicate-number": ["账单编号生成或人工录入发生重复", "同一业务记录可能被重复创建"],
    "invoice-over": ["同一发票可能被重复分配", "红冲/作废发票调整后仍保留旧分配关系"],
    "invoice-none": ["账单已进入正式结算阶段但尚未完成发票关联", "进销项发票可能尚未录入系统"],
    "invoice-partial": ["发票金额不足以覆盖账单", "部分发票尚未录入或尚未分配到本账单"],
    "quicksdk-month-missing": ["对应月份 QuickSDK 流水可能漏导入", "账单结算周期可能填写错误"],
    "contract-expired": ["合作合同已到期但业务仍在继续结算", "续约合同可能尚未归档到合同中心"],
    "contract-unlinked": ["合作方名称/客户关联可能不一致", "正式合同可能尚未录入或未关联客户库"],
    "missing-partner": ["账单基础资料未补齐合作方", "导入数据未正确映射客户库"],
    "missing-period": ["结算周期未填写或格式无法识别", "多周期明细可能存在空账期"],
    "missing-number": ["账单编号未生成", "历史导入记录缺少正式编号"],
}

RULE_ACTIONS: dict[str, list[str]] = {
    "payment-over": ["先在账单360核对全部收付款记录", "检查银行核销记录是否重复；确认后撤销错误核销或修正金额"],
    "final-but-unpaid": ["核对账单360中的实际收付款记录", "若资金未结清，将账单退回待核对后再继续状态流转"],
    "duplicate-number": ["打开重复账单逐笔核对业务来源", "保留真实账单并修正/删除重复记录，随后重新生成唯一编号"],
    "invoice-over": ["进入发票中心检查同一发票的账单分配", "核对红冲/作废状态并解除多余分配"],
    "invoice-none": ["进入对应进项/销项发票中心补录发票", "完成发票与账单关联后再推进状态"],
    "invoice-partial": ["补录缺失发票或调整发票分配金额", "确认剩余缺口是否属于未开票/未收票部分"],
    "quicksdk-month-missing": ["检查数据库导入记录是否缺少该月份", "若账单月份填写错误，退回待核对后修正结算周期"],
    "contract-expired": ["确认是否已续约并补充新合同", "在合同未明确前避免继续推进最终结算"],
    "contract-unlinked": ["核对客户库名称与合同合作方", "补录合同或修复客户关联"],
    "missing-partner": ["从客户库重新选择合作方", "保存后重新运行异常巡检"],
    "missing-period": ["补齐账单/明细自己的结算周期", "多周期账单逐行确认月份后重新保存"],
    "missing-number": ["补齐正式账单编号", "检查编号生成规则是否正常"],
}

CATEGORY_ROOT_CAUSES: dict[str, list[str]] = {
    "payment": ["资金登记、账单状态与银行流水之间可能未形成闭环"],
    "invoice": ["发票录入、红冲状态或账单分配关系可能不完整"],
    "duplicate": ["业务记录存在重复创建或唯一编号控制不足"],
    "contract": ["合同有效期或合作方关联可能未及时维护"],
    "data": ["上游流水数据可能缺失、延迟或账期映射错误"],
    "quality": ["账单基础资料完整性不足，影响后续自动匹配和统计"],
}

CATEGORY_ACTIONS: dict[str, list[str]] = {
    "payment": ["优先核对资金台账和银行核销关系"],
    "invoice": ["在发票中心核对有效发票及分配覆盖"],
    "duplicate": ["先处理重复记录，再继续后续结算"],
    "contract": ["在合同中心确认当前有效合同"],
    "data": ["检查数据库导入批次和结算月份"],
    "quality": ["补齐账单基础资料后重新巡检"],
}


def _text(value: object) -> str:
    return str(value or "").strip()


def _rule_key(item: AnomalyAiInputItem) -> str:
    return _text(item.id).split(":", 1)[0]


def _amount(value: float | None) -> float:
    try:
        parsed = abs(float(value or 0))
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed == parsed else 0.0


def _amount_bonus(value: float | None) -> int:
    amount = _amount(value)
    if amount >= 1_000_000:
        return 18
    if amount >= 100_000:
        return 15
    if amount >= 10_000:
        return 10
    if amount >= 1_000:
        return 5
    return 0


def _confidence(item: AnomalyAiInputItem, rule: str) -> float:
    if rule in {"payment-over", "final-but-unpaid", "duplicate-number", "invoice-over"}:
        value = 0.92
    elif item.category in {"invoice", "data", "payment"}:
        value = 0.85
    elif item.category in {"contract", "quality"}:
        value = 0.74
    else:
        value = 0.70
    if item.bill_id:
        value += 0.02
    if _amount(item.amount) > 0:
        value += 0.02
    return round(min(0.98, value), 2)


def _unique(values: Iterable[str], limit: int = 5) -> list[str]:
    out: list[str] = []
    for raw in values:
        value = _text(raw)
        if value and value not in out:
            out.append(value)
        if len(out) >= limit:
            break
    return out


def _priority_label(score: int) -> str:
    if score >= 90:
        return "立即处理"
    if score >= 75:
        return "高优先级"
    if score >= 55:
        return "优先处理"
    if score >= 35:
        return "建议关注"
    return "低优先级"


def _health_label(score: int) -> str:
    if score >= 80:
        return "高风险"
    if score >= 55:
        return "需重点关注"
    if score >= 30:
        return "可控风险"
    return "健康"


def _exposure_amount(items: list[AnomalyAiInputItem]) -> float:
    """同一账单多条异常只取最大影响金额，避免公司风险金额重复叠加。"""
    by_bill: dict[str, float] = {}
    standalone = 0.0
    for item in items:
        amount = _amount(item.amount)
        if amount <= 0:
            continue
        if item.bill_id:
            key = f"{item.bill_type or 'bill'}:{item.bill_id}"
            by_bill[key] = max(by_bill.get(key, 0.0), amount)
        else:
            standalone += amount
    return round(sum(by_bill.values()) + standalone, 2)


def analyze_items(
    items: list[AnomalyAiInputItem],
    system_signals: list[dict] | None = None,
) -> dict:
    pending = [item for item in items if _text(item.status).lower() == "pending"]
    bill_counts = Counter(
        f"{item.bill_type or 'bill'}:{item.bill_id}" for item in pending if item.bill_id
    )
    partner_counts = Counter(_text(item.partner_name) for item in pending if _text(item.partner_name))
    month_data_counts = Counter(
        _text(item.settlement_month)
        for item in pending
        if item.category == "data" and _text(item.settlement_month)
    )

    analyses: list[dict] = []
    for item in pending:
        rule = _rule_key(item)
        score = SEVERITY_BASE.get(_text(item.severity).lower(), 45)
        score += RULE_BONUS.get(rule, 0)
        score += _amount_bonus(item.amount)
        related_signals: list[str] = []

        if item.bill_id:
            bill_key = f"{item.bill_type or 'bill'}:{item.bill_id}"
            extra = max(0, bill_counts[bill_key] - 1)
            if extra:
                score += min(15, extra * 5)
                related_signals.append(f"同一账单同时存在 {bill_counts[bill_key]} 个异常")

        partner_name = _text(item.partner_name)
        if partner_name and partner_counts[partner_name] >= 3:
            score += 5
            related_signals.append(f"合作方“{partner_name}”同时出现 {partner_counts[partner_name]} 个异常，可能是系统性问题")

        month = _text(item.settlement_month)
        if item.category == "data" and month and month_data_counts[month] >= 2:
            score += 5
            related_signals.append(f"{month} 同时出现 {month_data_counts[month]} 个数据异常，可能存在批次/数据源问题")

        score = min(100, int(round(score)))
        roots = _unique([
            *RULE_ROOT_CAUSES.get(rule, []),
            *CATEGORY_ROOT_CAUSES.get(item.category, []),
        ], limit=4)
        actions = _unique([
            *RULE_ACTIONS.get(rule, []),
            *CATEGORY_ACTIONS.get(item.category, []),
        ], limit=4)
        if not roots:
            roots = ["当前异常由账单、资金、发票、合同或数据完整性规则触发，需要结合账单360进一步核对"]
        if not actions:
            actions = ["打开关联账单360核对明细，再根据实际业务情况处理"]

        explanation = (
            f"基础级别为{item.severity or 'warning'}，"
            f"结合影响金额{f' ¥{_amount(item.amount):,.2f}' if _amount(item.amount) else ''}"
            f"和关联对象聚集度后，优先级得分为 {score}/100。"
        )
        analyses.append(
            {
                "anomaly_id": item.id,
                "priority_score": score,
                "priority_label": _priority_label(score),
                "confidence": _confidence(item, rule),
                "root_causes": roots,
                "recommended_actions": actions,
                "related_signals": related_signals,
                "explanation": explanation,
                "bill_type": item.bill_type,
                "bill_id": item.bill_id,
            }
        )

    analyses.sort(key=lambda row: (row["priority_score"], row["confidence"]), reverse=True)
    signals = list(system_signals or [])
    critical_count = sum(1 for item in pending if item.severity == "critical")
    warning_count = sum(1 for item in pending if item.severity == "warning")
    info_count = sum(1 for item in pending if item.severity == "info")
    exposure = _exposure_amount(pending)

    score = min(
        100,
        critical_count * SEVERITY_WEIGHT["critical"]
        + warning_count * SEVERITY_WEIGHT["warning"]
        + info_count * SEVERITY_WEIGHT["info"]
        + (15 if exposure >= 1_000_000 else 10 if exposure >= 100_000 else 5 if exposure >= 10_000 else 0)
        + sum(SYSTEM_SIGNAL_WEIGHT.get(_text(signal.get("severity")).lower(), 0) for signal in signals),
    )
    top_risks = _unique(
        [
            *[f"{row['priority_label']}：{next((item.title for item in pending if item.id == row['anomaly_id']), row['anomaly_id'])}" for row in analyses[:5]],
            *[signal.get("title", "") for signal in signals if signal.get("severity") in {"critical", "warning"}],
        ],
        limit=6,
    )
    top_actions = _unique(
        [
            *[action for row in analyses[:5] for action in row["recommended_actions"][:2]],
            *[signal.get("action", "") for signal in signals],
        ],
        limit=6,
    )

    if not pending and not signals:
        narrative = "当前没有待处理异常，账单、资金、发票、合同与数据巡检处于健康状态。"
    else:
        narrative = (
            f"当前有 {len(pending)} 个待处理异常，其中严重 {critical_count} 个、待处理风险 {warning_count} 个，"
            f"去重后的风险暴露金额约 ¥{exposure:,.2f}。"
        )
        if signals:
            narrative += f" 同时识别到 {len(signals)} 个经营/资金系统信号。"
        if analyses:
            narrative += f" 最高优先级 {analyses[0]['priority_score']}/100，建议先处理“{top_risks[0].split('：', 1)[-1] if top_risks else analyses[0]['anomaly_id']}”。"

    return {
        "summary": {
            "risk_score": int(score),
            "health_label": _health_label(int(score)),
            "exposure_amount": exposure,
            "critical_count": critical_count,
            "warning_count": warning_count,
            "info_count": info_count,
            "narrative": narrative,
            "top_risks": top_risks,
            "recommended_actions": top_actions,
        },
        "items": analyses,
    }


def build_system_signals(db: Session) -> list[dict]:
    signals: list[dict] = []

    try:
        from app.services.bank_auto_reconciliation import build_dashboard

        bank = build_dashboard(db, limit=200)
        stats = bank.get("stats", {})
        high = int(stats.get("high_confidence", 0) or 0)
        medium = int(stats.get("medium_confidence", 0) or 0)
        unmatched = int(stats.get("unmatched", 0) or 0)
        if high > 0:
            signals.append(
                {
                    "key": "bank-high-confidence-pending",
                    "severity": "warning" if high >= 5 else "info",
                    "title": f"有 {high} 笔高置信银行流水待确认",
                    "detail": "这些流水已达到自动核销阈值，但尚未写入正式收付款状态。",
                    "value": float(high),
                    "action": "进入银行核销，优先确认高置信匹配",
                }
            )
        if medium + unmatched >= 10:
            signals.append(
                {
                    "key": "bank-unmatched-backlog",
                    "severity": "warning",
                    "title": f"银行流水待复核积压 {medium + unmatched} 笔",
                    "detail": f"其中需复核 {medium} 笔、低置信/未匹配 {unmatched} 笔。",
                    "value": float(medium + unmatched),
                    "action": "核对合作方名称、账单编号和未结余额后处理银行流水",
                }
            )
    except Exception:
        # 银行核销表在尚未迁移的环境中可能不存在；异常分析本身必须继续可用。
        pass

    try:
        from app.services.profit_analysis import build_profit_analysis

        profit = build_profit_analysis(db, requested_month=None, trend_months=3)
        current_profit = float(profit.get("operating_profit", {}).get("value", 0) or 0)
        margin = float(profit.get("profit_margin", {}).get("value", 0) or 0)
        margin_change = float(profit.get("profit_margin", {}).get("change_amount", 0) or 0)
        selected_month = profit.get("month") or "本月"
        if current_profit < -0.01:
            signals.append(
                {
                    "key": "operating-profit-negative",
                    "severity": "critical",
                    "title": f"{selected_month} 经营利润为负",
                    "detail": f"当前管理口径经营利润 ¥{current_profit:,.2f}，利润率 {margin:.1f}%。",
                    "value": current_profit,
                    "action": "进入利润分析，按产品和费用分类定位亏损来源",
                }
            )
        elif margin_change <= -10:
            signals.append(
                {
                    "key": "profit-margin-drop",
                    "severity": "warning",
                    "title": f"{selected_month} 利润率明显下降",
                    "detail": f"当前利润率 {margin:.1f}%，较上月下降 {abs(margin_change):.1f} 个百分点。",
                    "value": margin_change,
                    "action": "检查研发成本、服务器成本和经营费用的环比变化",
                }
            )
        shared_expense = float(profit.get("shared_expense", {}).get("value", 0) or 0)
        total_expense = float(profit.get("operating_expense", {}).get("value", 0) or 0)
        if total_expense > 0 and shared_expense / total_expense >= 0.7:
            signals.append(
                {
                    "key": "shared-expense-high",
                    "severity": "info",
                    "title": "经营费用中公共费用占比较高",
                    "detail": f"公共费用 ¥{shared_expense:,.2f}，占经营费用 {shared_expense / total_expense * 100:.1f}%。",
                    "value": shared_expense,
                    "action": "如费用确实可归属具体游戏，可在利润分析中补充产品归属",
                }
            )
    except Exception:
        # 利润表/费用表尚未迁移时跳过经营信号，保留账单异常分析。
        pass

    return signals


def analyze_with_database(db: Session, items: list[AnomalyAiInputItem]) -> dict:
    signals = build_system_signals(db)
    result = analyze_items(items, system_signals=signals)
    return {
        "engine": "explainable-risk-engine",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": result["summary"],
        "system_signals": signals,
        "items": result["items"],
    }
