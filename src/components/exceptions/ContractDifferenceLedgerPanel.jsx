import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { listContractDifferenceCases } from '@/lib/api/contractDifferences.ts'
import './ContractDifferenceLedgerPanel.css'

const STATUS_LABELS = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已解决'
}

const HANDLING_LABELS = {
  edit_bill: '修改账单',
  accept_difference: '接受差异',
  adjustment: '补差单',
  carry_forward: '下月冲抵'
}

function money(value) {
  const number = Number(value || 0)
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function monthText(value) {
  const raw = String(value || '')
  const match = raw.match(/^(\d{4})-(\d{2})$/)
  if (match) return `${match[1]}年${Number(match[2])}月`
  return raw || '-'
}

function varianceText(item) {
  return item.variance_direction === 'under'
    ? `少结 ${money(item.variance_abs)}`
    : item.variance_direction === 'over'
      ? `多结 ${money(item.variance_abs)}`
      : money(item.variance_abs)
}

export default function ContractDifferenceLedgerPanel({
  visible = true,
  onOpenBill,
  refreshToken = 0
}) {
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('open')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!visible) return
    setLoading(true)
    setError('')
    try {
      const result = await listContractDifferenceCases({ limit: 1000 })
      setItems(result.items || [])
      setSummary(result.summary || null)
    } catch (loadError) {
      console.error(loadError)
      setError('合同差异台账读取失败。')
    } finally {
      setLoading(false)
    }
  }, [visible])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return items.filter((item) => {
      if (status === 'open' && item.status === 'resolved') return false
      if (status !== 'open' && status !== 'all' && item.status !== status) return false
      if (!keyword) return true
      return [
        item.partner_name,
        item.game_name,
        item.statement_no,
        item.settlement_cycle,
        item.contract_name,
        item.owner,
        item.reason_type,
        item.description
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [items, query, status])

  if (!visible) return null

  return (
    <section className="contract-difference-ledger">
      <header className="contract-difference-ledger__head">
        <div>
          <span>异常中心 · 合同差异</span>
          <h2>合同差异台账</h2>
          <p>合同应结与账单实际金额的处理总账；不另建复杂模块，直接在异常中心闭环。</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? '刷新中…' : '刷新台账'}
        </button>
      </header>

      {summary ? (
        <div className="contract-difference-ledger__summary">
          <div><span>待处理</span><strong>{summary.pending_count} 笔</strong></div>
          <div><span>处理中</span><strong>{summary.processing_count} 笔</strong></div>
          <div className="is-under"><span>少结</span><strong>{money(summary.under_total)}</strong></div>
          <div className="is-over"><span>多结</span><strong>{money(summary.over_total)}</strong></div>
          <div><span>净差额</span><strong>{money(summary.net_difference)}</strong></div>
        </div>
      ) : null}

      <div className="contract-difference-ledger__toolbar">
        <label>
          <span>处理状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="open">待处理 + 处理中</option>
            <option value="pending">待处理</option>
            <option value="processing">处理中</option>
            <option value="resolved">已解决</option>
            <option value="all">全部</option>
          </select>
        </label>
        <label className="is-search">
          <span>搜索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="合作方、游戏、账单、负责人" />
        </label>
        <small>当前 {visibleItems.length} 笔</small>
      </div>

      {error ? <div className="contract-difference-ledger__error">{error}</div> : null}

      <div className="contract-difference-ledger__table-wrap">
        <table className="contract-difference-ledger__table">
          <thead>
            <tr>
              <th>合作方 / 游戏</th>
              <th>账期</th>
              <th className="is-right">合同应结</th>
              <th className="is-right">实际结算</th>
              <th className="is-right">差额</th>
              <th>处理方式</th>
              <th>状态 / 负责人</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="contract-difference-ledger__empty">
                  {loading ? '正在读取合同差异…' : '当前筛选没有合同差异。'}
                </td>
              </tr>
            ) : visibleItems.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.partner_name || '-'}</strong>
                  <span>{item.game_name || item.statement_no || '-'}</span>
                </td>
                <td>
                  <strong>{monthText(item.settlement_cycle)}</strong>
                  <span>{item.statement_no || '-'}</span>
                </td>
                <td className="is-right">{money(item.expected_amount)}</td>
                <td className="is-right">{money(item.actual_amount)}</td>
                <td className={`is-right is-variance is-${item.variance_direction}`}>
                  {varianceText(item)}
                </td>
                <td>
                  <strong>{HANDLING_LABELS[item.handling_type] || (item.status === 'pending' ? '待选择' : '-')}</strong>
                  <span>{item.reason_type || item.description || '-'}</span>
                </td>
                <td>
                  <strong className={`contract-difference-ledger__status is-${item.status}`}>
                    {STATUS_LABELS[item.status] || item.status}
                  </strong>
                  <span>{item.owner || '未指定负责人'}</span>
                </td>
                <td>
                  <button type="button" onClick={() => onOpenBill?.(item)}>账单360</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
