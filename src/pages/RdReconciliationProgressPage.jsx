import React, { useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import RdReconciliationProgressPanel from '@/components/reconciliation/RdReconciliationProgressPanel.jsx'
import { VIEWS } from '@/app/routes.js'
import { summarizeRdReconciliationProgress } from '@/domain/reconciliation/rdReconciliationProgress.js'
import { totalReconciliationSettlementAmount } from '@/domain/settlement/calculateSettlementAmount.js'
import './CoreReconciliationPages.css'

function clean(value) {
  return value == null ? '' : String(value).trim()
}

function monthKey(value) {
  const raw = clean(value)
  const match = raw.match(/^(\d{4})(?:-|年)\s*(\d{1,2})(?:月)?$/)
  if (!match) return raw
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
}

function monthLabel(value) {
  const match = monthKey(value).match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value
}

function settlementAmount(record) {
  const stored = Number.parseFloat(record?.settlementAmount)
  return Number.isFinite(stored) ? stored : totalReconciliationSettlementAmount(record)
}

function partnerName(record) {
  return clean(record?.partnerShortName || record?.partner || record?.partyBName)
}

function productName(record) {
  const items = Array.isArray(record?.items)
    ? record.items.map((item) => clean(item?.gameName)).filter(Boolean)
    : []
  return items.join('、') || clean(record?.game)
}

function RdReconciliationProgressPage() {
  const { recon, openReconciliationEdit } = useAppState()
  const [month, setMonth] = useState('')
  const [query, setQuery] = useState('')

  const monthOptions = useMemo(
    () =>
      [...new Set((recon.records || []).map((record) => monthKey(record.settlementMonth)).filter(Boolean))]
        .sort((a, b) => b.localeCompare(a, 'zh-CN')),
    [recon.records]
  )

  const records = useMemo(() => {
    const keyword = clean(query).toLowerCase()
    return (recon.records || []).filter((record) => {
      const matchesMonth = !month || monthKey(record.settlementMonth) === month
      const haystack = [
        record.settlementNumber,
        partnerName(record),
        productName(record)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return matchesMonth && (!keyword || haystack.includes(keyword))
    })
  }, [month, query, recon.records])

  const snapshot = useMemo(
    () =>
      summarizeRdReconciliationProgress(records, {
        month,
        settlementResolver: settlementAmount
      }),
    [month, records]
  )

  return (
    <PageContainer hideHeader className="core-recon-page rd-progress-page">
      <section className="core-recon-workbar rd-progress-workbar">
        <div className="core-recon-head">
          <div className="core-recon-title">
            <span className="core-recon-title-mark rd-progress-title-mark" aria-hidden="true">进</span>
            <div>
              <h1>对账进度</h1>
              <span>独立跟踪账单核对、结算与付款进度</span>
            </div>
          </div>
          <div className="rd-progress-scope">
            <strong>{records.length}</strong>
            <span>笔范围内账单</span>
          </div>
        </div>
        <div className="core-recon-filters rd-progress-filters">
          <label className="core-recon-filter-control">
            <span>账期</span>
            <select
              value={month}
              aria-label="筛选对账进度账期"
              onChange={(event) => setMonth(event.target.value)}
            >
              <option value="">全部账期</option>
              {monthOptions.map((value) => (
                <option key={value} value={value}>{monthLabel(value)}</option>
              ))}
            </select>
          </label>
          <label className="core-recon-filter-control core-recon-filter-search">
            <span>搜索</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="编号、客户或产品"
            />
          </label>
          <button
            type="button"
            className="core-recon-reset"
            onClick={() => {
              setMonth('')
              setQuery('')
            }}
          >
            重置
          </button>
        </div>
      </section>

      <RdReconciliationProgressPanel
        snapshot={snapshot}
        onEdit={(id) => openReconciliationEdit(String(id), VIEWS.RECON_PROGRESS)}
      />
    </PageContainer>
  )
}

export default RdReconciliationProgressPage
