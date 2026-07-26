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
    amount_total: '0',
    expiring_30: 0
  })

  useEffect(() => {
    let active = true
    listContracts({ limit: 1, offset: 0 })
      .then((response) => {
        if (active && response?.summary) setContractSummary(response.summary)
      })
      .catch(() => {
        // 合同中心会展示完整错误态；工作台保持可用。
      })
    return () => {
      active = false
    }
  }, [])

  const rdTotal = rdRecords.reduce((sum, row) => sum + Number(row.settlementAmount || 0), 0)
  const channelTotal = channelRecords.reduce((sum, row) => sum + Number(row.totalAmount || row.amount || 0), 0)
  const settlementMonth = settings.settlementMonth || '未设置'

  const quickActions = [
    {
      label: '新增研发账单',
      desc: '录入研发结算明细',
      view: VIEWS.RECON_CREATE,
      tone: 'rd'
    },
    {
      label: '新增渠道账单',
      desc: '录入渠道结算明细',
      view: VIEWS.CHANNEL_RECON_CREATE,
      tone: 'channel'
    },
    {
      label: '查看合同台账',
      desc: '履约、到期与客户关联',
      view: VIEWS.CONTRACTS,
      tone: 'contract'
    },
    {
      label: '查看数据库流水',
      desc: '批次、排行、原始明细',
      view: VIEWS.QUICKSDK_LIBRARY,
      tone: 'data'
    },
    {
      label: '维护客户库',
      desc: '合作方资料统一维护',
      view: VIEWS.PARTNER_CONTACTS,
      tone: 'customer'
    }
  ]

  const modules = [
    {
      name: '研发账单',
      desc: '保留原研发对账录入、计算、导入和导出逻辑。',
      count: `${rdRecords.length} 张`,
      amount: currency(rdTotal),
      meta: `当前账期：${settlementMonth}`,
      view: VIEWS.RECON_RD,
      tone: 'blue'
    },
    {
      name: '渠道账单',
      desc: '保留渠道对账导入、核算、编辑和导出流程。',
      count: `${channelRecords.length} 张`,
      amount: currency(channelTotal),
      meta: '渠道结算核心入口',
      view: VIEWS.RECON_CHANNEL,
      tone: 'green'
    },
    {
      name: '合同中心',
      desc: '集中管理 WPS 合同、履约状态、到期提醒和客户关联。',
      count: `${contractSummary.total} 份`,
      amount: currency(contractSummary.amount_total),
      meta: contractSummary.expiring_30 ? `${contractSummary.expiring_30} 份即将到期` : 'WPS 合同台账',
      view: VIEWS.CONTRACTS,
      tone: 'violet'
    },
    {
      name: '数据库',
      desc: '查看流水批次、产品排行、渠道排行和明细。',
      count: 'QK',
      amount: '数据中心',
      meta: '流水核验入口',
      view: VIEWS.QUICKSDK_LIBRARY,
      tone: 'amber'
    },
    {
      name: '客户库',
      desc: '维护合作方基础资料，供对账单复用。',
      count: `${partners.length} 个`,
      amount: '资料维护',
      meta: '合作方资料',
      view: VIEWS.PARTNER_CONTACTS,
      tone: 'slate'
    }
  ]

  return (
    <PageContainer hideHeader className="core-dashboard-page">
      <section className="core-dashboard-hero">
        <div className="core-dashboard-hero__copy">
          <p className="core-dashboard-eyebrow">核心财务后台</p>
          <h1>对账管理系统</h1>
          <p>研发对账、渠道对账、合同、流水和客户资料集中在一个工作台，重要状态一眼可见。</p>
          <div className="core-dashboard-hero__meta" role="group" aria-label="工作台状态">
            <span>账期：{settlementMonth}</span>
            <span>核心入口：5 个</span>
            <span>客户资料：{partners.length} 个</span>
          </div>
        </div>
        <div className="core-dashboard-kpis" role="group" aria-label="对账金额概览">
          <button type="button" className="core-dashboard-kpi" onClick={() => setActiveView(VIEWS.RECON_RD)}>
            <span>研发对账金额</span>
            <strong>{currency(rdTotal)}</strong>
            <small>{rdRecords.length} 张账单</small>
          </button>
          <button type="button" className="core-dashboard-kpi" onClick={() => setActiveView(VIEWS.RECON_CHANNEL)}>
            <span>渠道对账金额</span>
            <strong>{currency(channelTotal)}</strong>
            <small>{channelRecords.length} 张账单</small>
          </button>
        </div>
      </section>

      <section className="core-dashboard-actions" aria-label="常用操作">
        <div className="core-dashboard-section-title">
          <strong>常用操作</strong>
          <span>高频动作直接放在第一屏</span>
        </div>
        <div className="core-dashboard-action-grid">
          {quickActions.map((action) => (
            <button
              type="button"
              key={action.label}
              className={`core-dashboard-action core-dashboard-action--${action.tone}`}
              onClick={() => setActiveView(action.view)}
            >
              <span>{action.label}</span>
              <small>{action.desc}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="core-dashboard-modules" aria-label="核心模块">
        <div className="core-dashboard-section-title">
          <strong>核心模块</strong>
          <span>五个核心业务入口统一管理</span>
        </div>
        <div className="core-dashboard-module-grid">
          {modules.map((module) => (
            <button
              type="button"
              key={module.name}
              className={`core-module-card core-module-card--${module.tone}`}
              onClick={() => setActiveView(module.view)}
            >
              <span className="core-module-card__head">
                <span>
                  <strong>{module.name}</strong>
                  <small>{module.meta}</small>
                </span>
                <em>{module.count}</em>
              </span>
              <span className="core-module-card__desc">{module.desc}</span>
              <span className="core-module-card__foot">
                <b>{module.amount}</b>
                <i>进入</i>
              </span>
            </button>
          ))}
        </div>
      </section>
    </PageContainer>
  )
}

export default CoreDashboardPage
