import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import {
  getRdPrepaymentPoolDetail,
  getRdPrepaymentWorkbench
} from '@/lib/api/rdPrepayment.ts'
import RdPrepaymentFundingModal from './RdPrepaymentFundingModal.jsx'
import './RdPrepaymentWorkbenchDock.css'

function money(value) {
  const amount = Number(value || 0)
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function dateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'funding', label: '待补银行' },
  { key: 'invoice', label: '待补发票' },
  { key: 'using', label: '正在抵扣' },
  { key: 'done', label: '已用完' }
]

function matchFilter(pool, filter) {
  if (filter === 'funding') return ['funding_pending', 'funding_shortfall'].includes(pool.status)
  if (filter === 'invoice') return pool.status === 'invoice_pending'
  if (filter === 'using') return pool.status === 'deducting'
  if (filter === 'done') return pool.status === 'exhausted'
  return true
}

export default function RdPrepaymentWorkbenchDock({ onChanged }) {
  const { can } = useAuth()
  const canManage = can('funds.manage')
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState('')
  const [details, setDetails] = useState({})
  const [detailLoading, setDetailLoading] = useState('')
  const [fundingTarget, setFundingTarget] = useState(null)

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const result = await getRdPrepaymentWorkbench(5)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '研发预付款台账读取失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { void load({ silent: true }) }, [])
  useEffect(() => { if (open && !data && !loading) void load() }, [open])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.items || []).filter((pool) => {
      if (!matchFilter(pool, filter)) return false
      if (!q) return true
      return [pool.product_name, pool.contract_name, pool.contract_no, pool.counterparty, pool.partner_name, pool.partner_short_name]
        .some((value) => String(value || '').toLowerCase().includes(q))
    })
  }, [data?.items, filter, search])

  const openDetail = async (pool) => {
    const id = String(pool.access_item_id || '')
    if (!id) return
    if (expandedId === id) {
      setExpandedId('')
      return
    }
    setExpandedId(id)
    if (details[id]) return
    setDetailLoading(id)
    try {
      const result = await getRdPrepaymentPoolDetail(id)
      setDetails((current) => ({ ...current, [id]: result }))
    } catch (err) {
      setError(err instanceof Error ? err.message : '预付款明细读取失败')
    } finally {
      setDetailLoading('')
    }
  }

  const refreshAfterFunding = async () => {
    setDetails({})
    await load({ silent: true })
    onChanged?.()
  }

  const stats = data?.stats || {}
  const attention = Number(stats.attention_count || 0)

  return (
    <>
      <button type="button" className="rd-prepay-workbench-launcher" onClick={() => setOpen(true)}>
        <span>预</span>
        <div><strong>研发预付款</strong><small>{attention ? `${attention} 项待处理` : '资金池 / 抵扣 / 发票'}</small></div>
        {attention ? <em>{attention}</em> : <b>›</b>}
      </button>

      {open ? (
        <div className="rd-prepay-workbench-mask" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
          <aside className="rd-prepay-workbench-drawer">
            <header className="rd-prepay-workbench-head">
              <div><span>R&D PREPAYMENT WORKBENCH</span><h2>研发预付款台账</h2><p>合同约定 → 银行实际付款 → 发票凭证 → 月度抵扣，一处完成核对与补录。</p></div>
              <button type="button" onClick={() => setOpen(false)}>×</button>
            </header>

            <main>
              {error ? <div className="rd-prepay-workbench-error">{error}<button type="button" onClick={() => void load()}>重试</button></div> : null}
              {loading && !data ? <div className="rd-prepay-workbench-loading">正在汇总合同、银行、发票和研发账单抵扣…</div> : null}

              {data ? (
                <>
                  <section className="rd-prepay-workbench-stats">
                    <article><span>合同预付款</span><strong>{money(stats.agreed_amount)}</strong><small>{stats.pool_count || 0} 个产品资金池</small></article>
                    <article><span>银行已付</span><strong>{money(stats.funded_amount)}</strong><small>真实资金来源</small></article>
                    <article><span>累计抵扣</span><strong>{money(stats.deducted_amount)}</strong><small>已进入研发月结</small></article>
                    <article className="is-good"><span>当前可用</span><strong>{money(stats.available_amount)}</strong><small>按银行已付口径</small></article>
                    <article className={Number(stats.funding_gap || 0) > 0.01 ? 'is-warning' : ''}><span>待补银行</span><strong>{money(stats.funding_gap)}</strong><small>合同约定尚未入账</small></article>
                    <article className={Number(stats.invoice_gap || 0) > 0.01 ? 'is-warning' : ''}><span>待补发票</span><strong>{money(stats.invoice_gap)}</strong><small>银行已付尚无进项凭证</small></article>
                  </section>

                  <section className="rd-prepay-workbench-toolbar">
                    <div className="rd-prepay-workbench-filters">{FILTERS.map((item) => <button key={item.key} type="button" className={filter === item.key ? 'is-active' : ''} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索游戏 / 合同 / 合作方" />
                    <button type="button" onClick={() => void load()}>刷新</button>
                  </section>

                  <section className="rd-prepay-workbench-list">
                    {!data.schema_ready ? <div className="rd-prepay-workbench-empty">数据库预付款结构尚未初始化，请先完成生产迁移。</div> : null}
                    {data.schema_ready && visible.length === 0 ? <div className="rd-prepay-workbench-empty">当前筛选下没有预付款产品。</div> : null}
                    {visible.map((pool) => {
                      const id = String(pool.access_item_id)
                      const expanded = expandedId === id
                      const detail = details[id]
                      const progressBase = Math.max(Number(pool.prepayment_agreed_amount || 0), 0.01)
                      const usedPct = Math.min(100, Math.max(0, Number(pool.deducted_amount || 0) / progressBase * 100))
                      const fundedPct = Math.min(100, Math.max(0, Number(pool.actual_funded_amount || 0) / progressBase * 100))
                      return (
                        <article key={id} className={`rd-prepay-pool-card is-${pool.status_tone || 'neutral'}`}>
                          <div className="rd-prepay-pool-main">
                            <div className="rd-prepay-pool-title"><strong>{pool.product_name || '未命名研发产品'}</strong><small>{pool.contract_name || '未命名合同'}{pool.contract_no ? ` · ${pool.contract_no}` : ''}</small><small>{pool.counterparty || pool.partner_name || '未填写合作方'}</small></div>
                            <div className="rd-prepay-pool-money"><span>合同预付<strong>{money(pool.prepayment_agreed_amount)}</strong></span><span>银行已付<strong>{money(pool.actual_funded_amount)}</strong></span><span>已抵扣<strong>{money(pool.deducted_amount)}</strong></span><span>可用余额<strong>{money(pool.available_balance)}</strong></span></div>
                            <div className="rd-prepay-pool-state"><em className={`is-${pool.status_tone || 'neutral'}`}>{pool.status_label}</em><small>{Number(pool.invoice_gap || 0) > 0.01 ? `发票缺口 ${money(pool.invoice_gap)}` : '发票凭证已覆盖'}</small></div>
                            <button type="button" className="rd-prepay-pool-expand" onClick={() => void openDetail(pool)}>{expanded ? '收起' : '查看明细'}</button>
                          </div>
                          <div className="rd-prepay-pool-progress"><i style={{ width: `${fundedPct}%` }} /><b style={{ width: `${usedPct}%` }} /></div>

                          {Number(pool.funding_shortfall || 0) > 0.01 ? <div className="rd-prepay-pool-alert is-danger">历史抵扣比已关联银行付款多 {money(pool.funding_shortfall)}，请优先补齐真实预付款流水。</div> : null}
                          {Number(pool.funding_gap || 0) > 0.01 && (pool.bank_recommendations || []).length ? (
                            <div className="rd-prepay-pool-recommendations">
                              <span>历史流水推荐</span>
                              {(pool.bank_recommendations || []).map((candidate) => (
                                <button key={candidate.id} type="button" disabled={!canManage} onClick={() => setFundingTarget({ ...candidate, preferred_access_item_id: id })}>
                                  <strong>{candidate.trade_date || '-'} · {candidate.payee_name || '未识别收款方'} · {money(candidate.available_amount)}</strong>
                                  <small>{candidate.transaction_no || candidate.summary || '无流水号/摘要'} · 匹配 {candidate.match_score}</small>
                                  <em>{canManage ? `补录 ${money(candidate.suggested_funding_amount)}` : '仅查看'}</em>
                                </button>
                              ))}
                            </div>
                          ) : null}

                          {expanded ? (
                            <div className="rd-prepay-pool-detail">
                              {detailLoading === id && !detail ? <div className="rd-prepay-detail-loading">正在读取银行、发票与抵扣明细…</div> : null}
                              {detail ? (
                                <>
                                  <section><header><strong>银行实际付款 / 发票凭证</strong><small>{detail.fundings?.length || 0} 笔银行入账</small></header>
                                    {(detail.fundings || []).length === 0 ? <p className="rd-prepay-detail-empty">尚未关联真实银行付款。上方有推荐流水时可直接补录。</p> : (detail.fundings || []).map((funding) => (
                                      <div key={funding.id} className="rd-prepay-detail-row">
                                        <div><strong>{funding.trade_date || funding.funding_date || '-'} · {funding.counterparty_name || '-'}</strong><small>{funding.transaction_no || funding.bank_summary || '无流水号/摘要'}</small></div>
                                        <div><span>银行入账</span><strong>{money(funding.funded_amount)}</strong></div>
                                        <div><span>发票覆盖</span><strong>{money(funding.invoice_allocated_amount)}</strong><small>{Number(funding.invoice_gap || 0) > 0.01 ? `缺 ${money(funding.invoice_gap)}` : '已覆盖'}</small></div>
                                        <button type="button" disabled={!canManage} onClick={() => setFundingTarget({ id: funding.bank_transaction_id, preferred_access_item_id: id })}>{Number(funding.invoice_gap || 0) > 0.01 ? '补发票 / 查看' : '查看凭证'}</button>
                                      </div>
                                    ))}
                                  </section>
                                  <section><header><strong>研发月结抵扣流水</strong><small>{detail.deductions?.length || 0} 条抵扣</small></header>
                                    {(detail.deductions || []).length === 0 ? <p className="rd-prepay-detail-empty">尚未发生研发月度抵扣。</p> : (detail.deductions || []).map((deduction) => (
                                      <div key={deduction.id} className="rd-prepay-detail-row is-deduction">
                                        <div><strong>{deduction.statement_no || deduction.bill_id} · {deduction.game_name || pool.product_name}</strong><small>{deduction.settlement_cycle || deduction.settlement_month || '-'} · {dateTime(deduction.created_at)}</small></div>
                                        <div><span>本期研发应结</span><strong>{money(deduction.settlement_amount)}</strong></div>
                                        <div><span>预付款抵扣</span><strong>-{money(deduction.deduction_amount)}</strong></div>
                                        <div><span>本期现金应付</span><strong>{money(deduction.actual_cash_payable)}</strong></div>
                                      </div>
                                    ))}
                                  </section>
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      )
                    })}
                  </section>

                  <footer className="rd-prepay-workbench-note">管理口径：研发成本按合同应结金额确认；预付款抵扣只是资金余额消耗，不会把当期研发成本变成 0。银行付款和月度抵扣分别留痕。</footer>
                </>
              ) : null}
            </main>
          </aside>
        </div>
      ) : null}

      <RdPrepaymentFundingModal
        open={Boolean(fundingTarget)}
        transaction={fundingTarget}
        onClose={() => setFundingTarget(null)}
        onSaved={() => void refreshAfterFunding()}
      />
    </>
  )
}
