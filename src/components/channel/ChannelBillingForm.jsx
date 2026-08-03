import React, { useEffect, useMemo, useState } from 'react'
import {
  initialHeaderForm,
  initialLineItem,
  calculateBillingAmount,
  calculateShareAmount,
  calculateSettlement,
  effectiveLineFlowFromFormData,
  buildFullChannelRecord,
  channelStatusForSubmit,
  recordToHeaderForm,
  recordToLineForms
} from '@/domain/channel/channelBillingForm.js'
import '@/components/ChannelBilling.css'
import LineItemsTable from '@/components/shared/LineItemsTable.jsx'
import PartnerPicker, { findExactPartner } from '@/components/shared/PartnerPicker.jsx'

function formatCycleFromMonth(rawMonth) {
  const text = String(rawMonth || '').trim()
  const m = text.match(/^(\d{4})-(\d{1,2})$/)
  if (!m) return text
  return `${m[1]}年${Number(m[2])}月`
}

function monthFromCycle(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  let m = text.match(/^(\d{4})年(\d{1,2})月?$/)
  if (m) return `${m[1]}-${String(Math.min(Math.max(Number(m[2]), 1), 12)).padStart(2, '0')}`
  m = text.match(/^(\d{4})-(\d{1,2})$/)
  if (m) return `${m[1]}-${String(Math.min(Math.max(Number(m[2]), 1), 12)).padStart(2, '0')}`
  return ''
}

