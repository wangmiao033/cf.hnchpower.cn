import React, { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import ChannelReceiptDrawer from '@/components/channel/ChannelReceiptDrawer.jsx'
import { VIEWS } from '@/app/routes.js'
import {
  buildChannelBillFromSingleGameForm,
  normalizeChannelSettlementCycle
} from '@/domain/channel/channelBillingForm.js'
import {
  getChannelReceivedAmount,
  getChannelTotals,
  isChannelReceiptSettled,
  sumChannelNumericLines
} from '@/domain/channel/channelAggregates.js'
import { parseChannelStatementWorkbook } from '@/domain/channel/channelStatementImport.js'
import { getChannelBillNumber } from '@/utils/channelBillNumber.js'
import '@/components/reconciliation/reconciliation-admin.css'
import './CoreReconciliationPages.css'

const STATUS_LABELS = {
  pending: '待处理',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消'
}

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function text(value, fallback = '-') {
  const raw = value == null ? '' : String(value).trim()
  return raw || fallback
}

function monthKey(value) {
  return normalizeChannelSettlementCycle(value)
}

function monthLabel(value) {
  const normalized = monthKey(value)
  const match = normalized.match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : normalized
}

function channelMonths(record) {
  const fromItems = Array.isArray(record?.items)
    ? record.items.map((item) => monthKey(item?.settlementCycle)).filter(Boolean)
    : []
  const values = fromItems.length ? fromItems : [monthKey(record?.settlementMonth)].filter(Boolean)
  return [...new Set(values)].sort()
}

function channelPeriodLabel(record) {
  const months = channelMonths(record)
  if (!months.length) return '-'
  if (months.length === 1) return monthLabel(months[0])
  const short = (value) => value.replace('-', '.')
  return `${short(months[0])}–${short(months[months.length - 1])} · ${months.length}个月`
}

function channelGames(record) {
  const rawNames = Array.isArray(record?.items) && record.items.length > 0
    ? record.items.map((item) => item?.gameName)
    : String(record?.gameName || '').split(/[、,，]/)
  const seen = new Set()
  const names = []
  rawNames.forEach((value) => {
    const name = String(value || '').trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    names.push(name)
  })
  return names
}

function CoreChannelReconciliationPage() {
  const {
    recon,
    settings,
    showToast,
    setActiveView,
    openChannelReconciliationEdit,
    openBill360
  } = useAppState()
  const fileRef = useRef(null)
  const [month, setMonth] = useState('')
  const [channel, setChannel] = useState('')
  const [channelDraft, setChannelDraft] = useState('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [isDeleting, setIsDeleting] = useState(false)
  const [receiptRecord, setReceiptRecord] = useState(null)

  const monthOptions = useMemo(
    () => [...new Set((recon.channelRecords || []).flatMap(channelMonths))].sort((a, b) => b.localeCompare(a)),
    [recon.channelRecords]
  )

  const channelOptions = useMemo(
    () => [...new Set((recon.channelRecords || []).map((row) => text(row.channelName, '')).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [recon.channelRecords]
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const channelQuery = channel.trim().toLowerCase()
    return (recon.channelRecords || []).filter((row) => {
      const rowMonths = channelMonths(row)
      const matchesMonth = !month || rowMonths.includes(month)
      const matchesChannel = !channelQuery || text(row.channelName, '').toLowerCase().includes(channelQuery)
      const matchesStatus = !status || String(row.status || 'pending') === status
      const haystack = [
        getChannelBillNumber(row), row.channelName, row.partnerName,
        ...channelGames(row), ...rowMonths, row.remark
      ].filter(Boolean).join(' ').toLowerCase()
      return matchesMonth && matchesChannel && matchesStatus && (!q || haystack.includes(q))
    })
  }, [recon.channelRecords, month, channel, status, query])

  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.includes(String(row.id))), [rows, selectedIds])
  const allVisibleSelected = rows.length > 0 && selectedRows.length === rows.length
  const partiallyVisibleSelected = selectedRows.length > 0 && !allVisibleSelected

  const stats = useMemo(() => {
    const settlement = rows.reduce((sum, row) => sum + getChannelTotals(row).settlementAmount, 0)
    const received = rows.reduce((sum, row) => sum + getChannelReceivedAmount(row), 0)
    const unpaid = Math.max(0, settlement - received)
    const channels = new Set(rows.map((row) => text(row.channelName, '')).filter(Boolean))
    const games = new Set(rows.flatMap(channelGames))
    return [
      { label: '账单数量', value: rows.length },
      { label: '渠道', value: channels.size },
      { label: '产品', value: games.size },
      { label: '渠道应收', value: money(settlement), note: `已收 ${money(received)} · 未收 ${money(unpaid)}` }
    ]
  }, [rows])

  const toggleSelected = (id) => {
    const sid = String(id)
    setSelectedIds((prev) => (prev.includes(sid) ? prev.filter((item) => item !== sid) : [...prev, sid]))
  }

  const toggleSelectAll = () => {
    const visibleIds = rows.map((row) => String(row.id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return [...next]
    })
  }

  const handleBulkDelete = async () => {
    if (selectedRows.length === 0 || isDeleting) return
    if (!window.confirm(`确定永久删除选中的 ${selectedRows.length} 条渠道账单吗？此操作不可恢复。`)) return
    setIsDeleting(true)
    try {
      const result = await recon.onChannelDeleteRecordsBatch(selectedRows.map((row) => row.id))
      const deletedIds = new Set(result?.deletedIds || [])
      setSelectedIds((prev) => prev.filter((id) => !deletedIds.has(String(id))))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSingleDelete = async (row) => {
    if (isDeleting) return
    if (!window.confirm(`确定删除渠道账单“${getChannelBillNumber(row)}”吗？此操作不可恢复。`)) return
    setIsDeleting(true)
    try {
      const deleted = await recon.onChannelDeleteRecord(row.id)
      if (deleted) setSelectedIds((prev) => prev.filter((id) => id !== String(row.id)))
    } finally {
      setIsDeleting(false)
    }
  }

  const exportRows = () => {
    const target = selectedRows.length > 0 ? selectedRows : rows
    if (!target.length) {
      showToast('没有可导出的渠道账单', 'error')
      return
    }
    const data = target.map((row) => {
      const totals = getChannelTotals(row)
      const received = getChannelReceivedAmount(row)
      const games = channelGames(row)
      const months = channelMonths(row)
      return {
        结算周期: channelPeriodLabel(row),
        月份数: months.length,
        编号: getChannelBillNumber(row),
        渠道: row.channelName || '',
        合作方: row.partnerName || '',
        产品数量: games.length,
        产品: games.join('、'),
        计费流水: totals.flow,
        计费金额: sumChannelNumericLines(row, 'billingAmount'),
        分成金额: sumChannelNumericLines(row, 'shareAmount'),
        通道费: sumChannelNumericLines(row, 'gatewayCost'),
        渠道应收: totals.settlementAmount,
        已收款: received,
        未收款: Math.max(0, totals.settlementAmount - received),
        收款状态: isChannelReceiptSettled(row) ? '已结清' : received > 0 ? '部分收款' : '未收款',
        状态: STATUS_LABELS[row.status] || row.status || '待处理',
        备注: row.remark || ''
      }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '渠道账单')
    XLSX.writeFile(wb, `渠道账单_${new Date().toISOString().slice(0, 10)}.xlsx`)
    showToast(`已导出 ${target.length} 条渠道账单`, 'success')
  }

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const structured = parseChannelStatementWorkbook(workbook, file.name)
      if (structured.detected) {
        await recon.onChannelAddRecordsBatch(structured.records)
        const detailCount = structured.records.reduce((sum, record) => sum + (record.items?.length || 0), 0)
        showToast(`已导入 ${structured.records.length} 张渠道账单，共 ${detailCount} 条游戏明细`, 'success')
        return
      }
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const importRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const records = importRows.map(mapChannelImportRow).filter(Boolean)
      if (!records.length) {
        showToast('没有识别到可导入的渠道对账数据', 'error')
        return
      }
      await recon.onChannelAddRecordsBatch(records)
      showToast(`已导入 ${records.length} 条渠道账单`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入失败，请检查 Excel 格式', 'error')
    }
  }

  return (
    <PageContainer hideHeader className="core-recon-page core-channel-recon-page">
      <section className="core-recon-workbar">
        <div className="core-recon-head">
          <div className="core-recon-title">
            <span className="core-recon-title-mark" aria-hidden="true">渠</span>
            <div><h1>渠道账单</h1><span>{rows.length} 笔账单</span></div>
          </div>
          <div className="core-recon-actions">
            <button type="button" onClick={() => fileRef.current?.click()}>导入 Excel</button>
            <button type="button" onClick={exportRows}>导出</button>
            <button type="button" className="primary" onClick={() => setActiveView(VIEWS.CHANNEL_RECON_CREATE)}>新增账单</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImportFile} hidden />
          </div>
        </div>
        <div className="core-recon-filters">
          <label className="core-recon-filter-control">
            <span>月份</span>
            <select value={month} aria-label="筛选明细结算月份" onChange={(event) => setMonth(event.target.value)}>
              <option value="">全部月份</option>
              {monthOptions.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
            </select>
          </label>
          <div className="core-recon-filter-control core-recon-partner-filter">
            <span>渠道</span>
            <input
              type="search" list="core-channel-options" value={channelDraft}
              onChange={(event) => setChannelDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault(); setChannel(channelDraft.trim()); setSelectedIds([])
                }
              }}
              placeholder="输入渠道名称" aria-label="搜索渠道"
            />
            <datalist id="core-channel-options">{channelOptions.map((name) => <option key={name} value={name} />)}</datalist>
            <button type="button" className="core-recon-partner-submit" onClick={() => { setChannel(channelDraft.trim()); setSelectedIds([]) }}>搜索</button>
          </div>
          <label className="core-recon-filter-control">
            <span>状态</span>
            <select value={status} aria-label="筛选渠道账单状态" onChange={(event) => setStatus(event.target.value)}>
              <option value="">全部状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="core-recon-filter-control core-recon-filter-search">
            <span>关键词</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="渠道、合作方、产品或月份" />
          </label>
          <button type="button" className="core-recon-reset" onClick={() => {
            setMonth(''); setChannel(''); setChannelDraft(''); setStatus(''); setQuery(''); setSelectedIds([])
          }}>重置</button>
        </div>
      </section>

      <section className="core-recon-stats">
        {stats.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.note && <small>{item.note}</small>}</div>)}
      </section>

      <section className="core-recon-panel">
        <div className="core-recon-panel-head">
          <h2>账单列表</h2>
          <div className="core-recon-panel-tools">
            <span>{selectedRows.length > 0 ? `已选 ${selectedRows.length} 条` : `${rows.length} 条`}</span>
            {selectedRows.length > 0 && (
              <div className="core-recon-selection-actions">
                <button type="button" onClick={() => setSelectedIds([])} disabled={isDeleting}>取消选择</button>
                <button type="button" className="danger" onClick={handleBulkDelete} disabled={isDeleting}>{isDeleting ? '删除中…' : `删除所选（${selectedRows.length}）`}</button>
              </div>
            )}
          </div>
        </div>
        <div className="core-recon-table-wrap">
          <table className="core-recon-table core-channel-recon-table">
            <colgroup>
              <col className="core-channel-col-month" style={{ width: 150 }} />
              <col className="core-channel-col-number" />
              <col className="core-channel-col-channel" />
              <col className="core-channel-col-partner" />
              <col className="core-channel-col-game" style={{ width: 180 }} />
              <col className="core-channel-col-flow" />
              <col className="core-channel-col-share" />
              <col className="core-channel-col-settlement" />
              <col className="core-channel-col-received" style={{ width: 150 }} />
              <col className="core-channel-col-status" />
              <col className="core-channel-col-actions" style={{ width: 155 }} />
            </colgroup>
            <thead>
              <tr>
                <th><label className="core-recon-select-all"><input ref={(node) => { if (node) node.indeterminate = partiallyVisibleSelected }} type="checkbox" aria-label="全选当前筛选结果" checked={allVisibleSelected} disabled={!rows.length || isDeleting} onChange={toggleSelectAll} /><span>结算周期</span></label></th>
                <th>编号</th><th>渠道</th><th>合作方</th><th>产品</th>
                <th className="core-recon-align-right">计费流水</th><th className="core-recon-align-right">分成金额</th>
                <th className="core-recon-align-right">渠道应收</th><th className="core-recon-align-right">已收 / 未收</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length ? <tr><td colSpan={11} className="core-recon-empty">暂无渠道账单</td></tr> : rows.map((row) => {
                const totals = getChannelTotals(row)
                const games = channelGames(row)
                const received = getChannelReceivedAmount(row)
                const unpaid = Math.max(0, totals.settlementAmount - received)
                const settled = isChannelReceiptSettled(row)
                const gameText = games.join('、')
                const periodText = channelPeriodLabel(row)
                return (
                  <tr key={row.id} className={selectedIds.includes(String(row.id)) ? 'is-selected' : ''}>
                    <td className="core-rd-month-cell">
                      <input type="checkbox" aria-label={`选择渠道账单 ${text(row.channelName)} ${periodText}`} checked={selectedIds.includes(String(row.id))} disabled={isDeleting} onChange={() => toggleSelected(row.id)} />
                      <span title={channelMonths(row).map(monthLabel).join('、')}>{periodText}</span>
                    </td>
                    <td className="core-recon-number">{getChannelBillNumber(row)}</td>
                    <td><strong className="core-recon-partner-short-name" title={text(row.channelName)}>{text(row.channelName)}</strong></td>
                    <td><span className="core-recon-game-text" title={text(row.partnerName)}>{text(row.partnerName)}</span></td>
                    <td><span className="core-recon-game-text" title={gameText || '-'}>{games.length > 1 ? `${games.length}个 · ${gameText}` : text(gameText)}</span></td>
                    <td className="core-recon-money">{money(totals.flow)}</td>
                    <td className="core-recon-money">{money(sumChannelNumericLines(row, 'shareAmount'))}</td>
                    <td className="core-recon-money core-recon-money--settlement">{money(totals.settlementAmount)}</td>
                    <td className="core-recon-money core-recon-money--received"><strong style={{ display: 'block', fontWeight: 700 }}>{money(received)}</strong><small style={{ display: 'block', marginTop: 2, color: '#8a98aa', fontSize: 10 }}>未收 {money(unpaid)}</small></td>
                    <td><span className={`core-recon-status core-recon-status--${row.status || 'pending'}`}>{STATUS_LABELS[row.status] || row.status || '待处理'}</span></td>
                    <td><div className="core-recon-row-actions">
                      <button type="button" onClick={() => openBill360('channel', String(row.id), row)}>详情</button>
                      <button type="button" disabled={settled || !recon.channelApiEnabled} title={!recon.channelApiEnabled ? '渠道 API 不可用，暂不能登记收款' : settled ? '该账单已结清' : '登记渠道收款'} onClick={() => setReceiptRecord(row)}>{settled ? '已结清' : '收款'}</button>
                      <button type="button" onClick={() => openChannelReconciliationEdit(String(row.id))}>编辑</button>
                      <button type="button" className="danger" disabled={isDeleting} onClick={() => handleSingleDelete(row)}>删除</button>
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ChannelReceiptDrawer
        open={Boolean(receiptRecord)} record={receiptRecord} quickFull={false}
        partyA={settings.partyA} partyB={settings.partyB}
        channelApiEnabled={recon.channelApiEnabled} showToast={showToast}
        onClose={() => setReceiptRecord(null)} onRegisterReceipt={recon.onChannelRegisterReceipt}
      />
    </PageContainer>
  )
}

function readAny(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name]
  }
  return ''
}

