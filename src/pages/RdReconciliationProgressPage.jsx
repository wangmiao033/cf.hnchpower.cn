import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import AdminDrawerLayout from '@/components/admin/AdminDrawerLayout.jsx'
import BillScanAttachments from '@/components/billing/BillScanAttachments.jsx'
import BillInvoiceAllocationPanel from '@/components/invoice/BillInvoiceAllocationPanel.jsx'
import ChannelBillProgressPanel from '@/components/channel/ChannelBillProgressPanel.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import RdReconciliationProgressPanel from '@/components/reconciliation/RdReconciliationProgressPanel.jsx'
import { summarizeChannelBillProgress } from '@/domain/channel/channelBillProgress.js'
import { summarizeRdReconciliationProgress } from '@/domain/reconciliation/rdReconciliationProgress.js'
import { totalReconciliationSettlementAmount } from '@/domain/settlement/calculateSettlementAmount.js'
import { getBillInvoiceSummary } from '@/lib/api/billInvoiceAllocations.ts'
import '@/components/reconciliation/reconciliation-admin.css'
import './CoreReconciliationPages.css'

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function monthKey(value) {
  const raw = clean(value)
  const match = raw.match(/^(\d{4})(?:-|年)\s*(\d{1,2})/)
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : raw
}

function monthLabel(value) {
  const match = monthKey(value).match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value
}

function settlementAmount(record) {
  const stored = Number.parseFloat(record?.settlementAmount)
  return Number.isFinite(stored)
    ? stored
    : totalReconciliationSettlementAmount(record)
}

function invoiceSummaryKey(billType, billId) {
  return `${billType}:${billId}`
}

