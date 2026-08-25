from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected exactly one pattern in {path}, got {count}: {old[:160]!r}")
    write(path, text.replace(old, new, 1))


# 1) Versioned schema migration. This is generic for every channel bill.
replace_once(
    "backend/app/core/migrations.py",
    '*tuple(f"{number:03d}" for number in range(1, 69)),',
    '*tuple(f"{number:03d}" for number in range(1, 70)),',
)
write(
    "backend/sql/069_channel_settlement_adjustments.sql",
    """-- Generic, opt-in bill-level settlement adjustments for channel bills.
-- Game/business line amounts remain untouched; only the final receivable changes.
ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS settlement_adjustment_type VARCHAR(40);

ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS settlement_adjustment_source_month VARCHAR(16);

ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS settlement_adjustment_amount NUMERIC(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS settlement_adjustment_reason TEXT;

ALTER TABLE channel_records
  ADD COLUMN IF NOT EXISTS settlement_final_override NUMERIC(18, 2);
""",
)

# 2) ORM fields.
replace_once(
    "backend/app/models/channel.py",
    '    settlement_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)\n    received_amount:',
    '    settlement_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)\n'
    '    settlement_adjustment_type: Mapped[str | None] = mapped_column(String(40), nullable=True)\n'
    '    settlement_adjustment_source_month: Mapped[str | None] = mapped_column(String(16), nullable=True)\n'
    '    settlement_adjustment_amount: Mapped[float] = mapped_column(Numeric(18, 2), nullable=False, default=0)\n'
    '    settlement_adjustment_reason: Mapped[str | None] = mapped_column(Text, nullable=True)\n'
    '    settlement_final_override: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)\n'
    '    received_amount:',
)

# 3) API schemas and period safety.
replace_once(
    "backend/app/schemas/channel.py",
    '    validation_tolerance: float = Field(default=0.05, ge=0, le=1000)\n    items: Annotated[list[ChannelLineItemCreate], Field(min_length=1)]',
    '    validation_tolerance: float = Field(default=0.05, ge=0, le=1000)\n'
    '    settlement_adjustment_type: str | None = None\n'
    '    settlement_adjustment_source_month: str | None = None\n'
    '    settlement_adjustment_amount: float = 0\n'
    '    settlement_adjustment_reason: str | None = None\n'
    '    settlement_final_override: float | None = Field(default=None, ge=0)\n'
    '    items: Annotated[list[ChannelLineItemCreate], Field(min_length=1)]',
)
replace_once(
    "backend/app/schemas/channel.py",
    '    def validate_settlement_month(cls, value: str | None) -> str | None:\n        return _normalize_safe_settlement_month(value)\n\n\nclass ChannelRecordUpdate',
    '    def validate_settlement_month(cls, value: str | None) -> str | None:\n'
    '        return _normalize_safe_settlement_month(value)\n\n'
    '    @field_validator("settlement_adjustment_source_month", mode="before")\n'
    '    @classmethod\n'
    '    def validate_adjustment_source_month(cls, value: str | None) -> str | None:\n'
    '        return _normalize_safe_settlement_month(value)\n\n\nclass ChannelRecordUpdate',
)
replace_once(
    "backend/app/schemas/channel.py",
    '    validation_tolerance: float | None = Field(default=None, ge=0, le=1000)\n    items: list[ChannelLineItemCreate] | None = None',
    '    validation_tolerance: float | None = Field(default=None, ge=0, le=1000)\n'
    '    settlement_adjustment_type: str | None = None\n'
    '    settlement_adjustment_source_month: str | None = None\n'
    '    settlement_adjustment_amount: float | None = None\n'
    '    settlement_adjustment_reason: str | None = None\n'
    '    settlement_final_override: float | None = Field(default=None, ge=0)\n'
    '    items: list[ChannelLineItemCreate] | None = None',
)
replace_once(
    "backend/app/schemas/channel.py",
    '    def validate_settlement_month(cls, value: str | None) -> str | None:\n        return _normalize_safe_settlement_month(value)\n\n\nclass ChannelRecordRead',
    '    def validate_settlement_month(cls, value: str | None) -> str | None:\n'
    '        return _normalize_safe_settlement_month(value)\n\n'
    '    @field_validator("settlement_adjustment_source_month", mode="before")\n'
    '    @classmethod\n'
    '    def validate_adjustment_source_month(cls, value: str | None) -> str | None:\n'
    '        return _normalize_safe_settlement_month(value)\n\n\nclass ChannelRecordRead',
)
replace_once(
    "backend/app/schemas/channel.py",
    '    settlement_amount: float\n    received_amount: float = 0',
    '    settlement_amount: float\n'
    '    settlement_adjustment_type: str | None = None\n'
    '    settlement_adjustment_source_month: str | None = None\n'
    '    settlement_adjustment_amount: float = 0\n'
    '    settlement_adjustment_reason: str | None = None\n'
    '    settlement_final_override: float | None = None\n'
    '    received_amount: float = 0',
)

