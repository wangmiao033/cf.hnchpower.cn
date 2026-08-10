import React, { useEffect, useState } from 'react'
import { getBankBillAllocationSummary } from '@/lib/api/bankAutoReconciliation.ts'
import './Bill360FundingPanel.css'

function money(value) {
  const number = Number(value || 0)
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

export default function Bill360FundingPanel({ billType, billId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!billId) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    getBankBillAllocationSummary(billType, billId)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : '资金闭环读取失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [billType, billId])

  if (loading && !data) return <div className="bill360-funding-state">正在汇总银行流水和核销分配…</div>
  if (error && !data) return <div className="bill360-funding-state is-error">{error}</div>
  if (!data) return null

  const percent = data.bill_amount > 0 ? Math.min(100, data.cash_total_amount / data.bill_amount * 100) : 100
  return (
    <div className="bill360-funding">
      <section className="bill360-funding-metrics">
        <article><span>账单金额</span><strong>{money(data.bill_amount)}</strong><small>{data.bill_number}</small></article>
        <article><span>银行核销分配</span><strong>{money(data.bank_allocated_amount)}</strong><small>{data.allocation_count} 条银行 allocation</small></article>
        <article><span>累计已收 / 已付</span><strong>{money(data.cash_total_amount)}</strong><small>含兼容的历史手工资金记录</small></article>
        <article className={data.remaining_amount <= 0.01 ? 'is-good' : 'is-warning'}><span>剩余未结</span><strong>{money(data.remaining_amount)}</strong><small>{percent.toFixed(1)}% 已完成</small></article>
      </section>
      <div className="bill360-funding-progress"><span style={{ width: `${percent}%` }} /></div>
      <section className="bill360-funding-card">
        <header><div><span>BANK ALLOCATIONS</span><h3>银行流水分配明细</h3></div><small>同一账单可由多笔流水共同结清</small></header>
        <div className="bill360-funding-table-wrap">
          <table>
            <thead><tr><th>银行日期</th><th>对方单位</th><th>流水号 / 摘要</th><th>来源</th><th className="is-right">本账单分配</th><th>确认人 / 时间</th></tr></thead>
            <tbody>
              {data.allocations.length === 0 ? <tr><td colSpan={6} className="bill360-funding-empty">暂无银行核销分配。</td></tr> : data.allocations.map((item) => (
                <tr key={item.match_id}>
                  <td>{item.trade_date || '-'}</td>
                  <td>{item.counterparty_name || '-'}</td>
                  <td><strong>{item.transaction_no || '-'}</strong><small>{item.summary || '-'}</small></td>
                  <td><strong>{item.source_bank || 'BANK'}</strong><small title={item.source_file_name || ''}>{item.source_file_name || '手工/历史'}{item.source_row_no ? ` · 行 ${item.source_row_no}` : ''}</small></td>
                  <td className="is-right"><strong>{money(item.linked_amount)}</strong></td>
                  <td>{item.confirmed_email || '-'}<small>{dateTime(item.confirmed_at)}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
