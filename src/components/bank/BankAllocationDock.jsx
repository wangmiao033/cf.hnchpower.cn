import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import {
  allocateBankTransaction,
  getBankMultiAllocationDashboard,
  reverseBankAutoReconciliation
} from '@/lib/api/bankAutoReconciliation.ts'
import { buildExactBillCombination } from '@/lib/bank/bankCombinationAllocation.js'
import './BankAllocationDock.css'

function money(value) {
  const number = Number(value || 0)
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function candidateKey(candidate) {
  return `${candidate?.bill_type || ''}:${candidate?.bill_id || ''}`
}

function confidence(value) {
  return { high: '高', medium: '中', low: '低', none: '未匹配' }[value] || value || '-'
}

function newLine(candidate, amount) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    candidateKey: candidateKey(candidate),
    amount: amount == null ? '' : String(Number(amount).toFixed(2))
  }
}

function smartLines(combination) {
  return (combination?.items || []).map((item) => newLine(item.candidate, item.amount))
}

function initialLines(item) {
  const combination = buildExactBillCombination(item)
  if (combination && !combination.ambiguous) return smartLines(combination)
  const first = item?.candidates?.[0]
  if (!first) return []
  return [newLine(first, Math.min(Number(first.recommended_amount || 0), Number(item.remaining_amount || 0)))]
}