# 4) Settlement engine: apply a signed bill-level adjustment without touching game lines.
replace_once(
    "backend/app/services/channel_settlement_engine.py",
    'def _money(value: Decimal) -> Decimal:\n    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)\n\n\ndef _value',
    'def _money(value: Decimal) -> Decimal:\n'
    '    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)\n\n\n'
    'def apply_bill_adjustment(\n'
    '    business_amount: Any,\n'
    '    adjustment_amount: Any = 0,\n'
    '    final_override: Any = None,\n'
    ') -> dict[str, Decimal | None]:\n'
    '    """Apply a documented bill-level adjustment without rewriting game lines.\n\n'
    '    ``adjustment_amount`` is signed: negative = deduction/carry-over, positive = top-up.\n'
    '    ``final_override`` is optional for a formally agreed final receivable.  Any\n'
    '    difference between arithmetic and that final amount is kept as an explicit tail.\n'
    '    """\n'
    '    business = _money(_d(business_amount))\n'
    '    adjustment = _money(_d(adjustment_amount))\n'
    '    calculated = _money(business + adjustment)\n'
    '    override = None if final_override in (None, "") else _money(_d(final_override))\n'
    '    final = override if override is not None else calculated\n'
    '    tail = _money(final - calculated)\n'
    '    return {\n'
    '        "business_amount": business,\n'
    '        "adjustment_amount": adjustment,\n'
    '        "calculated_amount": calculated,\n'
    '        "final_override": override,\n'
    '        "tail_amount": tail,\n'
    '        "final_amount": final,\n'
    '    }\n\n\n'
    'def _value',
)

