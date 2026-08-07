import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import PageContainer from '@/components/layout/PageContainer.jsx'
import {
  ANOMALY_CATEGORY_LABELS,
  buildReconciliationAnomalies,
  summarizeAnomalies
} from '@/domain/anomalies/reconciliationAnomalies.js'
import { listBillInvoiceOverviews } from '@/lib/api/anomaly.ts'
import { listContracts } from '@/lib/api/contract.ts'
import { listExceptionStatuses, upsertExceptionStatus } from '@/lib/api/exceptionStatus.ts'
import { getQuickSdkAnalytics } from '@/lib/api/quicksdk.ts'
import './AnomalyCenterPage.css'

const SEVERITY_LABELS = {
  critical: '严重',
  warning: '待处理',
  info: '提醒'
}

const STATUS_LABELS = {
  pending: '待处理',
  ignored: '已忽略',
  resolved: '已解决'
}

function money(value) {
  if (value == null || value === '') return '-'
  const amount = Number(value || 0)
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function monthText(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : value || '-'
}

function sourceLabel(state) {
  if (state === 'ready') return '已读取'
  if (state === 'error') return '读取失败'
  return '读取中'
}

export default function AnomalyCenterPage() {
  const {
    recon,
    showToast,
    setActiveView,
    openReconciliationEdit,
    openChannelReconciliationEdit
  } = useAppState()
  const rdRecords = recon.records || []
  const channelRecords = recon.channelRecords || []

  const [snapshot, setSnapshot] = useState({
    invoiceOverviews: null,
    contracts: null,
    quickSdkMonthly: null
  })
  const [statusMap, setStatusMap] = useState({})
  const [sourceState, setSourceState] = useState({
    invoice: 'loading',
    contract: 'loading',
    quicksdk: 'loading',
    status: 'loading'
  })
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState('')
  const [severity, setSeverity] = useState('all')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('pending')
  const [query, setQuery] = useState('')

  const billRefs = useMemo(
    () => [
      ...rdRecords.map((row) => ({ bill_type: 'rd', bill_id: String(row?.id || '') })),
      ...channelRecords.map((row) => ({ bill_type: 'channel', bill_id: String(row?.id || '') }))
    ].filter((item) => item.bill_id),
    [channelRecords, rdRecords]
  )
  const billRefsKey = useMemo(
    () => billRefs.map((item) => `${item.bill_type}:${item.bill_id}`).join(','),
    [billRefs]
  )

  const loadSnapshot = useCallback(async () => {
    setLoading(true)
    setSourceState({ invoice: 'loading', contract: 'loading', quicksdk: 'loading', status: 'loading' })

    const [invoiceResult, contractResult, quickSdkResult, statusResult] = await Promise.allSettled([
      listBillInvoiceOverviews(billRefs),
      listContracts({ limit: 500, offset: 0 }),
      getQuickSdkAnalytics({ limit: 36 }),
      listExceptionStatuses({ limit: 10000, offset: 0 })
    ])

    setSnapshot({
      invoiceOverviews: invoiceResult.status === 'fulfilled' ? invoiceResult.value : null,
      contracts: contractResult.status === 'fulfilled' ? contractResult.value.items || [] : null,
      quickSdkMonthly: quickSdkResult.status === 'fulfilled' ? quickSdkResult.value.monthly || [] : null
    })
    setStatusMap(
      statusResult.status === 'fulfilled'
        ? Object.fromEntries((statusResult.value.items || []).map((item) => [item.exception_id, item.status]))
        : {}
    )
    setSourceState({
      invoice: invoiceResult.status === 'fulfilled' ? 'ready' : 'error',
      contract: contractResult.status === 'fulfilled' ? 'ready' : 'error',
      quicksdk: quickSdkResult.status === 'fulfilled' ? 'ready' : 'error',
      status: statusResult.status === 'fulfilled' ? 'ready' : 'error'
    })
    setLoading(false)
  }, [billRefsKey])

  useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

  const anomalies = useMemo(
    () => buildReconciliationAnomalies({
      rdRecords,
      channelRecords,
      invoiceOverviews: snapshot.invoiceOverviews,
      contracts: snapshot.contracts,
      quickSdkMonthly: snapshot.quickSdkMonthly,
      statusMap
    }),
    [channelRecords, rdRecords, snapshot, statusMap]
  )
  const summary = useMemo(() => summarizeAnomalies(anomalies), [anomalies])

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return anomalies.filter((item) => {
      if (severity !== 'all' && item.severity !== severity) return false
      if (category !== 'all' && item.category !== category) return false
      if (status !== 'all' && item.status !== status) return false
      if (!keyword) return true
      return [
        item.title,
        item.detail,
        item.billNumber,
        item.partnerName,
        item.gameName,
        item.settlementMonth
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [anomalies, category, query, severity, status])

  const updateStatus = async (item, nextStatus) => {
    setUpdatingId(item.id)
    try {
      const updated = await upsertExceptionStatus({ exception_id: item.id, status: nextStatus })
      setStatusMap((current) => ({ ...current, [item.id]: updated.status }))
      showToast(
        nextStatus === 'resolved' ? '已标记为解决' : nextStatus === 'ignored' ? '已忽略该提醒' : '已重新打开异常',
        'success'
      )
    } catch (error) {
      console.error(error)
      showToast('异常状态保存失败，请稍后重试', 'error')
    } finally {
      setUpdatingId('')
    }
  }

  const openBill = (item) => {
    if (!item.billId) return
    if (item.billType === 'rd') {
      openReconciliationEdit(String(item.billId), VIEWS.ANOMALIES)
      return
    }
    if (item.billType === 'channel') {
      openChannelReconciliationEdit(String(item.billId), VIEWS.ANOMALIES)
    }
  }

  const openRelated = (item) => {
    const view = item.targetView
    if (!view) return
    setActiveView(view)
  }

  return (
    <PageContainer hideHeader className="anomaly-center-page">
      <section className="anomaly-head">
        <div>
          <span>工作台 · 自动巡检</span>
          <h1>异常中心</h1>
          <p>自动汇总收付款、发票、合同、QuickSDK 数据和重复编号风险；处理结果会保留，不重复干扰。</p>
        </div>
        <button type="button" onClick={loadSnapshot} disabled={loading}>
          {loading ? '巡检中…' : '重新巡检'}
        </button>
      </section>

      <section className="anomaly-summary" aria-label="异常统计">
        <button type="button" onClick={() => { setStatus('pending'); setSeverity('all') }}>
          <span>待处理</span><strong>{summary.pending}</strong><small>全部未处理问题</small>
        </button>
        <button type="button" className="is-critical" onClick={() => { setStatus('pending'); setSeverity('critical') }}>
          <span>严重异常</span><strong>{summary.critical}</strong><small>优先处理</small>
        </button>
        <button type="button" className="is-warning" onClick={() => { setStatus('pending'); setSeverity('warning') }}>
          <span>待处理风险</span><strong>{summary.warning}</strong><small>需要核对</small>
        </button>
        <button type="button" className="is-info" onClick={() => { setStatus('pending'); setSeverity('info') }}>
          <span>提醒</span><strong>{summary.info}</strong><small>建议关注</small>
        </button>
        <button type="button" onClick={() => { setStatus('resolved'); setSeverity('all') }}>
          <span>已解决</span><strong>{summary.resolved}</strong><small>历史处理</small>
        </button>
      </section>

      <section className="anomaly-source-state" aria-label="巡检数据源状态">
        <span>账单 {rdRecords.length + channelRecords.length} 笔</span>
        <span className={`is-${sourceState.invoice}`}>发票覆盖：{sourceLabel(sourceState.invoice)}</span>
        <span className={`is-${sourceState.contract}`}>合同：{sourceLabel(sourceState.contract)}</span>
        <span className={`is-${sourceState.quicksdk}`}>QuickSDK：{sourceLabel(sourceState.quicksdk)}</span>
        <span className={`is-${sourceState.status}`}>处理状态：{sourceLabel(sourceState.status)}</span>
      </section>

      <section className="anomaly-toolbar">
        <label>
          <span>状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">待处理</option>
            <option value="resolved">已解决</option>
            <option value="ignored">已忽略</option>
            <option value="all">全部</option>
          </select>
        </label>
        <label>
          <span>级别</span>
          <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
            <option value="all">全部级别</option>
            <option value="critical">严重</option>
            <option value="warning">待处理</option>
            <option value="info">提醒</option>
          </select>
        </label>
        <label>
          <span>类型</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">全部类型</option>
            {Object.entries(ANOMALY_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="anomaly-search">
          <span>搜索</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="账单编号、客户、游戏或问题"
          />
        </label>
        <button type="button" className="anomaly-reset" onClick={() => {
          setStatus('pending')
          setSeverity('all')
          setCategory('all')
          setQuery('')
        }}>
          重置
        </button>
      </section>

      <section className="anomaly-panel">
        <div className="anomaly-panel-head">
          <div>
            <h2>巡检结果</h2>
            <p>当前筛选显示 {visible.length} 条，共识别 {anomalies.length} 条。</p>
          </div>
          <span>{loading ? '正在更新' : `最近巡检完成`}</span>
        </div>

        <div className="anomaly-table-wrap">
          <table className="anomaly-table">
            <thead>
              <tr>
                <th>级别</th>
                <th>问题</th>
                <th>关联对象</th>
                <th>账期</th>
                <th className="is-right">影响金额</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="anomaly-empty">
                    {loading ? '正在巡检数据…' : status === 'pending' ? '当前筛选范围没有待处理异常。' : '当前筛选范围暂无记录。'}
                  </td>
                </tr>
              ) : visible.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className={`anomaly-severity is-${item.severity}`}>{SEVERITY_LABELS[item.severity]}</span>
                    <small>{ANOMALY_CATEGORY_LABELS[item.category] || item.category}</small>
                  </td>
                  <td className="anomaly-problem">
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </td>
                  <td className="anomaly-object">
                    <strong>{item.billNumber || item.partnerName || '系统数据'}</strong>
                    <span>{[item.partnerName, item.gameName].filter(Boolean).join(' · ') || '-'}</span>
                  </td>
                  <td>{monthText(item.settlementMonth)}</td>
                  <td className="is-right anomaly-money">{money(item.amount)}</td>
                  <td><span className={`anomaly-status is-${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span></td>
                  <td>
                    <div className="anomaly-actions">
                      {item.billId ? <button type="button" onClick={() => openBill(item)}>查看账单</button> : null}
                      {item.targetView && item.targetView !== (item.billType === 'rd' ? VIEWS.RECON_RD : VIEWS.RECON_CHANNEL) ? (
                        <button type="button" onClick={() => openRelated(item)}>去处理</button>
                      ) : null}
                      {item.status === 'pending' ? (
                        <>
                          <button type="button" disabled={updatingId === item.id} onClick={() => updateStatus(item, 'resolved')}>已解决</button>
                          <button type="button" className="is-muted" disabled={updatingId === item.id} onClick={() => updateStatus(item, 'ignored')}>忽略</button>
                        </>
                      ) : (
                        <button type="button" disabled={updatingId === item.id} onClick={() => updateStatus(item, 'pending')}>重新打开</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PageContainer>
  )
}
