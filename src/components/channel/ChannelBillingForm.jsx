import React, { useEffect, useMemo, useState } from 'react'
import {
  CHANNEL_RULE_PRESETS,
  initialHeaderForm,
  initialLineItem,
  calculateBillingAmount,
  calculateShareAmount,
  calculateSettlementDetails,
  effectiveLineFlowFromFormData,
  buildFullChannelRecord,
  channelSettlementPeriodFromLines,
  channelStatusForSubmit,
  normalizeChannelSettlementCycle,
  recordToHeaderForm,
  recordToLineForms,
  applyChannelRulePreset,
  detectChannelRulePreset,
  ruleFormulaText
} from '@/domain/channel/channelBillingForm.js'
import '@/components/ChannelBilling.css'
import './ChannelSettlementRule.css'
import LineItemsTable from '@/components/shared/LineItemsTable.jsx'
import PartnerPicker, { findExactPartner } from '@/components/shared/PartnerPicker.jsx'

function formatMoney(amount) {
  const value = Number(amount || 0)
  if (Math.abs(value) >= 100000000) return `¥${(value / 100000000).toFixed(2)}亿`
  if (Math.abs(value) >= 10000) return `¥${(value / 10000).toFixed(2)}万`
  return `¥${value.toFixed(2)}`
}

function periodSummary(lines) {
  const period = channelSettlementPeriodFromLines(lines)
  if (!period.months.length) return '每行选择自己的结算月份'
  const label = (value) => String(value || '').replace('-', '.')
  if (period.months.length === 1) return `${label(period.firstMonth)} · 1个月`
  return `${label(period.firstMonth)} – ${label(period.lastMonth)} · ${period.months.length}个月`
}

function validationText(status) {
  return { pass: '一致', fail: '差异', partial: '部分校验', unvalidated: '未校验' }[status] || '未校验'
}