# 5) Backend persistence/recalculation and audit reason.
replace_once(
    "backend/app/api/channel.py",
    'from app.services.channel_settlement_engine import aggregate_validation, calculate_channel_line',
    'from app.services.channel_settlement_engine import apply_bill_adjustment, aggregate_validation, calculate_channel_line',
)
replace_once(
    "backend/app/api/channel.py",
    'router = APIRouter()\nRECEIPT_EPS = 0.01\n\n\ndef _recompute_receipt_rollup',
    'router = APIRouter()\n'
    'RECEIPT_EPS = 0.01\n'
    'SETTLEMENT_ADJUSTMENT_FIELDS = {\n'
    '    "settlement_adjustment_type",\n'
    '    "settlement_adjustment_source_month",\n'
    '    "settlement_adjustment_amount",\n'
    '    "settlement_adjustment_reason",\n'
    '    "settlement_final_override",\n'
    '}\n\n\n'
    'def _validate_settlement_adjustment_values(amount, final_override, reason) -> None:\n'
    '    active = abs(float(amount or 0)) > 0.005 or final_override not in (None, "")\n'
    '    if active and not str(reason or "").strip():\n'
    '        raise HTTPException(\n'
    '            status_code=422,\n'
    '            detail={\n'
    '                "error": "settlement_adjustment_reason_required",\n'
    '                "message": "使用账单调整或最终确认金额时，必须填写调整原因以便审计。",\n'
    '            },\n'
    '        )\n\n\n'
    'def _validate_settlement_adjustment_row(row: ChannelRecord) -> None:\n'
    '    _validate_settlement_adjustment_values(\n'
    '        row.settlement_adjustment_amount,\n'
    '        row.settlement_final_override,\n'
    '        row.settlement_adjustment_reason,\n'
    '    )\n\n\n'
    'def _recompute_receipt_rollup',
)
replace_once(
    "backend/app/api/channel.py",
    '    validation = aggregate_validation(items, row)\n    row.settlement_amount = float(validation["settlement_total"])\n    row.system_settlement_amount',
    '    validation = aggregate_validation(items, row)\n'
    '    adjusted = apply_bill_adjustment(\n'
    '        validation["settlement_total"],\n'
    '        row.settlement_adjustment_amount,\n'
    '        row.settlement_final_override,\n'
    '    )\n'
    '    row.settlement_amount = float(adjusted["final_amount"])\n'
    '    row.system_settlement_amount',
)
replace_once(
    "backend/app/api/channel.py",
    'def create_channel_record(payload: ChannelRecordCreate, db: Session = Depends(get_db)) -> ChannelRecordRead:\n    if not payload.items:',
    'def create_channel_record(payload: ChannelRecordCreate, db: Session = Depends(get_db)) -> ChannelRecordRead:\n'
    '    _validate_settlement_adjustment_values(\n'
    '        payload.settlement_adjustment_amount,\n'
    '        payload.settlement_final_override,\n'
    '        payload.settlement_adjustment_reason,\n'
    '    )\n'
    '    if not payload.items:',
)
replace_once(
    "backend/app/api/channel.py",
    '    data = payload.model_dump(exclude_unset=True); items_payload = data.pop("items", None)\n    for key, value in data.items(): setattr(row, key, value)\n    row.updated_at = datetime.now(timezone.utc)\n    if items_payload is not None:\n        if not items_payload: raise HTTPException(status_code=422, detail={"error": "items_required", "message": "至少保留一行游戏明细"})\n        _replace_line_items(db, row, [ChannelLineItemCreate(**x) for x in items_payload]); _sync_denormalized_totals(row, db)',
    '    data = payload.model_dump(exclude_unset=True); items_payload = data.pop("items", None)\n'
    '    adjustment_touched = bool(SETTLEMENT_ADJUSTMENT_FIELDS.intersection(data))\n'
    '    for key, value in data.items(): setattr(row, key, value)\n'
    '    _validate_settlement_adjustment_row(row)\n'
    '    row.updated_at = datetime.now(timezone.utc)\n'
    '    if items_payload is not None:\n'
    '        if not items_payload: raise HTTPException(status_code=422, detail={"error": "items_required", "message": "至少保留一行游戏明细"})\n'
    '        _replace_line_items(db, row, [ChannelLineItemCreate(**x) for x in items_payload]); _sync_denormalized_totals(row, db)\n'
    '    elif adjustment_touched:\n'
    '        _sync_denormalized_totals(row, db)',
)

# 6) Locked bills treat adjustment fields as financial fields.
replace_once(
    "backend/app/services/bill_lifecycle.py",
    '        "profit_rate",\n        "items",\n    },',
    '        "profit_rate",\n'
    '        "settlement_adjustment_type",\n'
    '        "settlement_adjustment_source_month",\n'
    '        "settlement_adjustment_amount",\n'
    '        "settlement_adjustment_reason",\n'
    '        "settlement_final_override",\n'
    '        "items",\n'
    '    },',
)

