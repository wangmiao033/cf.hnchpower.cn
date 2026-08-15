import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import PageContainer from '@/components/layout/PageContainer.jsx'
import AnomalyAiInsightPanel from '@/components/anomalies/AnomalyAiInsightPanel.jsx'
import ContractDifferenceLedgerPanel from '@/components/exceptions/ContractDifferenceLedgerPanel.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import {
  ANOMALY_CATEGORY_LABELS,
  buildReconciliationAnomalies
} from '@/domain/anomalies/reconciliationAnomalies.js'
import { listBillInvoiceOverviews } from '@/lib/api/anomaly.ts'
import { listContracts } from '@/lib/api/contract.ts'
import { listExceptionStatuses, upsertExceptionStatus } from '@/lib/api/exceptionStatus.ts'
import { getQuickSdkAnalytics } from '@/lib/api/quicksdk.ts'
import './AnomalyCenterPage.css'
import './AnomalyWorkflow.css'

const SEVERITY_LABELS = {
  critical: '严重',
  warning: '待处理',
  info: '提醒'
}

const STATUS_LABELS = {
  pending: '待处理',
  processing: '处理中',
  ignored: '已忽略',
  resolved: '已解决'
}

const CATEGORY_LABELS = {
  contract_difference: '合同差异',
  ...ANOMALY_CATEGORY_LABELS
}