export default function BankAllocationDock({ onChanged }) {
  const { showToast, openBill360 } = useAppState()
  const { can } = useAuth()
  const canManage = can('funds.manage')
  const [open, setOpen] = useState(false)
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [lines, setLines] = useState([])
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')

  const selectItem = (item) => {
    setSelectedId(item?.transaction_id || '')
    setLines(initialLines(item))
  }

  const load = async (keepSelected = true) => {
    setLoading(true)
    setError('')
    try {
      const result = await getBankMultiAllocationDashboard(500)
      setDashboard(result)
      const suggestions = result.suggestions || []
      const next = keepSelected
        ? suggestions.find((item) => item.transaction_id === selectedId) || suggestions[0] || null
        : suggestions[0] || null
      selectItem(next)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '多对多核销数据读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void load(false)
  // load is intentionally event-scoped; opening always fetches fresh server facts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const suggestions = dashboard?.suggestions || []
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return suggestions
    return suggestions.filter((item) => [
      item.transaction_no,
      item.counterparty_name,
      item.summary,
      item.trade_date
    ].some((value) => String(value || '').toLowerCase().includes(needle)))
  }, [suggestions, query])

  const selected = suggestions.find((item) => item.transaction_id === selectedId) || null
  const candidates = selected?.candidates || []
  const candidateMap = useMemo(
    () => new Map(candidates.map((item) => [candidateKey(item), item])),
    [candidates]
  )
  const smartCombination = useMemo(
    () => buildExactBillCombination(selected),
    [selected]
  )

  const selectedTotal = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  const afterAmount = Math.max(0, Number(selected?.remaining_amount || 0) - selectedTotal)

  const applySmartCombination = () => {
    if (!smartCombination || smartCombination.ambiguous) return
    setLines(smartLines(smartCombination))
  }

  const autoSplit = () => {
    if (!selected) return
    if (smartCombination && !smartCombination.ambiguous) {
      applySmartCombination()
      showToast?.(`已应用 ${smartCombination.count} 张账单的精确金额组合`, 'success')
      return
    }
    let left = Number(selected.remaining_amount || 0)
    const next = []
    for (const candidate of candidates) {
      if (left <= 0.005) break
      const amount = Math.min(left, Number(candidate.outstanding_amount || 0))
      if (amount <= 0.005) continue
      next.push(newLine(candidate, amount))
      left -= amount
    }
    setLines(next)
  }

  const addLine = () => {
    const used = new Set(lines.map((line) => line.candidateKey))
    const candidate = candidates.find((item) => !used.has(candidateKey(item)))
    if (!candidate) {
      showToast?.('当前推荐候选已经全部加入', 'info')
      return
    }
    setLines((current) => [...current, newLine(candidate, Math.min(Number(candidate.recommended_amount || 0), afterAmount || Number(candidate.outstanding_amount || 0)))])
  }

  const changeCandidate = (id, key) => {
    const candidate = candidateMap.get(key)
    setLines((current) => current.map((line) => line.id === id
      ? { ...line, candidateKey: key, amount: candidate ? String(Math.min(Number(candidate.recommended_amount || 0), Number(selected?.remaining_amount || 0)).toFixed(2)) : '' }
      : line))
  }

  const submit = async () => {
    if (!selected || saving) return
    const allocations = lines.map((line) => {
      const candidate = candidateMap.get(line.candidateKey)
      return candidate ? {
        bill_type: candidate.bill_type,
        bill_id: candidate.bill_id,
        amount: Number(line.amount || 0)
      } : null
    }).filter(Boolean)
    if (!allocations.length || allocations.some((item) => !Number.isFinite(item.amount) || item.amount <= 0)) {
      showToast?.('请至少填写一条有效核销分配', 'error')
      return
    }
    const unique = new Set(allocations.map((item) => `${item.bill_type}:${item.bill_id}`))
    if (unique.size !== allocations.length) {
      showToast?.('同一张账单不能在本次分配中重复出现', 'error')
      return
    }
    if (selectedTotal > Number(selected.remaining_amount || 0) + 0.01) {
      showToast?.('分配金额超过当前流水剩余金额', 'error')
      return
    }
    const exactHint = Math.abs(selectedTotal - Number(selected.remaining_amount || 0)) <= 0.01 && allocations.length > 1
      ? '\n本次将把该银行流水完整核销到这组账单。'
      : ''
    if (!window.confirm(`确认分配 ${allocations.length} 张账单，共 ${money(selectedTotal)}？\n\n流水剩余 ${money(selected.remaining_amount)}，本次后剩余 ${money(afterAmount)}。${exactHint}`)) return

    setSaving(true)
    try {
      const result = await allocateBankTransaction(selected.transaction_id, allocations)
      showToast?.(result.message || '多对多核销完成', 'success')
      setLines([])
      await load(false)
      onChanged?.()
    } catch (saveError) {
      showToast?.(saveError instanceof Error ? saveError.message : '核销分配失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const openBill = (billType, billId) => {
    setOpen(false)
    openBill360?.(billType, billId)
  }

  const reverseExisting = async (allocation) => {
    const reason = window.prompt(`撤销 ${allocation.bill_number || '该账单'} 的 ${money(allocation.linked_amount)} 分配，请填写原因：`, '') || ''
    if (reason.trim().length < 2) return
    if (!window.confirm('只撤销这一条资金分配；同一银行流水的其他核销不会受影响。是否继续？')) return
    setSaving(true)
    try {
      await reverseBankAutoReconciliation(allocation.match_id, reason.trim())
      showToast?.('该条资金分配已撤销', 'success')
      setLines([])
      await load(false)
      onChanged?.()
    } catch (reverseError) {
      showToast?.(reverseError instanceof Error ? reverseError.message : '撤销失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) return null

  return (
    <>
      <button type="button" className="bank-allocation-launcher" onClick={() => setOpen(true)}>
        <span>⇄</span>
        <div><strong>多对多核销</strong><small>智能组合 · 拆分流水 · 多账单</small></div>
      </button>
      {open ? (
        <div className="bank-allocation-mask" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false)
        }}>
          <section className="bank-allocation-dialog" role="dialog" aria-modal="true" aria-label="多对多核销">
            <header>
              <div><span>V3.2 · SMART MONEY ALLOCATION</span><h2>多对多核销</h2><p>自动识别“同合作方 + 多账单未结金额之和 = 银行流水”的精确组合，再由你确认入账。</p></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            </header>
            <div className="bank-allocation-body">
              <aside className="bank-allocation-queue">
                <div className="bank-allocation-search">
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索流水号 / 对方 / 摘要" />
                  <button type="button" onClick={() => void load(true)} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
                </div>
                {error ? <div className="bank-allocation-error">{error}</div> : null}
                <div className="bank-allocation-queue-list">
                  {!loading && filtered.length === 0 ? <div className="bank-allocation-empty">没有待分配流水。</div> : null}
                  {filtered.map((item) => (
                    <button key={item.transaction_id} type="button" className={selectedId === item.transaction_id ? 'is-active' : ''} onClick={() => selectItem(item)}>
                      <span><strong>{item.trade_date || '-'}</strong><em className={`is-${item.direction}`}>{item.direction_label}</em></span>
                      <b>{item.counterparty_name || '未识别对方'}</b>
                      <small>{item.transaction_no || item.summary || '无流水号'}</small>
                      <div><span>原额 {money(item.amount)}</span><span>已分 {money(item.allocated_amount)}</span><strong>剩余 {money(item.remaining_amount)}</strong></div>
                    </button>
                  ))}
                </div>
              </aside>

              <main className="bank-allocation-main">
                {!selected ? <div className="bank-allocation-empty bank-allocation-empty--large">选择左侧一笔流水开始分配。</div> : (
                  <>
                    <section className="bank-allocation-summary">
                      <article><span>原始流水</span><strong>{money(selected.amount)}</strong><small>{selected.direction_label} · {selected.currency || 'CNY'}</small></article>
                      <article><span>已核销</span><strong>{money(selected.allocated_amount)}</strong><small>{selected.allocation_count} 条有效分配</small></article>
                      <article className="is-focus"><span>剩余待分配</span><strong>{money(selected.remaining_amount)}</strong><small>{smartCombination ? `${confidence(smartCombination.confidenceLevel)}置信组合 · ${smartCombination.score} 分` : `${confidence(selected.confidence_level)}置信 · ${Number(selected.top_score || 0).toFixed(0)} 分`}</small></article>
                      <article><span>本次分配</span><strong>{money(selectedTotal)}</strong><small>完成后剩余 {money(afterAmount)}</small></article>
                    </section>

                    {smartCombination ? (
                      <section className={`bank-allocation-smart ${smartCombination.ambiguous ? 'is-ambiguous' : 'is-exact'}`}>
                        <div className="bank-allocation-smart-head">
                          <div><span>V3.2 智能组合</span><h3>{smartCombination.ambiguous ? '检测到多个精确组合，需要人工确认' : `已识别 ${smartCombination.count} 张账单的精确组合`}</h3></div>
                          <strong>{money(smartCombination.totalAmount)} = 流水剩余</strong>
                        </div>
                        <div className="bank-allocation-smart-meta">
                          <span>合作方：{smartCombination.partnerName || '待确认'}</span>
                          <span>{confidence(smartCombination.confidenceLevel)}置信 · {smartCombination.score} 分</span>
                          <span>{smartCombination.ambiguous ? '不会自动套用' : '已自动预填，可直接核对'}</span>
                        </div>
                        <div className="bank-allocation-smart-bills">
                          {smartCombination.items.map((item, index) => (
                            <button key={item.candidateKey} type="button" onClick={() => openBill(item.candidate.bill_type, item.candidate.bill_id)}>
                              <i>{index + 1}</i>
                              <span><b>{item.candidate.bill_number}</b><small>{item.candidate.settlement_month || '-'} · {item.candidate.game_name || '未填游戏'}</small></span>
                              <strong>{money(item.amount)}</strong>
                            </button>
                          ))}
                        </div>
                        <div className="bank-allocation-smart-reasons">
                          {smartCombination.reasons.map((reason) => <span key={reason}>✓ {reason}</span>)}
                        </div>
                        {!smartCombination.ambiguous ? <button type="button" className="bank-allocation-smart-apply" onClick={applySmartCombination}>重新应用精确组合</button> : null}
                      </section>
                    ) : null}

                    {selected.existing_allocations?.length ? (
                      <section className="bank-allocation-existing">
                        <div className="bank-allocation-section-title"><div><span>已生效</span><h3>现有资金分配</h3></div><small>撤销单条不会影响其他账单</small></div>
                        {selected.existing_allocations.map((allocation) => (
                          <div key={allocation.match_id}>
                            <button type="button" onClick={() => openBill(allocation.bill_type, allocation.bill_id)}>{allocation.bill_number || allocation.bill_id}</button>
                            <strong>{money(allocation.linked_amount)}</strong>
                            <button type="button" className="is-danger" disabled={saving} onClick={() => reverseExisting(allocation)}>撤销</button>
                          </div>
                        ))}
                      </section>
                    ) : null}

                    <section className="bank-allocation-editor">
                      <div className="bank-allocation-section-title">
                        <div><span>本次操作</span><h3>新增分配</h3></div>
                        <div><button type="button" onClick={autoSplit}>{smartCombination && !smartCombination.ambiguous ? '应用智能组合' : '按推荐自动拆分'}</button><button type="button" onClick={addLine}>＋ 添加账单</button></div>
                      </div>
                      {lines.length === 0 ? <div className="bank-allocation-empty">当前没有可加入的候选账单。</div> : lines.map((line, index) => {
                        const candidate = candidateMap.get(line.candidateKey)
                        return (
                          <div className="bank-allocation-line" key={line.id}>
                            <span className="bank-allocation-index">{index + 1}</span>
                            <label><span>账单</span><select value={line.candidateKey} onChange={(event) => changeCandidate(line.id, event.target.value)}>
                              {candidates.map((item) => <option key={candidateKey(item)} value={candidateKey(item)}>{item.bill_number} · {item.partner_name || '-'} · 未结 {money(item.outstanding_amount)}</option>)}
                            </select></label>
                            <label className="bank-allocation-amount"><span>分配金额</span><input inputMode="decimal" value={line.amount} onChange={(event) => setLines((current) => current.map((item) => item.id === line.id ? { ...item, amount: event.target.value } : item))} /></label>
                            <button type="button" className="bank-allocation-open" onClick={() => candidate && openBill(candidate.bill_type, candidate.bill_id)}>360°</button>
                            <button type="button" className="bank-allocation-remove" onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>×</button>
                            {candidate ? <small>{candidate.settlement_month || '-'} · {candidate.game_name || '未填游戏'} · 推荐 {money(candidate.recommended_amount)} · {confidence(candidate.confidence_level)}置信 {candidate.score}分</small> : null}
                          </div>
                        )
                      })}
                    </section>
                  </>
                )}
              </main>
            </div>
            <footer>
              <span>确认后逐张账单写入核销事实，并同步收款状态与 Bill 360；银行原始流水金额不会被拆改。</span>
              <div><button type="button" onClick={() => setOpen(false)}>关闭</button><button type="button" className="is-primary" disabled={!selected || saving || !lines.length || selectedTotal <= 0} onClick={submit}>{saving ? '正在核销…' : `确认分配 ${money(selectedTotal)}`}</button></div>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