# 7) Frontend REST mapping.
replace_once(
    "src/lib/api/channel.ts",
    '  billing_flow: number; voucher_cost: number; no_worry_cost: number; refund_cost: number; test_cost: number; welfare_cost: number; coin_cost: number; share_rate: number; billing_amount: number; share_amount: number; tax_rate: number; gateway_cost: number; settlement_amount: number;\n  received_amount:',
    '  billing_flow: number; voucher_cost: number; no_worry_cost: number; refund_cost: number; test_cost: number; welfare_cost: number; coin_cost: number; share_rate: number; billing_amount: number; share_amount: number; tax_rate: number; gateway_cost: number; settlement_amount: number;\n'
    '  settlement_adjustment_type: string | null; settlement_adjustment_source_month: string | null; settlement_adjustment_amount: number; settlement_adjustment_reason: string | null; settlement_final_override: number | null;\n'
    '  received_amount:',
)
replace_once(
    "src/lib/api/channel.ts",
    '  settlement_rule_code?: string; channel_fee_mode?: string; tax_mode?: string; validation_tolerance?: number; items: ChannelLinePayload[]',
    '  settlement_rule_code?: string; channel_fee_mode?: string; tax_mode?: string; validation_tolerance?: number;\n'
    '  settlement_adjustment_type?: string | null; settlement_adjustment_source_month?: string | null; settlement_adjustment_amount?: number; settlement_adjustment_reason?: string | null; settlement_final_override?: number | null; items: ChannelLinePayload[]',
)
replace_once(
    "src/lib/api/channel.ts",
    'settlementAmount: row.settlement_amount, receivedAmount: row.received_amount ?? 0,',
    'settlementAmount: row.settlement_amount, settlementAdjustmentType: row.settlement_adjustment_type ?? \'\', settlementAdjustmentSourceMonth: row.settlement_adjustment_source_month ?? \'\', settlementAdjustmentAmount: row.settlement_adjustment_amount ?? 0, settlementAdjustmentReason: row.settlement_adjustment_reason ?? \'\', settlementFinalOverride: row.settlement_final_override, receivedAmount: row.received_amount ?? 0,',
)
replace_once(
    "src/lib/api/channel.ts",
    'validation_tolerance: Number(record.validationTolerance || 0.05), items }',
    'validation_tolerance: Number(record.validationTolerance || 0.05), settlement_adjustment_type: textOrNull(record.settlementAdjustmentType), settlement_adjustment_source_month: textOrNull(record.settlementAdjustmentSourceMonth), settlement_adjustment_amount: Number(record.settlementAdjustmentAmount || 0), settlement_adjustment_reason: textOrNull(record.settlementAdjustmentReason), settlement_final_override: numOrNull(record.settlementFinalOverride), items }',
)