const ACTION_LABELS = {
  payment: '核对资金闭环',
  invoice: '处理发票覆盖',
  contract: '核对合同依据',
  data: '补齐数据源',
  quality: '补全账单资料',
  duplicate: '核对重复记录'
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

function dateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

function sourceLabel(state) {
  if (state === 'ready') return '已读取'
  if (state === 'error') return '读取失败'
  return '读取中'
}

function nextActionLabel(item) {
  return ACTION_LABELS[item?.category] || '核对并处理'
}

function relatedActionLabel(item) {
  if (item?.category === 'invoice') return '去发票中心'
  if (item?.category === 'contract') return '去合同中心'
  if (item?.category === 'data') return '去数据中心'
  return '去对应模块'
}

function summarizeWorkflow(items = []) {
  return items.reduce((acc, item) => {
    acc.total += 1
    const state = item.status || 'pending'
    acc[state] = (acc[state] || 0) + 1
    if (state === 'pending' || state === 'processing') {
      acc.open += 1
      acc[item.severity] = (acc[item.severity] || 0) + 1
    }
    return acc
  }, {
    total: 0,
    open: 0,
    pending: 0,
    processing: 0,
    resolved: 0,
    ignored: 0,
    critical: 0,
    warning: 0,
    info: 0
  })
}

export default function AnomalyCenterPage() {
  const {
    recon,
    showToast,
    setActiveView,
    openBill360,
    openReconciliationEdit,
    openChannelReconciliationEdit
  } = useAppState()
  const { user } = useAuth()
  const rdRecords = recon.records || []
  const channelRecords = recon.channelRecords || []

  const [snapshot, setSnapshot] = useState({
    invoiceOverviews: null,
    contracts: null,
    quickSdkMonthly: null
  })
  const [statusMap, setStatusMap] = useState({})
  const [statusDetailMap, setStatusDetailMap] = useState({})
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
  const [status, setStatus] = useState('open')
  const [query, setQuery] = useState('')
  const [ledgerRefresh, setLedgerRefresh] = useState(0)
  const [workflowItem, setWorkflowItem] = useState(null)
  const [workflowTarget, setWorkflowTarget] = useState('processing')
  const [assigneeDraft, setAssigneeDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')

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
      contracts: contractResult.status === 'fulfilled' ? invoiceResult.value && contractResult.value.items || [] : null,
      quickSdkMonthly: quickSdkResult.status === 'fulfilled' ? quickSdkResult.value.monthly || [] : null
    })
    if (statusResult.status === 'fulfilled') {
      const details = Object.fromEntries((statusResult.value.items || []).map((item) => [item.exception_id, item]))
      setStatusDetailMap(details)
      setStatusMap(Object.fromEntries(Object.entries(details).map(([key, item]) => [key, item.status])))
    } else {
      setStatusDetailMap({})
      setStatusMap({})
    }
    setSourceState({
      invoice: invoiceResult.status === 'fulfilled' ? 'ready' : 'error',
      contract: contractResult.status === 'fulfilled' ? 'ready' : 'error',
      quicksdk: quickSdkResult.status === 'fulfilled' ? 'ready' : 'error',
      status: statusResult.status === 'fulfilled' ? 'ready' : 'error'
    })
    setLedgerRefresh((value) => value + 1)
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
  const summary = useMemo(() => summarizeWorkflow(anomalies), [anomalies])

  const visible = useMemo(() => {
    if (category === 'contract_difference') return []
    const keyword = query.trim().toLowerCase()
    return anomalies.filter((item) => {
      if (severity !== 'all' && item.severity !== severity) return false
      if (category !== 'all' && item.category !== category) return false
      if (status === 'open' && !['pending', 'processing'].includes(item.status)) return false
      if (status !== 'all' && status !== 'open' && item.status !== status) return false
      if (!keyword) return true
      const detail = statusDetailMap[item.id] || {}
      return [
        item.title,
        item.detail,
        item.billNumber,
        item.partnerName,
        item.gameName,
        item.settlementMonth,
        nextActionLabel(item),
        detail.assignee,
        detail.note
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [anomalies, category, query, severity, status, statusDetailMap])

  const openWorkflow = (item, nextStatus = null) => {
    const detail = statusDetailMap[item.id] || {}
    setWorkflowItem(item)
    setWorkflowTarget(nextStatus || item.status || 'processing')
    setAssigneeDraft(detail.assignee || user?.email || '')
    setNoteDraft(detail.note || '')
  }

  const saveWorkflow = async () => {
    if (!workflowItem) return
    if (['resolved', 'ignored'].includes(workflowTarget) && noteDraft.trim().length < 2) {
      showToast('标记解决或忽略时，请填写处理说明', 'error')
      return
    }
    setUpdatingId(workflowItem.id)
    try {
      const updated = await upsertExceptionStatus({
        exception_id: workflowItem.id,
        status: workflowTarget,
        assignee: assigneeDraft.trim() || null,
        note: noteDraft.trim() || null
      })
      setStatusMap((current) => ({ ...current, [workflowItem.id]: updated.status }))
      setStatusDetailMap((current) => ({ ...current, [workflowItem.id]: updated }))
      setWorkflowItem(null)
      showToast(
        workflowTarget === 'processing' ? '异常已进入处理中' :
          workflowTarget === 'resolved' ? '异常已解决并保留处理说明' :
            workflowTarget === 'ignored' ? '异常已忽略并保留原因' : '异常已重新打开',
        'success'
      )
    } catch (error) {
      console.error(error)
      showToast('异常处理状态保存失败，请稍后重试', 'error')
    } finally {
      setUpdatingId('')
    }
  }

  const openBillOverview = (item) => {
    if (!item?.billId || !item?.billType) return
    openBill360(item.billType, String(item.billId), null)
  }

  const editBill = (item) => {
    if (!item?.billId) return
    if (item.billType === 'rd') {
      openReconciliationEdit(String(item.billId), VIEWS.ANOMALIES)
      return
    }
    if (item.billType === 'channel') {
      openChannelReconciliationEdit(String(item.billId), VIEWS.ANOMALIES)
    }
  }

  const openDifferenceBill = (item) => {
    if (!item?.bill_id) return
    openBill360(item.bill_type, String(item.bill_id), null)
  }

  const openRelated = (item) => {
    const view = item.targetView
    if (!view) return
    setActiveView(view)
  }

  const shouldOfferEdit = (item) => Boolean(
    item?.billId && (item.category === 'quality' || item.category === 'duplicate')
  )

  const shouldOfferRelated = (item) => Boolean(
    item?.targetView &&
    item.targetView !== (item.billType === 'rd' ? VIEWS.RECON_RD : VIEWS.RECON_CHANNEL)
  )

  return (
    <PageContainer hideHeader className="anomaly-center-page">
      <section className="anomaly-head">
        <div>
          <span>V5.1 · FINANCE ACTION INBOX</span>
          <h1>待办与异常</h1>
          <p>把巡检问题变成有负责人、有处理说明、可追踪状态的财务处理队列。异常规则仍实时计算，处理状态独立留痕。</p>
        </div>
        <button type="button" onClick={loadSnapshot} disabled={loading}>
          {loading ? '巡检中…' : '重新巡检'}
        </button>
      </section>

      <section className="anomaly-summary" aria-label="异常统计">
        <button type="button" onClick={() => { setStatus('open'); setSeverity('all'); setCategory('all') }}>
          <span>待办总数</span><strong>{summary.open}</strong><small>待处理 + 处理中</small>
        </button>
        <button type="button" className="is-critical" onClick={() => { setStatus('open'); setSeverity('critical'); setCategory('all') }}>
          <span>必须优先处理</span><strong>{summary.critical}</strong><small>会影响金额或闭环</small>
        </button>
        <button type="button" className="is-warning" onClick={() => { setStatus('processing'); setSeverity('all'); setCategory('all') }}>
          <span>处理中</span><strong>{summary.processing}</strong><small>已有负责人跟进</small>
        </button>
        <button type="button" onClick={() => { setStatus('resolved'); setSeverity('all'); setCategory('all') }}>
          <span>已解决</span><strong>{summary.resolved}</strong><small>保留处理历史</small>
        </button>
        <button type="button" className="is-info" onClick={() => { setStatus('ignored'); setSeverity('all'); setCategory('all') }}>
          <span>已忽略</span><strong>{summary.ignored}</strong><small>已记录忽略原因</small>
        </button>
      </section>

      <AnomalyAiInsightPanel anomalies={anomalies} sourceLoading={loading} />

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
          <select value={status} onChange={(event) => setStatus(event.target.value)} disabled={category === 'contract_difference'}>
            <option value="open">未关闭</option>
            <option value="pending">待处理</option>
            <option value="processing">处理中</option>
            <option value="resolved">已解决</option>
            <option value="ignored">已忽略</option>
            <option value="all">全部</option>
          </select>
        </label>
        <label>
          <span>级别</span>
          <select value={severity} onChange={(event) => setSeverity(event.target.value)} disabled={category === 'contract_difference'}>
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
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
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
            placeholder="账单、客户、游戏、负责人或处理说明"
            disabled={category === 'contract_difference'}
          />
        </label>
        <button type="button" className="anomaly-reset" onClick={() => {
          setStatus('open')
          setSeverity('all')
          setCategory('all')
          setQuery('')
        }}>
          重置
        </button>
      </section>

      <ContractDifferenceLedgerPanel
        visible={category === 'all' || category === 'contract_difference'}
        onOpenBill={openDifferenceBill}
        refreshToken={ledgerRefresh}
      />

      {category !== 'contract_difference' ? (
        <section className="anomaly-panel">
          <div className="anomaly-panel-head">
            <div>
              <h2>财务待办清单</h2>
              <p>当前筛选 {visible.length} 条；问题可以先领取进入处理中，再记录处理说明并关闭。</p>
            </div>
            <span>{loading ? '正在更新' : `共识别 ${anomalies.length} 条`}</span>
          </div>

          <div className="anomaly-table-wrap">
            <table className="anomaly-table">
              <thead>
                <tr>
                  <th>优先级</th>
                  <th>问题 / 下一步</th>
                  <th>关联对象</th>
                  <th>账期</th>
                  <th className="is-right">影响金额</th>
                  <th>状态 / 负责人</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="anomaly-empty">
                      {loading ? '正在巡检数据…' : status === 'open' ? '当前筛选范围没有未关闭事项。' : '当前筛选范围暂无记录。'}
                    </td>
                  </tr>
                ) : visible.map((item) => {
                  const detail = statusDetailMap[item.id] || {}
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className={`anomaly-severity is-${item.severity}`}>{SEVERITY_LABELS[item.severity]}</span>
                        <small>{CATEGORY_LABELS[item.category] || item.category}</small>
                      </td>
                      <td className="anomaly-problem">
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                        <span className="anomaly-next-action">下一步：{nextActionLabel(item)}</span>
                        {detail.note ? <span className="anomaly-workflow-note">处理说明：{detail.note}</span> : null}
                      </td>
                      <td className="anomaly-object">
                        <strong>{item.billNumber || item.partnerName || '系统数据'}</strong>
                        <span>{[item.partnerName, item.gameName].filter(Boolean).join(' · ') || '-'}</span>
                      </td>
                      <td>{monthText(item.settlementMonth)}</td>
                      <td className="is-right anomaly-money">{money(item.amount)}</td>
                      <td>
                        <span className={`anomaly-status is-${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span>
                        <small className="anomaly-assignee">{detail.assignee || (item.status === 'pending' ? '未分配' : '-')}</small>
                      </td>
                      <td>
                        <div className="anomaly-actions">
                          {item.billId ? <button type="button" className="is-primary-action" onClick={() => openBillOverview(item)}>360°核对</button> : null}
                          {shouldOfferRelated(item) ? <button type="button" onClick={() => openRelated(item)}>{relatedActionLabel(item)}</button> : null}
                          {shouldOfferEdit(item) ? <button type="button" onClick={() => editBill(item)}>修复账单</button> : null}
                          {item.status === 'pending' ? <button type="button" disabled={updatingId === item.id} onClick={() => openWorkflow(item, 'processing')}>开始处理</button> : null}
                          {item.status === 'processing' ? <button type="button" disabled={updatingId === item.id} onClick={() => openWorkflow(item, 'processing')}>更新处理</button> : null}
                          {item.status === 'processing' ? <button type="button" disabled={updatingId === item.id} onClick={() => openWorkflow(item, 'resolved')}>完成</button> : null}
                          {['resolved', 'ignored'].includes(item.status) ? <button type="button" disabled={updatingId === item.id} onClick={() => openWorkflow(item, 'pending')}>重新打开</button> : null}
                          <button type="button" className="is-muted" onClick={() => openWorkflow(item, item.status)}>处理记录</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {workflowItem ? (
        <div className="anomaly-workflow-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setWorkflowItem(null)
        }}>
          <aside className="anomaly-workflow-panel" role="dialog" aria-modal="true" aria-label="异常处理">
            <header>
              <div><span>EXCEPTION WORKFLOW</span><h2>异常处理</h2><p>{workflowItem.title}</p></div>
              <button type="button" onClick={() => setWorkflowItem(null)} aria-label="关闭">×</button>
            </header>
            <main>
              <section className="anomaly-workflow-facts">
                <div><span>关联对象</span><strong>{workflowItem.billNumber || workflowItem.partnerName || '系统数据'}</strong></div>
                <div><span>影响金额</span><strong>{money(workflowItem.amount)}</strong></div>
                <div><span>问题类型</span><strong>{CATEGORY_LABELS[workflowItem.category] || workflowItem.category}</strong></div>
                <div><span>最后更新</span><strong>{dateTime(statusDetailMap[workflowItem.id]?.updated_at)}</strong></div>
              </section>
              <label><span>处理状态</span><select value={workflowTarget} onChange={(event) => setWorkflowTarget(event.target.value)}><option value="pending">待处理</option><option value="processing">处理中</option><option value="resolved">已解决</option><option value="ignored">已忽略</option></select></label>
              <label><span>负责人</span><input value={assigneeDraft} onChange={(event) => setAssigneeDraft(event.target.value)} placeholder="负责人邮箱或姓名" /></label>
              <label><span>处理说明</span><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={6} placeholder="记录核对结果、处理动作、原因或证据位置。标记解决/忽略时必须填写。" /></label>
              <div className="anomaly-workflow-history">
                <span>最后处理人：{statusDetailMap[workflowItem.id]?.updated_by_email || '-'}</span>
                <span>开始处理：{dateTime(statusDetailMap[workflowItem.id]?.started_at)}</span>
                <span>关闭时间：{dateTime(statusDetailMap[workflowItem.id]?.closed_at)}</span>
              </div>
            </main>
            <footer><button type="button" onClick={() => setWorkflowItem(null)}>取消</button><button type="button" className="primary" disabled={updatingId === workflowItem.id} onClick={() => void saveWorkflow()}>{updatingId === workflowItem.id ? '保存中…' : `保存为${STATUS_LABELS[workflowTarget]}`}</button></footer>
          </aside>
        </div>
      ) : null}
    </PageContainer>
  )
}
