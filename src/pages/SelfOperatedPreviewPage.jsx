import React, { useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import { compactMoney, exactMoney, previewFor, PREVIEW_MONTHS } from '@/domain/selfOperated/readonlySample.js'
import './SelfOperatedPreviewPage.css'

// 第一阶段只做页面验收，不读取财务接口，不上传文件，不保存合同或生成账单。
const TABS=[['overview','经营总览'],['profit','游戏利润'],['ads','买量管理'],['contract','合同关联']]
const DEMO_URL='https://daxiong-finance-preview.vercel.app/'

function Cash({amount,compact=false}){
 return <span title={exactMoney(amount)}>{compact?compactMoney(amount):exactMoney(amount)}</span>
}
function Status({children='待接入'}){return <span className="so-status">{children}</span>}
function GameTable({report,profit,query,setQuery}){
 const visible=report.games.filter(g=>`${g.name} ${g.id}`.toLowerCase().includes(query.trim().toLowerCase()))
 return <section className="so-panel so-table-panel">
  <div className="so-panel-head"><div><h2>{profit?'逐游戏经营贡献':'游戏经营概览'}</h2><p>游戏ID汇总 · 演示现金实付，非充值面额</p></div><input value={query} onChange={e=>setQuery(e.target.value)} type="search" placeholder="搜索游戏 / ID" aria-label="搜索游戏"/></div>
  <div className="so-scroll"><table className="so-table"><thead><tr><th>游戏 / 占比</th><th className="so-right">现金实付</th><th className="so-right">买量成本</th><th className="so-right">{profit?'经营贡献':'研发应付'}</th><th>合同状态</th></tr></thead>
  <tbody>{visible.map(g=><tr key={g.id}><td><strong>{g.name}</strong><small>ID {g.id} · {report.cash?(g.cash/report.cash*100).toFixed(1):'0.0'}%</small></td><td className="so-right"><Cash amount={g.cash}/></td><td className="so-right so-muted">待接入</td><td className="so-right so-muted">待核算</td><td><Status>待关联合同</Status></td></tr>)}
   {!visible.length&&<tr><td colSpan={5} className="so-empty">未找到对应游戏</td></tr>}
  </tbody></table></div>
  <div className="so-table-foot">显示 {visible.length}/{report.games.length} 款 · 当前数据仅用于界面确认</div>
 </section>
}

export default function SelfOperatedPreviewPage(){
 const {setActiveView}=useAppState()
 const [month,setMonth]=useState('2026-09')
 const [tab,setTab]=useState('overview')
 const [query,setQuery]=useState('')
 const report=useMemo(()=>previewFor(month),[month])
 const go=view=>setActiveView?.(view)
 const kpis=[
  {name:'游戏现金订单实付',value:report.cash,note:`${report.orders} 笔现金订单 · 示例`},
  {name:'买量实际消耗',value:report.spent,note:'不含广告账户充值'},
  {name:'研发应付测算',value:null,note:'待关联正式研发合同'},
  {name:'本月贡献试算',value:null,note:'待核对合同与运营费用'}
 ]
 return <div className="so-page">
  <div className="so-top">
   <div role="status" className="so-notice"><span>自营渠道 · 第一阶段</span> 只读演示，不读取、不修改正式财务数据。</div>
   <div className="so-tools">
    <label htmlFor="so-month">账期</label>
    <select id="so-month" value={month} onChange={e=>{setMonth(e.target.value);setQuery('')}}>{Object.keys(PREVIEW_MONTHS).map(key=><option key={key} value={key}>{PREVIEW_MONTHS[key].label}</option>)}</select>
    <button disabled title="第二阶段才开放真实订单导入">导入订单 · 待接入</button>
    <a href={DEMO_URL} target="_blank" rel="noopener noreferrer">完整原型 ↗</a>
   </div>
  </div>
  <div className="so-metrics">{kpis.map(k=><article key={k.name} className="so-metric"><span>{k.name}</span><strong title={k.value===null?'尚未核算':exactMoney(k.value)}>{k.value===null?'待核算':<Cash compact amount={k.value}/>}</strong><small>{k.note}</small></article>)}</div>
  <div className="so-tabs" role="tablist" aria-label="自营渠道模块">{TABS.map(([id,label])=><button type="button" key={id} role="tab" aria-selected={tab===id} className={tab===id?'active':''} onClick={()=>{setTab(id);setQuery('')}}>{label}</button>)}</div>
  <div role="tabpanel" aria-label={TABS.find(([id])=>id===tab)?.[1]}>
   {(tab==='overview'||tab==='profit')&&<div className="so-columns">
    <GameTable report={report} profit={tab==='profit'} query={query} setQuery={setQuery}/>
    <aside className="so-aside">
     {tab==='overview'?<>
      <section className="so-panel so-pad"><h2>本月待办</h2>
       <div className="so-todo"><b>01</b><div><strong>订单正式导入</strong><small>按订单号去重与核对，第二阶段接入</small></div></div>
       <div className="so-todo"><b>02</b><div><strong>关联研发合同</strong><small>复用原有合同，不新增第二套</small></div></div>
       <div className="so-todo"><b>03</b><div><strong>利润汇总</strong><small>费用确认后才进入公司经营分析</small></div></div>
      </section>
      <section className="so-panel so-pad"><h2>账户与费用归属</h2><p>公司主体：广州熊动科技有限公司</p><p>收款账户：网商银行对公账户</p><p>服务器、CDN、域名依旧在原「运营费用」管理。</p></section>
     </>:<>
      <section className="so-panel so-pad"><h2>平台经营贡献</h2>
       <div className="so-ledger"><span>现金订单实付（示例）</span><Cash compact amount={report.cash}/></div>
       <div className="so-ledger"><span>广告实际消耗（示例）</span><Cash compact amount={report.spent}/></div>
       <div className="so-ledger"><span>研发分成</span><em>待关联合同</em></div>
       <div className="so-ledger"><span>运营费用</span><em>待核实</em></div>
       <div className="so-profit-total"><span>本月利润</span><strong>待核算</strong></div>
       <p>没有研发合同和完整费用时，不输出看似准确的利润。</p>
      </section>
      <section className="so-panel so-pad"><h2>核算原则</h2><p>广告充值属于预付款，只有实际消耗计成本；银行内部划转不计收入。</p></section>
     </>}
    </aside>
   </div>}
   {tab==='ads'&&<div className="so-columns">
    <section className="so-panel so-table-panel">
     <div className="so-panel-head"><div><h2>买量及相关记录</h2><p>TapTap 等广告账户充值与消耗分开管理</p></div><Status>演示数据</Status></div>
     <div className="so-scroll"><table className="so-table"><thead><tr><th>日期</th><th>记录类型</th><th>广告平台 / 游戏归属</th><th className="so-right">金额</th></tr></thead><tbody>
      {report.ads.map(a=><tr key={a.id}><td>{month.slice(0,4)}-{a.date}</td><td><span className={a.kind==='topup'?'so-topup':'so-spend'}>{a.kind==='topup'?'账户充值':'实际消耗'}</span></td><td>{a.platform} · {a.game}</td><td className="so-right"><Cash amount={a.amount}/></td></tr>)}
     </tbody></table></div>
     <div className="so-table-foot">仅作演示，不写入运营费用或银行系统</div>
    </section>
    <aside className="so-aside">
     <section className="so-panel so-pad"><h2>本月买量金额</h2><div className="so-ledger"><span>广告账户充值</span><Cash compact amount={report.topup}/></div><div className="so-ledger"><span>广告实际消耗</span><Cash compact amount={report.spent}/></div><p>账户充值是预付，实际消耗才是游戏买量成本。</p></section>
     <section className="so-panel so-pad"><h2>平台服务器成本</h2><p>归属原有「运营费用」，此处不再建立服务器管理栏目。</p><button type="button" onClick={()=>go(VIEWS.SERVER_COSTS)}>打开原服务器成本 →</button></section>
    </aside>
   </div>}
   {tab==='contract'&&<div className="so-columns">
    <section className="so-panel so-table-panel">
     <div className="so-panel-head"><div><h2>游戏与合同映射</h2><p>正式接入时按游戏 ID 和合同有效期关联</p></div><Status>只读</Status></div>
     <div className="so-scroll"><table className="so-table"><thead><tr><th>游戏 / ID</th><th className="so-right">现金实付</th><th>合同状态</th><th className="so-right">预计研发应付</th></tr></thead><tbody>
      {report.games.map(g=><tr key={g.id}><td><strong>{g.name}</strong><small>ID {g.id}</small></td><td className="so-right"><Cash amount={g.cash}/></td><td><Status/></td><td className="so-right so-muted">—</td></tr>)}
     </tbody></table></div><div className="so-table-foot">不会自动修改合同或创建真实研发账单</div>
    </section>
    <aside className="so-aside">
     <section className="so-panel so-pad"><h2>合同配置进度</h2><div className="so-count">0 / {report.games.length}<small>已关联</small></div><div className="so-progress"/><p>下一阶段引用现有合同中的分成比例和生效日期，历史账期独立。</p><button type="button" onClick={()=>go(VIEWS.CONTRACTS)}>查看现有合同台账 →</button></section>
     <section className="so-panel so-pad"><h2>统一研发账单</h2><p>正式应付、发票、付款均由原有「研发账单」管理，不重复开发结算模块。</p><button type="button" onClick={()=>go(VIEWS.RECON_RD)}>打开研发账单 →</button></section>
    </aside>
   </div>}
  </div>
  <footer className="so-footer">大熊游戏 · 第一阶段只读演示 · 不读取或写入正式业务数据</footer>
 </div>
}