# 8) Frontend calculation: business settlement and final receivable are separate.
replace_once(
    "src/domain/channel/channelBillingForm.js",
    "  settlementRuleCode: 'legacy_fixed_fee_tax', channelFeeMode: 'fixed', taxMode: 'share', validationTolerance: '0.05'\n}",
    "  settlementRuleCode: 'legacy_fixed_fee_tax', channelFeeMode: 'fixed', taxMode: 'share', validationTolerance: '0.05',\n"
    "  settlementAdjustmentType: '', settlementAdjustmentSourceMonth: '', settlementAdjustmentAmount: '', settlementAdjustmentReason: '', settlementFinalOverride: ''\n}",
)
replace_once(
    "src/domain/channel/channelBillingForm.js",
    "  const settlementTotal = roundingTailApplied ? precisionSystemTotal : sum('settlementAmount')\n  return {",
    "  const settlementTotal = roundingTailApplied ? precisionSystemTotal : sum('settlementAmount')\n"
    "  const businessSettlementAmount = settlementTotal\n"
    "  const settlementAdjustmentAmount = round2(Number(effectiveHeader.settlementAdjustmentAmount || 0))\n"
    "  const settlementCalculatedAfterAdjustment = round2(businessSettlementAmount + settlementAdjustmentAmount)\n"
    "  const finalOverride = optionalNumber(effectiveHeader.settlementFinalOverride)\n"
    "  const finalSettlementAmount = finalOverride == null ? settlementCalculatedAfterAdjustment : round2(finalOverride)\n"
    "  const settlementAdjustmentTail = round2(finalSettlementAmount - settlementCalculatedAfterAdjustment)\n"
    "  return {",
)
replace_once(
    "src/domain/channel/channelBillingForm.js",
    "    startDate: period.startDate || effectiveHeader.startDate || '', endDate: period.endDate || effectiveHeader.endDate || '', remark: effectiveHeader.remark || '', status: effectiveHeader.status || 'pending', serverCost: parseOptionalNum(effectiveHeader.serverCost), discountType: effectiveHeader.discountType || null,",
    "    startDate: period.startDate || effectiveHeader.startDate || '', endDate: period.endDate || effectiveHeader.endDate || '', remark: effectiveHeader.remark || '', status: effectiveHeader.status || 'pending', serverCost: parseOptionalNum(effectiveHeader.serverCost), discountType: effectiveHeader.discountType || null,\n"
    "    settlementAdjustmentType: effectiveHeader.settlementAdjustmentType || '', settlementAdjustmentSourceMonth: normalizeChannelSettlementCycle(effectiveHeader.settlementAdjustmentSourceMonth), settlementAdjustmentAmount, settlementAdjustmentReason: effectiveHeader.settlementAdjustmentReason || '', settlementFinalOverride: finalOverride, businessSettlementAmount, settlementCalculatedAfterAdjustment, settlementAdjustmentTail,",
)
replace_once(
    "src/domain/channel/channelBillingForm.js",
    "systemSettlementAmount: systemTotal, platformSettlementAmount: platformTotal, settlementDifference: differenceTotal, validationStatus, settlementAmount: settlementTotal",
    "systemSettlementAmount: systemTotal, platformSettlementAmount: platformTotal, settlementDifference: differenceTotal, validationStatus, settlementAmount: finalSettlementAmount",
)
replace_once(
    "src/domain/channel/channelBillingForm.js",
    "settlementRuleCode: record.settlementRuleCode || 'legacy_fixed_fee_tax', channelFeeMode: record.channelFeeMode || 'fixed', taxMode: record.taxMode || 'share', validationTolerance: record.validationTolerance != null ? String(record.validationTolerance) : '0.05'",
    "settlementRuleCode: record.settlementRuleCode || 'legacy_fixed_fee_tax', channelFeeMode: record.channelFeeMode || 'fixed', taxMode: record.taxMode || 'share', validationTolerance: record.validationTolerance != null ? String(record.validationTolerance) : '0.05', settlementAdjustmentType: record.settlementAdjustmentType || '', settlementAdjustmentSourceMonth: normalizeChannelSettlementCycle(record.settlementAdjustmentSourceMonth), settlementAdjustmentAmount: record.settlementAdjustmentAmount != null && Number(record.settlementAdjustmentAmount) !== 0 ? String(record.settlementAdjustmentAmount) : '', settlementAdjustmentReason: record.settlementAdjustmentReason || '', settlementFinalOverride: record.settlementFinalOverride != null ? String(record.settlementFinalOverride) : ''",
)