function mapChannelImportRow(row) {
  const channelName = String(readAny(row, ['渠道', '渠道名称', 'channel'])).trim()
  const gameName = String(readAny(row, ['游戏', '产品', '游戏项目', '产品名称'])).trim()
  const flow = Number(readAny(row, ['计费流水', '流水', '后台流水', '充值金额']) || 0)
  const settlementCycle = String(readAny(row, ['月份', '结算月份', '结算时间', '账期'])).trim()
  if (!channelName && !gameName && !flow) return null
  return buildChannelBillFromSingleGameForm({
    channelName,
    partnerName: String(readAny(row, ['合作方', '客户', '结算方'])).trim(),
    settlementMonth: settlementCycle,
    settlementCycle,
    startDate: String(readAny(row, ['开始日期', '开始时间'])).trim(),
    endDate: String(readAny(row, ['结束日期', '结束时间'])).trim(),
    remark: String(readAny(row, ['备注'])).trim(),
    gameName,
    flow,
    discountFactor: Number(readAny(row, ['折扣', '折扣系数']) || 1),
    voucherCost: Number(readAny(row, ['代金券', '券成本']) || 0),
    noWorryCost: Number(readAny(row, ['无忧成本', '无忧券']) || 0),
    refundCost: Number(readAny(row, ['退款', '退款成本']) || 0),
    testCost: Number(readAny(row, ['测试费', '测试成本']) || 0),
    welfareCost: Number(readAny(row, ['福利成本', '福利']) || 0),
    shareRate: Number(readAny(row, ['分成比例', '渠道分成比例']) || 30),
    taxRate: Number(readAny(row, ['税率', '税点']) || 5),
    gatewayCost: Number(readAny(row, ['通道费', '通道成本']) || 0),
    settlementAmount: readAny(row, ['渠道应收', '结算金额']) || ''
  })
}

export default CoreChannelReconciliationPage
