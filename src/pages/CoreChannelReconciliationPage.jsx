import React, { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { VIEWS } from '@/app/routes.js'
import { buildChannelBillFromSingleGameForm } from '@/domain/channel/channelBillingForm.js'
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

function CoreChannelReconciliationPage() {
  const { recon, showToast, setActiveView, openChannelReconciliationEdit } = useAppState()
  const fileRef = useRef(null)
  const [month, setMonth] = useState('')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState([])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (recon.channelRecords || []).filter((row) => {
      const matchesMonth = !month || text(row.settlementMonth, '') === month
      const haystack = [row.channelName, row.partnerName, row.gameName, row.remark]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return matchesMonth && (!q || haystack.includes(q))
    })
  }, [recon.channelRecords, month, query])

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(String(row.id))),
    [rows, selectedIds]
  )

  const stats = useMemo(() => {
    const flow = rows.reduce((sum, row) => sum + Number(row.flow || 0), 0)
    const settlement = rows.reduce((sum, row) => sum + Number(row.settlementAmount || 0), 0)
    const channels = new Set(rows.map((row) => text(row.channelName, '')).filter(Boolean))
    const games = new Set(rows.flatMap((row) => String(row.gameName || '').split('、').filter(Boolean)))
    return [
      { label: '账单数量', value: rows.length },
      { label: '渠道', value: channels.size },
      { label: '产品', value: games.size },
      { label: '结算金额', value: money(settlement) },
      { label: '计费流水', value: money(flow) }
    ]
  }, [rows])

  const toggleSelected = (id) => {
    const sid = String(id)
    setSelectedIds((prev) => (prev.includes(sid) ? prev.filter((item) => item !== sid) : [...prev, sid]))
  }

  const exportRows = () => {
    const target = selectedRows.length > 0 ? selectedRows : rows
    if (target.length === 0) {
      showToast('没有可导出的渠道账单', 'error')
      return
    }
    const data = target.map((row) => ({
      月份: row.settlementMonth || '',
      渠道: row.channelName || '',
      合作方: row.partnerName || '',
      产品: row.gameName || '',
      计费流水: Number(row.flow || 0),
      计费金额: Number(row.billingAmount || 0),
      分成金额: Number(row.shareAmount || 0),
      税率: row.taxRate || 0,
      通道费: Number(row.gatewayCost || 0),
      结算金额: Number(row.settlementAmount || 0),
      已收款: Number(row.receivedAmount || 0),
      状态: STATUS_LABELS[row.status] || row.status || '待处理',
      备注: row.remark || ''
    }))
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
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const records = rows.map(mapChannelImportRow).filter(Boolean)
      if (records.length === 0) {
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
    <PageContainer hideHeader className="core-recon-page">
      <section className="core-recon-head">
        <div>
          <p>核心对账</p>
          <h1>渠道账单</h1>
          <span>沿用现有渠道核算公式和服务端接口，重做渠道账单列表、统计、导入导出。</span>
        </div>
        <div className="core-recon-actions">
          <button type="button" onClick={() => fileRef.current?.click()}>导入 Excel</button>
          <button type="button" onClick={exportRows}>导出</button>
          <button type="button" className="primary" onClick={() => setActiveView(VIEWS.CHANNEL_RECON_CREATE)}>
            新增账单
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImportFile} hidden />
        </div>
      </section>

      <section className="core-recon-filters">
        <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索渠道、合作方、产品"
        />
        <button type="button" onClick={() => { setMonth(''); setQuery(''); setSelectedIds([]) }}>
          清空
        </button>
      </section>

      <section className="core-recon-stats core-recon-stats--five">
        {stats.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <section className="core-recon-panel">
        <div className="core-recon-panel-head">
          <h2>账单列表</h2>
          <span>{selectedRows.length > 0 ? `已选 ${selectedRows.length} 条` : `${rows.length} 条`}</span>
        </div>
        <div className="core-recon-table-wrap">
          <table className="core-recon-table">
            <thead>
              <tr>
                <th>选择</th>
                <th>月份</th>
                <th>渠道</th>
                <th>合作方</th>
                <th>产品</th>
                <th>计费流水</th>
                <th>分成金额</th>
                <th>结算金额</th>
                <th>收款</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="core-recon-empty">暂无渠道账单</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(String(row.id))}
                        onChange={() => toggleSelected(row.id)}
                      />
                    </td>
                    <td>{text(row.settlementMonth)}</td>
                    <td>{text(row.channelName)}</td>
                    <td>{text(row.partnerName)}</td>
                    <td>{text(row.gameName)}</td>
                    <td>{money(row.flow)}</td>
                    <td>{money(row.shareAmount)}</td>
                    <td>{money(row.settlementAmount)}</td>
                    <td>{money(row.receivedAmount)}</td>
                    <td><span className="core-recon-status">{STATUS_LABELS[row.status] || row.status || '待处理'}</span></td>
                    <td>
                      <button type="button" onClick={() => openChannelReconciliationEdit(String(row.id))}>编辑</button>
                      <button type="button" className="danger" onClick={() => recon.onChannelDeleteRecord(row.id)}>删除</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
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
  if (!channelName && !gameName && !flow) return null
  return buildChannelBillFromSingleGameForm({
    channelName,
    partnerName: String(readAny(row, ['合作方', '客户', '结算方'])).trim(),
    settlementMonth: String(readAny(row, ['月份', '结算月份', '账期'])).trim(),
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
    settlementAmount: readAny(row, ['结算金额']) || ''
  })
}

export default CoreChannelReconciliationPage