function ChannelBillingForm({
  formId,
  mode = 'add',
  recordId = null,
  sourceRecord = null,
  draftRecord = null,
  onAddRecord,
  onUpdateRecord,
  submitIntentRef,
  onAfterSubmit,
  onPreviewChange,
  onFormStateChange,
  onError,
  partners = [],
  onAddPartner,
  className = ''
}) {
  const [header, setHeader] = useState(initialHeaderForm)
  const [lines, setLines] = useState([initialLineItem()])
  const [partnerId, setPartnerId] = useState('')

  const fullRecord = useMemo(
    () => buildFullChannelRecord({ ...header, status: header.status || 'pending' }, lines),
    [header, lines]
  )
  const previewSettlement = Number(fullRecord.settlementAmount || 0)
  const totals = useMemo(() => ({
    rawFlow: Number(fullRecord.rawFlowTotal || 0),
    effectiveFlow: Number(fullRecord.flow || 0),
    voucher: Number(fullRecord.voucherCost || 0),
    refund: Number(fullRecord.refundCost || 0),
    system: Number(fullRecord.systemSettlementAmount || 0),
    platform: fullRecord.platformSettlementAmount,
    difference: fullRecord.settlementDifference,
    settlement: previewSettlement,
    validationStatus: fullRecord.validationStatus || 'unvalidated'
  }), [fullRecord, previewSettlement])

  const selectedPartner = useMemo(() => {
    if (partnerId) {
      const byId = (partners || []).find((partner) => String(partner?.id || '') === String(partnerId))
      if (byId) return byId
    }
    return findExactPartner(partners, header.partnerName || header.channelName)
  }, [partners, partnerId, header.partnerName, header.channelName])

  useEffect(() => { onPreviewChange?.(previewSettlement) }, [previewSettlement, onPreviewChange])

  useEffect(() => {
    const stateRecord = draftRecord || (mode === 'edit' ? sourceRecord : null)
    if (stateRecord) {
      setPartnerId('')
      setHeader(recordToHeaderForm(stateRecord))
      const lineForms = recordToLineForms(stateRecord)
      setLines(lineForms.length ? lineForms : [initialLineItem()])
      return
    }
    setHeader({ ...initialHeaderForm })
    setPartnerId('')
    setLines([{ ...initialLineItem() }])
  }, [mode, sourceRecord?.id, draftRecord])

  useEffect(() => {
    if (partnerId) return
    const matched = findExactPartner(partners, header.partnerName || header.channelName)
    if (!matched) return
    setPartnerId(String(matched.id || ''))
    setHeader((current) => ({ ...current, partnerName: current.partnerName || matched.name, channelName: current.channelName || matched.shortName || matched.name }))
  }, [partners, header.partnerName, header.channelName, partnerId])

  const handleHeaderChange = (field, value) => setHeader((current) => ({ ...current, [field]: value }))
  const handleRuleFieldChange = (field, value) => setHeader((current) => ({ ...current, settlementRuleCode: 'custom', [field]: value }))

  const handlePartnerChange = (partnerName, nextPartnerId = '', selected = null) => {
    setPartnerId(nextPartnerId)
    setHeader((current) => {
      const base = { ...current, partnerName, channelName: selected && nextPartnerId ? selected.shortName || selected.name : partnerName }
      const preset = detectChannelRulePreset(base.channelName || base.partnerName)
      return preset && mode === 'add' ? applyChannelRulePreset(base, preset) : base
    })
  }

  const handleLineChange = (index, field, value) => {
    setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row))
  }

  const addLine = () => {
    const lastCycle = normalizeChannelSettlementCycle(lines[lines.length - 1]?.settlementCycle)
    setLines((current) => [...current, { ...initialLineItem(), settlementCycle: lastCycle }])
  }
  const removeLine = (index) => setLines((current) => current.length <= 1 ? current : current.filter((_, rowIndex) => rowIndex !== index))

  const formStateRecord = useMemo(() => ({ ...fullRecord, ...(recordId != null ? { id: recordId } : {}) }), [fullRecord, recordId])
  useEffect(() => { onFormStateChange?.(formStateRecord) }, [formStateRecord, onFormStateChange])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!(header.partnerName || header.channelName)?.trim()) {
      const msg = '请填写合作方'; onError?.(msg) ?? window.alert(msg); return
    }
    for (let i = 0; i < lines.length; i += 1) {
      const row = lines[i]
      if (!normalizeChannelSettlementCycle(row.settlementCycle)) { const msg = `第 ${i + 1} 行：请选择结算月份`; onError?.(msg) ?? window.alert(msg); return }
      if (!row.gameName?.trim()) { const msg = `第 ${i + 1} 行：请填写游戏名称`; onError?.(msg) ?? window.alert(msg); return }
    }
    const intent = submitIntentRef?.current ?? 'back'
    const record = buildFullChannelRecord({ ...header, status: channelStatusForSubmit(header.status, intent) }, lines)
    try {
      if (mode === 'edit' && recordId != null) {
        const pendingResult = onUpdateRecord?.(recordId, { ...record, id: recordId })
        const result = pendingResult && typeof pendingResult.then === 'function' ? await pendingResult : pendingResult
        if (result === false) return
        onAfterSubmit?.(intent)
      } else {
        const result = onAddRecord?.(record); if (result && typeof result.then === 'function') await result
        if (intent === 'continue') { setHeader({ ...initialHeaderForm }); setPartnerId(''); setLines([{ ...initialLineItem() }]) }
        onAfterSubmit?.(intent)
      }
    } catch { return }
    if (submitIntentRef) submitIntentRef.current = 'back'
  }

  const feeMode = header.channelFeeMode || 'fixed'
  const validationTone = totals.validationStatus === 'fail' ? 'is-danger' : totals.validationStatus === 'pass' ? 'is-good' : ''

  return (
    <form id={formId} onSubmit={handleSubmit} className={`channel-form channel-form--page ${className}`}>
      <div className="channel-form-section channel-bill-meta-section">
        <div className="form-section-title">1）账单信息</div>
        <div className="channel-bill-meta-grid">
          <div className="form-group channel-bill-meta-grid__partner">
            <label>合作方 *</label>
            <PartnerPicker value={header.partnerName || header.channelName} partnerId={partnerId} partners={partners} onChange={handlePartnerChange} onAddPartner={onAddPartner} required linkedText={selectedPartner ? `已关联客户库 · 简称：${selectedPartner.shortName || selectedPartner.name}` : '已关联客户库'} unlinkedText="输入简称或公司全称，并从客户库结果中选择" />
          </div>
          <div className="form-group channel-bill-meta-grid__remark">
            <label>备注</label><input type="text" value={header.remark} onChange={(e) => handleHeaderChange('remark', e.target.value)} className="admin-input" placeholder="选填，记录发票、回款、N1/N2 或本期特殊说明" />
          </div>
        </div>

        <section className="channel-rule-panel">
          <div className="channel-rule-panel__head">
            <div><span>结算规则引擎</span><strong>明确区分百分比渠道费和固定通道费</strong></div>
            <small>平台结算额填入后作为实际应收；系统计算用于校验。超过容差的账单可以保存，但不能确认核对。</small>
          </div>
          <div className="channel-rule-grid">
            <label><span>规则模板</span><select value={header.settlementRuleCode} onChange={(e) => setHeader((current) => applyChannelRulePreset(current, e.target.value))}>{Object.entries(CHANNEL_RULE_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}</select></label>
            <label><span>渠道费模式</span><select value={header.channelFeeMode} onChange={(e) => handleRuleFieldChange('channelFeeMode', e.target.value)}><option value="none">不扣渠道费</option><option value="percent">百分比</option><option value="fixed">固定金额/行</option></select></label>
            <label><span>渠道费率%</span><input type="number" step="0.01" min="0" max="100" value={header.channelFeeRate} disabled={feeMode !== 'percent'} onChange={(e) => handleRuleFieldChange('channelFeeRate', e.target.value)} placeholder={feeMode === 'percent' ? '如 5' : '当前不使用'} /></label>
            <label><span>税处理</span><select value={header.taxMode} onChange={(e) => handleRuleFieldChange('taxMode', e.target.value)}><option value="none">仅记录，不参与</option><option value="share">按分成额扣税</option><option value="after_fee">渠道费后再扣税</option></select></label>
            <label><span>差异容差（元）</span><input type="number" step="0.01" min="0" value={header.validationTolerance} onChange={(e) => handleRuleFieldChange('validationTolerance', e.target.value)} /></label>
          </div>
          <div className="channel-rule-formula"><span>当前公式</span><strong>{ruleFormulaText(header)}</strong></div>
        </section>
      </div>

      <div className="channel-form-section">
        <div className="form-section-title channel-bill-detail-title"><span>2）游戏明细</span><span className="channel-bill-period-badge">{periodSummary(lines)}</span></div>
        <LineItemsTable onAddRow={addLine} showAddButton={false} hint="每行可填平台账单的最终结算金额。系统金额与平台金额差异超过容差时会标红并阻止确认核对。">
          <table className="channel-line-items-table">
            <thead><tr><th>结算月份</th><th>游戏名称</th><th>后台流水</th><th>折扣系数</th><th>总流水</th><th>代金券</th><th>无忧试</th><th>玩家退款</th><th>测试费</th><th>福利币</th><th>其他扣减</th><th>分成%</th><th>税率%</th><th>{feeMode === 'fixed' ? '固定通道费' : '通道费'}</th><th>计费额</th><th>分成额</th><th>系统结算</th><th>平台结算</th><th>差异</th><th>校验</th><th>操作</th></tr></thead>
            <tbody>{lines.map((row, index) => {
              const details = calculateSettlementDetails(row, header)
              return (
                <tr key={row.id || `line-${index}`}>
                  <td style={{ minWidth: 132 }}><input type="month" className="admin-input" value={normalizeChannelSettlementCycle(row.settlementCycle)} onChange={(e) => handleLineChange(index, 'settlementCycle', e.target.value)} required /></td>
                  <td><input type="text" className="admin-input" value={row.gameName} onChange={(e) => handleLineChange(index, 'gameName', e.target.value)} placeholder="必填" /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.flow} onChange={(e) => handleLineChange(index, 'flow', e.target.value)} /></td>
                  <td><input type="number" step="0.000001" min="0" className="admin-input" value={row.discountFactor} onChange={(e) => handleLineChange(index, 'discountFactor', e.target.value)} placeholder="默认1" /></td>
                  <td className="channel-line-num">{effectiveLineFlowFromFormData(row).toFixed(2)}</td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.voucherCost} onChange={(e) => handleLineChange(index, 'voucherCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.noWorryCost} onChange={(e) => handleLineChange(index, 'noWorryCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.refundCost} onChange={(e) => handleLineChange(index, 'refundCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.testCost} onChange={(e) => handleLineChange(index, 'testCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.welfareCost} onChange={(e) => handleLineChange(index, 'welfareCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.coinCost} onChange={(e) => handleLineChange(index, 'coinCost', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.shareRate} onChange={(e) => handleLineChange(index, 'shareRate', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.taxRate} onChange={(e) => handleLineChange(index, 'taxRate', e.target.value)} /></td>
                  <td><input type="number" step="0.01" className="admin-input" value={row.gatewayCost} disabled={feeMode !== 'fixed'} onChange={(e) => handleLineChange(index, 'gatewayCost', e.target.value)} placeholder={feeMode === 'fixed' ? '元' : '由规则计算'} /></td>
                  <td className="channel-line-num">{formatMoney(calculateBillingAmount(row))}</td>
                  <td className="channel-line-num">{formatMoney(calculateShareAmount(row))}</td>
                  <td className="channel-system-amount">{formatMoney(details.systemSettlementAmount)}</td>
                  <td><input type="number" step="0.01" className="admin-input channel-platform-input" value={row.platformSettlementAmount} onChange={(e) => handleLineChange(index, 'platformSettlementAmount', e.target.value)} placeholder="平台账单金额" /></td>
                  <td className={`channel-line-diff is-${details.validationStatus}`}>{details.settlementDifference == null ? '-' : `${details.settlementDifference >= 0 ? '+' : ''}${formatMoney(details.settlementDifference)}`}</td>
                  <td><span className={`channel-validation-badge is-${details.validationStatus}`}>{validationText(details.validationStatus)}</span></td>
                  <td><button type="button" className="rec-btn rec-btn--ghost rec-btn--small" onClick={addLine}>+</button><button type="button" className="rec-btn rec-btn--ghost rec-btn--small" onClick={() => removeLine(index)} disabled={lines.length <= 1}>-</button></td>
                </tr>
              )
            })}</tbody>
          </table>
        </LineItemsTable>
      </div>

      <div className="channel-form-section">
        <div className="form-section-title">3）汇总</div>
        <div className="channel-line-items-summary channel-line-items-summary--channel">
          <div className="summary-item summary-item--accent"><div className="label">原始后台流水</div><div className="value">{formatMoney(totals.rawFlow)}</div></div>
          <div className="summary-item summary-item--accent"><div className="label">折算后总流水</div><div className="value">{formatMoney(totals.effectiveFlow)}</div></div>
          <div className="summary-item"><div className="label">总代金券</div><div className="value">{formatMoney(totals.voucher)}</div></div>
          <div className="summary-item"><div className="label">总退款</div><div className="value">{formatMoney(totals.refund)}</div></div>
          <div className="summary-item summary-item--hero"><div className="label">实际结算金额</div><div className="value">{formatMoney(totals.settlement)}</div></div>
        </div>
        <div className="channel-rule-summary">
          <div><span>系统计算合计</span><strong>{formatMoney(totals.system)}</strong></div>
          <div><span>平台结算合计</span><strong>{totals.platform == null ? '未录入' : formatMoney(totals.platform)}</strong></div>
          <div className={validationTone}><span>系统 - 平台</span><strong>{totals.difference == null ? '-' : `${totals.difference >= 0 ? '+' : ''}${formatMoney(totals.difference)}`}</strong></div>
          <div className={validationTone}><span>校验状态</span><strong>{validationText(totals.validationStatus)}</strong></div>
          <div><span>允许误差</span><strong>±{formatMoney(header.validationTolerance)}</strong></div>
        </div>
      </div>
    </form>
  )
}

export default ChannelBillingForm
