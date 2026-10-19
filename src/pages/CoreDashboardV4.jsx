import React, { useCallback, useEffect, useMemo, useState } from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { useAppState } from '@/app/AppStateContext.jsx'
import { canOpenView } from '@/app/viewPermissions.js'
import { VIEWS } from '@/app/routes.js'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { getProfitAnalysis, getProjectProfitAnalysis } from '@/lib/api/profitAnalysis.ts'
import { getMonthlyBusinessDashboard } from '@/lib/api/businessDashboard.ts'
import { getWorkbenchTodos } from '@/lib/api/workbench.ts'
import { listContracts } from '@/lib/api/contract.ts'
import { getFinanceTaskSummary } from '@/lib/api/financeTasks.ts'
import {
  displayMoney, exactMoney, monthText, latestPeriod,
  summarizeFinancePeriod, combineMonthlyTrends
} from '@/domain/financeDashboardV4.js'
import './CoreDashboardV4.css'

const ICONS = {
  dashboard: 'M4 17l6-6 4 3 6-8M15 6h5v5',
  game: 'M7 7h10a4 4 0 0 1 4 4l1 5a3 3 0 0 1-5 2l-2-2H9l-2 2a3 3 0 0 1-5-2l1-5a4 4 0 0 1 4-4zM7 12h4m-2-2v4m8-3h.01m2 2h.01',
  briefcase: 'M4 7h16v14H4zM9 7V4h6v3M4 12h16m-12 0v2h8v-2',
  income: 'M4 17 18 3M9 3h9v9M4 8v9h9',
  expense: 'M20 7 6 21M11 21H6v-5M20 16V7h-9',
  receipt: 'M5 3h14v18l-3-2-4 2-4-2-3 2zM8 9h8M8 13h8',
  wallet: 'M3 7h18v13H3zM3 7V4h17M16 14h3',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20M12 6v6l4 2',
  trend: 'M3 17l6-6 4 3 8-9M14 5h7v7',
  calendar: 'M3 5h18v16H3zM7 2v6m10-6v6M3 11h18',
  refresh: 'M20 11a8 8 0 0 0-14-5L4 8m0-4v4h4M4 13a8 8 0 0 0 14 5l2-2m0 4v-4h-4',
  plus: 'M12 4v16M4 12h16',
  chevron: 'm9 18 6-6-6-6',
  info: 'M12 11v6M12 7h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  x: 'M5 5l14 14M19 5 5 19',
  check: 'M5 12l5 5L20 7',
  file: 'M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h7',
  alert: 'M12 3 2 21h20L12 3zM12 9v5m0 3h.01',
  bank: 'M3 10l9-7 9 7M4 10h16M6 10v9m6-9v9m6-9v9M3 21h18',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'
}
function I({ name, size = 18 }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d={ICONS[name] || ICONS.info}/></svg>
}
const number = v => Number.isFinite(Number(v)) ? Number(v) : 0
const valid = v => v !== null && v !== undefined && Number.isFinite(Number(v))
const percent = v => valid(v) ? Number(v).toFixed(1) + '%' : '—'
function Delta({ change, label = '较上月' }) {
  if (!valid(change)) return null
  return <span className={'f4-delta '+ (Number(change) < 0 ? 'negative' : 'positive')}>{Number(change) < 0 ? '↓' : '↑'} {label} {Math.abs(Number(change)).toFixed(1)}%</span>
}
function ProfitHero({ label, hint, amount, margin, extra, tone, onClick, change, loading }) {
  return <button type="button" className={'f4-profit f4-card '+tone} onClick={onClick}>
    <span className="f4-profit-heading"><span className="f4-profit-caption"><span className="f4-square"><I name={tone==='green'?'game':'briefcase'} size={19}/></span><span><b>{label}</b><small>{hint}</small></span></span><span className="f4-mini-tag">管理口径</span></span>
    <span className={'f4-profit-value'+(valid(amount)&&Number(amount)<0?' is-negative':'')} title={exactMoney(amount)}>{loading ? '读取中…' : displayMoney(amount)}</span>
    <span className="f4-profit-summary"><span>{extra || '按实际账单与已录入费用归集'}</span><Delta change={change}/></span>
    <span className="f4-profit-foot"><span>利润率 <strong>{percent(margin)}</strong></span><span>查看明细 <I name="chevron" size={14}/></span></span>
  </button>
}
function Metric({ label, amount, hint, icon, tone, onClick, loading }) {
  return <button type="button" className="f4-metric f4-card" onClick={onClick} disabled={!onClick}>
    <span className={'f4-metric-icon '+tone}><I name={icon} size={20}/></span>
    <span className="f4-metric-content"><span>{label}</span><strong title={valid(amount)?exactMoney(amount):''}>{loading?'读取中…':displayMoney(amount)}</strong><small>{hint}</small></span>
  </button>
}
function HeaderSection({ title, note, action, onClick }) {
  return <div className="f4-section-heading"><h2>{title} <small>{note}</small></h2>{action&&<button type="button" onClick={onClick}>{action} <I name="chevron" size={14}/></button>}</div>
}
const SERIES = {
  profit: [
    {key:'gross',label:'游戏业务利润',color:'#14ad82'},
    {key:'operating',label:'公司经营利润',color:'#497cf4'}
  ],
  settlement: [
    {key:'channel',label:'渠道结算',color:'#497cf4'},
    {key:'rd',label:'研发结算',color:'#916de2'},
    {key:'contribution',label:'结算贡献',color:'#14ad82'}
  ],
  cash: [
    {key:'cashIn',label:'渠道实际收款',color:'#14ad82'},
    {key:'cashOut',label:'研发实际付款',color:'#e9a04b'},
    {key:'cashNet',label:'部分现金净流入',color:'#497cf4'}
  ]
}
function Chart({ rows, series }) {
  const specs=SERIES[series]
  const present=rows.filter(row=>specs.some(s=>valid(row[s.key])))
  if (!present.length) return <div className="f4-empty">此时间范围暂无对应数据</div>
  const vals=present.flatMap(row=>specs.map(s=>row[s.key]).filter(valid))
  const min=Math.min(0,...vals),max=Math.max(1,...vals),spread=Math.max(1,max-min)
  const xpos = i => 48 + i * 555 / Math.max(1,present.length-1)
  const ypos = v => 210 - (v-min)/spread * 165
  const path=key => present.map((row,i)=>valid(row[key])?(i?'L':'M')+xpos(i).toFixed(1)+','+ypos(row[key]).toFixed(1):'').join(' ')
  return <div className="f4-trend-canvas"><svg viewBox="0 0 650 255" preserveAspectRatio="xMidYMid meet" role="img" aria-label="月度经营趋势">
    {[0,1,2,3,4].map(i=>{const v=min+(max-min)*(4-i)/4;return <g key={i}><line x1="44" x2="611" y1={ypos(v)} y2={ypos(v)} stroke="#e7edf6" strokeDasharray="4 5"/><text x="38" y={ypos(v)+4} textAnchor="end" fontSize="10" fill="#9eabc0">{(v/10000).toFixed(1)}</text></g>})}
    {min<0 && <line x1="44" x2="611" y1={ypos(0)} y2={ypos(0)} stroke="#bccadc"/>}
    {specs.map(spec=><g key={spec.key}><path d={path(spec.key)} stroke={spec.color} strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round" fill="none"/>{present.map((row,i)=>valid(row[spec.key])?<circle key={row.month} cx={xpos(i)} cy={ypos(row[spec.key])} r="4" fill="#fff" stroke={spec.color} strokeWidth="2.2"><title>{monthText(row.month)+' · '+spec.label+'：'+exactMoney(row[spec.key])}</title></circle>:null)}</g>)}
    {present.map((row,i)=><text key={row.month} x={xpos(i)} y="239" textAnchor="middle" fontSize="11" fill="#9bacc1">{row.month.slice(5)}月</text>)}
  </svg></div>
}
function CashPanel({ summary, loading, onMore }) {
  const amountIn=summary.cashIn,amountOut=summary.cashOut
  const positive=valid(summary.cashNet) && summary.cashNet >= 0
  const abs=valid(amountIn)&&valid(amountOut) ? Math.abs(amountIn)+Math.abs(amountOut) : 0
  const share=abs ? Math.abs(amountIn) / abs *100 : 0
  return <section className="f4-panel f4-card">
    <div className="f4-panel-head"><div><h3>实际现金流</h3><p>按真实收付款发生日期归集 · 不等于经营利润</p></div><button type="button" onClick={onMore}>查看明细 <I name="chevron" size={14}/></button></div>
    <div className="f4-cash-pair">
      <div className="f4-cash-tile received"><span><I name="income" size={16}/> 渠道实际收款</span><strong title={exactMoney(amountIn)}>{loading?'读取中…':displayMoney(amountIn)}</strong><small>按收款登记日期</small></div>
      <div className="f4-cash-tile paid"><span><I name="expense" size={16}/> 研发实际付款</span><strong title={exactMoney(amountOut)}>{loading?'读取中…':displayMoney(amountOut)}</strong><small>按付款登记日期</small></div>
    </div>
    <div className="f4-net"><span>本期部分现金净流入<small>渠道实收 − 研发实付（不含其他资金收支）</small></span><strong className={positive?'positive':'negative'} title={exactMoney(summary.cashNet)}>{displayMoney(summary.cashNet)}</strong></div>
    <div className="f4-ratio-heading"><span>收款与付款规模对比</span><strong>{abs?'收款 '+share.toFixed(0)+'% · 付款 '+(100-share).toFixed(0)+'%':'暂无可比数据'}</strong></div>
    <div className="f4-ratio-bar"><span style={{width:share+'%'}}/><i style={{width:(100-share)+'%'}}/></div>
    <p className="f4-panel-caption">应收未收与已经到账属于不同口径，资金指标不替代公司银行余额。</p>
  </section>
}
function Breakdown({ summary, onClick, annual }) {
  const rows=[
    ['渠道结算收入（利润归集口径）', summary.profitIncome,'blue'],
    ['研发结算成本', summary.rdCost,'orange'],
    ['服务器成本', summary.serverCost,'orange'],
    ['经营费用（含归属及公共费用）',summary.operatingExpense,'orange']
  ]
  return <section className="f4-panel f4-card">
    <div className="f4-panel-head"><div><h3>利润构成与成本拆解</h3><p>同一核算范围 · 每项成本只扣一次</p></div><button type="button" onClick={onClick}>计算口径 <I name="chevron" size={14}/></button></div>
    <div className="f4-bridge">{rows.map(([name,value,tone])=><div key={name} className="f4-bridge-line"><span><i className={'f4-dot '+tone}/>{name}</span><strong className={tone==='orange'?'expense':''} title={exactMoney(value)}>{tone==='orange'&&valid(value)?'− ':''}{displayMoney(value)}</strong></div>)}
      <div className="f4-bridge-result gross"><b>游戏业务利润</b><strong title={exactMoney(summary.gross)}>{displayMoney(summary.gross)}</strong></div>
      <div className="f4-bridge-line"><span><i className="f4-dot orange"/>未归属公共成本与费用</span><strong className="expense" title={exactMoney(summary.sharedTotal)}>{valid(summary.sharedTotal)?'− ':''}{displayMoney(summary.sharedTotal)}</strong></div>
      <div className="f4-bridge-result operating"><b>公司经营利润</b><strong title={exactMoney(summary.operating)}>{displayMoney(summary.operating)}</strong></div>
    </div>
    <p className="f4-panel-caption">{annual?'年度数据按已有月度利润记录汇总。':'费用仅扣已录入台账金额，未录入的成本不会自动估算。'} 游戏利润与经营利润属于不同层次，不能相加。</p>
  </section>
}
function Projects({ projects, loading, onProject, onMore, annual }) {
  const rows=projects.slice(0,5)
  const max=Math.max(1,...rows.map(x=>Math.max(0,number(x.profit))))
  return <section className="f4-panel f4-card">
    <div className="f4-panel-head"><div><h3>游戏利润贡献排行</h3><p>项目可归属毛利 TOP 5 · 可查看成本来源</p></div><button type="button" onClick={onMore}>查看全部 <I name="chevron" size={14}/></button></div>
    <div className="f4-projects">{rows.length?rows.map((project,i)=><button type="button" className="f4-project-row" key={project.game_name} onClick={()=>onProject(project)}><span className={'f4-rank '+(i===0?'top':'')}>{i+1}</span><span className="f4-project-title"><strong>{project.game_name}</strong><small>毛利率 {percent(project.margin)}</small></span><span className="f4-project-bar"><i style={{width:Math.max(0,project.profit)/max*100+'%'}}/></span><strong className={project.profit<0?'is-negative':''} title={exactMoney(project.profit)}>{displayMoney(project.profit)}</strong><I name="chevron" size={14}/></button>):<div className="f4-empty">{loading?'读取项目数据中…':'所选'+(annual?'年度':'月份')+'暂无项目利润记录'}</div>}</div>
  </section>
}
function ProgressPanel({ business, annual, openView }) {
  const rows=[{label:'渠道账单',done:business?.channel_completed_count,total:business?.channel_bill_count,view:VIEWS.RECON_CHANNEL},{label:'研发账单',done:business?.rd_completed_count,total:business?.rd_bill_count,view:VIEWS.RECON_RD}]
  return <section className="f4-panel f4-card"><div className="f4-panel-head"><div><h3>账单核对进度</h3><p>{annual?'年度请切回具体月份查看完成率':'所选账期已完成 / 已结算 / 已核销的账单'}</p></div><button type="button" onClick={()=>openView(VIEWS.RECON_PROGRESS)}>查看列表 <I name="chevron" size={14}/></button></div>
    <div className="f4-progress-list">{rows.map(row=>{const ready=!annual&&Number.isFinite(Number(row.total))&&business!=null;const rate=ready&&number(row.total)>0?Math.max(0,Math.min(100,number(row.done)/number(row.total)*100)):0;return <button type="button" key={row.label} onClick={()=>openView(row.view)}><span><b>{row.label}</b><strong>{ready?number(row.done)+' / '+number(row.total)+' 笔':'—'}</strong></span><span className="f4-progress-track"><i style={{width:rate+'%'}}/></span><small>{ready?rate.toFixed(1)+'%':'请切换月份'}</small></button>})}</div>
  </section>
}
function Alerts({ items, onMore }) {
  return <section className="f4-panel f4-card"><div className="f4-panel-head"><div><h3>经营提醒</h3><p>只提示真实的费用缺项、合同与发票事项</p></div><button type="button" onClick={onMore}>查看更多 <I name="chevron" size={14}/></button></div>
    <div className="f4-alerts">{items.length?items.slice(0,4).map((item,i)=><button key={i} type="button" onClick={item.onClick} disabled={!item.onClick}><span className={'f4-alert-ico '+item.tone}><I name={item.icon} size={17}/></span><span><b>{item.label}</b><small>{item.sub}</small></span><strong>{item.value||'查看'}</strong><I name="chevron" size={14}/></button>):<div className="f4-empty">暂无需要显示的提醒</div>}</div>
  </section>
}

function CoreDashboardV4() {
  const {can}=useAuth()
  const {setActiveView}=useAppState()
  const canAnalytics=can('analytics.view')
  const canFunds=can('funds.view')
  const canRecon=can('reconciliation.view')
  const canInvoices=can('invoices.view')
  const canContracts=can('contracts.view')
  const canFinanceTasks=can('finance_tasks.view')
  const [selection,setSelection]=useState('')
  const [resolvedMonth,setResolvedMonth]=useState('')
  const [profit,setProfit]=useState(null)
  const [business,setBusiness]=useState(null)
  const [projectYear,setProjectYear]=useState(null)
  const [todo,setTodo]=useState(null)
  const [contractSummary,setContractSummary]=useState(null)
  const [financeTasks,setFinanceTasks]=useState(null)
  const [errors,setErrors]=useState([])
  const [loading,setLoading]=useState(true)
  const [revision,setRevision]=useState(0)
  const [series,setSeries]=useState('profit')
  const [range,setRange]=useState(6)
  const [drawer,setDrawer]=useState(null)
  const [showAllProjects,setShowAllProjects]=useState(false)
  const [newBillMenu,setNewBillMenu]=useState(false)
  const go=useCallback(view=>{if(view&&canOpenView(can,view))setActiveView(view)},[can,setActiveView])
  const refresh=useCallback(()=>setRevision(count=>count+1),[])
  useEffect(()=>{
    let current=true
    setLoading(true);setErrors([])
    async function load(){
      const annual=/^\d{4}-year$/.test(selection)
      const month=annual?selection.slice(0,4)+'-12':selection||undefined
      const checks=await Promise.allSettled([
        canAnalytics?getProfitAnalysis({month,trendMonths:annual?12:12}):Promise.resolve(null),
        canAnalytics?getMonthlyBusinessDashboard({month,trendMonths:annual?12:12}):Promise.resolve(null),
        getWorkbenchTodos(),
        canContracts?listContracts({limit:1,offset:0}):Promise.resolve(null),
        canFinanceTasks?getFinanceTaskSummary():Promise.resolve(null),
        canAnalytics&&annual?getProjectProfitAnalysis({year:selection.slice(0,4)}):Promise.resolve(null)
      ])
      let [p,b,t,c,f,pr]=checks.map(result=>result.status==='fulfilled'?result.value:null)
      let notes=checks.map((result,i)=>result.status==='rejected'?(['利润分析','经营驾驶舱','财务待办','合同关联','开票任务','年度项目毛利'][i]+'读取失败'):null).filter(Boolean)
      const last=latestPeriod(p,b)
      if(!selection&&last){
        if(p&&p.month!==last){try{p=await getProfitAnalysis({month:last,trendMonths:12})}catch{p=null;notes.push('统一账期利润读取失败')}}
        if(b&&b.month!==last){try{b=await getMonthlyBusinessDashboard({month:last,trendMonths:12})}catch{b=null;notes.push('统一账期经营数据读取失败')}}
      }
      if(!current)return
      setProfit(p);setBusiness(b);setTodo(t);setContractSummary(c?.summary||null)
      setFinanceTasks(f);setProjectYear(pr)
      setResolvedMonth(selection?annual?'':selection:last)
      setErrors(notes);setLoading(false)
    }
    void load()
    return()=>{current=false}
  },[selection,revision,canAnalytics,canContracts,canFinanceTasks])
  const annual=/^\d{4}-year$/.test(selection)
  const currentMonth=annual?'':selection||resolvedMonth
  const scope=annual?selection.slice(0,4)+'年累计':monthText(currentMonth)
  const metrics=useMemo(()=>summarizeFinancePeriod(profit,business,selection||currentMonth),[profit,business,selection,currentMonth])
  const months=useMemo(()=>[...new Set([...(profit?.available_months||[]),...(business?.available_months||[]),currentMonth].filter(Boolean))].sort().reverse(),[profit,business,currentMonth])
  const years=[...new Set(months.map(key=>key.slice(0,4)))].sort().reverse()
  const trend=useMemo(()=>combineMonthlyTrends(profit,business,currentMonth,{annual,year:annual?selection.slice(0,4):'',months:range}),[profit,business,currentMonth,annual,selection,range])
  const projects=useMemo(()=>{
    if(annual)return (projectYear?.projects||[]).map(row=>({...row,profit:row.gross_profit,margin:row.gross_margin}))
    if(!metrics.profitReady)return []
    return (profit?.games||[]).map(row=>({...row,profit:row.attributable_profit,margin:row.attributable_margin})).sort((a,b)=>number(b.profit)-number(a.profit))
  },[annual,projectYear,profit,metrics.profitReady])
  const outstanding=todo?.summary||null
  const overviewBillCount=annual?null:business&&metrics.businessReady?number(business.channel_bill_count)+number(business.rd_bill_count):null
  const overviewCompleted=overviewBillCount===null?null:number(business.channel_completed_count)+number(business.rd_completed_count)
  const completion=overviewBillCount>0?Math.round(overviewCompleted/overviewBillCount*100):null
  const contributionRate=valid(metrics.contribution)&&metrics.channelSettlement>0?metrics.contribution/metrics.channelSettlement*100:null
  const cashShare=valid(metrics.cashIn)&&valid(metrics.cashOut)&&number(metrics.cashIn)+number(metrics.cashOut)>0
    ?100*number(metrics.cashIn)/(number(metrics.cashIn)+number(metrics.cashOut)):null
  const alerts=[]
  if(errors.length)alerts.push({label:'数据读取异常',sub:errors.join('；'),value:errors.length+' 项',tone:'warning',icon:'alert',onClick:refresh})
  if(canContracts&&contractSummary){
    const gap=Math.max(0,number(contractSummary.total)-number(contractSummary.linked))
    if(gap>0)alerts.push({label:'合同关联待核查',sub:'按合同台账的当前关联状态统计',value:gap+' 份',tone:'orange',icon:'file',onClick:()=>go(VIEWS.CONTRACTS)})
  }
  const invoiceItems=(todo?.items||[]).filter(row=>row.key==='input_invoice_gap'||row.key==='output_invoice_gap')
  const invoiceCount=invoiceItems.reduce((sum,item)=>sum+number(item.count),0)
  if(canInvoices&&invoiceCount>0)alerts.push({label:'发票覆盖与开票缺口',sub:'账单未被有效发票完全覆盖',value:invoiceCount+' 项',tone:'purple',icon:'receipt',onClick:()=>go(VIEWS.INVOICE_MANAGE)})
  if(canFinanceTasks&&number(financeTasks?.pending_count)+number(financeTasks?.processing_count)>0)alerts.push({label:'业务开票任务',sub:'开票任务已移到发票中心，历史记录保留',value:(number(financeTasks.pending_count)+number(financeTasks.processing_count))+' 笔',tone:'orange',icon:'receipt',onClick:()=>go(VIEWS.FINANCE_WORKBENCH)})
  if(canAnalytics&&metrics.profitReady&&!annual&&number(profit?.expense_count)===0)alerts.push({label:'本期经营费用录入检查',sub:'费用记录为 0，请确认属于无发生还是尚未录入',value:'待核实',tone:'blue',icon:'info',onClick:()=>go(VIEWS.OPERATING_EXPENSES)})
  if(canAnalytics&&!metrics.profitReady&&!loading)alerts.push({label:'当前账期暂无利润归集',sub:'请核查所选月份是否仅存在实际收付款',value:'待核实',tone:'blue',icon:'info',onClick:()=>setDrawer({kind:'method'})})
  const showDrawer=(kind,extra)=>{setDrawer({kind,...extra})}
  const marginChange=annual||!profit?.operating_profit||!metrics.profitReady?null:profit.operating_profit.change_percent
  const grossChange=annual||!profit?.project_gross_profit||!metrics.profitReady?null:profit.project_gross_profit.change_percent
  return <PageContainer hideHeader className="core-dashboard-v4">
    <div className="f4-page-head">
      <div className="f4-title"><span className="f4-title-icon"><I name="dashboard" size={22}/></span><div><h1>经营工作台</h1><p>游戏利润、公司经营、结算与现金流，一屏掌握</p></div></div>
      <div className="f4-actions">
        {canAnalytics&&<label className="f4-select"><I name="calendar" size={16}/><span className="f4-visually-hidden">统计月份</span><select aria-label="选择经营月份" value={selection||currentMonth||''} onChange={e=>{setSelection(e.target.value);setDrawer(null)}} disabled={loading&&months.length===0}>
          {!currentMonth&&!selection&&<option value="">最新有数据账期</option>}
          {months.map(m=><option key={m} value={m}>{monthText(m)}</option>)}
          {years.map(y=><option key={y+'-year'} value={y+'-year'}>{y}年累计</option>)}
        </select></label>}
        <button type="button" className="f4-action" onClick={refresh} disabled={loading}><I name="refresh" size={16}/>{loading?'刷新中':'刷新数据'}</button>
        {can('reconciliation.manage')&&<div className="f4-new-wrap"><button type="button" className="f4-action primary" onClick={()=>setNewBillMenu(v=>!v)} aria-expanded={newBillMenu}><I name="plus" size={17}/> 新建账单</button>{newBillMenu&&<div className="f4-new-menu"><button type="button" onClick={()=>{setNewBillMenu(false);go(VIEWS.RECON_CREATE)}}>新建研发账单</button><button type="button" onClick={()=>{setNewBillMenu(false);go(VIEWS.CHANNEL_RECON_CREATE)}}>新建渠道账单</button></div>}</div>}
      </div>
    </div>
    <div className="f4-notice"><I name="info" size={16}/><span>本页已接入真实财务数据；<strong>利润、结算、现金收付为不同统计口径</strong>，利润不等同于税后净利润。{annual?'年度仅汇总已录入月份。':'当前利润和结算采用所选账期，未收未付为全部未结。'}</span></div>
    {canAnalytics&&<>
      <HeaderSection title="经营利润" note={'游戏业务毛利与公司经营利润并列 · '+scope} action="利润口径说明" onClick={()=>showDrawer('method')}/>
      <div className="f4-profit-grid">
        <ProfitHero label="游戏业务利润" hint="项目可归属毛利 · 不分摊公司公共费用" amount={metrics.gross} margin={metrics.grossRate} extra="所选账期已归属项目利润合计" tone="green" change={grossChange} loading={loading} onClick={()=>showDrawer('profit')}/>
        <ProfitHero label="公司经营利润" hint="管理口径 · 已扣除全部录入经营费用" amount={metrics.operating} margin={metrics.operatingRate} extra={'未归属公共成本 '+displayMoney(metrics.sharedTotal)} tone="blue" change={marginChange} loading={loading} onClick={()=>showDrawer('operating')}/>
      </div>
    </>}
    <HeaderSection title="结算与资金" note={'结算按业务账期，待收待付按全部未结 · '+scope}/>
    <div className="f4-metrics">
      {canAnalytics&&<Metric label="渠道结算收入" amount={metrics.channelSettlement} hint="本期结算应收" icon="income" tone="blue" loading={loading} onClick={()=>showDrawer('settlement')}/>}
      {canAnalytics&&<Metric label="研发结算成本" amount={metrics.rdSettlement} hint="本期研发应付结算" icon="expense" tone="purple" loading={loading} onClick={()=>showDrawer('settlement')}/>}
      {canFunds&&<Metric label="渠道待收款" amount={outstanding?.receivable_amount??null} hint="全部账期仍未收清" icon="clock" tone="green" loading={loading} onClick={()=>go(VIEWS.BANK_RECONCILIATION)}/>}
      {canFunds&&<Metric label="研发待付款" amount={outstanding?.payable_amount??null} hint="全部账期仍未付清" icon="receipt" tone="orange" loading={loading} onClick={()=>go(VIEWS.BANK_RECONCILIATION)}/>}
    </div>
    <div className="f4-strip">
      <span><i className="f4-dot blue"/>结算贡献 <b title={exactMoney(metrics.contribution)}>{displayMoney(metrics.contribution)}</b><small>未扣全部费用</small></span>
      <span><i className="f4-dot green"/>部分现金净流入 <b title={exactMoney(metrics.cashNet)}>{displayMoney(metrics.cashNet)}</b></span>
      <span><i className="f4-dot orange"/>账单完成率 <b>{valid(completion)?completion+'%':'—'}</b><small>{annual?'年度不计算':'所选账期'}</small></span>
      <span><i className="f4-dot blue"/>数据口径 <b>经营 / 现金分开</b></span>
    </div>
    {canAnalytics&&<div className="f4-grid top">
      <section className="f4-panel f4-card">
        <div className="f4-panel-head"><div><h3>经营变化趋势</h3><p>将利润、结算和现金趋势整合为可切换图表</p></div><div className="f4-chart-actions"><div className="f4-segment">{[['profit','利润'],['settlement','结算'],['cash','现金流']].map(([id,label])=><button type="button" key={id} className={series===id?'active':''} aria-pressed={series===id} onClick={()=>setSeries(id)}>{label}</button>)}</div><div className="f4-segment">{[6,12].map(v=><button type="button" key={v} className={range===v?'active':''} aria-pressed={range===v} onClick={()=>setRange(v)}>{'近'+v+'月'}</button>)}</div></div></div>
        <div className="f4-legends">{SERIES[series].map(row=><span key={row.key}><i style={{background:row.color}}/>{row.label}</span>)}<small>单位：万元</small></div>
        <Chart rows={trend} series={series}/>
        <div className="f4-panel-foot"><span>{series==='cash'?'收付按实际登记日期，现金净流入不包括其他银行收支':series==='settlement'?'结算贡献未扣全部经营费用':'管理口径利润，不等于银行实际收款'}</span><strong>{scope} · {displayMoney(series==='profit'?metrics.operating:series==='cash'?metrics.cashNet:metrics.contribution)}</strong></div>
      </section>
      <CashPanel summary={metrics} loading={loading} onMore={()=>showDrawer('cash')}/>
    </div>}
    {canAnalytics&&<div className="f4-grid middle">
      <Breakdown summary={metrics} annual={annual} onClick={()=>showDrawer('method')}/>
      <Projects projects={projects} loading={loading} annual={annual} onMore={()=>{setShowAllProjects(true);showDrawer('projects')}} onProject={project=>showDrawer('project',{project})}/>
    </div>}
    <div className="f4-grid bottom">
      {canRecon&&<ProgressPanel business={metrics.businessReady?business:null} annual={annual} openView={go}/>}
      <Alerts items={alerts} onMore={()=>showDrawer('alerts')}/>
    </div>
    <p className="f4-page-footer">经营工作台 V4 · 实时读取已授权财务接口 · 未修改合同、账单、银行及发票原始数据</p>
    {drawer&&<div className="f4-overlay" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget){setDrawer(null);setShowAllProjects(false)}}}><aside className="f4-drawer" role="dialog" aria-modal="true" aria-label="经营指标详情"><header><div><span>经营数据 · {scope}</span><h2>{drawer.kind==='method'?'利润计算口径':drawer.kind==='profit'?'游戏业务利润':drawer.kind==='operating'?'公司经营利润':drawer.kind==='settlement'?'结算来源':drawer.kind==='cash'?'部分现金净流入':drawer.kind==='projects'?'项目毛利明细':drawer.kind==='project'?drawer.project?.game_name:'经营提醒'}</h2></div><button type="button" aria-label="关闭明细" onClick={()=>{setDrawer(null);setShowAllProjects(false)}}><I name="x" size={20}/></button></header>
      <main>
        {['method','profit','operating'].includes(drawer.kind)&&<><p className="f4-drawer-note">管理口径：游戏业务利润只扣游戏可归属成本；公司经营利润再扣未归属公共服务器与经营费用。两者不相加。</p><div className="f4-drawer-kpis"><div><span>游戏业务利润</span><strong>{displayMoney(metrics.gross)}</strong></div><div><span>公司经营利润</span><strong>{displayMoney(metrics.operating)}</strong></div><div><span>未归属公共成本</span><strong>{displayMoney(metrics.sharedTotal)}</strong></div></div>{(profit?.notes||[]).map((note,i)=><p key={i} className="f4-drawer-small">{i+1}. {note}</p>)}</>}
        {drawer.kind==='settlement'&&<><p className="f4-drawer-note">结算数据由经营驾驶舱提供，按账单周期汇总。由于跨月拆分规则与利润归集不同，不以结算贡献代替游戏毛利。</p><div className="f4-drawer-kpis"><div><span>渠道结算</span><strong>{displayMoney(metrics.channelSettlement)}</strong></div><div><span>研发结算</span><strong>{displayMoney(metrics.rdSettlement)}</strong></div><div><span>结算贡献（扣服务器前后按原接口定义）</span><strong>{displayMoney(metrics.contribution)}</strong></div></div>{canRecon&&<button className="f4-drawer-link" type="button" onClick={()=>go(VIEWS.RECON_PROGRESS)}>查看账单及对账进度 →</button>}</>}
        {drawer.kind==='cash'&&<><p className="f4-drawer-note">现金流统计按收付款实际发生日期，仅包括渠道已收与研发已付；不代表公司所有银行账户净变动。</p><div className="f4-drawer-kpis"><div><span>渠道收款</span><strong>{displayMoney(metrics.cashIn)}</strong></div><div><span>研发付款</span><strong>{displayMoney(metrics.cashOut)}</strong></div><div><span>部分现金净流入</span><strong>{displayMoney(metrics.cashNet)}</strong></div></div>{canFunds&&<button className="f4-drawer-link" type="button" onClick={()=>go(VIEWS.BANK_RECONCILIATION)}>打开银行资金中心 →</button>}</>}
        {drawer.kind==='project'&&drawer.project&&<><p className="f4-drawer-note">游戏名称已按后台项目归并规则汇总；公共费用未摊派到具体游戏。</p><div className="f4-drawer-kpis"><div><span>项目毛利</span><strong>{displayMoney(drawer.project.profit)}</strong></div><div><span>渠道结算</span><strong>{displayMoney(drawer.project.channel_settlement)}</strong></div><div><span>研发成本</span><strong>{displayMoney(drawer.project.rd_cost)}</strong></div><div><span>服务器成本</span><strong>{displayMoney(drawer.project.server_cost_allocated??drawer.project.server_cost)}</strong></div><div><span>归属费用</span><strong>{displayMoney(drawer.project.attributed_expense)}</strong></div></div></>}
        {drawer.kind==='projects'&&<div className="f4-drawer-projects">{projects.map(row=><button type="button" key={row.game_name} onClick={()=>showDrawer('project',{project:row})}><span>{row.game_name}</span><strong>{displayMoney(row.profit)}</strong></button>)}{!projects.length&&<p>所选账期暂无项目数据。</p>}</div>}
        {drawer.kind==='alerts'&&<div className="f4-drawer-projects">{alerts.map((item,i)=><button type="button" key={i} onClick={item.onClick} disabled={!item.onClick}><span>{item.label}<small>{item.sub}</small></span><strong>{item.value||'查看'}</strong></button>)}{!alerts.length&&<p>暂无提醒项目。</p>}</div>}
      </main><footer><button type="button" onClick={()=>{setDrawer(null);setShowAllProjects(false)}}>关闭</button></footer></aside></div>}
  </PageContainer>
}
export default CoreDashboardV4