# 9) Form UI: generic panel for every channel, inert for ordinary bills.
replace_once(
    "src/components/channel/ChannelBillingForm.jsx",
    "    settlement: previewSettlement,\n    validationStatus: fullRecord.validationStatus || 'unvalidated'",
    "    businessSettlement: Number(fullRecord.businessSettlementAmount ?? previewSettlement),\n"
    "    adjustment: Number(fullRecord.settlementAdjustmentAmount || 0),\n"
    "    afterAdjustment: Number(fullRecord.settlementCalculatedAfterAdjustment ?? previewSettlement),\n"
    "    adjustmentTail: Number(fullRecord.settlementAdjustmentTail || 0),\n"
    "    settlement: previewSettlement,\n"
    "    validationStatus: fullRecord.validationStatus || 'unvalidated'",
)
replace_once(
    "src/components/channel/ChannelBillingForm.jsx",
    "  const selectedPartner = useMemo(() => {",
    "  const adjustmentActive = Math.abs(Number(header.settlementAdjustmentAmount || 0)) > 0.0001 || String(header.settlementFinalOverride ?? '').trim() !== ''\n\n"
    "  const selectedPartner = useMemo(() => {",
)
replace_once(
    "src/components/channel/ChannelBillingForm.jsx",
    "    const nextMonths = recordMonths({ settlementMonth: fullRecord.settlementMonth, items: lines })",
    "    if (adjustmentActive && !String(header.settlementAdjustmentReason || '').trim()) {\n"
    "      const msg = '使用结算调整时必须填写调整原因，避免账单金额被无依据修改。'\n"
    "      onError?.(msg) ?? window.alert(msg); return\n"
    "    }\n\n"
    "    const nextMonths = recordMonths({ settlementMonth: fullRecord.settlementMonth, items: lines })",
)
replace_once(
    "src/components/channel/ChannelBillingForm.jsx",
    '        <div className="channel-rule-summary">',
    '''        <div style={{ marginTop: 10, border: '1px solid #dbe5f3', borderRadius: 10, padding: '10px 12px', background: '#f8fbff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 8 }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <strong style={{ fontSize: 13 }}>结算调整（通用）</strong>
              <span style={{ color: '#667085', fontSize: 11 }}>所有渠道都可用；普通账单保持为空。跨月差额、补扣、补款时才填写，不会改写上面的游戏明细。</span>
            </div>
            {adjustmentActive ? <span style={{ fontSize: 11, color: '#9a6700', background: '#fff8c5', borderRadius: 999, padding: '3px 8px' }}>已启用调整</span> : <span style={{ fontSize: 11, color: '#667085' }}>未启用</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, .8fr) minmax(125px, .7fr) minmax(140px, .8fr) minmax(150px, .8fr) minmax(220px, 1.6fr)', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 11 }}><span>调整类型</span><select className="admin-input" value={header.settlementAdjustmentType || ''} onChange={(e) => handleHeaderChange('settlementAdjustmentType', e.target.value)}><option value="">不调整</option><option value="historical_carryover">历史差额结转</option><option value="business_makeup">商务补差</option><option value="offset">补扣 / 冲抵</option><option value="other">其他</option></select></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11 }}><span>来源账期</span><input type="month" max={currentMonthKey} className="admin-input" value={normalizeChannelSettlementCycle(header.settlementAdjustmentSourceMonth)} onChange={(e) => handleHeaderChange('settlementAdjustmentSourceMonth', e.target.value)} /></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11 }}><span>调整金额（可正负）</span><input type="number" step="0.01" className="admin-input" value={header.settlementAdjustmentAmount ?? ''} onChange={(e) => handleHeaderChange('settlementAdjustmentAmount', e.target.value)} placeholder="扣减如 -498.64" /></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11 }}><span>最终确认金额（选填）</span><input type="number" step="0.01" min="0" className="admin-input" value={header.settlementFinalOverride ?? ''} onChange={(e) => handleHeaderChange('settlementFinalOverride', e.target.value)} placeholder="如双方确认 376.00" /></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11 }}><span>调整原因 {adjustmentActive ? '*' : ''}</span><input type="text" className="admin-input" value={header.settlementAdjustmentReason || ''} onChange={(e) => handleHeaderChange('settlementAdjustmentReason', e.target.value)} placeholder="例如：10月差额于12月结转，双方确认最终金额" /></label>
          </div>
          {adjustmentActive ? (
            <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12 }}>
              <span>本期业务结算 <strong>{formatMoney(totals.businessSettlement)}</strong></span>
              <span>+</span>
              <span>调整 <strong>{totals.adjustment >= 0 ? '+' : ''}{formatMoney(totals.adjustment)}</strong></span>
              <span>=</span>
              <span>计算后 <strong>{formatMoney(totals.afterAdjustment)}</strong></span>
              {String(header.settlementFinalOverride ?? '').trim() !== '' ? <><span>→</span><span>最终确认 <strong>{formatMoney(totals.settlement)}</strong></span></> : null}
              {Math.abs(totals.adjustmentTail) >= 0.005 ? <span style={{ color: '#9a6700' }}>尾差 {totals.adjustmentTail >= 0 ? '+' : ''}{formatMoney(totals.adjustmentTail)}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="channel-rule-summary">''',
)
replace_once(
    "src/components/channel/ChannelBillingForm.jsx",
    '<div className="summary-item summary-item--hero"><div className="label">实际结算金额</div><div className="value">{formatMoney(totals.settlement)}</div></div>',
    '<div className="summary-item summary-item--hero"><div className="label">{adjustmentActive ? \'最终应收\' : \'实际结算金额\'}</div><div className="value">{formatMoney(totals.settlement)}</div></div>',
)

