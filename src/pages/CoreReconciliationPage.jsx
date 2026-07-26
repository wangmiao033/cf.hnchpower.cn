import React, { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { VIEWS } from '@/app/routes.js'
import {
  buildSettlementWorkbookFromSelected,
  writeSettlementWorkbookToFile
} from '@/domain/export/settlementConfirmationExport.js'
import { totalReconciliationSettlementAmount } from '@/domain/settlement/calculateSettlementAmount.js'
import './CoreReconciliationPages.css'
import '@/components/reconciliation/reconciliation-admin.css'

const STATUS_LABELS = {
  pending: '待处理',
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消',
  settled: '已结算',
  invoiced: '已开票',
  reconciled: '已核销'
}

function money(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function recordSettlementAmount(row) {
  const stored = Number.parseFloat(row?.settlementAmount)
  return Number.isFinite(stored) ? stored : totalReconciliationSettlementAmount(row)
}

function text(value, fallback = '-') {
  const raw = value == null ? '' : String(value).trim()
  return raw || fallback
}

function monthOf(row) {
  return text(row.settlementMonth, '')
}

function monthKey(value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})(?:-|年)\s*(\d{1,2})(?:月)?$/)
  if (!match) return raw
  return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`
}

function monthLabel(value) {
  const normalized = monthKey(value)
  const match = normalized.match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : normalized
}

function gameText(row) {
  if (Array.isArray(row.items) && row.items.length > 0) {
    return row.items.map((item) => item.gameName).filter(Boolean).join('、')
  }
  return text(row.game, '')
}

function partnerKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/\s+/g, '')
}

function CoreReconciliationPage() {
  const { recon, settings, showToast, setActiveView, openReconciliationEdit } = useAppState()
  const fileRef = useRef(null)
  const [month, setMonth] = useState('')
  const [partner, setPartner] = useState('')
  const [partnerDraft, setPartnerDraft] = useState('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState([])

  const monthOptions = useMemo(
    () =>
      [...new Set((recon.records || []).map((row) => monthKey(monthOf(row))).filter(Boolean))]
        .sort((a, b) => b.localeCompare(a, 'zh-CN')),
    [recon.records]
  )

  const partnerOptions = useMemo(() => {
    const names = [
      ...(settings.partners || []).map((item) => String(item.name || '').trim()),
      ...(recon.records || []).map((row) => text(row.partner || row.partyBName, ''))
    ].filter(Boolean)
    const unique = new Map()
    names.forEach((name) => {
      const key = partnerKey(name)
      if (key && !unique.has(key)) unique.set(key, name)
    })
    return [...unique.values()].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [recon.records, settings.partners])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (recon.records || []).filter((row) => {
      const matchesMonth = !month || monthKey(monthOf(row)) === month
      const rowPartner = text(row.partner || row.partyBName, '')
      const matchesPartner = !partner || partnerKey(rowPartner).includes(partnerKey(partner))
      const matchesStatus = !status || String(row.status || 'pending') === status
      const haystack = [
        row.settlementNumber,
        rowPartner,
        row.game,
        gameText(row),
        row.remark
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return matchesMonth && matchesPartner && matchesStatus && (!q || haystack.includes(q))
    })
  }, [recon.records, month, partner, query, status])

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(String(row.id))),
    [rows, selectedIds]
  )

  const stats = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + recordSettlementAmount(row), 0)
    const partners = new Set(rows.map((row) => text(row.partner || row.partyBName, '')).filter(Boolean))
    const games = new Set(rows.flatMap((row) => gameText(row).split('、').filter(Boolean)))
    return [
      { label: '账单数量', value: rows.length },
      { label: '合作方', value: partners.size },
      { label: '游戏项目', value: games.size },
      { label: '结算金额', value: money(total) }
    ]
  }, [rows])

  const toggleSelected = (id) => {
    const sid = String(id)
    setSelectedIds((prev) => (prev.includes(sid) ? prev.filter((item) => item !== sid) : [...prev, sid]))
  }

  const exportSelected = () => {
    const target = selectedRows.length > 0 ? selectedRows : rows
    if (target.length === 0) {
      showToast('没有可导出的研发账单', 'error')
      return
    }
    const { wb, fileName } = buildSettlementWorkbookFromSelected(target)
    writeSettlementWorkbookToFile(wb, fileName)
    showToast(`已导出 ${target.length} 条研发账单`, 'success')
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
      const records = rows.map(mapRdImportRow).filter(Boolean)
      if (records.length === 0) {
        showToast('没有识别到可导入的研发对账数据', 'error')
        return
      }
      await recon.handleExcelImport(records)
      showToast(`已导入 ${records.length} 条研发账单`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : '导入失败，请检查 Excel 格式', 'error')
    }
  }

  return (
    <PageContainer hideHeader className="core-recon-page">
      <section className="core-recon-head">
        <div>
          <p>核心对账</p>
          <h1>研发账单</h1>
          <span>沿用现有研发结算公式和导出模板，重做筛选、统计和列表体验。</span>
        </div>
        <div className="core-recon-actions">
          <button type="button" onClick={() => fileRef.current?.click()}>导入 Excel</button>
          <button type="button" onClick={exportSelected}>导出</button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              recon.setQuickFillData(null)
              setActiveView(VIEWS.RECON_CREATE)
            }}
          >
            新增账单
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImportFile} hidden />
        </div>
      </section>

      <section className="core-recon-filters">
        <label>
          <span>月份</span>
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            <option value="">全部月份</option>
            {monthOptions.map((value) => (
              <option key={value} value={value}>{monthLabel(value)}</option>
            ))}
          </select>
        </label>
        <div className="core-recon-filter-field core-recon-partner-filter">
          <span>合作方</span>
          <div className="core-recon-partner-search">
            <input
              type="search"
              list="core-recon-partner-options"
              value={partnerDraft}
              onChange={(event) => setPartnerDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  setPartner(partnerDraft.trim())
                  setSelectedIds([])
                }
              }}
              placeholder="输入名称或简称"
              aria-label="搜索合作方"
            />
            <datalist id="core-recon-partner-options">
              {partnerOptions.map((name) => <option key={name} value={name} />)}
            </datalist>
            <button
              type="button"
              onClick={() => {
                setPartner(partnerDraft.trim())
                setSelectedIds([])
              }}
            >
              搜索
            </button>
          </div>
        </div>
        <label>
          <span>状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="core-recon-filter-search">
          <span>搜索</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索编号、合作方、游戏"
          />
        </label>
        <button type="button" onClick={() => {
          setMonth('')
          setPartner('')
          setPartnerDraft('')
          setStatus('')
          setQuery('')
          setSelectedIds([])
        }}>
          清空
        </button>
      </section>

      <section className="core-recon-stats">
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
                <th>编号</th>
                <th>月份</th>
                <th>合作方</th>
                <th>游戏</th>
                <th>流水</th>
                <th>分成</th>
                <th>结算金额</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="core-recon-empty">暂无研发账单</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择账单 ${text(row.settlementNumber)}`}
                        checked={selectedIds.includes(String(row.id))}
                        onChange={() => toggleSelected(row.id)}
                      />
                    </td>
                    <td>{text(row.settlementNumber)}</td>
                    <td>{text(row.settlementMonth)}</td>
                    <td>{text(row.partner || row.partyBName)}</td>
                    <td>{text(gameText(row))}</td>
                    <td>{money(row.gameFlow || sumItems(row, 'revenue'))}</td>
                    <td>{text(row.revenueShareRatio != null ? `${row.revenueShareRatio}%` : '')}</td>
                    <td>{money(recordSettlementAmount(row))}</td>
                    <td><span className="core-recon-status">{STATUS_LABELS[row.status] || row.status || '待处理'}</span></td>
                    <td>
                      <button type="button" onClick={() => openReconciliationEdit(String(row.id))}>编辑</button>
                      <button type="button" className="danger" onClick={() => recon.deleteRecord(row.id)}>删除</button>
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

