import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import {
  cancelChannelCumulativeBatch,
  createChannelCumulativeBatch,
  getChannelCumulativeSnapshot,
  saveChannelCumulativePolicy,
  submitChannelCumulativeBatchInvoice
} from '@/lib/api/channelCumulativeSettlement.ts'
import './ChannelCumulativeSettlementCard.css'

function money(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '¥0.00'
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function monthText(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : String(value || '-')
}

function batchStatus(batch) {
  if (!batch) return { label: '暂无结算批次', tone: 'muted' }
  if (batch.status === 'ready') return { label: '待提交开票', tone: 'ready' }
  if (batch.status === 'invoicing') return { label: '财务开票中', tone: 'processing' }
  if (batch.status === 'invoiced') return { label: '已开票 · 待回款', tone: 'invoiced' }
  if (batch.status === 'settled') return { label: '已结清', tone: 'done' }
  if (batch.status === 'cancelled') return { label: '已取消', tone: 'muted' }
  return { label: batch.status || '未知', tone: 'muted' }
}

export default function ChannelCumulativeSettlementCard({
  partnerName,
  recordId = '',
  billStatus = 'pending',
  draftBasisAmount = 0,
  draftSettlementAmount = 0
}) {
  const { can } = useAuth()
  const canManage = can('reconciliation.manage')
  const canSubmitInvoice = can('invoice_requests.submit')
  const [policy, setPolicy] = useState(null)
  const [pool, setPool] = useState(null)
  const [batches, setBatches] = useState([])
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const name = String(partnerName || '').trim()
    if (!name) {
      setPolicy(null)
      setPool(null)
      setBatches([])
      setForm(null)
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const snapshot = await getChannelCumulativeSnapshot(name, 8)
      const policyResult = snapshot.policy
      setPolicy(policyResult)
      setPool(snapshot.pool)
      setBatches(snapshot.batches?.items || [])
      setForm({
        settlement_mode: policyResult.settlement_mode || 'periodic',
        threshold_basis: policyResult.threshold_basis || 'billing_flow',
        threshold_amount: String(policyResult.threshold_amount || 2000),
        enabled: policyResult.enabled !== false,
        note: policyResult.note || ''
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '累计结算信息读取失败')
    } finally {
      setLoading(false)
    }
  }, [partnerName])

  useEffect(() => {
    void load()
  }, [load])

  const thresholdMode = policy?.enabled && policy?.settlement_mode === 'threshold'
  const basisLabel = policy?.threshold_basis === 'settlement_amount' ? '累计结算金额' : '累计流水'
  const currentStatus = String(billStatus || 'pending').toLowerCase()
  const alreadyIncluded = Boolean(recordId && pool?.bills?.some((item) => String(item.bill_id) === String(recordId)))
  const mayJoinAfterReview = !['confirmed', 'invoiced', 'completed', 'settled', 'reconciled', 'verified', 'cancelled'].includes(currentStatus)
  const draftBasis = policy?.threshold_basis === 'settlement_amount'
    ? Number(draftSettlementAmount || 0)
    : Number(draftBasisAmount || 0)
  const projectedBasis = Number(pool?.basis_total || 0) + (thresholdMode && mayJoinAfterReview && !alreadyIncluded ? Math.max(0, draftBasis) : 0)
  const projectedSettlement = Number(pool?.settlement_total || 0) + (thresholdMode && mayJoinAfterReview && !alreadyIncluded ? Math.max(0, Number(draftSettlementAmount || 0)) : 0)
  const threshold = Number(policy?.threshold_amount || 0)
  const projectedReady = thresholdMode && threshold > 0 && projectedBasis + 0.01 >= threshold
  const projectedProgress = threshold > 0 ? Math.min(100, projectedBasis / threshold * 100) : 0
  const recentBatch = useMemo(
    () => (batches || []).find((item) => item.status !== 'cancelled') || batches?.[0] || null,
    [batches]
  )
  const recentStatus = batchStatus(recentBatch)

  const savePolicy = async () => {
    if (!canManage || !form || working) return
    const mode = form.settlement_mode
    const amount = Number(form.threshold_amount || 0)
    if (mode === 'threshold' && (!Number.isFinite(amount) || amount <= 0)) {
      setMessage('累计结算门槛必须大于 0。')
      return
    }
    setWorking('policy')
    setMessage('')
    try {
      await saveChannelCumulativePolicy({
        partner_name: String(partnerName || '').trim(),
        settlement_mode: mode,
        threshold_basis: form.threshold_basis,
        threshold_amount: mode === 'threshold' ? amount : 0,
        scope: 'partner',
        enabled: form.enabled,
        note: form.note
      })
      await load()
      setMessage('结算策略已保存。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '结算策略保存失败')
    } finally {
      setWorking('')
    }
  }

  const createBatch = async () => {
    if (!canManage || working || !pool?.ready) return
    if (!window.confirm(`确认把当前累计池的 ${pool.bill_count || 0} 张已核对账单生成一个累计结算批次吗？\n\n累计口径：${money(pool.basis_total)}\n累计应收：${money(pool.settlement_total)}`)) return
    setWorking('batch')
    setMessage('')
    try {
      const result = await createChannelCumulativeBatch(String(partnerName || '').trim())
      await load()
      setMessage(`已生成累计结算批次 ${result.batch_no}。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '累计结算批次生成失败')
    } finally {
      setWorking('')
    }
  }

  const submitInvoice = async () => {
    if (!canSubmitInvoice || !recentBatch || recentBatch.status !== 'ready' || working) return
    setWorking('invoice')
    setMessage('')
    try {
      const result = await submitChannelCumulativeBatchInvoice(recentBatch.id)
      await load()
      setMessage(`累计开票任务 ${result.task_no} 已提交财务工作台。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '累计开票任务提交失败')
    } finally {
      setWorking('')
    }
  }

  const cancelBatch = async () => {
    if (!canManage || !recentBatch || recentBatch.status !== 'ready' || recentBatch.invoice_task_id || working) return
    const reason = window.prompt(`取消累计结算批次 ${recentBatch.batch_no} 的原因：`, '')
    if (reason === null) return
    if (!reason.trim()) {
      setMessage('取消批次必须填写原因。')
      return
    }
    setWorking('cancel')
    setMessage('')
    try {
      await cancelChannelCumulativeBatch(recentBatch.id, reason.trim())
      await load()
      setMessage('累计结算批次已取消，账单已重新回到累计池。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '取消批次失败')
    } finally {
      setWorking('')
    }
  }

  if (!String(partnerName || '').trim()) {
    return (
      <section className="channel-cumulative-card is-empty">
        <div><span>累计结算</span><strong>选择合作方后自动识别结算策略</strong></div>
        <p>支持按月结算，以及“累计流水/累计应收达到门槛后再统一开票收款”。</p>
      </section>
    )
  }

  return (
    <section className={`channel-cumulative-card ${thresholdMode ? 'is-threshold' : 'is-periodic'}`}>
      <div className="channel-cumulative-card__head">
        <div>
          <span>累计结算策略</span>
          <strong>{loading ? '正在读取…' : thresholdMode ? `累计达标结算 · ${basisLabel}` : '按月正常结算'}</strong>
          <small>{thresholdMode ? '月度账单照常核对并锁定，达到门槛前不进入开票、催收和银行匹配。' : '每张已核对账单按现有开票、收款与核销流程独立结算。'}</small>
        </div>
        <em className={thresholdMode ? (pool?.ready ? 'is-ready' : 'is-running') : 'is-normal'}>
          {thresholdMode ? (pool?.ready ? '已达门槛' : '累计中') : '正常'}
        </em>
      </div>

      {thresholdMode ? (
        <>
          <div className="channel-cumulative-card__metrics">
            <div><span>{basisLabel}</span><strong>{money(pool?.basis_total || 0)}</strong><small>/ {money(threshold)}</small></div>
            <div><span>距离门槛</span><strong>{pool?.ready ? '已达到' : money(pool?.remaining_to_threshold || threshold)}</strong><small>{pool?.bill_count || 0} 张已核对账单</small></div>
            <div><span>累计应收</span><strong>{money(pool?.settlement_total || 0)}</strong><small>{pool?.period_start ? `${monthText(pool.period_start)} ～ ${monthText(pool.period_end || pool.period_start)}` : '等待已核对账单'}</small></div>
          </div>
          <div className="channel-cumulative-card__progress"><span style={{ width: `${Math.max(0, Math.min(100, Number(pool?.progress_percent || 0)))}%` }} /></div>
          {mayJoinAfterReview && !alreadyIncluded && draftBasis > 0 ? (
            <div className={`channel-cumulative-card__projection ${projectedReady ? 'is-ready' : ''}`}>
              <span>本单核对后预计</span>
              <strong>{basisLabel} {money(projectedBasis)} / {money(threshold)}</strong>
              <small>{projectedReady ? `预计达到结算门槛 · 累计应收约 ${money(projectedSettlement)}` : `预计还差 ${money(Math.max(0, threshold - projectedBasis))} · 本单仍可正常完成核对`}</small>
            </div>
          ) : null}
          <div className="channel-cumulative-card__actions">
            {pool?.ready && canManage ? (
              <button type="button" className="is-primary" onClick={createBatch} disabled={!!working || Boolean(recentBatch && ['ready', 'invoicing', 'invoiced'].includes(recentBatch.status))}>
                {working === 'batch' ? '生成中…' : '生成累计结算批次'}
              </button>
            ) : null}
            {recentBatch?.status === 'ready' && canSubmitInvoice ? (
              <button type="button" onClick={submitInvoice} disabled={!!working}>{working === 'invoice' ? '提交中…' : '提交累计开票'}</button>
            ) : null}
            {recentBatch?.status === 'ready' && canManage && !recentBatch.invoice_task_id ? (
              <button type="button" onClick={cancelBatch} disabled={!!working}>{working === 'cancel' ? '取消中…' : '取消批次'}</button>
            ) : null}
          </div>
          {recentBatch ? (
            <div className={`channel-cumulative-card__batch is-${recentStatus.tone}`}>
              <div><span>最近批次</span><strong>{recentBatch.batch_no}</strong><small>{recentBatch.items?.length || 0} 张账单 · {money(recentBatch.settlement_total)}</small></div>
              <em>{recentStatus.label}</em>
              {recentBatch.status === 'invoiced' ? <small>已收 {money(recentBatch.received_total)} · 剩余 {money(recentBatch.remaining_receivable)}</small> : null}
            </div>
          ) : null}
        </>
      ) : null}

      {canManage && form ? (
        <details className="channel-cumulative-card__settings">
          <summary>结算策略设置</summary>
          <div className="channel-cumulative-card__settings-grid">
            <label><span>结算方式</span><select value={form.settlement_mode} onChange={(event) => setForm((current) => ({ ...current, settlement_mode: event.target.value }))}><option value="periodic">按月结算</option><option value="threshold">累计达标结算</option></select></label>
            <label><span>累计口径</span><select value={form.threshold_basis} disabled={form.settlement_mode !== 'threshold'} onChange={(event) => setForm((current) => ({ ...current, threshold_basis: event.target.value }))}><option value="billing_flow">累计流水</option><option value="settlement_amount">累计结算金额</option></select></label>
            <label><span>结算门槛（元）</span><input type="number" min="0" step="0.01" disabled={form.settlement_mode !== 'threshold'} value={form.threshold_amount} onChange={(event) => setForm((current) => ({ ...current, threshold_amount: event.target.value }))} /></label>
            <label className="is-wide"><span>规则说明</span><input type="text" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="例如：累计流水总金额达到2000元后结算" /></label>
          </div>
          <button type="button" onClick={savePolicy} disabled={!!working}>{working === 'policy' ? '保存中…' : '保存结算策略'}</button>
        </details>
      ) : null}

      {message ? <div className="channel-cumulative-card__message">{message}</div> : null}
    </section>
  )
}