# 10) Management analytics keep business-line settlement, while cash/outstanding use final receivable.
replace_once(
    "backend/app/services/profit_analysis.py",
    'def _channel_line_allocations(record) -> list[tuple[str, float, float, float]]:\n    """Return (game, normalized settlement, flow, allocated legacy server cost)."""\n    items = list(getattr(record, "line_items", None) or [])\n    total_settlement = abs(_num(getattr(record, "settlement_amount", 0)))',
    'def _channel_business_total(record) -> float:\n'
    '    """Business settlement before bill-level carry-over/top-up adjustments."""\n'
    '    items = list(getattr(record, "line_items", None) or [])\n'
    '    adjustment_active = (\n'
    '        abs(_num(getattr(record, "settlement_adjustment_amount", 0))) > 0.005\n'
    '        or getattr(record, "settlement_final_override", None) is not None\n'
    '    )\n'
    '    if adjustment_active and items:\n'
    '        return sum(abs(_num(getattr(line, "settlement_amount", 0))) for line in items)\n'
    '    return abs(_num(getattr(record, "settlement_amount", 0)))\n\n\n'
    'def _channel_line_allocations(record) -> list[tuple[str, float, float, float]]:\n'
    '    """Return (game, normalized settlement, flow, allocated legacy server cost)."""\n'
    '    items = list(getattr(record, "line_items", None) or [])\n'
    '    total_settlement = _channel_business_total(record)',
)
replace_once(
    "backend/app/services/profit_analysis.py",
    '        total = abs(_num(record.settlement_amount))\n        server = max(0.0, _num(record.server_cost))',
    '        total = _channel_business_total(record)\n        server = max(0.0, _num(record.server_cost))',
)
replace_once(
    "backend/app/services/monthly_business_dashboard.py",
    '            total_settlement = sum(month_settlements.values())\n            received = max(0.0, abs(_num(record.received_amount)))\n            server_cost = max(0.0, _num(record.server_cost))',
    '            total_settlement = sum(month_settlements.values())\n'
    '            final_receivable = max(0.0, abs(_num(record.settlement_amount)))\n'
    '            received = max(0.0, abs(_num(record.received_amount)))\n'
    '            final_outstanding = max(0.0, final_receivable - received)\n'
    '            server_cost = max(0.0, _num(record.server_cost))',
)
replace_once(
    "backend/app/services/monthly_business_dashboard.py",
    '                bucket.channel_outstanding += max(0.0, settlement - received * ratio)',
    '                bucket.channel_outstanding += final_outstanding * ratio',
)

