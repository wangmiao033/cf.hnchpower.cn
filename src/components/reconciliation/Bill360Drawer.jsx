import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import {
  apiRowToFrontend,
  getReconciliationBankPayment,
  getReconciliationRecord,
  listBankPaymentAttachments,
  listReconciliationLinkedBankPayments
} from '@/lib/api/reconciliation.ts'
import {
  apiChannelRowToFrontend,
  getChannelRecord,
  listChannelReceipts
} from '@/lib/api/channel.ts'
import { getBillInvoiceSummary } from '@/lib/api/billInvoiceAllocations.ts'
import { listContracts } from '@/lib/api/contract.ts'
import { getQuickSdkGameFlow } from '@/lib/api/quicksdk.ts'
import {
  billAttachmentFileUrl,
  listBillAttachments
} from '@/lib/api/billAttachments.ts'
import {
  bill360Lines,
  bill360Number,
  bill360PartnerName,
  bill360QuickSdkKeys,
  filterBill360Contracts,
  summarizeBill360
} from '@/domain/reconciliation/bill360.js'
import BillOperationTimeline from './BillOperationTimeline.jsx'
import './Bill360Drawer.css'

const TABS = [
  ['overview', '总览'],
  ['lines', '账单明细'],
  ['invoice', '发票'],
  ['payment', '收付款'],
  ['contract', '合同'],
  ['history', '操作日志'],
  ['attachment', '附件']
]

const STATUS_TEXT = {
  pending: '待处理',
  confirmed: '已确认',
  invoiced: '已开票',
  completed: '已完成',
  settled: '已结算',
  reconciled: '已核销',
  cancelled: '已取消'
}

function money(value) {
  const number = Number(value || 0)
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function dateText(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'
  return raw.replace('T', ' ').slice(0, 19)
}

function monthText(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value || '-'
}

function text(value, fallback = '-') {
  const raw = value == null ? '' : String(value).trim()
  return raw || fallback
}

function loadErrorLabel(error) {
  return error instanceof Error ? error.message : '读取失败'
}

function ProgressBar({ value, tone = '' }) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)))
  return (
    <div className={`bill360-progress ${tone ? `is-${tone}` : ''}`}>
      <span style={{ width: `${safe}%` }} />
    </div>
  )
}

