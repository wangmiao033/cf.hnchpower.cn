import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getContractBillReconciliation } from '@/lib/api/contractTerms.ts'
import { transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'
import { getChannelTotals } from '@/domain/channel/channelAggregates.js'
import { getChannelBillNumber } from '@/utils/channelBillNumber.js'
import {
  quickReconcileAssessment,
  quickReconcileCounts,
  quickReconcileEligible,
  quickReconcileLineRows
} from '@/domain/channel/channelQuickReconcile.js'
import './ChannelQuickReconcileDrawer.css'

function money(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function text(value, fallback = '-') {
  const raw = value == null ? '' : String(value).trim()
  return raw || fallback
}

function recordMonth(record) {
  const values = Array.isArray(record?.items)
    ? record.items.map((item) => String(item?.settlementCycle || '').trim()).filter(Boolean)
    : []
  const month = values.sort().at(-1) || String(record?.settlementMonth || '').trim()
  const match = month.match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : month || '-'
}

function aggregatePlatform(record) {
  const items = Array.isArray(record?.items) ? record.items : []
  const values = items
    .map((item) => Number(item?.platformSettlementAmount))
    .filter(Number.isFinite)
  if (values.length) return values.reduce((sum, value) => sum + value, 0)
  const direct = Number(record?.platformSettlementAmount)
  return Number.isFinite(direct) ? direct : null
}

function assessmentIcon(tone) {
  if (tone === 'pass') return '✓'
  if (tone === 'danger') return '!'
  if (tone === 'warning') return '△'
  return '…'
}

function queueStatusText(assessment) {
  return {
    pass: '可通过',
    warning: '需确认',
    danger: '有差异',
    loading: '核验中'
  }[assessment.tone] || assessment.label
}

export default function ChannelQuickReconcileDrawer({
  open,
  rows = [],
  filterLabel = '当前筛选',
  onClose,
  onRefresh,
  onEdit,
  onOpenBill360,
  showToast
}) {
  const initialTotalRef = useRef(0)
  const loadedRef = useRef(new Set())
  const mountedRef = useRef(true)
  const [currentId, setCurrentId] = useState('')
  const [checkStates, setCheckStates] = useState({})
  const [skippedIds, setSkippedIds] = useState(() => new Set())
  const [confirmedIds, setConfirmedIds] = useState(() => new Set())
  const [confirming, setConfirming] = useState(false)

  useEffect(() => () => { mountedRef.current = false }, [])

  const eligibleRows = useMemo(
    () => (rows || []).filter(quickReconcileEligible),
    [rows]
  )

  useEffect(() => {
    if (!open) return
    initialTotalRef.current = eligibleRows.length
    setSkippedIds(new Set())
    setConfirmedIds(new Set())
    setCheckStates({})
    loadedRef.current = new Set()
    setCurrentId(String(eligibleRows[0]?.id || ''))
  }, [open])

  const queue = useMemo(
    () => eligibleRows.filter((record) => {
      const id = String(record?.id || '')
      return id && !skippedIds.has(id) && !confirmedIds.has(id)
    }),
    [eligibleRows, skippedIds, confirmedIds]
  )

  useEffect(() => {
    if (!open) return
    if (!queue.length) {
      setCurrentId('')
      return
    }
    if (!queue.some((record) => String(record.id) === currentId)) {
      setCurrentId(String(queue[0].id))
    }
  }, [open, queue, currentId])

  const currentIndex = useMemo(
    () => Math.max(0, queue.findIndex((record) => String(record.id) === currentId)),
    [queue, currentId]
  )
  const current = queue[currentIndex] || null
  const currentState = current ? checkStates[String(current.id)] : null
  const currentAssessment = current ? quickReconcileAssessment(current, currentState) : null
  const lineRows = useMemo(
    () => current ? quickReconcileLineRows(current, currentState?.data) : [],
    [current, currentState]
  )

  const loadOne = useCallback(async (record, force = false) => {
    const id = String(record?.id || '')
    if (!id) return
    if (!force && loadedRef.current.has(id)) return
    loadedRef.current.add(id)
    if (mountedRef.current) {
      setCheckStates((states) => ({ ...states, [id]: { loading: true, data: states[id]?.data || null, error: '' } }))
    }
    try {
      const data = await getContractBillReconciliation('channel', id)
      if (mountedRef.current) setCheckStates((states) => ({ ...states, [id]: { loading: false, data, error: '' } }))
    } catch (error) {
      if (mountedRef.current) {
        setCheckStates((states) => ({
          ...states,
          [id]: { loading: false, data: null, error: error instanceof Error ? error.message : '合同核验暂不可用' }
        }))
      }
    }
  }, [])

  const queueKey = useMemo(() => queue.map((record) => String(record.id)).join('|'), [queue])
  useEffect(() => {
    if (!open || !queue.length) return undefined
    let cancelled = false
    const currentRecord = queue.find((record) => String(record.id) === currentId)
    if (currentRecord) void loadOne(currentRecord)

    const candidates = queue.filter((record) => !loadedRef.current.has(String(record.id))).slice(0, 40)
    let cursor = 0
    const worker = async () => {
      while (!cancelled) {
        const record = candidates[cursor]
        cursor += 1
        if (!record) break
        await loadOne(record)
      }
    }
    const workers = Array.from({ length: Math.min(4, candidates.length) }, () => worker())
    void Promise.allSettled(workers)
    return () => { cancelled = true }
  }, [open, queueKey, currentId, loadOne])

  const counts = useMemo(() => quickReconcileCounts(queue, checkStates), [queue, checkStates])
  const processed = confirmedIds.size
  const skipped = skippedIds.size
  const remaining = queue.length

  const moveToNext = useCallback((skipCurrent = false) => {
    if (!current) return
    const id = String(current.id)
    const next = queue[currentIndex + 1] || queue[currentIndex - 1] || null
    if (skipCurrent) {
      setSkippedIds((set) => {
        const nextSet = new Set(set)
        nextSet.add(id)
        return nextSet
      })
    }
    setCurrentId(String(next?.id || ''))
  }, [current, currentIndex, queue])

  const handleConfirm = async () => {
    if (!current || confirming || !currentAssessment) return
    if (currentAssessment.tone === 'loading') return
    if (currentAssessment.tone === 'danger') {
      showToast?.('当前账单存在明确差异，请先处理后再确认。', 'error')
      return
    }
    if (currentAssessment.tone === 'warning') {
      const accepted = window.confirm('当前账单还有合同匹配/资料警告，但没有识别到明确金额差异。\n\n确认继续将再次执行正式合同预检；如正式预检发现差异，系统仍会阻止确认。是否继续？')
      if (!accepted) return
    }

    const id = String(current.id)
    const next = queue[currentIndex + 1] || queue[currentIndex - 1] || null
    setConfirming(true)
    try {
      await transitionBillLifecycle('channel', id, 'confirmed')
      setConfirmedIds((set) => {
        const nextSet = new Set(set)
        nextSet.add(id)
        return nextSet
      })
      setCurrentId(String(next?.id || ''))
      showToast?.(`账单 ${getChannelBillNumber(current)} 已确认核对`, 'success')
      await onRefresh?.()
    } catch (error) {
      console.error(error)
      showToast?.(error instanceof Error ? error.message : '确认核对失败', 'error')
      loadedRef.current.delete(id)
      await loadOne(current, true)
    } finally {
      setConfirming(false)
    }
  }

  if (!open) return null

  const totals = current ? getChannelTotals(current) : null
  const amountSummary = currentState?.data?.amount_summary || null
  const summary = currentState?.data?.summary || null
  const expected = Number.isFinite(Number(amountSummary?.expected_amount)) ? Number(amountSummary.expected_amount) : Number(totals?.settlementAmount || 0)
  const platform = current ? aggregatePlatform(current) : null
  const actual = Number.isFinite(Number(amountSummary?.actual_amount)) ? Number(amountSummary.actual_amount) : platform
  const difference = Number.isFinite(Number(amountSummary?.difference_amount))
    ? Number(amountSummary.difference_amount)
    : actual == null ? null : expected - actual

  return (
    <div className="channel-quick-reconcile__overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !confirming) onClose?.()
    }}>
      <section className="channel-quick-reconcile" role="dialog" aria-modal="true" aria-label="渠道快速对账">
        <header className="channel-quick-reconcile__header">
          <div>
            <span>CHANNEL QUICK RECONCILIATION</span>
            <h2>⚡ 快速对账</h2>
            <p>{filterLabel} · 只处理待核对账单；确认仍走正式合同预检和账单生命周期。</p>
          </div>
          <div className="channel-quick-reconcile__header-actions">
            <div className="channel-quick-reconcile__progress">
              <strong>{processed}</strong><span>已通过</span>
              <strong>{remaining}</strong><span>待处理</span>
              {skipped > 0 ? <><strong>{skipped}</strong><span>已跳过</span></> : null}
            </div>
            <button type="button" onClick={onClose} disabled={confirming} aria-label="关闭快速对账">×</button>
          </div>
        </header>

        <div className="channel-quick-reconcile__summary">
          <span><i className="is-pass">✓</i> 可直接通过 <strong>{counts.pass}</strong></span>
          <span><i className="is-warning">△</i> 需人工确认 <strong>{counts.warning}</strong></span>
          <span><i className="is-danger">!</i> 明确差异 <strong>{counts.danger}</strong></span>
          {counts.loading > 0 ? <span><i>…</i> 核验中 <strong>{counts.loading}</strong></span> : null}
        </div>

        <div className="channel-quick-reconcile__body">
          <aside className="channel-quick-reconcile__queue">
            <div className="channel-quick-reconcile__queue-head">
              <strong>待核对队列</strong>
              <span>{queue.length} / {initialTotalRef.current}</span>
            </div>
            <div className="channel-quick-reconcile__queue-list">
              {queue.map((record, index) => {
                const assessment = quickReconcileAssessment(record, checkStates[String(record.id)])
                const active = String(record.id) === String(currentId)
                return (
                  <button
                    type="button"
                    key={record.id}
                    className={`channel-quick-reconcile__queue-item is-${assessment.tone}${active ? ' is-active' : ''}`}
                    onClick={() => setCurrentId(String(record.id))}
                  >
                    <span className="channel-quick-reconcile__queue-order">{index + 1}</span>
                    <span className="channel-quick-reconcile__queue-copy">
                      <strong>{text(record.channelName || record.partnerName)}</strong>
                      <small>{recordMonth(record)} · {getChannelBillNumber(record)}</small>
                    </span>
                    <em>{assessmentIcon(assessment.tone)} {queueStatusText(assessment)}</em>
                  </button>
                )
              })}
              {!queue.length ? <div className="channel-quick-reconcile__queue-empty">本轮待核对账单已处理完</div> : null}
            </div>
          </aside>

          <main className="channel-quick-reconcile__main">
            {!current ? (
              <div className="channel-quick-reconcile__done">
                <span>✓</span>
                <h3>本轮快速对账已完成</h3>
                <p>已通过 {processed} 张{skipped ? `，跳过 ${skipped} 张` : ''}。跳过的账单仍保留原状态，可稍后继续处理。</p>
                <button type="button" onClick={onClose}>返回渠道账单</button>
              </div>
            ) : (
              <>
                <section className={`channel-quick-reconcile__hero is-${currentAssessment?.tone || 'loading'}`}>
                  <div className="channel-quick-reconcile__hero-copy">
                    <span>{currentIndex + 1} / {queue.length} · {recordMonth(current)}</span>
                    <h3>{text(current.channelName || current.partnerName)}</h3>
                    <p>{getChannelBillNumber(current)} · {Array.isArray(current.items) ? current.items.length : 0} 个游戏</p>
                  </div>
                  <div className="channel-quick-reconcile__verdict">
                    <i>{assessmentIcon(currentAssessment?.tone)}</i>
                    <div><strong>{currentAssessment?.label || '核验中'}</strong><span>{currentAssessment?.detail || '正在读取核验结果'}</span></div>
                  </div>
                  {currentState?.error ? (
                    <button type="button" className="channel-quick-reconcile__retry" onClick={() => {
                      const id = String(current.id)
                      loadedRef.current.delete(id)
                      void loadOne(current, true)
                    }}>重新读取核验</button>
                  ) : null}
                </section>

                <section className="channel-quick-reconcile__metrics">
                  <div><span>后台流水</span><strong>{money(totals?.flow || 0)}</strong></div>
                  <div><span>合同应结</span><strong>{money(expected)}</strong></div>
                  <div><span>平台结算</span><strong>{actual == null ? '-' : money(actual)}</strong></div>
                  <div className={difference != null && Math.abs(difference) > 0.01 ? 'is-danger' : 'is-pass'}><span>差异</span><strong>{difference == null ? '-' : `${difference > 0 ? '+' : ''}${money(difference)}`}</strong></div>
                  <div><span>合同匹配</span><strong>{summary ? `${Number(summary.matched_lines || 0)}/${Number(summary.total_lines || lineRows.length)}` : '-'}</strong></div>
                </section>

                <section className="channel-quick-reconcile__detail">
                  <div className="channel-quick-reconcile__detail-head">
                    <div><strong>游戏明细核对</strong><span>只展示快速判断需要的字段；详细条款仍可进入 360°。</span></div>
                    <button type="button" onClick={() => { onClose?.(); onOpenBill360?.(current) }}>360°详细核验</button>
                  </div>
                  <div className="channel-quick-reconcile__table-wrap">
                    <table>
                      <thead><tr><th>游戏</th><th>后台流水</th><th>分成</th><th>合同应结</th><th>平台结算</th><th>差异</th><th>结果</th></tr></thead>
                      <tbody>
                        {lineRows.length ? lineRows.map((line) => (
                          <tr key={line.key} className={`is-${line.status}`}>
                            <td><strong>{line.gameName}</strong>{line.contractName ? <small title={line.contractName}>{line.contractName}</small> : <small>合同待确认</small>}</td>
                            <td>{money(line.flow)}</td>
                            <td>{line.shareRate == null ? '-' : `${line.shareRate}%`}</td>
                            <td>{money(line.expected)}</td>
                            <td>{line.platform == null ? '-' : money(line.platform)}</td>
                            <td>{line.difference == null ? '-' : `${line.difference > 0 ? '+' : ''}${money(line.difference)}`}</td>
                            <td><span>{line.status === 'pass' ? '✓ 一致' : line.status === 'danger' ? '! 差异' : '△ 确认'}</span></td>
                          </tr>
                        )) : (
                          <tr><td colSpan={7} className="channel-quick-reconcile__table-empty">{currentState?.loading ? '正在加载合同核验…' : '暂无游戏明细'}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <footer className="channel-quick-reconcile__footer">
                  <div className="channel-quick-reconcile__secondary-actions">
                    <button type="button" onClick={() => moveToNext(true)} disabled={confirming}>跳过</button>
                    <button type="button" onClick={() => { onClose?.(); onEdit?.(current) }} disabled={confirming}>就地处理 / 编辑</button>
                    <button type="button" onClick={() => { onClose?.(); onOpenBill360?.(current) }} disabled={confirming}>360°</button>
                  </div>
                  {currentAssessment?.tone === 'danger' ? (
                    <button type="button" className="channel-quick-reconcile__primary is-danger" onClick={() => { onClose?.(); onEdit?.(current) }}>
                      先处理差异
                    </button>
                  ) : (
                    <button type="button" className={`channel-quick-reconcile__primary is-${currentAssessment?.tone || 'loading'}`} disabled={confirming || currentAssessment?.tone === 'loading'} onClick={() => void handleConfirm()}>
                      {confirming ? '正在确认…' : currentAssessment?.tone === 'warning' ? '仍确认并下一张 →' : '通过并下一张 →'}
                    </button>
                  )}
                </footer>
              </>
            )}
          </main>
        </div>
      </section>
    </div>
  )
}
