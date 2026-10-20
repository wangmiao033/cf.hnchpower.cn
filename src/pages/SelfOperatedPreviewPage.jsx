import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { loadLocalDraft, saveLocalDraft, deleteLocalDraft } from '@/domain/selfOperated/deviceDraft.js'
import { VIEWS } from '@/app/routes.js'
import { compactMoney, exactMoney, previewFor, PREVIEW_MONTHS } from '@/domain/selfOperated/readonlySample.js'
import { reportFromInspectedRows } from '@/domain/selfOperated/orderPreviewImport.js'
import DaxiongOrderImportDialog from './DaxiongOrderImportDialog.jsx'
import './SelfOperatedPreviewPage.css'

// 第一阶段只做页面验收，不读取财务接口，不上传文件，不保存合同或生成账单。
const TABS=[['overview','经营总览'],['profit','游戏利润'],['ads','买量管理'],['contract','合同关联']]
const DEMO_URL='https://daxiong-finance-preview.vercel.app/'

function Cash({amount,compact=false}){
 return <span title={exactMoney(amount)}>{compact?compactMoney(amount):exactMoney(amount)}</span>
}
function Status({children='待接入'}){return <span className="so-status">{children}</span>}
function GameTable({report,profit,query,setQuery,imported=false,storedLocally=false}){
 const visible=report.games.filter(g=>`${g.name} ${g.id}`.toLowerCase().includes(query.trim().toLowerCase()))
 return <section className="so-panel so-table-panel">
  <div className="so-panel-head"><div><h2>{profit?'逐游戏经营贡献':'游戏经营概览'}</h2><p>{imported?(storedLocally?'本机草稿里的已核对现金订单 · 未入正式账本':'本次文件有效现金订单 · 浏览器临时预览，未保存'):'游戏ID汇总 · 演示现金实付，非充值面额'}</p></div><input value={query} onChange={e=>setQuery(e.target.value)} type="search" placeholder="搜索游戏 / ID" aria-label="搜索游戏"/></div>
  <div className="so-scroll"><table className="so-table so-game-table"><thead><tr><th>游戏 / 占比</th><th className="so-right">现金实付</th><th className="so-right">买量成本</th><th className="so-right">{profit?'经营贡献':'研发应付'}</th><th>合同状态</th></tr></thead>
  <tbody>{visible.map(g=><tr key={g.id+'-'+g.name}><td><strong>{g.name}</strong><small>ID {g.id} · {report.cash?(g.cash/report.cash*100).toFixed(1):'0.0'}%</small></td><td data-label="现金实付" className="so-right"><Cash amount={g.cash}/></td><td data-label="买量成本" className="so-right so-muted">待接入</td><td data-label={profit?"经营贡献":"研发应付"} className="so-right so-muted">待核算</td><td data-label="合同状态"><Status>待关联合同</Status></td></tr>)}
   {!visible.length&&<tr><td colSpan={5} className="so-empty">未找到对应游戏</td></tr>}
  </tbody></table></div>
  <div className="so-table-foot">显示 {visible.length}/{report.games.length} 款 · 当前数据仅用于界面确认</div>
 </section>
}

