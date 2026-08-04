import React, { useEffect, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { VIEWS } from '@/app/routes.js'
import { listContracts } from '@/lib/api/contract.ts'
import './CoreDashboardPage.css'

function currency(value) {
  const n = Number(value || 0)
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function CoreDashboardPage() {
  const { recon, settings, setActiveView } = useAppState()
  const rdRecords = recon.records || []
  const channelRecords = recon.channelRecords || []
  const partners = settings.partners || []
  const [contractSummary, setContractSummary] = useState({
    total: 0,
    linked: 0,
    amount_total: '0',
    expiring_30: 0,
    expired: 0
  })

  useEffect(() => {
    let active = true
    listContracts({ limit: 1, offset: 0 })
      .then((response) => {
        if (active && response?.summary) {
          setContractSummary((current) => ({ ...current, ...response.summary }))
        }
      })
      .catch(() => {
        // 合同中心会展示完整错误态；工作台保持可用。
      })
    return () => {
      active = false
    }
  }, [])

  const rdTotal = rdRecords.reduce(
    (sum, row) => sum + Number(row.settlementAmount || 0),
    0
  )
  const channelTotal = channelRecords.reduce(
    (sum, row) =>
      sum + Number(row.settlementAmount ?? row.totalAmount ?? row.amount ?? 0),
    0
  )
  const rdPendingRows = rdRecords.filter(
    (row) => String(row.status || 'pending') === 'pending'
  )
  const channelPendingRows = channelRecords.filter(
    (row) => String(row.status || 'pending') === 'pending'
  )
  const rdPendingAmount = rdPendingRows.reduce(
    (sum, row) => sum + Number(row.settlementAmount || 0),
    0
  )
  const channelPendingAmount = channelPendingRows.reduce(
    (sum, row) =>
      sum + Number(row.settlementAmount ?? row.totalAmount ?? row.amount ?? 0),
    0
  )
  const totalPendingCount = rdPendingRows.length + channelPendingRows.length
  const contractExpiring = Number(contractSummary.expiring_30 || 0)
  const contractExpired = Number(contractSummary.expired || 0)
  const contractRiskCount = contractExpiring + contractExpired
  const settlementMonth = settings.settlementMonth || '未设置'

  const metrics = [
    {
      label: '对账总额',
      value: currency(rdTotal + channelTotal),
      note: `${rdRecords.length + channelRecords.length} 笔账单`,
      view: VIEWS.RECON_PROGRESS,
      tone: 'total'
    },
    {
      label: '研发结算',
      value: currency(rdTotal),
      note: `${rdRecords.length} 笔账单`,
      view: VIEWS.RECON_RD,
      tone: 'rd'
    },
    {
      label: '渠道结算',
      value: currency(channelTotal),
      note: `${channelRecords.length} 笔账单`,
      view: VIEWS.RECON_CHANNEL,
      tone: 'channel'
    },
    {
      label: '待处理账单',
      value: `${totalPendingCount} 笔`,
      note: totalPendingCount > 0 ? '需要继续核对或确认' : '当前没有待处理账单',
      view: VIEWS.RECON_PROGRESS,
      tone: totalPendingCount > 0 ? 'warning' : 'clear'
    }
  ]

  const attentionItems = [
    {
      label: '研发待处理',
      value: `${rdPendingRows.length} 笔`,
      note: currency(rdPendingAmount),
      view: VIEWS.RECON_RD,
      tone: 'rd',
      clear: rdPendingRows.length === 0
    },
    {
      label: '渠道待处理',
      value: `${channelPendingRows.length} 笔`,
      note: currency(channelPendingAmount),
      view: VIEWS.RECON_CHANNEL,
      tone: 'channel',
      clear: channelPendingRows.length === 0
    },
    {
      label: '合同风险',
      value: `${contractRiskCount} 份`,
      note: contractRiskCount
        ? `即将到期 ${contractExpiring} · 已过期 ${contractExpired}`
        : '暂无到期风险',
      view: VIEWS.CONTRACTS,
      tone: 'contract',
      clear: contractRiskCount === 0
    }
  ]

  const modules = [
    {
      name: '研发账单',
      count: `${rdRecords.length} 笔`,
      meta: currency(rdTotal),
      view: VIEWS.RECON_RD,
      tone: 'blue',
      mark: '研'
    },
    {
      name: '渠道账单',
      count: `${channelRecords.length} 笔`,
      meta: currency(channelTotal),
      view: VIEWS.RECON_CHANNEL,
      tone: 'green',
      mark: '渠'
    },
    {
      name: '合同台账',
      count: `${contractSummary.total || 0} 份`,
      meta: currency(contractSummary.amount_total),
      view: VIEWS.CONTRACTS,
      tone: 'violet',
      mark: '合'
    },
    {
      name: '数据库',
      count: '流水核验',
      meta: '批次与原始明细',
      view: VIEWS.QUICKSDK_LIBRARY,
      tone: 'amber',
      mark: '流'
    },
    {
      name: '客户库',
      count: `${partners.length} 个`,
      meta: '合作方资料',
      view: VIEWS.PARTNER_CONTACTS,
      tone: 'slate',
      mark: '客'
    }
  ]

  return (
    <PageContainer hideHeader className="core-dashboard-page">
      <section className="core-dashboard-overview" aria-label="财务概览">
        <div className="core-dashboard-overview__head">
          <div className="core-dashboard-period">
            <span>当前账期</span>
            <strong>{settlementMonth}</strong>
            <small>研发与渠道结算统一汇总</small>
          </div>
          <div className="core-dashboard-primary-actions" aria-label="快捷新增">
            <button
              type="button"
              className="is-primary"
              onClick={() => setActiveView(VIEWS.RECON_CREATE)}
            >
              新增研发账单
            </button>
            <button
              type="button"
              onClick={() => setActiveView(VIEWS.CHANNEL_RECON_CREATE)}
            >
              新增渠道账单
            </button>
            <button type="button" onClick={() => setActiveView(VIEWS.RECON_PROGRESS)}>
              查看对账进度
            </button>
          </div>
        </div>
        <div className="core-dashboard-metric-grid">
          {metrics.map((metric) => (
            <button
              type="button"
              key={metric.label}
              className={`core-dashboard-metric core-dashboard-metric--${metric.tone}`}
              onClick={() => setActiveView(metric.view)}
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.note}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="core-dashboard-attention" aria-label="需要关注">
        <div className="core-dashboard-section-title">
          <div>
            <strong>需要关注</strong>
            <span>优先处理会影响核对、结算和合同履约的事项</span>
          </div>
          <em>{totalPendingCount + contractRiskCount} 项</em>
        </div>
        <div className="core-dashboard-attention-grid">
          {attentionItems.map((item) => (
            <button
              type="button"
              key={item.label}
              className={`core-dashboard-attention-card core-dashboard-attention-card--${item.tone} ${item.clear ? 'is-clear' : ''}`}
              onClick={() => setActiveView(item.view)}
            >
              <span className="core-dashboard-attention-card__mark" aria-hidden="true" />
              <span className="core-dashboard-attention-card__copy">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.note}</small>
              </span>
              <i aria-hidden="true">›</i>
            </button>
          ))}
        </div>
      </section>

      <section className="core-dashboard-modules" aria-label="业务入口">
        <div className="core-dashboard-section-title">
          <div>
            <strong>业务入口</strong>
            <span>进入台账、数据和客户资料</span>
          </div>
        </div>
        <div className="core-dashboard-module-grid">
          {modules.map((module) => (
            <button
              type="button"
              key={module.name}
              className={`core-module-card core-module-card--${module.tone}`}
              onClick={() => setActiveView(module.view)}
            >
              <span className="core-module-card__mark" aria-hidden="true">{module.mark}</span>
              <span className="core-module-card__copy">
                <strong>{module.name}</strong>
                <small>{module.meta}</small>
              </span>
              <span className="core-module-card__count">{module.count}</span>
              <i aria-hidden="true">›</i>
            </button>
          ))}
        </div>
      </section>
    </PageContainer>
  )
}

export default CoreDashboardPage