export default function RdReconciliationProgressPage() {
  const {
    recon,
    showToast,
    openReconciliationEdit,
    openChannelReconciliationEdit
  } = useAppState()
  const [mode, setMode] = useState('game')
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [query, setQuery] = useState('')
  const [selectedBill, setSelectedBill] = useState(null)
  const [invoiceSummaries, setInvoiceSummaries] = useState({})
  const [invoiceRevision, setInvoiceRevision] = useState(0)

  useEffect(() => {
    if (!selectedBill) return undefined
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setSelectedBill(null)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedBill])

  const gameRecords = recon.records || []
  const channelRecords = recon.channelRecords || []

  const monthOptions = useMemo(() => {
    const source = mode === 'game' ? gameRecords : channelRecords
    return Array.from(
      new Set(
        source
          .map((record) =>
            monthKey(
              mode === 'game'
                ? record.month || record.settlementMonth
                : record.settlementMonth || record.billMonth || record.month
            )
          )
          .filter(Boolean)
      )
    ).sort((a, b) => b.localeCompare(a))
  }, [channelRecords, gameRecords, mode])

  const activeMonth =
    selectedMonth && monthOptions.includes(selectedMonth)
      ? selectedMonth
      : monthOptions[0] || ''

  const gameSnapshot = useMemo(() => {
    const keyword = clean(query).toLowerCase()
    const records = gameRecords.filter((record) => {
      if (activeMonth && monthKey(record.month || record.settlementMonth) !== activeMonth) {
        return false
      }
      if (!keyword) return true
      return [
        record.billNumber,
        record.code,
        record.partnerShortName,
        record.partnerName,
        record.gameName,
        ...(record.items || []).map((item) => item.gameName)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })

    return summarizeRdReconciliationProgress(records, {
      month: activeMonth,
      settlementResolver: settlementAmount
    })
  }, [activeMonth, gameRecords, query])

  const channelMonthSnapshot = useMemo(
    () => summarizeChannelBillProgress(channelRecords, { month: activeMonth }),
    [activeMonth, channelRecords]
  )

  const channelSnapshot = useMemo(() => {
    const keyword = clean(query).toLowerCase()
    if (!keyword) return channelMonthSnapshot

    return {
      ...channelMonthSnapshot,
      unresolved: channelMonthSnapshot.unresolved.filter((row) =>
        [row.billNumber, row.channel, row.partner, row.product]
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      )
    }
  }, [channelMonthSnapshot, query])

  const scopeCount =
    mode === 'game'
      ? gameSnapshot?.totals?.rows || 0
      : channelMonthSnapshot?.totals?.rows || 0

  const visibleInvoiceBills = useMemo(() => {
    const rows = mode === 'game' ? gameSnapshot.rows : channelSnapshot.rows
    return (rows || [])
      .map((row) => ({
        billType: mode === 'game' ? 'rd' : 'channel',
        billId: String(mode === 'game' ? row.billId || '' : row.id || '')
      }))
      .filter((row) => row.billId)
  }, [channelSnapshot.rows, gameSnapshot.rows, mode])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        visibleInvoiceBills.map(async ({ billType, billId }) => {
          try {
            return [invoiceSummaryKey(billType, billId), await getBillInvoiceSummary(billType, billId)]
          } catch {
            return [billId, null]
          }
        })
      )
      if (!cancelled) setInvoiceSummaries(Object.fromEntries(entries.filter(([, value]) => value)))
    })()
    return () => {
      cancelled = true
    }
  }, [invoiceRevision, visibleInvoiceBills])

  function changeMode(nextMode) {
    setMode(nextMode)
    setSelectedMonth(null)
    setQuery('')
  }

  return (
    <PageContainer hideHeader className="core-recon-page rd-progress-page">
      <section className="core-recon-workbar rd-progress-workbar">
        <div className="core-recon-head">
          <div className="core-recon-title">
            <span className="core-recon-title-mark rd-progress-title-mark">进</span>
            <div>
              <h1>对账进度</h1>
              <p>统一查看游戏账单与渠道账单的核对、结算和待处理进度</p>
            </div>
          </div>
          <div className="rd-progress-scope">
            <strong>{monthLabel(activeMonth) || '全部账期'}</strong>
            <span>{scopeCount} {mode === 'game' ? '笔账单' : '笔渠道账单'}</span>
          </div>
        </div>

        <div className="core-recon-filters rd-progress-filters">
          <div className="rd-progress-mode-switch" role="group" aria-label="对账类型">
            <button
              type="button"
              className={mode === 'game' ? 'is-active' : ''}
              onClick={() => changeMode('game')}
            >
              游戏对账
            </button>
            <button
              type="button"
              className={mode === 'channel' ? 'is-active' : ''}
              onClick={() => changeMode('channel')}
            >
              渠道对账
            </button>
          </div>

          <label className="core-recon-filter-control">
            <span>统计月份</span>
            <select
              value={activeMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
            >
              {monthOptions.length === 0 && <option value="">暂无账期</option>}
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </label>

          <label className="core-recon-filter-search">
            <span>搜索</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                mode === 'game'
                  ? '编号、客户或产品'
                  : '编号、渠道、合作方或产品'
              }
            />
          </label>

          <button
            type="button"
            className="core-recon-reset"
            onClick={() => {
              setSelectedMonth(null)
              setQuery('')
            }}
          >
            回到最新月
          </button>
        </div>
      </section>

      {mode === 'game' ? (
        <RdReconciliationProgressPanel
          snapshot={gameSnapshot}
          onEdit={(id) => openReconciliationEdit(String(id), VIEWS.RECON_PROGRESS)}
          onViewAttachments={(row) => setSelectedBill({
            panel: 'attachments',
            billType: 'rd',
            billId: row.billId,
            billNumber: row.billNumber
          })}
          onViewInvoices={(row) => setSelectedBill({
            panel: 'invoices',
            billType: 'rd',
            billId: row.billId,
            billNumber: row.billNumber
          })}
          invoiceSummaries={invoiceSummaries}
        />
      ) : (
        <ChannelBillProgressPanel
          snapshot={channelSnapshot}
          onEditBill={(id) => openChannelReconciliationEdit(String(id), VIEWS.RECON_PROGRESS)}
          onViewAttachments={(row) => setSelectedBill({
            panel: 'attachments',
            billType: 'channel',
            billId: row.id,
            billNumber: row.billNumber
          })}
          onViewInvoices={(row) => setSelectedBill({
            panel: 'invoices',
            billType: 'channel',
            billId: row.id,
            billNumber: row.billNumber
          })}
          invoiceSummaries={invoiceSummaries}
        />
      )}

      {selectedBill && (
        <>
          <button
            type="button"
            className="rec-drawer-backdrop"
            aria-label="关闭账单管理"
            onClick={() => setSelectedBill(null)}
          />
          <AdminDrawerLayout
            className="rec-drawer rec-drawer--wide rec-drawer--light"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bill-detail-drawer-title"
          >
            <div className="rec-drawer__head">
              <h2 id="bill-detail-drawer-title" className="rec-drawer__title">
                {selectedBill.panel === 'invoices' ? '账单发票' : '账单附件'}
                <span className="rec-drawer__title-sub"> · {selectedBill.billNumber || selectedBill.billId}</span>
              </h2>
              <button
                type="button"
                className="rec-drawer__close"
                onClick={() => setSelectedBill(null)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className="rec-drawer__body">
              {selectedBill.panel === 'invoices' ? (
                <BillInvoiceAllocationPanel
                  billType={selectedBill.billType}
                  billId={selectedBill.billId}
                  showToast={showToast}
                  onChanged={() => setInvoiceRevision((value) => value + 1)}
                />
              ) : (
                <BillScanAttachments
                  billType={selectedBill.billType}
                  billId={selectedBill.billId}
                />
              )}
            </div>
          </AdminDrawerLayout>
        </>
      )}
    </PageContainer>
  )
}