function Bill360Drawer({ target, onClose }) {
  const {
    setActiveView,
    openReconciliationEdit,
    openChannelReconciliationEdit
  } = useAppState()
  const [activeTab, setActiveTab] = useState('overview')
  const [record, setRecord] = useState(target?.initialRecord || null)
  const [invoiceSummary, setInvoiceSummary] = useState(null)
  const [quickSdkRows, setQuickSdkRows] = useState([])
  const [contracts, setContracts] = useState([])
  const [attachments, setAttachments] = useState([])
  const [payments, setPayments] = useState([])
  const [bankInstruction, setBankInstruction] = useState(null)
  const [bankAttachments, setBankAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const billType = target?.billType === 'channel' ? 'channel' : 'rd'
  const billId = String(target?.billId || '')

  useEffect(() => {
    setActiveTab('overview')
  }, [billType, billId])

  useEffect(() => {
    if (!billId) return undefined
    let cancelled = false
    setLoading(true)
    setError('')

    void (async () => {
      try {
        const apiRecord = billType === 'rd'
          ? apiRowToFrontend(await getReconciliationRecord(billId))
          : apiChannelRowToFrontend(await getChannelRecord(billId))
        if (cancelled) return
        setRecord(apiRecord)

        const partnerName = bill360PartnerName(billType, apiRecord)
        const partnerId = String(apiRecord?.partnerId || '')
        const quickKeys = bill360QuickSdkKeys(billType, apiRecord).slice(0, 30)

        const invoicePromise = getBillInvoiceSummary(billType, billId).catch(() => null)
        const contractPromise = listContracts({ q: partnerName, limit: 100, offset: 0 })
          .then((response) => filterBill360Contracts(response.items || [], partnerName, partnerId))
          .catch(() => [])
        const attachmentPromise = listBillAttachments(billType, billId).catch(() => [])
        const quickPromise = Promise.all(
          quickKeys.map(async (item) => {
            try {
              const result = await getQuickSdkGameFlow({
                settlement_month: item.month,
                game_name: item.game
              })
              return { ...result, lookupKey: item.key, lookupGame: item.game, lookupMonth: item.month }
            } catch (quickError) {
              return {
                lookupKey: item.key,
                lookupGame: item.game,
                lookupMonth: item.month,
                total_flow: 0,
                row_count: 0,
                error: loadErrorLabel(quickError)
              }
            }
          })
        )

        let paymentPromise
        if (billType === 'rd') {
          paymentPromise = Promise.all([
            listReconciliationLinkedBankPayments(billId).catch(() => ({ items: [] })),
            getReconciliationBankPayment(billId).catch(() => null),
            listBankPaymentAttachments(billId).catch(() => ({ items: [] }))
          ])
        } else {
          paymentPromise = listChannelReceipts(billId).catch(() => ({ items: [] }))
        }

        const [invoiceResult, contractResult, attachmentResult, quickResult, paymentResult] = await Promise.all([
          invoicePromise,
          contractPromise,
          attachmentPromise,
          quickPromise,
          paymentPromise
        ])
        if (cancelled) return

        setInvoiceSummary(invoiceResult)
        setContracts(contractResult)
        setAttachments(attachmentResult)
        setQuickSdkRows(quickResult)
        if (billType === 'rd') {
          setPayments(paymentResult?.[0]?.items || [])
          setBankInstruction(paymentResult?.[1] || null)
          setBankAttachments(paymentResult?.[2]?.items || [])
        } else {
          setPayments(paymentResult?.items || [])
          setBankInstruction(null)
          setBankAttachments([])
        }
      } catch (loadError) {
        if (!cancelled) setError(loadErrorLabel(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [billId, billType])

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const lines = useMemo(() => bill360Lines(billType, record || {}), [billType, record])
  const summary = useMemo(
    () => summarizeBill360({ billType, record: record || {}, invoiceSummary, quickSdkRows }),
    [billType, record, invoiceSummary, quickSdkRows]
  )
  const numberValue = bill360Number(billType, record || {}) || billId
  const partnerName = bill360PartnerName(billType, record || {})
  const gameNames = [...new Set(lines.map((line) => line.game).filter(Boolean))]
  const months = [...new Set(lines.map((line) => line.month).filter(Boolean))]

  const editBill = () => {
    onClose?.()
    if (billType === 'rd') {
      openReconciliationEdit(billId)
    } else {
      openChannelReconciliationEdit(billId)
    }
  }

  const navigate = (view) => {
    onClose?.()
    setActiveView(view)
  }

  const invoiceTone = invoiceSummary?.coverage_status === 'complete'
    ? 'good'
    : invoiceSummary?.coverage_status === 'over'
      ? 'danger'
      : 'warning'
  const paymentTone = summary.unpaidAmount <= 0.01 ? 'good' : summary.paidAmount > 0 ? 'warning' : 'muted'

  return (
    <div className="bill360-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.()
    }}>
      <aside className="bill360-drawer" role="dialog" aria-modal="true" aria-label="账单360详情">
        <header className="bill360-header">
          <div className="bill360-title-wrap">
            <span className={`bill360-type is-${billType}`}>{billType === 'rd' ? '研发' : '渠道'}</span>
            <div>
              <div className="bill360-eyebrow">账单 360°</div>
              <h2>{numberValue}</h2>
              <p>{[partnerName, gameNames.join('、'), months.map(monthText).join(' / ')].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <div className="bill360-header-actions">
            <span className={`bill360-status is-${String(record?.status || 'pending')}`}>
              {STATUS_TEXT[record?.status] || record?.status || '待处理'}
            </span>
            <button type="button" onClick={editBill}>编辑账单</button>
            <button type="button" className="bill360-close" onClick={onClose} aria-label="关闭">×</button>
          </div>
        </header>

        {error ? (
          <div className="bill360-error">
            <strong>账单详情读取失败</strong>
            <span>{error}</span>
            <button type="button" onClick={onClose}>关闭</button>
          </div>
        ) : (
          <>
            <section className="bill360-kpis">
              <article>
                <span>结算金额</span>
                <strong>{money(summary.settlementAmount)}</strong>
                <small>{billType === 'rd' ? `账单流水 ${money(summary.billFlow)}` : `计费流水 ${money(summary.billFlow)}`}</small>
              </article>
              <article>
                <span>{billType === 'rd' ? '已付款' : '已收款'}</span>
                <strong>{money(summary.paidAmount)}</strong>
                <small>剩余 {money(summary.unpaidAmount)}</small>
                <ProgressBar value={summary.paymentPercent} tone={paymentTone} />
              </article>
              <article>
                <span>发票覆盖</span>
                <strong>{invoiceSummary ? percent(summary.invoicePercent) : loading ? '读取中…' : '-'}</strong>
                <small>已关联 {money(summary.invoiceAllocated)} · 缺口 {money(summary.invoiceRemaining)}</small>
                <ProgressBar value={summary.invoicePercent} tone={invoiceTone} />
              </article>
              <article>
                <span>{billType === 'rd' ? '数据库核对' : '合同状态'}</span>
                {billType === 'rd' ? (
                  <>
                    <strong className={summary.flowMatched === false ? 'is-danger-text' : ''}>
                      {summary.flowMatched == null ? '暂无结果' : summary.flowMatched ? '流水一致' : `差异 ${money(summary.flowDifference)}`}
                    </strong>
                    <small>QuickSDK {money(summary.databaseFlow)}</small>
                  </>
                ) : (
                  <>
                    <strong>{contracts.some((item) => item.timeline_status === '生效中') ? '合同有效' : contracts.length ? '需核对' : '未匹配'}</strong>
                    <small>匹配 {contracts.length} 份合同</small>
                  </>
                )}
              </article>
            </section>

            <nav className="bill360-tabs" aria-label="账单详情模块">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={activeTab === key ? 'is-active' : ''}
                  onClick={() => setActiveTab(key)}
                >
                  {label}
                  {key === 'invoice' && invoiceSummary ? <em>{invoiceSummary.allocations?.length || 0}</em> : null}
                  {key === 'payment' ? <em>{payments.length}</em> : null}
                  {key === 'contract' ? <em>{contracts.length}</em> : null}
                  {key === 'attachment' ? <em>{attachments.length + bankAttachments.length}</em> : null}
                </button>
              ))}
            </nav>

            <main className="bill360-content">
              {loading && !record ? <div className="bill360-loading">正在汇总账单关联信息…</div> : null}

              {activeTab === 'overview' && (
                <div className="bill360-overview-grid">
                  <section className="bill360-card bill360-card--wide">
                    <div className="bill360-card-head">
                      <div><span>核心核对</span><h3>资金与数据闭环</h3></div>
                      <span className="bill360-card-meta">自动汇总</span>
                    </div>
                    <div className="bill360-check-list">
                      {billType === 'rd' && (
                        <div className={summary.flowMatched ? 'is-good' : summary.flowMatched === false ? 'is-danger' : 'is-neutral'}>
                          <span>数据库流水</span>
                          <strong>{money(summary.databaseFlow)}</strong>
                          <small>{summary.flowMatched == null ? '暂无可核对数据' : summary.flowMatched ? '与账单流水一致' : `与账单相差 ${money(summary.flowDifference)}`}</small>
                        </div>
                      )}
                      <div className={summary.unpaidAmount <= 0.01 ? 'is-good' : 'is-warning'}>
                        <span>{billType === 'rd' ? '付款进度' : '收款进度'}</span>
                        <strong>{percent(summary.paymentPercent)}</strong>
                        <small>{summary.unpaidAmount <= 0.01 ? '资金已结清' : `仍有 ${money(summary.unpaidAmount)} 未结`}</small>
                      </div>
                      <div className={invoiceTone === 'good' ? 'is-good' : invoiceTone === 'danger' ? 'is-danger' : 'is-warning'}>
                        <span>发票覆盖</span>
                        <strong>{invoiceSummary ? percent(summary.invoicePercent) : '-'}</strong>
                        <small>{invoiceSummary ? `剩余缺口 ${money(summary.invoiceRemaining)}` : '未读取到发票关联'}</small>
                      </div>
                      <div className={contracts.some((item) => item.timeline_status === '生效中') ? 'is-good' : contracts.length ? 'is-warning' : 'is-neutral'}>
                        <span>合同</span>
                        <strong>{contracts.length} 份</strong>
                        <small>{contracts.some((item) => item.timeline_status === '生效中') ? '存在生效中合同' : contracts.length ? '当前合同需核对有效期' : '未匹配合同'}</small>
                      </div>
                    </div>
                  </section>

                  <section className="bill360-card">
                    <div className="bill360-card-head"><div><span>账单信息</span><h3>基础资料</h3></div></div>
                    <dl className="bill360-detail-list">
                      <div><dt>账单编号</dt><dd>{numberValue}</dd></div>
                      <div><dt>合作方</dt><dd>{partnerName || '-'}</dd></div>
                      {billType === 'channel' ? <div><dt>渠道</dt><dd>{text(record?.channelName)}</dd></div> : null}
                      <div><dt>结算周期</dt><dd>{months.length ? months.map(monthText).join(' / ') : '-'}</dd></div>
                      <div><dt>产品</dt><dd>{gameNames.join('、') || '-'}</dd></div>
                      <div><dt>创建时间</dt><dd>{dateText(record?.createdAt || record?.created_at)}</dd></div>
                      <div><dt>备注</dt><dd>{text(record?.memo || record?.remark)}</dd></div>
                    </dl>
                  </section>

                  <section className="bill360-card">
                    <div className="bill360-card-head"><div><span>快捷处理</span><h3>关联模块</h3></div></div>
                    <div className="bill360-jump-list">
                      <button type="button" onClick={() => navigate(billType === 'rd' ? VIEWS.INVOICE_INPUT : VIEWS.INVOICE_MANAGE)}><span>票</span><div><strong>发票中心</strong><small>查看与调整发票覆盖</small></div></button>
                      <button type="button" onClick={() => navigate(VIEWS.CONTRACTS)}><span>合</span><div><strong>合同中心</strong><small>查看合作方合同与有效期</small></div></button>
                      {billType === 'rd' ? <button type="button" onClick={() => navigate(VIEWS.QUICKSDK_LIBRARY)}><span>流</span><div><strong>数据库</strong><small>核对 QuickSDK 原始流水</small></div></button> : null}
                      <button type="button" onClick={editBill}><span>编</span><div><strong>编辑账单</strong><small>进入完整账单编辑表单</small></div></button>
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'lines' && (
                <section className="bill360-card bill360-card--table">
                  <div className="bill360-card-head"><div><span>明细</span><h3>{lines.length} 条账单明细</h3></div></div>
                  <div className="bill360-table-wrap">
                    <table>
                      <thead><tr><th>账期</th><th>游戏</th><th className="is-right">流水</th><th className="is-right">折扣</th><th className="is-right">分成比例</th><th className="is-right">税率</th><th className="is-right">结算金额</th></tr></thead>
                      <tbody>{lines.map((line) => <tr key={line.key}><td>{monthText(line.month)}</td><td>{line.game || '-'}</td><td className="is-right">{money(line.flow)}</td><td className="is-right">{line.discount || '-'}</td><td className="is-right">{percent(line.shareRate)}</td><td className="is-right">{percent(line.taxRate)}</td><td className="is-right is-strong">{money(line.settlementAmount)}</td></tr>)}</tbody>
                    </table>
                  </div>
                  {billType === 'rd' && quickSdkRows.length > 0 ? (
                    <div className="bill360-database-lines">
                      <h4>QuickSDK 对应流水</h4>
                      {quickSdkRows.map((row) => <div key={row.lookupKey}><span>{monthText(row.lookupMonth)} · {row.lookupGame}</span><strong>{money(row.total_flow)}</strong><small>{row.error ? row.error : `${row.row_count || 0} 条原始流水`}</small></div>)}
                    </div>
                  ) : null}
                </section>
              )}

              {activeTab === 'invoice' && (
                <section className="bill360-card bill360-card--table">
                  <div className="bill360-card-head"><div><span>发票闭环</span><h3>{invoiceSummary ? `${percent(summary.invoicePercent)} 已覆盖` : '暂无关联摘要'}</h3></div><button type="button" onClick={() => navigate(billType === 'rd' ? VIEWS.INVOICE_INPUT : VIEWS.INVOICE_MANAGE)}>进入发票中心</button></div>
                  <div className="bill360-invoice-summary"><div><span>账单金额</span><strong>{money(summary.settlementAmount)}</strong></div><div><span>已分配</span><strong>{money(summary.invoiceAllocated)}</strong></div><div><span>剩余</span><strong>{money(summary.invoiceRemaining)}</strong></div></div>
                  <div className="bill360-table-wrap">
                    <table><thead><tr><th>发票号码</th><th>往来单位</th><th>开票日期</th><th className="is-right">发票金额</th><th className="is-right">本账单分配</th><th>匹配方式</th></tr></thead><tbody>
                      {(invoiceSummary?.allocations || []).length === 0 ? <tr><td colSpan={6} className="bill360-empty-cell">暂无已关联发票</td></tr> : (invoiceSummary.allocations || []).map((allocation) => <tr key={allocation.id}><td>{allocation.invoice?.number || '-'}</td><td>{allocation.invoice?.counterparty_name || '-'}</td><td>{allocation.invoice?.issue_date || '-'}</td><td className="is-right">{money(allocation.invoice?.gross_amount)}</td><td className="is-right is-strong">{money(allocation.allocated_gross_amount)}</td><td>{allocation.match_type || 'manual'}</td></tr>)}
                    </tbody></table>
                  </div>
                </section>
              )}

              {activeTab === 'payment' && (
                <section className="bill360-card bill360-card--table">
                  <div className="bill360-card-head"><div><span>资金闭环</span><h3>{billType === 'rd' ? '付款记录' : '收款记录'}</h3></div><span className="bill360-card-meta">{payments.length} 笔</span></div>
                  {billType === 'rd' && bankInstruction ? (
                    <div className="bill360-bank-instruction"><div><span>付款指令</span><strong>{bankInstruction.transaction_serial || '未填写流水号'}</strong></div><div><span>指令金额</span><strong>{money(bankInstruction.remittance_amount)}</strong></div><div><span>付款日期</span><strong>{bankInstruction.payment_date || '-'}</strong></div><div><span>状态</span><strong>{bankInstruction.transfer_status || '-'}</strong></div></div>
                  ) : null}
                  <div className="bill360-table-wrap">
                    <table><thead><tr><th>日期</th><th>{billType === 'rd' ? '付款方 / 收款方' : '银行账户'}</th><th>流水号 / 备注</th><th className="is-right">金额</th><th>状态</th></tr></thead><tbody>
                      {payments.length === 0 ? <tr><td colSpan={5} className="bill360-empty-cell">暂无{billType === 'rd' ? '付款' : '收款'}记录</td></tr> : payments.map((payment) => billType === 'rd' ? <tr key={payment.id}><td>{payment.trade_date || '-'}</td><td>{[payment.payer_name, payment.payee_name].filter(Boolean).join(' → ') || '-'}</td><td>{payment.transaction_no || payment.summary || payment.remark || '-'}</td><td className="is-right is-strong">{money(payment.linked_amount ?? payment.expense_amount ?? payment.amount)}</td><td>{payment.status || '-'}</td></tr> : <tr key={payment.id}><td>{payment.receipt_date || '-'}</td><td>{payment.bank_account || '-'}</td><td>{payment.remark || '-'}</td><td className="is-right is-strong">{money(payment.amount)}</td><td>已登记</td></tr>)}
                    </tbody></table>
                  </div>
                </section>
              )}

              {activeTab === 'contract' && (
                <section className="bill360-card bill360-card--table">
                  <div className="bill360-card-head"><div><span>业务依据</span><h3>合作方合同</h3></div><button type="button" onClick={() => navigate(VIEWS.CONTRACTS)}>进入合同中心</button></div>
                  <div className="bill360-contracts">
                    {contracts.length === 0 ? <div className="bill360-empty-block">没有匹配到该合作方合同。</div> : contracts.map((contract) => <article key={contract.id}><div><span className={`bill360-contract-status is-${contract.timeline_status}`}>{contract.timeline_status || '未判断'}</span><h4>{contract.contract_name || contract.contract_no || '未命名合同'}</h4><p>{contract.contract_no || '无合同编号'} · {contract.contract_type || '未分类'}</p></div><dl><div><dt>合作方</dt><dd>{contract.partner_short_name || contract.partner_name || contract.counterparty || '-'}</dd></div><div><dt>有效期</dt><dd>{contract.effective_date || '-'} ～ {contract.end_date || '-'}</dd></div><div><dt>金额</dt><dd>{contract.amount ? money(contract.amount) : '-'}</dd></div></dl></article>)}
                  </div>
                </section>
              )}

              {activeTab === 'history' && (
                <BillOperationTimeline billType={billType} billId={billId} />
              )}

              {activeTab === 'attachment' && (
                <section className="bill360-card">
                  <div className="bill360-card-head"><div><span>资料归档</span><h3>账单与付款附件</h3></div><span className="bill360-card-meta">共 {attachments.length + bankAttachments.length} 个</span></div>
                  <div className="bill360-attachments">
                    {attachments.map((attachment) => <a key={attachment.id} href={billAttachmentFileUrl(billType, billId, attachment.id, true)} target="_blank" rel="noreferrer"><span>账</span><div><strong>{attachment.file_name}</strong><small>{attachment.file_type || '文件'} · {attachment.file_size ? `${Math.ceil(attachment.file_size / 1024)} KB` : '-'}</small></div><em>预览</em></a>)}
                    {bankAttachments.map((attachment) => <a key={attachment.id} href={attachment.file_url} target="_blank" rel="noreferrer"><span>付</span><div><strong>{attachment.file_name}</strong><small>{attachment.file_type || '付款附件'}</small></div><em>打开</em></a>)}
                    {attachments.length + bankAttachments.length === 0 ? <div className="bill360-empty-block">当前账单没有附件。</div> : null}
                  </div>
                </section>
              )}
            </main>
          </>
        )}
      </aside>
    </div>
  )
}

export default Bill360Drawer