function sumItems(row, field) {
  if (!Array.isArray(row.items)) return 0
  return row.items.reduce((sum, item) => sum + Number(item[field] || 0), 0)
}

function readAny(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') return row[name]
  }
  return ''
}

function mapRdImportRow(row) {
  const game = String(readAny(row, ['游戏', '游戏项目', '产品', '项目'])).trim()
  const gameFlow = Number(readAny(row, ['游戏流水', '流水', '充值金额', '后台流水']) || 0)
  if (!game && !gameFlow) return null
  return {
    settlementMonth: String(readAny(row, ['结算月份', '月份', '账期'])).trim(),
    partner: String(readAny(row, ['合作方', '客户', '研发商'])).trim(),
    game,
    gameFlow,
    testingFee: Number(readAny(row, ['测试费', '平台币', '测试费用']) || 0),
    voucher: Number(readAny(row, ['代金券', '券成本']) || 0),
    channelFeeRate: Number(readAny(row, ['通道费率', '渠道费率']) || 0),
    taxPoint: Number(readAny(row, ['税点', '税率']) || 0),
    revenueShareRatio: Number(readAny(row, ['分成比例', '合作方分成比例']) || 0),
    discount: Number(readAny(row, ['折扣', '折扣系数']) || 1),
    refund: Number(readAny(row, ['退款', '额外费用']) || 0),
    status: 'pending'
  }
}

export default CoreReconciliationPage