export default function SelfOperatedPreviewPage(){
 const {setActiveView}=useAppState()
 const {user}=useAuth()
 const accountId=user?.id ? String(user.id) : ''
 const [month,setMonth]=useState('2026-09')
 const [tab,setTab]=useState('overview')
 const [query,setQuery]=useState('')
 const [importOpen,setImportOpen]=useState(false)
 const [imported,setImported]=useState(null)
 const [localDraft,setLocalDraft]=useState(null)
 const [draftLoading,setDraftLoading]=useState(true)
 const [draftBusy,setDraftBusy]=useState(false)
 const [draftError,setDraftError]=useState('')
 const savedHere=Boolean(imported&&localDraft?.payload?.draftId===imported.draftId)
 const months=imported?.months?.length?imported.months:Object.keys(PREVIEW_MONTHS)
 const report=useMemo(()=>imported?reportFromInspectedRows(imported,month):previewFor(month),[month,imported])
 useEffect(()=>{
   let active=true
   setDraftLoading(true)
   setDraftError('')
   setLocalDraft(null)
   setImported(null)
   setMonth('2026-09')
   if(!accountId){
     setDraftLoading(false)
     return ()=>{active=false}
   }
   loadLocalDraft(accountId).then(result=>{
     if(!active)return
     if(result){
       setLocalDraft(result)
       setImported(result.payload)
       setMonth(result.payload.months[0])
     }
   }).catch(error=>{
     if(active)setDraftError('本机草稿读取失败：'+(error?.message||'请保留原始CSV'))
   }).finally(()=>{if(active)setDraftLoading(false)})
   return ()=>{active=false}
 },[accountId])

 const acceptPreview=parsed=>{
   if(!parsed?.months?.length)return
   setImported({...parsed,draftId:crypto.randomUUID()})
   setMonth(parsed.months[0])
   setTab('overview')
   setQuery('')
   setDraftError('')
   setImportOpen(false)
 }

 const saveDraftToDevice=async()=>{
   if(!accountId||!imported||draftBusy)return
   if(localDraft && localDraft.payload.draftId!==imported.draftId){
     if(!window.confirm('这会覆盖此浏览器为当前账号保存的旧大熊游戏草稿。旧草稿不会合并，确定继续吗？'))return
   }
   setDraftBusy(true);setDraftError('')
   try{
     const saved=await saveLocalDraft(accountId,imported)
     setLocalDraft(saved)
   }catch(error){
     setDraftError('本机保存失败：'+(error?.message||'请保留原始CSV文件'))
   }finally{setDraftBusy(false)}
 }

 const removeDraftFromDevice=async()=>{
   if(!accountId||!localDraft||draftBusy)return
   if(!window.confirm('确认删除此账号在这台浏览器保存的大熊游戏草稿？此操作无法恢复，请保留原始CSV文件。'))return
   setDraftBusy(true);setDraftError('')
   try{
     await deleteLocalDraft(accountId)
     if(imported?.draftId===localDraft.payload.draftId){
       setImported(null);setMonth('2026-09');setTab('overview');setQuery('')
     }
     setLocalDraft(null)
   }catch(error){
     setDraftError('删除本机草稿失败：'+(error?.message||'请重试'))
   }finally{setDraftBusy(false)}
 }

 const resetView=()=>{
   setImported(null);setMonth('2026-09');setTab('overview');setQuery('')
   setDraftError('')
 }
 const restoreView=()=>{
   if(!localDraft)return
   setImported(localDraft.payload)
   setMonth(localDraft.payload.months[0])
   setTab('overview');setQuery('')
   setDraftError('')
 }
 const go=view=>setActiveView?.(view)
 const kpis=imported?[
  {name:savedHere?'游戏现金实付（本机草稿）':'游戏现金实付（未保存）',value:report.cash,note:report.orders+' 笔有效游戏订单 · 非正式入账'},
  {name:'竹B现金充值（独立）',value:report.coinCash,note:'单列核对，不与游戏充值重复合计'},
  {name:'研发应付测算',value:null,note:'未关联合同，暂不生成应付'},
  {name:'本月经营利润',value:null,note:'尚未接入真实买量及运营费用'}
 ]:[
  {name:'游戏现金订单实付',value:report.cash,note:`${report.orders} 笔现金订单 · 示例`},
  {name:'买量实际消耗',value:report.spent,note:'不含广告账户充值'},
  {name:'研发应付测算',value:null,note:'待关联正式研发合同'},
  {name:'本月贡献试算',value:null,note:'待核对合同与运营费用'}
 ]
 return <div className="so-page">
  <div className="so-top">
   <div role="status" className="so-notice"><span>大熊游戏 · 第二阶段B</span> {imported
     ? (savedHere?'本机草稿：'+imported.fileName+'（非正式入账）':'文件预览：'+imported.fileName+'（未保存，刷新会丢失）')
     : (localDraft?'当前展示演示数据，可恢复本机草稿':'示例数据；支持文件核对与手动保存本机草稿，不会正式入账。')}</div>
   <div className="so-tools">
    <label htmlFor="so-month">账期</label>
    <select id="so-month" value={month} onChange={e=>{setMonth(e.target.value);setQuery('')}}>{months.map(key=><option key={key} value={key}>{imported?key.replace(/^(\d{4})-(\d{2})$/,(s,y,m)=>y+'年'+Number(m)+'月'):PREVIEW_MONTHS[key].label}</option>)}</select>
    <button type="button" className="so-import-launch" onClick={()=>setImportOpen(true)} disabled={draftLoading}>导入订单 · 先核对</button>
    {!imported&&localDraft&&<button type="button" onClick={restoreView}>恢复本机草稿</button>}
    <a href={DEMO_URL} target="_blank" rel="noopener noreferrer">完整原型 ↗</a>
   </div>
  </div>
  {imported&&<div className="so-import-active" role="status">
     <div className="so-draft-description">
       <strong>{savedHere?'本机草稿已保存 · 非正式入账':'已加载文件（未保存）'}</strong>
       <span>当前仅统计{month}有效订单，原文件共{imported.summary.rows}行；文件内排除/待核验{
         imported.summary.duplicates+imported.summary.conflicts+imported.summary.invalid+imported.summary.review+imported.summary.excluded
       }行。{savedHere?'刷新后可在本浏览器恢复。':'此页刷新后，本次未保存的文件预览会丢失。'} 跨历史账单查重与服务器正式保存尚未开放。</span>
       {savedHere&&<small>仅当前登录账号在此浏览器可恢复；换设备、清理浏览器数据或无痕模式可能丢失。请保留原始CSV。</small>}
     </div>
     <div className="so-draft-actions">
       {!savedHere&&<button type="button" className="so-device-save" disabled={draftLoading||draftBusy||!accountId} onClick={saveDraftToDevice}>{draftBusy?'正在保存…':'保存本机草稿（非正式入账）'}</button>}
       <button type="button" onClick={resetView}>清除当前预览</button>
       {localDraft&&<button type="button" className="so-device-delete" disabled={draftBusy} onClick={removeDraftFromDevice}>删除本机草稿</button>}
     </div>
   </div>}
   {draftError&&<p role="alert" className="so-draft-error">{draftError}</p>}
   {draftLoading&&<p role="status" className="so-draft-loading">正在检查本机草稿…</p>}
  <div className="so-metrics">{kpis.map(k=><article key={k.name} className="so-metric"><span>{k.name}</span><strong title={k.value===null?'尚未核算':exactMoney(k.value)}>{k.value===null?'待核算':<Cash compact amount={k.value}/>}</strong><small>{k.note}</small></article>)}</div>
  <div className="so-tabs" role="tablist" aria-label="大熊游戏模块">{TABS.map(([id,label])=><button type="button" key={id} role="tab" aria-selected={tab===id} className={tab===id?'active':''} onClick={()=>{setTab(id);setQuery('')}}>{label}</button>)}</div>
  <div role="tabpanel" aria-label={TABS.find(([id])=>id===tab)?.[1]}>
   {(tab==='overview'||tab==='profit')&&<div className="so-columns">
    <GameTable report={report} profit={tab==='profit'} query={query} setQuery={setQuery} imported={Boolean(imported)} storedLocally={savedHere}/>
    <aside className="so-aside">
     {tab==='overview'?<>
      <section className="so-panel so-pad"><h2>本月待办</h2>
       <div className="so-todo"><b>01</b><div><strong>{imported?'本次文件已检查':'订单文件试读'}</strong><small>{imported?'已在本地预览有效订单；正式保存仍需数据库备份':'CSV / Excel 本地字段识别、重复订单与金额核对'}</small></div></div>
       <div className="so-todo"><b>02</b><div><strong>关联研发合同</strong><small>复用原有合同，不新增第二套</small></div></div>
       <div className="so-todo"><b>03</b><div><strong>利润汇总</strong><small>费用确认后才进入公司经营分析</small></div></div>
      </section>
      <section className="so-panel so-pad"><h2>账户与费用归属</h2><p>公司主体：广州熊动科技有限公司</p><p>收款账户：网商银行对公账户</p><p>服务器、CDN、域名依旧在原「运营费用」管理。</p></section>
     </>:<>
      <section className="so-panel so-pad"><h2>平台经营贡献</h2>
       <div className="so-ledger"><span>现金订单实付（{imported?'未保存':'示例'}）</span><Cash compact amount={report.cash}/></div>
       <div className="so-ledger"><span>广告实际消耗（{imported?'未接入':'示例'}）</span>{imported?<em>待接入</em>:<Cash compact amount={report.spent}/>}</div>
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
     <div className="so-panel-head"><div><h2>买量及相关记录</h2><p>{imported?'订单文件不包含可核验的真实买量记录，暂不显示模拟广告费用':'TapTap 等广告账户充值与消耗分开管理'}</p></div><Status>{imported?'待接入':'演示数据'}</Status></div>
     <div className="so-scroll"><table className="so-table so-ads-table"><thead><tr><th>日期</th><th>记录类型</th><th>广告平台 / 游戏归属</th><th className="so-right">金额</th></tr></thead><tbody>
      {report.ads.map(a=><tr key={a.id}><td data-label="日期">{month.slice(0,4)}-{a.date}</td><td data-label="记录类型"><span className={a.kind==='topup'?'so-topup':'so-spend'}>{a.kind==='topup'?'账户充值':'实际消耗'}</span></td><td data-label="平台与归属">{a.platform} · {a.game}</td><td data-label="金额" className="so-right"><Cash amount={a.amount}/></td></tr>)}
     {imported&&!report.ads.length&&<tr><td colSpan={4} className="so-empty">真实买量数据未接入，游戏充值不可当作广告消耗。</td></tr>}
     </tbody></table></div>
     <div className="so-table-foot">{imported?'买量来源等待单独核对；不与充值订单合并':'仅作演示，不写入运营费用或银行系统'}</div>
    </section>
    <aside className="so-aside">
     <section className="so-panel so-pad"><h2>本月买量金额</h2><div className="so-ledger"><span>广告账户充值</span>{imported?<em>待接入</em>:<Cash compact amount={report.topup}/>}</div><div className="so-ledger"><span>广告实际消耗</span>{imported?<em>待接入</em>:<Cash compact amount={report.spent}/>}</div><p>账户充值是预付，实际消耗才是游戏买量成本。</p></section>
     <section className="so-panel so-pad"><h2>平台服务器成本</h2><p>归属原有「运营费用」，此处不再建立服务器管理栏目。</p><button type="button" onClick={()=>go(VIEWS.SERVER_COSTS)}>打开原服务器成本 →</button></section>
    </aside>
   </div>}
   {tab==='contract'&&<div className="so-columns">
    <section className="so-panel so-table-panel">
     <div className="so-panel-head"><div><h2>游戏与合同映射</h2><p>正式接入时按游戏 ID 和合同有效期关联</p></div><Status>只读</Status></div>
     <div className="so-scroll"><table className="so-table so-contract-table"><thead><tr><th>游戏 / ID</th><th className="so-right">现金实付</th><th>合同状态</th><th className="so-right">预计研发应付</th></tr></thead><tbody>
      {report.games.map(g=><tr key={g.id+'-'+g.name}><td><strong>{g.name}</strong><small>ID {g.id}</small></td><td data-label="现金实付" className="so-right"><Cash amount={g.cash}/></td><td data-label="合同状态"><Status/></td><td data-label="预计研发应付" className="so-right so-muted">—</td></tr>)}
     </tbody></table></div><div className="so-table-foot">不会自动修改合同或创建真实研发账单</div>
    </section>
    <aside className="so-aside">
     <section className="so-panel so-pad"><h2>合同配置进度</h2><div className="so-count">0 / {report.games.length}<small>已关联</small></div><div className="so-progress"/><p>下一阶段引用现有合同中的分成比例和生效日期，历史账期独立。</p><button type="button" onClick={()=>go(VIEWS.CONTRACTS)}>查看现有合同台账 →</button></section>
     <section className="so-panel so-pad"><h2>统一研发账单</h2><p>正式应付、发票、付款均由原有「研发账单」管理，不重复开发结算模块。</p><button type="button" onClick={()=>go(VIEWS.RECON_RD)}>打开研发账单 →</button></section>
    </aside>
   </div>}
  </div>
  <footer className="so-footer">大熊游戏 · 第二阶段B · {savedHere?'仅在本机浏览器保存订单草稿，正式数据库尚未写入':imported?'文件数据仅当前页面暂存，未正式入账':'当前金额为演示数据；本机草稿与正式账本严格区分'}</footer>
  {importOpen&&<DaxiongOrderImportDialog onClose={()=>setImportOpen(false)} onApply={acceptPreview}/>}
 </div>
}