function monthDateRange(rawMonth) {
  const match = String(rawMonth || '').match(/^(\d{4})-(\d{2})$/)
  if (!match) return { startDate: '', endDate: '' }
  const year = Number(match[1])
  const month = Number(match[2])
  const lastDay = new Date(year, month, 0).getDate()
  return {
    startDate: `${match[1]}-${match[2]}-01`,
    endDate: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`
  }
}

function formatMoney(amount) {
  if (amount >= 100000000) {
    return `¥${(amount / 100000000).toFixed(2)}亿`
  }
  if (amount >= 10000) {
    return `¥${(amount / 10000).toFixed(2)}万`
  }
  return `¥${Number(amount).toFixed(2)}`
}

function updateLineField(lines, index, field, value) {
  const next = lines.map((row, i) => (i === index ? { ...row, [field]: value } : { ...row }))
  const row = next[index]
  if (field === 'settlementAmount') {
    return next
  }
  if (
    [
      'flow',
      'discountFactor',
      'voucherCost',
      'noWorryCost',
      'refundCost',
      'testCost',
      'welfareCost',
      'shareRate',
      'taxRate',
      'gatewayCost'
    ].includes(field)
  ) {
    const settlement = calculateSettlement(row)
    next[index] = { ...row, settlementAmount: settlement.toFixed(2) }
  }
  return next
}

function ChannelBillingForm({
  formId,
  mode = 'add',
  recordId = null,
  sourceRecord = null,
  onAddRecord,
  onUpdateRecord,
  submitIntentRef,
  onAfterSubmit,
  onPreviewChange,
  onError,
  partners = [],
  onAddPartner,
  className = ''
}) {
  const [header, setHeader] = useState(initialHeaderForm)
  const [lines, setLines] = useState([initialLineItem()])
  const [partnerId, setPartnerId] = useState('')

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, row) => {
        const rawFlow = parseFloat(row.flow || 0)
        const effFlow = effectiveLineFlowFromFormData(row)
        const voucher = parseFloat(row.voucherCost || 0)
        const refund = parseFloat(row.refundCost || 0)
        const settlement = parseFloat(row.settlementAmount || 0)
        return {
          rawFlow: acc.rawFlow + rawFlow,
          effectiveFlow: acc.effectiveFlow + effFlow,
          voucher: acc.voucher + voucher,
          refund: acc.refund + refund,
          settlement: acc.settlement + (Number.isFinite(settlement) ? settlement : 0)
        }
      },
      { rawFlow: 0, effectiveFlow: 0, voucher: 0, refund: 0, settlement: 0 }
    )
  }, [lines])

  const previewSettlement = useMemo(() => totals.settlement, [totals.settlement])
  const selectedPartner = useMemo(() => {
    if (partnerId) {
      const byId = (partners || []).find(
        (partner) => String(partner?.id || '') === String(partnerId)
      )
      if (byId) return byId
    }
    return findExactPartner(partners, header.partnerName || header.channelName)
  }, [partners, partnerId, header.partnerName, header.channelName])

  useEffect(() => {
    onPreviewChange?.(previewSettlement)
  }, [previewSettlement, onPreviewChange])

  useEffect(() => {
    if (mode === 'edit' && sourceRecord) {
      const nextHeader = recordToHeaderForm(sourceRecord)
      setPartnerId('')
      const lf = recordToLineForms(sourceRecord)
      const settlementMonth = nextHeader.settlementMonth || monthFromCycle(lf[0]?.settlementCycle)
      const dateRange = monthDateRange(settlementMonth)
      const defaultCycle = formatCycleFromMonth(settlementMonth)
      setHeader({ ...nextHeader, settlementMonth, ...dateRange })
      setLines(
        lf.length
          ? lf.map((line) => ({ ...line, settlementCycle: defaultCycle }))
          : [{ ...initialLineItem(), settlementCycle: defaultCycle }]
      )
    }
    if (mode === 'add') {
      setHeader({ ...initialHeaderForm })
      setPartnerId('')
      setLines([{ ...initialLineItem() }])
    }
  }, [mode, sourceRecord?.id])

  useEffect(() => {
    if (partnerId) return
    const matched = findExactPartner(partners, header.partnerName || header.channelName)
    if (!matched) return
    setPartnerId(String(matched.id || ''))
    setHeader((current) => ({
      ...current,
      partnerName: current.partnerName || matched.name,
      channelName: current.channelName || matched.shortName || matched.name
    }))
  }, [partners, header.partnerName, header.channelName, partnerId])

  const handleHeaderChange = (field, value) => {
    if (field === 'settlementMonth') {
      const dateRange = monthDateRange(value)
      const settlementCycle = formatCycleFromMonth(value)
      setHeader((h) => ({ ...h, settlementMonth: value, ...dateRange }))
      setLines((prev) => prev.map((line) => ({ ...line, settlementCycle })))
      return
    }
    setHeader((h) => ({ ...h, [field]: value }))
  }

  const handlePartnerChange = (partnerName, nextPartnerId = '', selectedPartner = null) => {
    setPartnerId(nextPartnerId)
    setHeader((current) => ({
      ...current,
      partnerName,
      channelName:
        selectedPartner && nextPartnerId
          ? selectedPartner.shortName || selectedPartner.name
          : partnerName
    }))
  }

  const handleLineChange = (index, field, value) => {
    setLines((prev) => updateLineField(prev, index, field, value))
  }

  const addLine = () => {
    const defaultCycle = formatCycleFromMonth(header.settlementMonth)
    setLines((prev) => [...prev, { ...initialLineItem(), settlementCycle: defaultCycle }])
  }

  const removeLine = (index) => {
    setLines((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!(header.partnerName || header.channelName)?.trim()) {
      const msg = '请填写合作方'
      onError?.(msg) ?? window.alert(msg)
      return
    }

    if (!header.settlementMonth) {
      const msg = '请选择账单月份'
      onError?.(msg) ?? window.alert(msg)
      return
    }

    for (let i = 0; i < lines.length; i += 1) {
      const row = lines[i]
      if (!row.gameName?.trim()) {
        const msg = `第 ${i + 1} 行：请填写游戏名称`
        onError?.(msg) ?? window.alert(msg)
        return
      }
    }

    const dateRange = monthDateRange(header.settlementMonth)
    const settlementCycle = formatCycleFromMonth(header.settlementMonth)
    const intent = submitIntentRef?.current ?? 'back'
    const record = buildFullChannelRecord(
      {
        ...header,
        ...dateRange,
        status: channelStatusForSubmit(header.status, intent)
      },
      lines.map((line) => ({ ...line, settlementCycle }))
    )

    try {
      if (mode === 'edit' && recordId != null) {
        const pendingResult = onUpdateRecord?.(recordId, { ...record, id: recordId })
        const result = pendingResult && typeof pendingResult.then === 'function'
          ? await pendingResult
          : pendingResult
        if (result === false) return
        onAfterSubmit?.(intent)
      } else {
        const res = onAddRecord?.(record)
        if (res && typeof res.then === 'function') await res
        if (intent === 'continue') {
          setHeader({ ...initialHeaderForm })
          setPartnerId('')
          setLines([{ ...initialLineItem() }])
        }
        onAfterSubmit?.(intent)
      }
    } catch {
      return
    }

    if (submitIntentRef) submitIntentRef.current = 'back'
  }

  return (
    <form id={formId} onSubmit={handleSubmit} className={`channel-form channel-form--page ${className}`}>
      <div className="channel-form-section channel-bill-meta-section">
      <div className="form-section-title">1）账单信息</div>
      <div className="channel-bill-meta-grid">
        <div className="form-group channel-bill-meta-grid__partner">
          <label>合作方 *</label>
          <PartnerPicker
            value={header.partnerName || header.channelName}
            partnerId={partnerId}
            partners={partners}
            onChange={handlePartnerChange}
            onAddPartner={onAddPartner}
            required
            linkedText={
              selectedPartner
                ? `已关联客户库 · 简称：${selectedPartner.shortName || selectedPartner.name}`
                : '已关联客户库'
            }
            unlinkedText="输入简称或公司全称，并从客户库结果中选择"
          />
        </div>
        <div className="form-group">
          <label>账单月份 *</label>
          <input
            type="month"
            value={header.settlementMonth}
            onChange={(e) => handleHeaderChange('settlementMonth', e.target.value)}
            className="admin-input"
            required
          />
          <div className="channel-bill-period-help">
            {header.startDate && header.endDate
              ? `账期 ${header.startDate} 至 ${header.endDate}`
              : '选择月份后自动生成整月账期'}
          </div>
        </div>
        <div className="form-group channel-bill-meta-grid__remark">
          <label>备注</label>
          <input
            type="text"
            value={header.remark}
            onChange={(e) => handleHeaderChange('remark', e.target.value)}
            className="admin-input"
            placeholder="选填，记录发票、回款或本期特殊说明"
          />
        </div>
      </div>
      </div>

      <div className="channel-form-section">
      <div className="form-section-title channel-bill-detail-title">
        <span>2）游戏明细</span>
        <span className="channel-bill-period-badge">
          {header.settlementMonth ? formatCycleFromMonth(header.settlementMonth) : '请先选择账单月份'}
        </span>
      </div>
      <LineItemsTable
        onAddRow={addLine}
        showAddButton={false}
        hint="折扣系数仅填数字（如 0.005 表示 0.05 折）。结算与导出均以「折算后总流水」为准。"
      >
        <table className="channel-line-items-table">
          <thead>
            <tr>
              <th>游戏名称</th>
              <th>后台流水</th>
              <th>折扣系数</th>
              <th>总流水</th>
              <th>代金券</th>
              <th>无忧试</th>
              <th>玩家退款</th>
              <th>测试费</th>
              <th>福利币</th>
              <th>分成%</th>
              <th>税率%</th>
              <th>通道费</th>
              <th>计费额</th>
              <th>分成额</th>
              <th>结算额</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((row, index) => (
              <tr key={row.id || `line-${index}`}>
                <td>
                  <input
                    type="text"
                    className="admin-input"
                    value={row.gameName}
                    onChange={(e) => handleLineChange(index, 'gameName', e.target.value)}
                    placeholder="必填"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="admin-input"
                    value={row.flow}
                    onChange={(e) => handleLineChange(index, 'flow', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.000001"
                    min="0"
                    className="admin-input"
                    value={row.discountFactor}
                    onChange={(e) => handleLineChange(index, 'discountFactor', e.target.value)}
                    placeholder="默认1；0.05折填0.005"
                    title="仅填数字。0.05折请填 0.005，0.1折请填 0.01"
                  />
                </td>
                <td className="channel-line-num" title="后台流水×折扣系数">
                  {effectiveLineFlowFromFormData(row).toFixed(2)}
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="admin-input"
                    value={row.voucherCost}
                    onChange={(e) => handleLineChange(index, 'voucherCost', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="admin-input"
                    value={row.noWorryCost}
                    onChange={(e) => handleLineChange(index, 'noWorryCost', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="admin-input"
                    value={row.refundCost}
                    onChange={(e) => handleLineChange(index, 'refundCost', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="admin-input"
                    value={row.testCost}
                    onChange={(e) => handleLineChange(index, 'testCost', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="admin-input"
                    value={row.welfareCost}
                    onChange={(e) => handleLineChange(index, 'welfareCost', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="admin-input"
                    value={row.shareRate}
                    onChange={(e) => handleLineChange(index, 'shareRate', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="admin-input"
                    value={row.taxRate}
                    onChange={(e) => handleLineChange(index, 'taxRate', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="admin-input"
                    value={row.gatewayCost}
                    onChange={(e) => handleLineChange(index, 'gatewayCost', e.target.value)}
                  />
                </td>
                <td className="channel-line-num">{formatMoney(calculateBillingAmount(row))}</td>
                <td className="channel-line-num">{formatMoney(calculateShareAmount(row))}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    className="admin-input"
                    value={row.settlementAmount}
                    onChange={(e) => handleLineChange(index, 'settlementAmount', e.target.value)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="rec-btn rec-btn--ghost rec-btn--small"
                    onClick={addLine}
                    title="新增一行游戏"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="rec-btn rec-btn--ghost rec-btn--small"
                    onClick={() => removeLine(index)}
                    disabled={lines.length <= 1}
                    title="删除一行游戏"
                  >
                    -
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LineItemsTable>
      </div>

      <div className="channel-form-section">
      <div className="form-section-title">3）汇总</div>
      <div className="channel-line-items-summary channel-line-items-summary--channel">
        <div className="summary-item summary-item--accent">
          <div className="label">原始后台流水</div>
          <div className="value">{formatMoney(totals.rawFlow)}</div>
        </div>
        <div className="summary-item summary-item--accent">
          <div className="label">折算后总流水</div>
          <div className="value">{formatMoney(totals.effectiveFlow)}</div>
        </div>
        <div className="summary-item">
          <div className="label">总代金券</div>
          <div className="value">{formatMoney(totals.voucher)}</div>
        </div>
        <div className="summary-item">
          <div className="label">总退款</div>
          <div className="value">{formatMoney(totals.refund)}</div>
        </div>
        <div className="summary-item summary-item--hero">
          <div className="label">总结算金额</div>
          <div className="value">{formatMoney(totals.settlement)}</div>
        </div>
      </div>
      </div>
    </form>
  )
}

export default ChannelBillingForm
