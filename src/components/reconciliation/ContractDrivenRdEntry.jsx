import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReconciliationLineItemsForm from './ReconciliationLineItemsForm.jsx'
import { calculateRdSettlementRow } from '@/domain/settlement/calculateSettlementAmount.js'
import { nextSettlementNumberForRecord } from '@/utils/settlementNumber.js'
import {
  finalizeRdContractEntry,
  getLatestRdContractEntry,
  prepareRdContractEntry,
  recommendRdContractRules
} from '@/lib/api/rdContractEntry.ts'
import './ContractDrivenRdEntry.css'

const EPS = 0.0001

function num(value, fallback = 0) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sameNumber(left, right, tolerance = EPS) {
  if (left === null || left === undefined || right === null || right === undefined) return true
  return Math.abs(num(left) - num(right)) <= tolerance
}

function money(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '-'
  return `¥${parsed.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function basisLabel(value) {
  if (value === 'actual_paid') return '按实付 / 实收'
  if (value === 'discounted_flow') return '按折后流水'
  return '结算基数待确认'
}

function matchTone(line) {
  if (!line?.match) return 'none'
  if (line.auto_apply) return 'pass'
  if (line.match.authorization_status === 'out_of_range') return 'fail'
  return 'warning'
}

function lineIdentity(partner, line, index) {
  return [partner || '', line?.gameName || '', line?.settlementCycle || '', index].join('|')
}

function buildRequestLines(record, productDiscountRefs, previousRecommendation) {
  const items = Array.isArray(record?.items) ? record.items : []
  const headerFee = num(record?.channelFeeRate)
  return items.map((line, index) => {
    const identity = lineIdentity(record?.partner, line, index)
    const previous = previousRecommendation?.lines?.find((item) => item.line_index === index)
    const currentDiscount = num(line?.discountRate, 1)
    let productDiscount = currentDiscount
    if (previous?.recommended?.basis_mode === 'actual_paid' && productDiscountRefs.current[identity] != null) {
      productDiscount = productDiscountRefs.current[identity]
    } else {
      productDiscountRefs.current[identity] = currentDiscount
    }
    const calc = calculateRdSettlementRow(line, headerFee)
    return {
      line_index: index,
      line_id: String(line?.id || ''),
      game_name: String(line?.gameName || '').trim(),
      settlement_cycle: String(line?.settlementCycle || record?.settlementMonth || '').trim(),
      revenue: num(line?.revenue),
      discount_rate: productDiscount,
      coupon_amount: num(line?.couponAmount),
      test_fee: num(line?.testFee),
      extra_fee: num(line?.extraFee),
      share_ratio: num(line?.shareRatio),
      tax_rate: num(line?.taxRate),
      channel_fee_rate: headerFee,
      settlement_amount: calc.settlementAmount
    }
  })
}

function recommendationMatchesRecord(record, recommendation) {
  if (!record || !recommendation) return false
  if (String(recommendation.partner_name || '').trim() !== String(record.partner || '').trim()) return false
  const rows = Array.isArray(record.items) ? record.items : []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const game = String(row?.gameName || '').trim()
    if (!game) continue
    const cycle = String(row?.settlementCycle || record.settlementMonth || '').trim()
    const matched = recommendation.lines?.find((item) => item.line_index === index)
    if (!matched) return false
    if (String(matched.game_name || '').trim() !== game) return false
    if (String(matched.settlement_cycle || '').trim() !== cycle) return false
  }
  return true
}

function deviationsFor(record, lineIndex, recommendationLine) {
  const line = Array.isArray(record?.items) ? record.items[lineIndex] : null
  const recommended = recommendationLine?.recommended
  if (!line || !recommendationLine?.auto_apply || !recommended) return []
  const out = []
  if (recommended.share_ratio != null && !sameNumber(line.shareRatio, recommended.share_ratio)) out.push('分成比例')
  if (recommended.tax_rate != null && !sameNumber(line.taxRate, recommended.tax_rate)) out.push('税率')
  if (recommended.test_fee != null && !sameNumber(line.testFee, recommended.test_fee, 0.01)) out.push('测试费')
  if (recommended.channel_fee_rate != null && !sameNumber(record?.channelFeeRate, recommended.channel_fee_rate)) out.push('通道费率')
  if (recommended.basis_mode !== 'ambiguous' && !sameNumber(line.discountRate, recommended.settlement_discount_rate, 0.000001)) {
    out.push('结算系数')
  }
  return out
}

function applyRecommendationToRecord(record, recommendation, productDiscountRefs) {
  if (!record || !recommendation) return record
  const rows = Array.isArray(record.items) ? record.items : []
  const nextItems = rows.map((row, index) => {
    const item = recommendation.lines?.find((candidate) => candidate.line_index === index)
    if (!item?.auto_apply || !item.recommended) return row
    const rec = item.recommended
    const identity = lineIdentity(record.partner, row, index)
    if (productDiscountRefs.current[identity] == null) {
      productDiscountRefs.current[identity] = num(row.discountRate, 1)
    }
    return {
      ...row,
      shareRatio: rec.share_ratio != null ? String(rec.share_ratio) : row.shareRatio,
      taxRate: rec.tax_rate != null ? String(rec.tax_rate) : row.taxRate,
      testFee: rec.test_fee != null ? String(rec.test_fee) : row.testFee,
      discountRate:
        rec.basis_mode !== 'ambiguous'
          ? String(rec.settlement_discount_rate)
          : row.discountRate
    }
  })
  const header = recommendation.header_recommendation
  const nextFee = header?.compatible && header.channel_fee_rate != null
    ? String(header.channel_fee_rate)
    : String(record.channelFeeRate ?? '0')
  return {
    ...record,
    channelFeeRate: nextFee,
    items: nextItems,
    taxPoint: nextItems[0]?.taxRate ?? record.taxPoint,
    revenueShareRatio: nextItems[0]?.shareRatio ?? record.revenueShareRatio,
    discount: nextItems[0]?.discountRate ?? record.discount
  }
}

export default function ContractDrivenRdEntry(props) {
  const {
    mode = 'add',
    editRecord,
    draftRecord,
    quickFillData,
    onFormStateChange,
    onAddRecord,
    onUpdateRecord,
    onError,
    existingRecords = [],
    settlementNumberFormat,
    ...rest
  } = props
  const [formState, setFormState] = useState(draftRecord || editRecord || null)
  const [recommendation, setRecommendation] = useState(null)
  const [recommendationLoading, setRecommendationLoading] = useState(false)
  const [recommendationError, setRecommendationError] = useState('')
  const [contractQuickFill, setContractQuickFill] = useState(null)
  const [contractDraftOverride, setContractDraftOverride] = useState(null)
  const [overrideReasons, setOverrideReasons] = useState({})
  const [snapshotInfo, setSnapshotInfo] = useState(null)
  const productDiscountRefs = useRef({})
  const recommendationRef = useRef(null)
  const lastRequestSignatureRef = useRef('')
  const lastAppliedSignatureRef = useRef('')
  const requestSeqRef = useRef(0)

  useEffect(() => {
    recommendationRef.current = recommendation
  }, [recommendation])

  useEffect(() => {
    setContractDraftOverride(null)
    setSnapshotInfo(null)
    setOverrideReasons({})
    productDiscountRefs.current = {}
    lastAppliedSignatureRef.current = ''
    lastRequestSignatureRef.current = ''
  }, [editRecord?.id])

  useEffect(() => {
    if (mode !== 'edit' || !editRecord?.id) return undefined
    let active = true
    void getLatestRdContractEntry(String(editRecord.id))
      .then((snapshot) => {
        if (!active) return
        setSnapshotInfo(snapshot)
        const reasons = {}
        for (const item of snapshot?.metadata || []) {
          const index = Number(item?.line_index)
          if (Number.isFinite(index) && item?.override_reason) reasons[index] = String(item.override_reason)
          const recordLine = editRecord?.items?.[index]
          const identity = lineIdentity(editRecord?.partner, recordLine, index)
          if (Number.isFinite(index) && item?.product_discount_reference != null) {
            productDiscountRefs.current[identity] = Number(item.product_discount_reference)
          }
        }
        setOverrideReasons(reasons)
      })
      .catch(() => {})
    return () => { active = false }
  }, [editRecord?.id, editRecord?.items, editRecord?.partner, mode])

  const handleFormStateChange = useCallback((record) => {
    setFormState(record)
    onFormStateChange?.(record)
  }, [onFormStateChange])

  useEffect(() => {
    const partner = String(formState?.partner || '').trim()
    const items = Array.isArray(formState?.items) ? formState.items : []
    const usable = items.filter((line) => String(line?.gameName || '').trim())
    if (!partner || usable.length === 0) {
      setRecommendation(null)
      setRecommendationError('')
      setRecommendationLoading(false)
      lastRequestSignatureRef.current = ''
      return undefined
    }

    const requestLines = buildRequestLines(formState, productDiscountRefs, recommendationRef.current)
      .filter((line) => line.game_name)
    const signature = JSON.stringify({
      partner,
      lines: requestLines.map((line) => ({
        i: line.line_index,
        g: line.game_name,
        c: line.settlement_cycle,
        r: line.revenue,
        d: line.discount_rate,
        cp: line.coupon_amount,
        e: line.extra_fee
      }))
    })
    if (signature === lastRequestSignatureRef.current) return undefined

    setRecommendationLoading(true)
    setRecommendationError('')
    const timer = window.setTimeout(async () => {
      const seq = ++requestSeqRef.current
      try {
        const result = await recommendRdContractRules({
          partner_name: partner,
          bill_id: mode === 'edit' && editRecord?.id ? String(editRecord.id) : undefined,
          lines: requestLines
        })
        if (seq !== requestSeqRef.current) return
        lastRequestSignatureRef.current = signature
        setRecommendation(result)
      } catch (error) {
        if (seq !== requestSeqRef.current) return
        setRecommendation(null)
        setRecommendationError(error instanceof Error ? error.message : '合同自动匹配暂不可用')
      } finally {
        if (seq === requestSeqRef.current) setRecommendationLoading(false)
      }
    }, 320)
    return () => window.clearTimeout(timer)
  }, [formState, mode, editRecord?.id])

  const forceApplyRecommendation = useCallback(() => {
    if (!formState || !recommendation || !recommendationMatchesRecord(formState, recommendation)) return
    if (recommendation.header_recommendation?.compatible === false) {
      onError?.(recommendation.header_recommendation.message || '合同通道费率不一致，请拆分研发账单')
      return
    }
    const patched = applyRecommendationToRecord(formState, recommendation, productDiscountRefs)
    const rdLines = (patched.items || []).map((line, index) => ({ ...line, sortOrder: index }))
    if (mode === 'add') {
      setContractQuickFill({
        settlementMonth: patched.settlementMonth,
        channelFeeRate: String(patched.channelFeeRate ?? '0'),
        rdLines
      })
    } else {
      setContractDraftOverride(patched)
    }
    lastAppliedSignatureRef.current = String(recommendation.generated_at || '')
  }, [formState, mode, onError, recommendation])

  useEffect(() => {
    if (mode !== 'add' || !recommendation || !formState || !recommendationMatchesRecord(formState, recommendation)) return
    if (recommendation.header_recommendation?.compatible === false) return
    const signature = String(recommendation.generated_at || '')
    if (!signature || signature === lastAppliedSignatureRef.current) return
    if (!recommendation.lines?.some((item) => item.auto_apply)) return
    forceApplyRecommendation()
  }, [forceApplyRecommendation, formState, mode, recommendation])

  const contractExpected = useMemo(() => {
    const amounts = (recommendation?.lines || [])
      .map((item) => Number(item?.contract_amount?.expected_amount))
      .filter((value) => Number.isFinite(value))
    return amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : null
  }, [recommendation])

  const recommendationCurrent = recommendationMatchesRecord(formState, recommendation)
  const currentFinal = num(formState?.settlementAmount, 0)
  const adjustment = contractExpected == null ? null : currentFinal - contractExpected
  const activeRows = Array.isArray(formState?.items) ? formState.items : []
  const deviationMap = useMemo(() => {
    const out = {}
    for (const item of recommendation?.lines || []) {
      out[item.line_index] = deviationsFor(formState, item.line_index, item)
    }
    return out
  }, [formState, recommendation])

  const prepaymentByLine = useMemo(() => {
    if (!recommendationCurrent) return {}
    return Object.fromEntries(
      (recommendation?.lines || []).map((item) => {
        const rec = item?.recommended || {}
        return [item.line_index, {
          enabled: Boolean(rec.prepayment_enabled),
          agreedAmount: num(rec.prepayment_agreed_amount),
          usedAmount: num(rec.prepayment_used_amount),
          availableBefore: num(rec.prepayment_available_before),
          deduction: num(rec.prepayment_deduction),
          availableAfter: num(rec.prepayment_available_after),
          actualPayable: num(rec.actual_payable)
        }]
      })
    )
  }, [recommendation, recommendationCurrent])
  const hasPrepayment = Object.values(prepaymentByLine).some((item) => item?.enabled)
  const prepaymentDeductionTotal = Object.values(prepaymentByLine).reduce(
    (sum, item) => sum + num(item?.deduction),
    0
  )
  const actualPayableTotal = Math.max(0, currentFinal - prepaymentDeductionTotal)

  const buildAuditMetadata = useCallback((record) => {
    const rows = Array.isArray(record?.items) ? record.items : []
    return rows.map((line, index) => {
      const result = recommendation?.lines?.find((item) => item.line_index === index)
      const match = result?.match
      const recommended = result?.recommended
      const identity = lineIdentity(record?.partner, line, index)
      const deviations = deviationsFor(record, index, result)
      return {
        line_index: index,
        game_name: String(line?.gameName || '').trim(),
        settlement_cycle: String(line?.settlementCycle || record?.settlementMonth || '').trim(),
        contract_id: match?.contract_id || null,
        contract_name: match?.contract_name || '',
        contract_no: match?.contract_no || null,
        access_item_id: match?.access_item_id || null,
        authorization_status: match?.authorization_status || 'unmatched',
        match_score: result?.score ?? null,
        match_confidence: result?.confidence || 'none',
        binding_allowed: Boolean(result?.auto_apply && match?.access_item_id),
        settlement_mode: recommended?.settlement_mode || '',
        settlement_basis: recommended?.settlement_basis || '',
        basis_mode: recommended?.basis_mode || 'unmatched',
        product_discount_reference:
          productDiscountRefs.current[identity] ?? recommended?.product_discount_reference ?? num(line?.discountRate, 1),
        recommended_fields: recommended ? {
          settlement_discount_rate: recommended.settlement_discount_rate,
          share_ratio: recommended.share_ratio,
          channel_fee_rate: recommended.channel_fee_rate,
          tax_rate: recommended.tax_rate,
          test_fee: recommended.test_fee
        } : null,
        saved_fields: {
          settlement_discount_rate: num(line?.discountRate, 1),
          share_ratio: num(line?.shareRatio),
          channel_fee_rate: num(record?.channelFeeRate),
          tax_rate: num(line?.taxRate),
          test_fee: num(line?.testFee)
        },
        contract_expected_amount: result?.contract_amount?.expected_amount ?? null,
        contract_amount_deterministic: Boolean(result?.contract_amount?.deterministic),
        prepayment_enabled: Boolean(recommended?.prepayment_enabled),
        prepayment_agreed_amount: recommended?.prepayment_agreed_amount ?? 0,
        prepayment_used_amount: recommended?.prepayment_used_amount ?? 0,
        prepayment_available_before: recommended?.prepayment_available_before ?? 0,
        prepayment_deduction: recommended?.prepayment_deduction ?? 0,
        prepayment_available_after: recommended?.prepayment_available_after ?? 0,
        actual_payable: recommended?.actual_payable ?? result?.contract_amount?.expected_amount ?? 0,
        deviations,
        override_reason: String(overrideReasons[index] || '').trim(),
        recommendation_generated_at: recommendation?.generated_at || null
      }
    })
  }, [overrideReasons, recommendation])

  const validateContractEntry = useCallback((record) => {
    if (recommendationLoading) return '合同正在重新匹配，请完成本轮匹配后再保存。'
    if (recommendation && !recommendationMatchesRecord(record, recommendation)) return '合同匹配结果已过期，正在按当前合作方/游戏/账期重新匹配，请稍后保存。'
    if (recommendation?.header_recommendation?.compatible === false) {
      return recommendation.header_recommendation.message || '同一账单匹配到不同合同通道费率，请拆分账单'
    }
    const rows = Array.isArray(record?.items) ? record.items : []
    for (let index = 0; index < rows.length; index += 1) {
      const result = recommendation?.lines?.find((item) => item.line_index === index)
      const deviations = deviationsFor(record, index, result)
      if (deviations.length && !String(overrideReasons[index] || '').trim()) {
        return `游戏「${rows[index]?.gameName || `第${index + 1}行`}」已偏离合同字段（${deviations.join('、')}），请填写人工调整原因。`
      }
    }
    return ''
  }, [overrideReasons, recommendation, recommendationLoading])

  const prepareForSave = useCallback(async (record) => {
    const validation = validateContractEntry(record)
    if (validation) throw new Error(validation)
    const statementNo = String(record?.settlementNumber || '').trim() || nextSettlementNumberForRecord(
      record,
      existingRecords,
      settlementNumberFormat
    )
    const preparedRecord = { ...record, settlementNumber: statementNo }
    const metadata = buildAuditMetadata(preparedRecord)
    if (recommendation) {
      await prepareRdContractEntry({ statement_no: statementNo, metadata })
    }
    return { preparedRecord, statementNo }
  }, [buildAuditMetadata, existingRecords, recommendation, settlementNumberFormat, validateContractEntry])

  const handleAddRecord = useCallback(async (record) => {
    let prepared
    try {
      prepared = await prepareForSave(record)
    } catch (error) {
      const message = error instanceof Error ? error.message : '合同录入校验失败'
      onError?.(message)
      throw error
    }
    const result = await onAddRecord?.(prepared.preparedRecord)
    if (recommendation) {
      try {
        await finalizeRdContractEntry(prepared.statementNo)
      } catch (error) {
        console.warn('研发合同录入快照将在后续 Bill360 核验时自动恢复', error)
        onError?.('账单已保存；合同快照暂未固化，系统会在后续合同核验时自动恢复。')
      }
    }
    return result
  }, [onAddRecord, onError, prepareForSave, recommendation])

  const handleUpdateRecord = useCallback(async (id, record) => {
    let prepared
    try {
      prepared = await prepareForSave(record)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '合同录入校验失败')
      return false
    }
    const result = await onUpdateRecord?.(id, prepared.preparedRecord)
    if (result === false) return false
    if (recommendation) {
      try {
        await finalizeRdContractEntry(prepared.statementNo)
      } catch (error) {
        console.warn('研发合同录入快照将在后续 Bill360 核验时自动恢复', error)
        onError?.('账单修改已保存；合同快照暂未固化，后续合同核验会自动恢复。')
      }
    }
    return result
  }, [onError, onUpdateRecord, prepareForSave, recommendation])

  const effectiveQuickFill = mode === 'add' && contractQuickFill ? contractQuickFill : quickFillData
  const effectiveDraftRecord = mode === 'edit' && contractDraftOverride ? contractDraftOverride : draftRecord

  return (
    <div className="rd-contract-entry-v31">
      <section className={`rd-contract-entry-panel is-${recommendationError ? 'error' : recommendationLoading ? 'loading' : recommendation?.auto_apply ? 'pass' : recommendation ? 'warning' : 'idle'}`}>
        <div className="rd-contract-entry-panel__head">
          <div>
            <span>V3.1 · CONTRACT-DRIVEN ENTRY</span>
            <h2>研发账单按合同录入</h2>
            <p>合作方 + 游戏 + 账期确定后，自动匹配合同合作清单并带入分成、税率、测试费和结算基数；历史账单不会因打开编辑页被自动改写。</p>
          </div>
          <div className="rd-contract-entry-panel__status">
            <strong>{recommendationLoading ? '正在匹配合同…' : recommendationError ? '合同服务暂不可用' : recommendation && !recommendationCurrent ? '匹配结果待刷新' : recommendation?.message || '等待合作方和游戏'}</strong>
            {snapshotInfo?.created_at ? <small>最近录入快照：{String(snapshotInfo.created_at).replace('T', ' ').slice(0, 19)}</small> : null}
          </div>
        </div>

        {recommendation && !recommendationCurrent && !recommendationLoading ? <div className="rd-contract-entry-alert is-warning">合作方、游戏或账期已变化，旧合同推荐不会用于保存，系统正在重新匹配。</div> : null}
        {recommendationError ? <div className="rd-contract-entry-alert is-error">{recommendationError}。本次仍可保存为待核对账单，确认核对前会再次走合同核验。</div> : null}
        {recommendation?.header_recommendation?.message ? (
          <div className={`rd-contract-entry-alert ${recommendation.header_recommendation.compatible === false ? 'is-error' : 'is-warning'}`}>
            {recommendation.header_recommendation.message}
          </div>
        ) : null}

        {recommendation?.lines?.length ? (
          <div className="rd-contract-entry-lines">
            {recommendation.lines.map((item) => {
              const currentLine = activeRows[item.line_index]
              const rec = item.recommended
              const deviations = deviationMap[item.line_index] || []
              const productRef = productDiscountRefs.current[lineIdentity(formState?.partner, currentLine, item.line_index)] ?? rec?.product_discount_reference
              return (
                <article key={`${item.line_index}-${item.match?.access_item_id || item.game_name}`} className={`rd-contract-entry-line is-${matchTone(item)}`}>
                  <div className="rd-contract-entry-line__title">
                    <div>
                      <strong>{item.game_name || `第 ${item.line_index + 1} 行`}</strong>
                      <span>{item.settlement_cycle || '未填写账期'}</span>
                    </div>
                    <em>{item.auto_apply ? '合同已自动带入' : item.match ? '需人工复核' : '未匹配合同'}</em>
                  </div>
                  {item.match ? (
                    <>
                      <div className="rd-contract-entry-contract">
                        <strong>{item.match.contract_name || '未命名合同'}</strong>
                        <span>{item.match.contract_no || '无合同编号'} · {item.match.product_name || item.game_name}</span>
                        <small>匹配 {item.score} 分 · {item.match.authorization_status === 'covered' ? '授权期内' : item.match.authorization_status === 'out_of_range' ? '授权期外' : '授权期待确认'}</small>
                      </div>
                      <div className="rd-contract-entry-rule-grid">
                        <div><span>结算基数</span><strong>{basisLabel(rec?.basis_mode)}</strong></div>
                        <div><span>合同分成</span><strong>{rec?.share_ratio == null ? '合同缺字段' : `${rec.share_ratio}%`}</strong></div>
                        <div><span>合同税率</span><strong>{rec?.tax_rate == null ? '保留当前值' : `${rec.tax_rate}%`}</strong></div>
                        <div><span>合同通道费</span><strong>{rec?.channel_fee_rate == null ? '保留当前值' : `${rec.channel_fee_rate}%`}</strong></div>
                        <div><span>合同测试费</span><strong>{rec?.test_fee == null ? '保留当前值' : money(rec.test_fee)}</strong></div>
                        <div><span>合同应结</span><strong>{money(item.contract_amount?.expected_amount)}</strong></div>
                        {rec?.prepayment_enabled ? <div><span>预付款抵扣</span><strong>-{money(rec.prepayment_deduction)}</strong></div> : null}
                        {rec?.prepayment_enabled ? <div><span>本期实际应付</span><strong>{money(rec.actual_payable)}</strong></div> : null}
                      </div>
                      <div className="rd-contract-entry-discount-note">
                        <span>产品折扣系数：<b>{productRef ?? '-'}</b></span>
                        <span>结算系数：<b>{rec?.basis_mode === 'ambiguous' ? '待人工确认' : rec?.settlement_discount_rate ?? '-'}</b></span>
                        {rec?.discount_policy === 'reference_only' ? <em>按实付结算：产品折扣只作业务参考，不参与财务乘法</em> : null}
                      </div>
                      {(rec?.warnings || []).length ? (
                        <div className="rd-contract-entry-warnings">{rec.warnings.join('；')}</div>
                      ) : null}
                      {deviations.length ? (
                        <div className="rd-contract-entry-override">
                          <div><strong>已人工偏离合同</strong><span>{deviations.join('、')}</span></div>
                          <input
                            type="text"
                            value={overrideReasons[item.line_index] || ''}
                            onChange={(event) => setOverrideReasons((current) => ({ ...current, [item.line_index]: event.target.value }))}
                            placeholder="必填：为什么不按合同值结算？如商务协商、历史约定等"
                          />
                        </div>
                      ) : null}
                    </>
                  ) : <p className="rd-contract-entry-line__empty">当前合作方/游戏/账期没有找到可自动采用的合同合作清单，账单可先保存为待核对。</p>}
                </article>
              )
            })}
          </div>
        ) : null}

        {recommendation ? (
          <div className="rd-contract-entry-summary">
            <div><span>合同应结</span><strong>{money(contractExpected)}</strong></div>
            <div><span>当前账单</span><strong>{money(currentFinal)}</strong></div>
            {hasPrepayment ? <div><span>预付款抵扣</span><strong>-{money(prepaymentDeductionTotal)}</strong></div> : null}
            {hasPrepayment ? <div><span>实际应付</span><strong>{money(actualPayableTotal)}</strong></div> : null}
            <div className={adjustment != null && Math.abs(adjustment) > 0.01 ? 'is-diff' : ''}>
              <span>人工调整</span><strong>{adjustment == null ? '-' : `${adjustment >= 0 ? '+' : ''}${money(adjustment)}`}</strong>
            </div>
            <button type="button" onClick={forceApplyRecommendation} disabled={!recommendationCurrent || !recommendation.lines?.some((item) => item.auto_apply)}>
              {mode === 'edit' ? '恢复为合同值' : '重新带入合同值'}
            </button>
          </div>
        ) : null}
      </section>

      <ReconciliationLineItemsForm
        {...rest}
        mode={mode}
        editRecord={editRecord}
        draftRecord={effectiveDraftRecord}
        quickFillData={effectiveQuickFill}
        prepaymentByLine={prepaymentByLine}
        onFormStateChange={handleFormStateChange}
        onAddRecord={handleAddRecord}
        onUpdateRecord={handleUpdateRecord}
        onError={onError}
      />
    </div>
  )
}
