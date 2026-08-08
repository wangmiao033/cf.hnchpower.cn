import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import ContractDetailsDrawer from '@/components/contract/ContractDetailsDrawer.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { getCustomer360 } from '@/lib/api/customer360.ts'
import { getGlobalSearchContract } from '@/lib/search/globalSearchDetails.ts'
import '@/pages/contract-management.css'
import './Customer360Drawer.css'

const ACTIVITY_META = {
  contract: { label: '合同', mark: '合' },
  rd_bill: { label: '研发账单', mark: '研' },
  channel_bill: { label: '渠道账单', mark: '渠' },
  invoice: { label: '发票', mark: '票' },
  bank_transaction: { label: '资金流水', mark: '流' }
}

function money(value) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  return `¥${number.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function currencyMoney(value, currency) {
  if (value === null || value === undefined || value === '') return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  const code = String(currency || 'CNY').trim().toUpperCase() || 'CNY'
  return `${code} ${number.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function text(value, fallback = '-') {
  const raw = String(value ?? '').trim()
  return raw || fallback
}

function dateText(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const match = raw.match(/^(\d{4})-(\d{2})$/)
  if (match) return `${match[1]}-${match[2]}`
  return raw.replace('T', ' ').slice(0, 10)
}

function joinText(values) {
  return (values || []).filter(Boolean).join('、') || '-'
}

function EmptyState({ children = '暂无关联数据' }) {
  return <div className="customer360-empty">{children}</div>
}

function Customer360Drawer({ partnerId, onClose, onEdit }) {
  const { openBill360, openInvoiceEdit, setActiveView, showToast } = useAppState()
  const { can } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedContract, setSelectedContract] = useState(null)
  const [contractLoadingId, setContractLoadingId] = useState('')

  useEffect(() => {
    if (!partnerId) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    setData(null)
    setActiveTab('overview')
    void getCustomer360(String(partnerId))
      .then((response) => {
        if (!cancelled) setData(response)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError?.message || '客户360读取失败，请稍后重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [partnerId])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !selectedContract) onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, selectedContract])

  const tabs = useMemo(() => {
    const access = data?.access || {}
    return [
      ['overview', '总览'],
      ...(access.contracts ? [['contracts', '合同']] : []),
      ...(access.reconciliation ? [['bills', '账单']] : []),
      ...(access.invoices ? [['invoices', '发票']] : []),
      ...(access.funds ? [['funds', '资金流水']] : [])
    ]
  }, [data?.access])

  const openContract = async (contractId) => {
    if (!contractId || contractLoadingId) return
    setContractLoadingId(String(contractId))
    try {
      const contract = await getGlobalSearchContract(String(contractId))
      setSelectedContract(contract)
    } catch (detailError) {
      console.error(detailError)
      showToast?.(detailError?.message || '合同详情读取失败', 'error')
    } finally {
      setContractLoadingId('')
    }
  }

  const openInvoice = (invoice) => {
    onClose?.()
    if (can?.('invoices.manage')) {
      openInvoiceEdit?.(invoice.id)
      return
    }
    setActiveView?.(
      invoice.direction === 'input' ? VIEWS.INVOICE_INPUT : VIEWS.INVOICE_MANAGE
    )
  }

  const openBank = () => {
    onClose?.()
    setActiveView?.(VIEWS.BANK_TRANSACTIONS_LEDGER)
  }

  const openActivity = (activity) => {
    if (!activity) return
    if (activity.kind === 'contract') {
      void openContract(activity.entity_id)
      return
    }
    if (activity.kind === 'rd_bill') {
      openBill360?.('rd', activity.entity_id)
      return
    }
    if (activity.kind === 'channel_bill') {
      openBill360?.('channel', activity.entity_id)
      return
    }
    if (activity.kind === 'invoice') {
      const invoice = (data?.invoices || []).find(
        (item) => String(item.id) === String(activity.entity_id)
      )
      if (invoice) openInvoice(invoice)
      return
    }
    if (activity.kind === 'bank_transaction') openBank()
  }

  const partner = data?.partner
  const summary = data?.summary || {}
  const access = data?.access || {}

  return (
    <>
      <div
        className="customer360-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose?.()
        }}
      >
        <aside className="customer360-drawer" role="dialog" aria-modal="true" aria-label="客户360详情">
          <header className="customer360-header">
            <div className="customer360-title">
              <span className="customer360-avatar">客</span>
              <div>
                <div className="customer360-eyebrow">客户 360°</div>
                <h2>{text(partner?.short_name, partner?.name || '客户详情')}</h2>
                <p>
                  {[partner?.name, partner?.category, partner?.tax_registration_no]
                    .filter(Boolean)
                    .join(' · ') || '正在读取客户资料'}
                </p>
              </div>
            </div>
            <div className="customer360-header-actions">
              {partner ? (
                <button type="button" onClick={() => onEdit?.()}>编辑客户资料</button>
              ) : null}
              <button type="button" className="customer360-close" onClick={onClose} aria-label="关闭">×</button>
            </div>
          </header>

          {loading ? (
            <div className="customer360-loading">正在汇总合同、账单、发票和资金流水…</div>
          ) : error ? (
            <div className="customer360-error">
              <strong>客户360读取失败</strong>
              <p>{error}</p>
              <button type="button" onClick={onClose}>关闭</button>
            </div>
          ) : data ? (
            <>
              <section className="customer360-kpis" aria-label="客户业务摘要">
                {access.contracts ? (
                  <article>
                    <span>合同</span>
                    <strong>{summary.contract_count ?? 0} 份</strong>
                    <small>履约中 {summary.active_contract_count ?? 0} · {money(summary.contract_amount)}</small>
                  </article>
                ) : null}
                {access.reconciliation ? (
                  <article>
                    <span>渠道业务</span>
                    <strong>{money(summary.channel_settlement_amount)}</strong>
                    <small>{summary.channel_bill_count ?? 0} 张账单 · 未回 {money(summary.channel_unreceived_amount)}</small>
                  </article>
                ) : null}
                {access.reconciliation ? (
                  <article>
                    <span>研发业务</span>
                    <strong>{money(summary.rd_settlement_amount)}</strong>
                    <small>{summary.rd_bill_count ?? 0} 张账单 · 未付 {money(summary.rd_unpaid_amount)}</small>
                  </article>
                ) : null}
                {access.invoices ? (
                  <article>
                    <span>发票</span>
                    <strong>{summary.invoice_count ?? 0} 张</strong>
                    <small>进 {summary.input_invoice_count ?? 0} / 销 {summary.output_invoice_count ?? 0} · {money(summary.invoice_amount)}</small>
                  </article>
                ) : null}
                {access.funds ? (
                  <article>
                    <span>资金流水</span>
                    <strong>{summary.bank_transaction_count ?? 0} 笔</strong>
                    <small>按原币种展示 · 最近 {dateText(summary.latest_trade_date)}</small>
                  </article>
                ) : null}
              </section>

              <nav className="customer360-tabs" aria-label="客户360模块">
                {tabs.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={activeTab === key ? 'is-active' : ''}
                    onClick={() => setActiveTab(key)}
                  >
                    {label}
                    {key === 'contracts' ? <em>{data.contracts.length}</em> : null}
                    {key === 'bills' ? <em>{data.rd_bills.length + data.channel_bills.length}</em> : null}
                    {key === 'invoices' ? <em>{data.invoices.length}</em> : null}
                    {key === 'funds' ? <em>{data.bank_transactions.length}</em> : null}
                  </button>
                ))}
              </nav>

              <main className="customer360-content">
                {activeTab === 'overview' ? (
                  <div className="customer360-overview">
                    <section className="customer360-card">
                      <div className="customer360-card-head">
                        <div><span>客户资料</span><h3>基础信息</h3></div>
                      </div>
                      <dl className="customer360-detail-grid">
                        <div><dt>公司全称</dt><dd>{text(partner?.name)}</dd></div>
                        <div><dt>客户简称</dt><dd>{text(partner?.short_name)}</dd></div>
                        <div><dt>客户类型</dt><dd>{text(partner?.category)}</dd></div>
                        <div><dt>税号</dt><dd>{text(partner?.tax_registration_no)}</dd></div>
                        <div><dt>开户行</dt><dd>{text(partner?.bank_name)}</dd></div>
                        <div><dt>银行账号</dt><dd>{text(partner?.bank_account)}</dd></div>
                        <div><dt>开票内容</dt><dd>{text(partner?.invoice_content)}</dd></div>
                        <div><dt>收件人</dt><dd>{text(partner?.recipient)}</dd></div>
                        <div><dt>收件电话</dt><dd>{text(partner?.recipient_phone)}</dd></div>
                        <div className="is-wide"><dt>邮寄地址</dt><dd>{text(partner?.mailing_address)}</dd></div>
                        <div className="is-wide"><dt>标签 / 备注</dt><dd>{text(partner?.tag)}</dd></div>
                      </dl>
                    </section>

                    <section className="customer360-card customer360-card--activity">
                      <div className="customer360-card-head">
                        <div><span>业务轨迹</span><h3>最近动态</h3></div>
                        <small>最近 {data.recent_activities.length} 条</small>
                      </div>
                      {data.recent_activities.length ? (
                        <div className="customer360-activity-list">
                          {data.recent_activities.map((activity, index) => {
                            const meta = ACTIVITY_META[activity.kind] || { label: '业务', mark: '·' }
                            return (
                              <button
                                key={`${activity.kind}:${activity.entity_id}:${index}`}
                                type="button"
                                onClick={() => openActivity(activity)}
                              >
                                <span className={`customer360-activity-mark is-${activity.kind}`}>{meta.mark}</span>
                                <span className="customer360-activity-copy">
                                  <strong>{activity.title || meta.label}</strong>
                                  <small>{[dateText(activity.date), activity.meta].filter(Boolean).join(' · ')}</small>
                                </span>
                                <b>{activity.kind === 'bank_transaction' ? '查看流水' : money(activity.amount)}</b>
                              </button>
                            )
                          })}
                        </div>
                      ) : <EmptyState>该客户暂时没有可汇总的业务动态</EmptyState>}
                    </section>
                  </div>
                ) : null}

                {activeTab === 'contracts' ? (
                  <section className="customer360-table-card">
                    <div className="customer360-section-head">
                      <div><span>合同中心</span><h3>关联合同</h3></div>
                      <small>优先按客户 ID 精确关联</small>
                    </div>
                    {data.contracts.length ? (
                      <div className="customer360-table-wrap">
                        <table className="customer360-table">
                          <thead><tr><th>我司编号</th><th>客户原号</th><th>合同名称</th><th>游戏 / 渠道</th><th>金额</th><th>有效期</th><th>状态</th></tr></thead>
                          <tbody>
                            {data.contracts.map((contract) => (
                              <tr key={contract.id} onClick={() => void openContract(contract.id)}>
                                <td><strong>{text(contract.internal_contract_no)}</strong></td>
                                <td>{text(contract.contract_no)}</td>
                                <td>{text(contract.contract_name)}</td>
                                <td>{[joinText(contract.products), joinText(contract.channels)].filter((item) => item !== '-').join(' / ') || '-'}</td>
                                <td>{money(contract.amount)}</td>
                                <td>{dateText(contract.effective_date)} → {dateText(contract.end_date)}</td>
                                <td><span className={`customer360-status is-${contract.state}`}>{text(contract.performance_status, contract.state)}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <EmptyState>暂无关联合同</EmptyState>}
                  </section>
                ) : null}

                {activeTab === 'bills' ? (
                  <div className="customer360-bill-stack">
                    <section className="customer360-table-card">
                      <div className="customer360-section-head">
                        <div><span>核心对账</span><h3>研发账单</h3></div>
                        <small>{data.rd_bills.length} 条最近记录</small>
                      </div>
                      {data.rd_bills.length ? (
                        <div className="customer360-table-wrap">
                          <table className="customer360-table">
                            <thead><tr><th>账单编号</th><th>账期</th><th>游戏</th><th>结算金额</th><th>已付款</th><th>未付款</th><th>状态</th></tr></thead>
                            <tbody>
                              {data.rd_bills.map((bill) => (
                                <tr key={bill.id} onClick={() => openBill360?.('rd', bill.id)}>
                                  <td><strong>{text(bill.statement_no)}</strong></td>
                                  <td>{text(bill.settlement_month)}</td>
                                  <td>{text(bill.games)}</td>
                                  <td>{money(bill.settlement_amount)}</td>
                                  <td>{money(bill.paid_amount)}</td>
                                  <td>{money(bill.unpaid_amount)}</td>
                                  <td>{text(bill.payment_status || bill.status)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <EmptyState>暂无关联研发账单</EmptyState>}
                    </section>

                    <section className="customer360-table-card">
                      <div className="customer360-section-head">
                        <div><span>核心对账</span><h3>渠道账单</h3></div>
                        <small>{data.channel_bills.length} 条最近记录</small>
                      </div>
                      {data.channel_bills.length ? (
                        <div className="customer360-table-wrap">
                          <table className="customer360-table">
                            <thead><tr><th>账单编号</th><th>账期</th><th>游戏</th><th>结算金额</th><th>已回款</th><th>未回款</th><th>状态</th></tr></thead>
                            <tbody>
                              {data.channel_bills.map((bill) => (
                                <tr key={bill.id} onClick={() => openBill360?.('channel', bill.id)}>
                                  <td><strong>{text(bill.statement_no)}</strong></td>
                                  <td>{text(bill.settlement_month)}</td>
                                  <td>{text(bill.games)}</td>
                                  <td>{money(bill.settlement_amount)}</td>
                                  <td>{money(bill.received_amount)}</td>
                                  <td>{money(bill.unreceived_amount)}</td>
                                  <td>{text(bill.receipt_status || bill.status)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : <EmptyState>暂无关联渠道账单</EmptyState>}
                    </section>
                  </div>
                ) : null}

                {activeTab === 'invoices' ? (
                  <section className="customer360-table-card">
                    <div className="customer360-section-head">
                      <div><span>发票中心</span><h3>进项 / 销项发票</h3></div>
                      <small>{data.invoices.length} 条最近记录</small>
                    </div>
                    {data.invoices.length ? (
                      <div className="customer360-table-wrap">
                        <table className="customer360-table">
                          <thead><tr><th>方向</th><th>发票号码</th><th>开票日期</th><th>购方</th><th>销方</th><th>含税金额</th><th>税额</th><th>状态</th></tr></thead>
                          <tbody>
                            {data.invoices.map((invoice) => (
                              <tr key={invoice.id} onClick={() => openInvoice(invoice)}>
                                <td><span className={`customer360-direction is-${invoice.direction}`}>{invoice.direction === 'input' ? '进项' : '销项'}</span></td>
                                <td><strong>{text(invoice.invoice_no)}</strong></td>
                                <td>{dateText(invoice.invoice_date)}</td>
                                <td>{text(invoice.buyer_name)}</td>
                                <td>{text(invoice.seller_name)}</td>
                                <td>{money(invoice.amount)}</td>
                                <td>{money(invoice.tax_amount)}</td>
                                <td>{text(invoice.status || invoice.tax_status)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <EmptyState>暂无关联发票</EmptyState>}
                  </section>
                ) : null}

                {activeTab === 'funds' ? (
                  <section className="customer360-table-card">
                    <div className="customer360-section-head">
                      <div><span>资金管理</span><h3>银行流水 / 收付款</h3></div>
                      <button type="button" onClick={openBank}>打开流水台账</button>
                    </div>
                    {data.bank_transactions.length ? (
                      <div className="customer360-table-wrap">
                        <table className="customer360-table">
                          <thead><tr><th>日期</th><th>流水号</th><th>付款方</th><th>收款方</th><th>摘要</th><th>收入</th><th>支出</th><th>币种</th><th>关联账单</th></tr></thead>
                          <tbody>
                            {data.bank_transactions.map((tx) => (
                              <tr key={tx.id} onClick={openBank}>
                                <td>{dateText(tx.trade_date)}</td>
                                <td><strong>{text(tx.transaction_no)}</strong></td>
                                <td>{text(tx.payer_name)}</td>
                                <td>{text(tx.payee_name)}</td>
                                <td>{text(tx.summary)}</td>
                                <td>{tx.inflow ? currencyMoney(tx.inflow, tx.currency) : '-'}</td>
                                <td>{tx.outflow ? currencyMoney(tx.outflow, tx.currency) : '-'}</td>
                                <td>{text(tx.currency, 'CNY')}</td>
                                <td>{text(tx.reconciliation_no)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <EmptyState>暂无关联银行流水</EmptyState>}
                  </section>
                ) : null}
              </main>
            </>
          ) : null}
        </aside>
      </div>

      <ContractDetailsDrawer
        contract={selectedContract}
        onClose={() => setSelectedContract(null)}
        onEdit={() => {
          setSelectedContract(null)
          onClose?.()
          setActiveView?.(VIEWS.CONTRACTS)
          showToast?.('已打开合同台账，可继续编辑合同资料', 'info')
        }}
        onAttachmentUploaded={(contract) =>
          setSelectedContract((current) => ({
            ...contract,
            internal_contract_no:
              contract?.internal_contract_no || current?.internal_contract_no || ''
          }))
        }
        onToast={showToast}
      />
    </>
  )
}

export default Customer360Drawer