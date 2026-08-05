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

function percent(value) {
  return `${Math.max(0, Math.min(100, Math.round(Number(value || 0))))}%`
}

function parsePeriod(value) {
  const raw = String(value || '').trim()
  if (!raw || raw === '未设置') return null

  const match = raw.match(/(20\d{2})\D{0,3}(1[0-2]|0?[1-9])(?:\D|$)/)
  if (match) {
    const year = Number(match[1])
    const month = Number(match[2])
    return {
      key: year * 100 + month,
      label: `${year}年${month}月`
    }
  }

  const compact = raw.match(/^(20\d{2})(1[0-2]|0[1-9])$/)
  if (compact) {
    const year = Number(compact[1])
    const month = Number(compact[2])
    return {
      key: year * 100 + month,
      label: `${year}年${month}月`
    }
  }

  return null
}

function resolveSettlementPeriod(configuredPeriod, rows) {
  const configured = parsePeriod(configuredPeriod)
  if (configured) {
    return { ...configured, source: '系统账期' }
  }

  const recordPeriods = rows
    .flatMap((row) => [
      row?.settlementMonth,
      row?.billMonth,
      row?.accountMonth,
      row?.month,
      row?.period,
      row?.date
    ])
    .map(parsePeriod)
    .filter(Boolean)
    .sort((left, right) => right.key - left.key)

  if (recordPeriods[0]) {
    return { ...recordPeriods[0], source: '最新账单月份' }
  }

  const now = new Date()
  return {
    key: now.getFullYear() * 100 + now.getMonth() + 1,
    label: `${now.getFullYear()}年${now.getMonth() + 1}月`,
    source: '当前月份'
  }
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
  const allRecords = [...rdRecords, ...channelRecords]
  const settlementPeriod = resolveSettlementPeriod(settings.settlementMonth, allRecords)
  const billCount = allRecords.length
  const completedBillCount = Math.max(0, billCount - totalPendingCount)
  const billCompletionRate = billCount > 0 ? (completedBillCount / billCount) * 100 : 100
  const settlementTotal = rdTotal + channelTotal
  const rdShare = settlementTotal > 0 ? (rdTotal / settlementTotal) * 100 : 0
  const channelShare = settlementTotal > 0 ? (channelTotal / settlementTotal) * 100 : 0
  const contractTotal = Number(contractSummary.total || 0)
  const contractLinked = Number(contractSummary.linked || 0)
  const contractLinkRate = contractTotal > 0 ? (contractLinked / contractTotal) * 100 : 0

  const metrics = [
    {
      label: '对账总额',
      value: currency(settlementTotal),
      note: `${billCount} 笔账单`,
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
  const activeAttentionItems = attentionItems.filter((item) => !item.clear)

  const operationProgress = [
    {
      label: '账单完成度',
      value: percent(billCompletionRate),
      note: `${completedBillCount} / ${billCount} 笔已完成`,
      progress: billCompletionRate,
      tone: 'blue',
      view: VIEWS.RECON_PROGRESS
    },
    {
      label: '研发金额占比',
      value: percent(rdShare),
      note: currency(rdTotal),
      progress: rdShare,
      tone: 'indigo',
      view: VIEWS.RECON_RD
    },
    {
      label: '渠道金额占比',
      value: percent(channelShare),
      note: currency(channelTotal),
      progress: channelShare,
      tone: 'green',
      view: VIEWS.RECON_CHANNEL
    },
    {
      label: '合同关联率',
      value: contractTotal > 0 ? percent(contractLinkRate) : '暂无合同',
      note: contractTotal > 0 ? `${contractLinked} / ${contractTotal} 份已关联` : '录入合同后自动统计',
      progress: contractLinkRate,
      tone: 'violet',
      view: VIEWS.CONTRACTS
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
      count: `${contractTotal} 份`,
      meta: currency(contractSummary.amount_total),
      view: VIEWS.CONTRACTS,
      tone: 'violet',
      mark: '合'
    },
    {
      name: '发票中心',
      count: '销项 / 进项',
      meta: '开票与账单关联',
      view: VIEWS.INVOICE_MANAGE,
      tone: 'cyan',
      mark: '票'
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
      name: '数据源',
      count: '产品映射',
      meta: '游戏与 ProductCode',
      view: VIEWS.PRODUCT_SOURCES,
      tone: 'sky',
      mark: '源'
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
            <strong>{settlementPeriod.label}</strong>
            <small>依据：{settlementPeriod.source} · 研发与渠道统一汇总</small>
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
          <em className={activeAttentionItems.length === 0 ? 'is-clear' : ''}>
            {activeAttentionItems.length} 项
          </em>
        </div>
        {activeAttentionItems.length > 0 ? (
          <div className="core-dashboard-attention-grid">
            {activeAttentionItems.map((item) => (
              <button
                type="button"
                key={item.label}
                className={`core-dashboard-attention-card core-dashboard-attention-card--${item.tone}`}
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
        ) : (
          <button
            type="button"
            className="core-dashboard-clear-state"
            onClick={() => setActiveView(VIEWS.RECON_PROGRESS)}
          >
            <span aria-hidden="true">✓</span>
            <strong>当前无待处理事项</strong>
            <small>研发与渠道账单没有待核对记录，合同暂无到期风险</small>
            <i aria-hidden="true">查看对账进度 ›</i>
          </button>
        )}
      </section>

      <section className="core-dashboard-progress" aria-label="本期运营概览">
        <div className="core-dashboard-section-title">
          <div>
            <strong>本期运营概览</strong>
            <span>快速判断账单处理效率与结算结构</span>
          </div>
        </div>
        <div className="core-dashboard-progress-grid">
          {operationProgress.map((item) => (
            <button
              type="button"
              key={item.label}
              className={`core-dashboard-progress-card core-dashboard-progress-card--${item.tone}`}
              onClick={() => setActiveView(item.view)}
            >
              <span className="core-dashboard-progress-card__head">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </span>
              <span className="core-dashboard-progress-card__track" aria-hidden="true">
                <i style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
              </span>
              <small>{item.note}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="core-dashboard-modules" aria-label="业务入口">
        <div className="core-dashboard-section-title">
          <div>
            <strong>业务入口</strong>
            <span>进入台账、发票、数据和客户资料</span>
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
