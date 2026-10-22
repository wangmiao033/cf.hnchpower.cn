import React, {useEffect,useRef,useState} from 'react'
import {useAuth} from '@/features/auth/AuthContext.jsx'
import {apiGet,apiPost} from '@/lib/api/client'
import {reportFromInspectedRows} from '@/domain/selfOperated/orderPreviewImport.js'
import {loadLocalDraft} from '@/domain/selfOperated/deviceDraft.js'
import {prepareDaxiongServerImport,confirmDaxiongServerImport} from '@/lib/api/selfOperatedOrders.js'
import DaxiongOrderImportDialog from './DaxiongOrderImportDialog.jsx'
import './SelfOperatedPreviewPage.css'

const fields=['cash_cents','refund_cents','fee_cents','received_cents']
const labels=['现金实付','退款','手续费','实际到账']
const money=v=>v==null?'':(v/100).toFixed(2)
export function parseCents(value){
 if(value==='')return null
 if(!/^\d+(\.\d{1,2})?$/.test(value))throw Error('金额需为非负数字，最多两位小数')
 const [whole,fraction='']=value.split('.')
 const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'))
 if(!Number.isSafeInteger(cents)||cents>999999999999)throw Error('金额超过允许范围')
 return cents
}
const editable=r=>({...r,...Object.fromEntries(fields.map(f=>[f,money(r[f])]))})
export default function DaxiongLedgerPage(){
 const {user}=useAuth()
 const [month,setMonth]=useState(new Date().toISOString().slice(0,7))
 const [doc,setDoc]=useState(null),[rows,setRows]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[dialog,setDialog]=useState(false)
 const [draft,setDraft]=useState(null),[preview,setPreview]=useState(null),[confirmed,setConfirmed]=useState(false)
 const request=useRef(null)
 const endpoint=`/api/self-operated/ledger/${month}`
 const load=async()=>{const d=await apiGet(endpoint);setDoc(d);setRows(d.rows.map(editable));setDirty(false);request.current=null}
 useEffect(()=>{let active=true;setDoc(null);setRows([]);setError('');setDirty(false);request.current=null
  apiGet(endpoint).then(d=>{if(active){setDoc(d);setRows(d.rows.map(editable))}}).catch(e=>{if(active)setError(e.message)})
  return()=>{active=false}
 },[endpoint,user?.id])
 useEffect(()=>{let active=true;setDraft(null);if(user?.id)loadLocalDraft(String(user.id)).then(d=>{if(active)setDraft(d)}).catch(e=>{if(active)setError('本机草稿读取失败：'+e.message)});return()=>{active=false}},[user?.id])
 useEffect(()=>{const warn=e=>{if(dirty){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
 const change=(i,patch)=>{setRows(old=>old.map((r,n)=>n===i?{...r,...patch}:r));setDirty(true);request.current=null}
 const save=async()=>{setError('');setNotice('');setBusy(true)
  try{if(!request.current)request.current={request_key:crypto.randomUUID(),revision:doc.revision,confirmed:true,rows:rows.map(r=>({game_id:r.game_id,game_name:r.game_name,...Object.fromEntries(fields.map(f=>[f,parseCents(r[f])])),rd_line_id:r.rd_line_id||null,expected_cash_cents:r.expected_cash_cents??null,expected_rd_cents:r.expected_rd_cents??null,status:r.status}))}
   await apiPost(endpoint,request.current);setNotice('已保存到服务器');setDirty(false)
   try{await load()}catch(e){setError('保存成功，但重新读取失败，请刷新核实：'+e.message)}
  }catch(e){setError('保存未确认，请保留当前内容；重试使用同一请求标识：'+e.message)}finally{setBusy(false)}
 }
 const importRows=async()=>{setBusy(true);setError('')
  try{const payload=prepareDaxiongServerImport(preview,{statusConfirmed:confirmed,typeConfirmed:confirmed});const result=await confirmDaxiongServerImport(payload);setNotice(`服务器已确认导入 ${result.inserted} 条；跳过重复 ${result.skipped_existing} 条。本机草稿保留。`);setPreview(null);await load()}catch(e){setError('导入未完成确认：'+e.message)}finally{setBusy(false)}
 }
 return <div className="so-page so-month-ledger"><header className="so-header"><h1>大熊游戏</h1><p>独立月度台账 · 不自动计入公司总账，不生成对自家渠道应收或新增研发应付</p></header>
 <div className="so-toolbar"><label>月份 <input aria-label="月份" type="month" value={month} disabled={busy} onChange={e=>{if(!dirty||window.confirm('当前编辑未保存，确认切换月份？'))setMonth(e.target.value)}}/></label>
 <button disabled={busy||dirty||!doc?.write_ready} onClick={()=>setDialog(true)}>导入表格</button>
 <button disabled={busy||!doc?.write_ready} onClick={save}>保存月表</button>
 <button disabled={busy} onClick={()=>{if(!dirty||window.confirm('放弃未保存编辑并重新读取？'))load().catch(e=>setError(e.message))}}>重新读取</button>
 {draft&&<button disabled={busy||dirty} onClick={()=>{setPreview(draft.payload);setConfirmed(false)}}>查看本机草稿（未迁入）</button>}</div>
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {doc&&!doc.write_ready&&<p role="status">正式存储尚未启用：备份恢复验证与独立表迁移完成后开放保存。当前不会写入正式账单。</p>}
 <section className="so-panel so-table-panel"><div className="so-scroll"><table className="so-table so-game-table"><thead><tr><th>游戏</th>{labels.map(x=><th key={x}>{x}</th>)}<th>研发应付</th><th>核对状态</th></tr></thead><tbody>
 {rows.map((r,i)=><tr key={i}><td>{r.imported?<strong>{r.game_name}</strong>:<input aria-label={`游戏 ${i+1}`} value={r.game_name} disabled={busy||!doc?.write_ready} onChange={e=>change(i,{game_name:e.target.value,rd_line_id:null,expected_rd_cents:null,rd_options:[],status:'pending'})} onBlur={async()=>{try{const options=await apiGet(`${endpoint}/rd-options?game_name=${encodeURIComponent(r.game_name)}`);change(i,{rd_options:options})}catch(e){setError(e.message)}}}/>}{!r.imported&&<input aria-label={`游戏ID ${i+1}`} placeholder="游戏ID（可选）" value={r.game_id} disabled={busy||!doc?.write_ready} onChange={e=>change(i,{game_id:e.target.value,status:'pending'})}/>}</td>
 {fields.map((f,n)=><td key={f}><input aria-label={`${labels[n]} ${i+1}`} inputMode="decimal" placeholder="未录入" value={r[f]} disabled={busy||!doc?.write_ready||(f==='cash_cents'&&r.imported)} onChange={e=>change(i,{[f]:e.target.value,status:'pending'})}/></td>)}
 <td><select aria-label={`研发应付 ${i+1}`} value={r.rd_line_id||''} disabled={busy||!doc?.write_ready} onChange={e=>{const option=r.rd_options.find(o=>o.id===e.target.value);change(i,{rd_line_id:option?.id??null,expected_rd_cents:option?.amount_cents??null,status:'pending'})}}><option value="">待引用</option>{r.rd_options.map(o=><option key={o.id} value={o.id}>{o.label} · {money(o.amount_cents)}</option>)}</select></td>
 <td><select aria-label={`核对状态 ${i+1}`} value={r.status} disabled={busy||!doc?.write_ready} onChange={e=>change(i,{status:e.target.value})}><option value="pending">待核对</option><option value="checked">已核对</option></select></td></tr>)}
 {!rows.length&&<tr><td colSpan={7}>{doc?'本月尚无记录':'正在读取服务器记录…'}</td></tr>}</tbody></table></div>
 <button disabled={busy||!doc?.write_ready} onClick={()=>{setRows([...rows,{game_id:'',game_name:'',cash_cents:'',refund_cents:'',fee_cents:'',received_cents:'',rd_line_id:null,rd_options:[],status:'pending'}]);setDirty(true);request.current=null}}>添加游戏</button>
 <p>空白表示未录入。实际到账独立记录；研发应付仅引用已有账单。保存不代表核对完成；所有金额与研发引用完整后才可保存“已核对”。{dirty?' · 有未保存编辑':''}</p></section>
 {preview&&<section className="so-panel"><h2>确认迁入独立台账</h2><p>{preview.fileName} · {preview.records?.length||0} 条 · 月份 {preview.months?.join('、')}。仅导入已支付的有效订单；本机原稿保留。</p><details><summary>查看逐月游戏金额</summary>{preview.months?.map(m=>{const report=reportFromInspectedRows(preview,m);return <div key={m}><strong>{m}</strong>{report.games.map(g=><p key={g.id+'-'+g.name}>{g.name} · {g.cash.toFixed(2)}</p>)}<p>游戏现金 {report.cash.toFixed(2)} · 霸B充值 {report.coinCash.toFixed(2)}（独立保留，不计入游戏现金）</p></div>})}</details><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我已核对原文件支付状态、业务类型与金额，确认是真实订单且无手工重复记账</label><button disabled={!confirmed||busy||!doc?.write_ready} onClick={importRows}>确认导入服务器</button><button disabled={busy} onClick={()=>setPreview(null)}>取消</button></section>}
 {dialog&&<DaxiongOrderImportDialog onClose={()=>setDialog(false)} onApply={p=>{setPreview({...p,draftId:crypto.randomUUID()});setConfirmed(false);setDialog(false)}}/>}
 </div>
}