# 11) Regression coverage.
replace_once(
    "backend/tests/test_channel_settlement_engine.py",
    '    ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,\n    calculate_channel_line,',
    '    ANJIU_PRE_DISCOUNT_DEDUCTION_RULE,\n    apply_bill_adjustment,\n    calculate_channel_line,',
)
replace_once(
    "backend/tests/test_channel_settlement_engine.py",
    '\n\nif __name__ == "__main__":\n    unittest.main()\n',
    '''
    def test_bill_level_adjustment_preserves_reference_and_explicit_tail(self):
        result = apply_bill_adjustment(874.60, -498.64, 376.00)
        self.assertEqual(float(result["business_amount"]), 874.60)
        self.assertEqual(float(result["adjustment_amount"]), -498.64)
        self.assertEqual(float(result["calculated_amount"]), 375.96)
        self.assertEqual(float(result["tail_amount"]), 0.04)
        self.assertEqual(float(result["final_amount"]), 376.00)

    def test_bill_level_adjustment_without_override_uses_signed_adjustment(self):
        result = apply_bill_adjustment(1000, -100, None)
        self.assertEqual(float(result["final_amount"]), 900.00)
        self.assertEqual(float(result["tail_amount"]), 0.00)


if __name__ == "__main__":
    unittest.main()
''',
)
replace_once(
    "backend/tests/test_migration_execution_context.py",
    '        self.assertIn("051_rd_contract_entry.sql", names)',
    '        self.assertIn("051_rd_contract_entry.sql", names)\n        self.assertIn("069_channel_settlement_adjustments.sql", names)',
)
write(
    "src/domain/channel/channelBillingAdjustment.test.js",
    '''import { describe, expect, it } from 'vitest'
import { buildFullChannelRecord, initialHeaderForm, initialLineItem } from './channelBillingForm.js'

describe('channel bill settlement adjustment', () => {
  it('keeps business settlement separate and exposes the signed carry-over and tail', () => {
    const record = buildFullChannelRecord(
      {
        ...initialHeaderForm,
        channelName: '通用测试渠道',
        partnerName: '通用测试合作方',
        settlementMonth: '2025-12',
        settlementRuleCode: 'share_only',
        channelFeeMode: 'none',
        taxMode: 'none',
        settlementAdjustmentType: 'historical_carryover',
        settlementAdjustmentSourceMonth: '2025-10',
        settlementAdjustmentAmount: '-498.64',
        settlementAdjustmentReason: '历史差额结转',
        settlementFinalOverride: '376.00'
      },
      [{
        ...initialLineItem(),
        settlementCycle: '2025-12',
        gameName: '测试游戏',
        flow: '874.60',
        shareRate: '100',
        taxRate: '0',
        settlementRuleCode: 'share_only',
        channelFeeMode: 'none',
        taxMode: 'none',
        platformSettlementAmount: '874.60'
      }]
    )

    expect(record.businessSettlementAmount).toBe(874.6)
    expect(record.settlementAdjustmentAmount).toBe(-498.64)
    expect(record.settlementCalculatedAfterAdjustment).toBe(375.96)
    expect(record.settlementAdjustmentTail).toBe(0.04)
    expect(record.settlementAmount).toBe(376)
  })
})
''',
)
write(
    "backend/tests/test_channel_settlement_adjustment_analytics.py",
    '''from types import SimpleNamespace
import unittest

from app.services.profit_analysis import _channel_business_total


class ChannelSettlementAdjustmentAnalyticsTests(unittest.TestCase):
    def test_adjusted_bill_keeps_business_line_total_for_profit_analysis(self):
        record = SimpleNamespace(
            settlement_amount=376.00,
            settlement_adjustment_amount=-498.64,
            settlement_final_override=376.00,
            line_items=[
                SimpleNamespace(settlement_amount=430.52),
                SimpleNamespace(settlement_amount=444.08),
            ],
        )
        self.assertAlmostEqual(_channel_business_total(record), 874.60, places=2)

    def test_normal_bill_still_uses_parent_settlement(self):
        record = SimpleNamespace(
            settlement_amount=874.60,
            settlement_adjustment_amount=0,
            settlement_final_override=None,
            line_items=[SimpleNamespace(settlement_amount=430.52), SimpleNamespace(settlement_amount=444.08)],
        )
        self.assertAlmostEqual(_channel_business_total(record), 874.60, places=2)


if __name__ == "__main__":
    unittest.main()
''',
)

print("channel settlement adjustment feature patched successfully")
