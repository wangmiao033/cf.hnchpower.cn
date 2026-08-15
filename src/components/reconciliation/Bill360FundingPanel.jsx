import React, { useEffect, useState } from 'react'
import { getBankBillAllocationSummary } from '@/lib/api/bankAutoReconciliation.ts'
import { getRdPrepaymentBillEvidence } from '@/lib/api/rdPrepayment.ts'
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

export default function Bill360FundingPanel({ billType, billId, onGoBank }) {
  const [data, setData] = useState(null)
  const [prepayment, setPrepayment] = useState(null)
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

  useEffect(() => {
    if (!billId || billType !== 'rd') {
      setPrepayment(null)
      return undefined
    }
    let cancelled = false
    getRdPrepaymentBillEvidence(billId)
      .then((result) => { if (!cancelled) setPrepayment(result) })
      .catch(() => { if (!cancelled) setPrepayment(null) })
    return () => { cancelled = true }
  }, [billType, billId])

  if (loading && !data) return <div className="bill360-funding-state">正在汇总银行流水和核销分配…</div>
  if (error && !data) return <div className="bill360-funding-state is-error">{error}</div>
  if (!data) return null

  const prepaymentDeduction = billType === 'rd' ? Number(prepayment?.prepayment_deduction_amount || 0) : 0
  const cashPaid = Number(data.cash_total_amount || 0)
  const billAmount = Number(data.bill_amount || 0)
  const effectiveRemaining = Math.max(0, billAmount - prepaymentDeduction - cashPaid)
  const completedAmount = Math.min(billAmount, Math.max(0, cashPaid + prepaymentDeduction))
  const percent = billAmount > 0 ? Math.min(100, completedAmount / billAmount * 100) : 100
  const hasPrepayment = billType === 'rd' && prepaymentDeduction > 0.01

  return (
    <div className="bill360-funding">
      <section className="bill360-funding-metrics">
        <article><span>{billType === 'rd' ? '研发应结金额' : '账单金额'}</span><strong>{money(billAmount)}</strong><small>{data.bill_number}</small></article>
        {billType === 'rd' ? (
          <article className={hasPrepayment ? 'is-prepayment' : ''}><span>研发预付款抵扣</span><strong>{hasPrepayment ? `-${money(prepaymentDeduction)}` : money(0)}</strong><small>{hasPrepayment ? prepayment?.status_label : '本期未使用预付款'}</small></article>
        ) : (
          <article><span>银行核销分配</span><strong>{money(data.bank_allocated_amount)}</strong><small>{data.allocation_count} 条银行 allocation</small></article>
        )}
        <article><span>{billType === 'rd' ? '本期实际现金已付' : '累计已收 / 已付'}</span><strong>{money(cashPaid)}</strong><small>{billType === 'rd' ? `银行核销 ${money(data.bank_allocated_amount)}` : '含兼容的历史手工资金记录'}</small></article>
        <article className={effectiveRemaining <= 0.01 ? 'is-good' : 'is-warning'}><span>{billType === 'rd' ? '剩余现金应付' : '剩余未结'}</span><strong>{money(effectiveRemaining)}</strong><small>{percent.toFixed(1)}% 已完成</small></article>
      </section>
      <div className="bill360-funding-progress"><span style={{ width: `${percent}%` }} /></div>

      {hasPrepayment && effectiveRemaining <= 0.01 ? (
        <div className="bill360-funding-prepay-closed"><span>PREPAYMENT OFFSET</span><strong>预付款已完成本期资金抵扣，无需再次付款</strong><small>本期研发成本仍按 {money(billAmount)} 确认；现金支付为 {money(cashPaid)}。这属于“预付款全额抵扣”，不是“零结算”。</small></div>
      ) : null}

      {effectiveRemaining > 0.01 && typeof onGoBank === 'function' ? (
        <div className="bill360-funding-next-action">
          <div><span>NEXT ACTION</span><strong>资金尚未结清</strong><small>{hasPrepayment ? `预付款已抵扣 ${money(prepaymentDeduction)}，仍需支付 ${money(effectiveRemaining)}。` : '去银行中心匹配或确认流水，完成后回到 360° 会自动重新汇总。'}</small></div>
          <button type="button" onClick={onGoBank}>去银行中心处理 →</button>
        </div>
      ) : null}

      {billType === 'rd' && (prepayment?.lines || []).length ? (
        <section className="bill360-funding-card bill360-prepayment-evidence">
          <header><div><span>PREPAYMENT EVIDENCE</span><h3>研发预付款抵扣证据链</h3></div><small>{prepayment.status_label} · 合同应结与现金付款分开核算</small></header>
          <div className="bill360-funding-table-wrap">
            <table>
              <thead><tr><th>游戏 / 结算周期</th><th>合同</th><th className="is-right">研发应结</th><th className="is-right">预付款抵扣</th><th className="is-right">本期现金应付</th><th>预付款资金池</th></tr></thead>
              <tbody>
                {(prepayment.lines || []).map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.game_name || item.product_name || '-'}</strong><small>{item.settlement_cycle || '-'}</small></td>
                    <td><strong>{item.contract_name || '-'}</strong><small>{item.contract_no || item.counterparty || '-'}</small></td>
                    <td className="is-right"><strong>{money(item.settlement_amount)}</strong></td>
                    <td className="is-right is-prepay-value"><strong>-{money(item.deduction_amount)}</strong></td>
                    <td className="is-right"><strong>{money(item.cash_payable_amount)}</strong></td>
                    <td><strong>银行已付 {money(item.actual_funded_amount)}</strong><small>合同预付 {money(item.agreed_amount)} · 当前可用 {money(item.pool_available_amount)}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

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
