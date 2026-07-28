import React, { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import RdReconciliationProgressPanel from '@/components/reconciliation/RdReconciliationProgressPanel.jsx'
import ChannelReconciliationProgressPanel from '@/components/channel/ChannelReconciliationProgressPanel.jsx'
import { VIEWS } from '@/app/routes.js'
import {
  CHANNEL_PROGRESS_PREVIEW,
  summarizeChannelProgressMatrix
} from '@/domain/channel/channelReconciliationProgress.js'
import { summarizeRdReconciliationProgress } from '@/domain/reconciliation/rdReconciliationProgress.js'
import { totalReconciliationSettlementAmount } from '@/domain/settlement/calculateSettlementAmount.js'
import './CoreReconciliationPages.css'

const CHANNEL_PROGRESS_STORAGE_KEY = 'channel-reconciliation-progress-preview-v1'

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

function loadChannelProgressPreview() {
  try {
    const saved = window.localStorage.getItem(CHANNEL_PROGRESS_STORAGE_KEY)
    return saved ? JSON.parse(saved) : CHANNEL_PROGRESS_PREVIEW
  } catch {
    return CHANNEL_PROGRESS_PREVIEW
  }
}

function RdReconciliationProgressPage() {
  const { recon, showToast, openReconciliationEdit } = useAppState()
  const channelProgressFileRef = useRef(null)
  const [mode, setMode] = useState('game')
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [query, setQuery] = useState('')
  const [channelSnapshot, setChannelSnapshot] = useState(loadChannelProgressPreview)

  const gameMonthOptions = useMemo(
    () =>
      [...new Set((recon.records || []).map((record) => monthKey(record.settlementMonth)).filter(Boolean))]
        .sort((a, b) => b.localeCompare(a, 'zh-CN')),
    [recon.records]
  )

  const channelMonthOptions = useMemo(
    () => [monthKey(channelSnapshot.month)].filter(Boolean),
    [channelSnapshot.month]
  )

  const monthOptions = mode === 'game' ? gameMonthOptions : channelMonthOptions
  const activeMonth = selectedMonth === null
    ? monthOptions[0] || ''
    : selectedMonth === '' || monthOptions.includes(selectedMonth)
      ? selectedMonth
      : monthOptions[0] || ''

  const gameRecords = useMemo(
    () =>
      (recon.records || []).filter(
        (record) => !activeMonth || monthKey(record.settlementMonth) === activeMonth
      ),
    [activeMonth, recon.records]
  )

  const gameMonthSnapshot = useMemo(
    () =>
      summarizeRdReconciliationProgress(gameRecords, {
        month: activeMonth,
        settlementResolver: settlementAmount
      }),
    [activeMonth, gameRecords]
  )

  const gameSnapshot = useMemo(() => {
    const keyword = clean(query).toLowerCase()
    if (!keyword) return gameMonthSnapshot

    return {
      ...gameMonthSnapshot,
      unresolved: gameMonthSnapshot.unresolved.filter((record) =>
        [record.billNumber, record.partner, record.product]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      )
    }
  }, [gameMonthSnapshot, query])

  const visibleChannelSnapshot = useMemo(() => {
    const keyword = clean(query).toLowerCase()
    if (!keyword) return channelSnapshot

    return {
      ...channelSnapshot,
      unresolved: channelSnapshot.unresolved.filter((record) =>
        [record.product, record.channel]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      )
    }
  }, [channelSnapshot, query])

  const handleChannelProgressImport = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      let selectedSheet = null
      let matrix = null

      for (const sheetName of workbook.SheetNames) {
        const candidate = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
          header: 1,
          defval: '',
          raw: true
        })
        const hasProgressColumn = candidate
          .slice(0, 8)
          .some((row) => Array.isArray(row) && row.some((cell) => String(cell).trim() === '对账进度'))
        if (hasProgressColumn) {
          selectedSheet = sheetName
          matrix = candidate
          break
        }
      }

      if (!selectedSheet || !matrix) {
        throw new Error('未找到包含“对账进度”的工作表')
      }

      const summary = summarizeChannelProgressMatrix(matrix, {
        fileName: file.name,
        sheetName: selectedSheet
      })
      setChannelSnapshot(summary)
      setSelectedMonth(monthKey(summary.month))
      window.localStorage.setItem(CHANNEL_PROGRESS_STORAGE_KEY, JSON.stringify(summary))
      showToast(`已更新 ${summary.totals.rows} 条渠道流水进度`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '进度数据读取失败', 'error')
    }
  }

  const isGameMode = mode === 'game'
  const scopeLabel = activeMonth ? monthLabel(activeMonth) : '全部月份'
  const scopeCount = isGameMode ? gameRecords.length : channelSnapshot.totals.rows

  return (
    <PageContainer hideHeader className="core-recon-page rd-progress-page">
      <section className="core-recon-workbar rd-progress-workbar">
        <div className="core-recon-head">
          <div className="core-recon-title">
            <span className="core-recon-title-mark rd-progress-title-mark" aria-hidden="true">进</span>
            <div>
              <h1>对账进度</h1>
              <span>统一查看游戏账单与渠道流水的核对、结算和待处理进度</span>
            </div>
          </div>
          <div className="rd-progress-scope">
            <strong>{scopeLabel}</strong>
            <span>{scopeCount} {isGameMode ? '笔账单' : '条流水'}</span>
          </div>
        </div>
        <div className="core-recon-filters rd-progress-filters">
          <div className="rd-progress-mode-switch" role="group" aria-label="选择对账进度类型">
            <button
              type="button"
              className={isGameMode ? 'is-active' : ''}
              onClick={() => {
                setMode('game')
                setSelectedMonth(null)
                setQuery('')
              }}
            >
              游戏对账
            </button>
            <button
              type="button"
              className={!isGameMode ? 'is-active' : ''}
              onClick={() => {
                setMode('channel')
                setSelectedMonth(null)
                setQuery('')
              }}
            >
              渠道对账
            </button>
          </div>
          <label className="core-recon-filter-control">
            <span>统计月份</span>
            <select
              value={activeMonth}
              aria-label="筛选对账进度账期"
              onChange={(event) => setSelectedMonth(event.target.value)}
            >
              {isGameMode && <option value="">全部月份（汇总）</option>}
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
              placeholder={isGameMode ? '编号、客户或产品' : '产品或渠道'}
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

      {isGameMode ? (
        <RdReconciliationProgressPanel
          snapshot={gameSnapshot}
          onEdit={(id) => openReconciliationEdit(String(id), VIEWS.RECON_PROGRESS)}
        />
      ) : (
        <>
          <input
            ref={channelProgressFileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleChannelProgressImport}
            hidden
          />
          <ChannelReconciliationProgressPanel
            snapshot={visibleChannelSnapshot}
            expanded
            onImport={() => channelProgressFileRef.current?.click()}
          />
        </>
      )}
    </PageContainer>
  )
}

export default RdReconciliationProgressPage
