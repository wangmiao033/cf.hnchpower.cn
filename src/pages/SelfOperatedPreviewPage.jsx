import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { loadLocalDraft, saveLocalDraft, deleteLocalDraft } from '@/domain/selfOperated/deviceDraft.js'
import { exactMoney, previewFor, PREVIEW_MONTHS } from '@/domain/selfOperated/readonlySample.js'
import { reportFromInspectedRows } from '@/domain/selfOperated/orderPreviewImport.js'
import DaxiongOrderImportDialog from './DaxiongOrderImportDialog.jsx'
import './SelfOperatedPreviewPage.css'

// 独立预览页：只使用订单预览和原有本机草稿，不读写正式财务账本。
function Cash({amount}){return <span>{exactMoney(amount)}</span>}
function GameTable({report,imported,savedHere}){
 return <section className="so-panel so-table-panel">
  <div className="so-panel-head"><div><h2>月度表</h2><p>每游戏一行 · {imported?'已核对文件中的有效现金订单':'示例数据，非正式入账'}</p></div></div>
  <div className="so-scroll" tabIndex={0} role="region" aria-label="大熊游戏月度表"><table className="so-table so-game-table"><thead><tr><th>游戏</th><th className="so-right">现金实付</th><th className="so-right">退款</th><th className="so-right">手续费</th><th className="so-right">实际到账</th><th className="so-right">研发应付</th><th>核对状态</th></tr></thead>
   <tbody>{report.games.map(g=><tr key={g.id+'-'+g.name}><td><strong>{g.name}</strong><small>ID {g.id}</small></td><td className="so-right"><Cash amount={g.cash}/></td>{['退款','手续费','实际到账','研发应付'].map(label=><td key={label} className="so-right so-muted" title={label==='研发应付'?'仅引用已有研发应付记录，当前未接入，不新建负债':label==='实际到账'?'独立到账记录未录入，不以实付减退款手续费推算':'当前没有可核对的记录'}>未录入</td>)}<td><span className="so-status">{imported?(savedHere?'本机已保存 · 待核对':'待核对 · 未保存'):'示例 · 待核对'}</span></td></tr>)}
   {!report.games.length&&<tr><td colSpan={7} className="so-empty">本月暂无有效游戏订单</td></tr>}
   </tbody></table></div>
  <div className="so-table-foot">共 {report.games.length} 款游戏 · 现金实付合计 <span className="so-cash-total"><Cash amount={report.cash}/></span>{imported&&<> · 竹B现金充值 <span className="so-coin-total"><Cash amount={report.coinCash}/></span>（独立列示，不重复合计）</>}<br/>实际到账独立核对；研发应付仅引用已有记录。未录入不代表零，不生成负债或对自家渠道的应收。</div>
 </section>
}

export default function SelfOperatedPreviewPage(){
 const {user}=useAuth()
 const accountId=user?.id ? String(user.id) : ''
 const [month,setMonth]=useState('2026-09')
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
       setImported(null);setMonth('2026-09')
     }
     setLocalDraft(null)
   }catch(error){
     setDraftError('删除本机草稿失败：'+(error?.message||'请重试'))
   }finally{setDraftBusy(false)}
 }

 const resetView=()=>{
   setImported(null);setMonth('2026-09')
   setDraftError('')
 }
 const restoreView=()=>{
   if(!localDraft)return
   setImported(localDraft.payload)
   setMonth(localDraft.payload.months[0])
   setDraftError('')
 }
 return <div className="so-page">
  <div className="so-top">
   <div role="status" className="so-notice"><span>大熊游戏</span> {imported
     ? (savedHere?'本机草稿：'+imported.fileName+'（非正式入账）':'文件预览：'+imported.fileName+'（未保存，刷新会丢失）')
     : (localDraft?'当前展示演示数据，可恢复本机草稿':'示例数据；支持文件核对与手动保存本机草稿，不会正式入账。')}</div>
   <div className="so-tools">
    <label htmlFor="so-month">账期</label>
    <select id="so-month" value={month} onChange={e=>setMonth(e.target.value)}>{months.map(key=><option key={key} value={key}>{imported?key.replace(/^(\d{4})-(\d{2})$/,(s,y,m)=>y+'年'+Number(m)+'月'):PREVIEW_MONTHS[key].label}</option>)}</select>
    <button type="button" className="so-import-launch" onClick={()=>setImportOpen(true)} disabled={draftLoading}>导入表格</button>
    {!imported&&localDraft&&<button type="button" onClick={restoreView}>恢复本机草稿</button>}
    <button type="button" className="so-device-save" disabled={draftLoading||draftBusy||!accountId||!imported||savedHere} onClick={saveDraftToDevice}>{draftBusy?'正在保存…':savedHere?'已保存本机草稿':'核对保存'}</button>
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

       <button type="button" onClick={resetView}>清除当前预览</button>
       {localDraft&&<button type="button" className="so-device-delete" disabled={draftBusy} onClick={removeDraftFromDevice}>删除本机草稿</button>}
     </div>
   </div>}
   {draftError&&<p role="alert" className="so-draft-error">{draftError}</p>}
   {draftLoading&&<p role="status" className="so-draft-loading">正在检查本机草稿…</p>}
  <GameTable report={report} imported={Boolean(imported)} savedHere={savedHere}/>
  <footer className="so-footer">大熊游戏 · {savedHere?'仅在本机浏览器保存订单草稿，正式数据库尚未写入':imported?'文件数据仅当前页面暂存，未正式入账':'当前金额为演示数据；本机草稿与正式账本严格区分'}</footer>
  {importOpen&&<DaxiongOrderImportDialog onClose={()=>setImportOpen(false)} onApply={acceptPreview}/>}
 </div>
}
