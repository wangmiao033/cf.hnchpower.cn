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

function RdReconciliationProgressPage() {
  const { recon, openReconciliationEdit } = useAppState()
  const [month, setMonth] = useState(null)
  const [query, setQuery] = useState('')

  const monthOptions = useMemo(
    () =>
      [...new Set((recon.records || []).map((record) => monthKey(record.settlementMonth)).filter(Boolean))]
        .sort((a, b) => b.localeCompare(a, 'zh-CN')),
    [recon.records]
  )

  const activeMonth = month === null ? monthOptions[0] || '' : month

  const records = useMemo(
    () =>
      (recon.records || []).filter(
        (record) => !activeMonth || monthKey(record.settlementMonth) === activeMonth
      ),
    [activeMonth, recon.records]
  )

  const monthSnapshot = useMemo(
    () =>
      summarizeRdReconciliationProgress(records, {
        month: activeMonth,
        settlementResolver: settlementAmount
      }),
    [activeMonth, records]
  )

  const snapshot = useMemo(() => {
    const keyword = clean(query).toLowerCase()
    if (!keyword) return monthSnapshot

    return {
      ...monthSnapshot,
      unresolved: monthSnapshot.unresolved.filter((record) =>
        [record.billNumber, record.partner, record.product]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      )
    }
  }, [monthSnapshot, query])

  const scopeLabel = activeMonth ? monthLabel(activeMonth) : '全部月份'

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
            <strong>{scopeLabel}</strong>
            <span>{records.length} 笔账单</span>
          </div>
        </div>
        <div className="core-recon-filters rd-progress-filters">
          <label className="core-recon-filter-control">
            <span>统计月份</span>
            <select
              value={activeMonth}
              aria-label="筛选对账进度账期"
              onChange={(event) => setMonth(event.target.value)}
            >
              <option value="">全部月份（汇总）</option>
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
              setMonth(monthOptions[0] || '')
              setQuery('')
            }}
          >
            回到最新月
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
