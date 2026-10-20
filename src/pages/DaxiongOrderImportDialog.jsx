import React,{useEffect,useMemo,useState} from 'react'
import {
  inspectOrderRows,suggestFieldMapping,
  ORDER_FIELDS,readOrderFile
} from '@/domain/selfOperated/orderPreviewImport.js'
import { exactMoney } from '@/domain/selfOperated/readonlySample.js'
import './DaxiongOrderImportDialog.css'

const FIELD_TITLES = Object.fromEntries(ORDER_FIELDS.map(field=>[field.key,field.label]))
const DISPOSITION_TEXT = {
  ready:'有效试算',excluded:'不计收入',duplicate:'重复排除',
  conflict:'订单冲突',invalid:'字段错误',review:'待核对'
}
const EMPTY_SELECTION = { sheets:[] }

function cents(value) {
  return exactMoney((value||0)/100)
}

export default function DaxiongOrderImportDialog({ onClose,onApply }) {
  const [fileData,setFileData]=useState(EMPTY_SELECTION)
  const [fileError,setFileError]=useState('')
  const [sheetIndex,setSheetIndex]=useState(0)
  const [headerRow,setHeaderRow]=useState(0)
  const [mapping,setMapping]=useState({})
  const [loading,setLoading]=useState(false)
  const sheet=fileData.sheets[sheetIndex]??null
  const headers=sheet?.matrix[headerRow]??[]
  const preview=useMemo(()=>{
    if(!sheet)return null
    try{return inspectOrderRows(sheet.matrix,{headerRow,mapping})}
    catch(error){return {error:error.message||'无法读取表格'}}
  },[sheet,headerRow,mapping])
  const missing=preview?.missing||[]
  const total=preview?.summary||{}
  const usable=(total.validGames||0)+(total.validCoins||0)
  const ready=preview&&!preview.error&&!missing.length&&usable>0

  useEffect(()=>{
    const onKey=event=>{if(event.key==='Escape')onClose?.()}
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[onClose])

  async function chooseFile(event) {
    const file=event.target.files?.[0]
    if(!file)return
    setLoading(true);setFileError('');setFileData(EMPTY_SELECTION)
    try{
      const read=await readOrderFile(file)
      setFileData(read);setSheetIndex(0)
      const best=read.sheets[0]
      setHeaderRow(best.headerRow)
      setMapping(best.matrix[best.headerRow]?suggestFor(best.matrix[best.headerRow]):{})
    }catch(error){
      setFileError(error instanceof Error?error.message:'无法读取文件')
    }finally{
      setLoading(false)
      event.target.value=''
    }
  }

  function suggestFor(row) {
    // Import dynamically? No: mapping suggestions are pure and small.
    return suggestFieldMapping(row)
  }
  function chooseSheet(value) {
    const index=Number(value)
    const selected=fileData.sheets[index]
    if(!selected)return
    setSheetIndex(index)
    setHeaderRow(selected.headerRow)
    setMapping(suggestFieldMapping(selected.matrix[selected.headerRow]||[]))
  }
  function chooseHeader(value) {
    const index=Number(value)
    if(!sheet||!sheet.matrix[index])return
    setHeaderRow(index)
    setMapping(suggestFieldMapping(sheet.matrix[index]))
  }
  function apply() {
    if(!ready)return
    onApply?.({
      fileName:fileData.fileName,
      sheetName:sheet.name,
      ...preview,
      // This object deliberately remains in current React memory only.
      temporary:true
    })
  }

  return <div className="so-import-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose?.()}}>
    <section className="so-import-dialog" role="dialog" aria-modal="true" aria-label="大熊游戏订单导入预览">
      <header className="so-import-header">
        <div><span className="so-import-kicker">大熊游戏 · 第二阶段 A</span><h2>导入订单 · 核对预览</h2><p>浏览器本地解析 CSV / Excel，<strong>不会上传、不会保存到财务数据库</strong>。</p></div>
        <button type="button" className="so-import-close" aria-label="关闭订单导入预览" onClick={onClose}>×</button>
      </header>

      <div className="so-import-body">
        <div className="so-import-pick">
          <label htmlFor="so-import-file" className="so-import-picker">选择订单文件（CSV / XLSX / XLS）</label>
          <input id="so-import-file" type="file" accept=".csv,.tsv,.xls,.xlsx" onChange={chooseFile} disabled={loading}/>
          <small>单文件上限12MB、30,000条；仅检测当前文件内重复单，无法与历史账单比对。</small>
        </div>
        {loading&&<p className="so-import-info" role="status">正在浏览器里解析文件…</p>}
        {fileError&&<p className="so-import-error" role="alert">{fileError}</p>}
        {sheet&&<>
          <div className="so-import-source">
            <strong title={fileData.fileName}>{fileData.fileName}</strong>
            {fileData.sheets.length>1&&<label>工作表 <select value={sheetIndex} onChange={event=>chooseSheet(event.target.value)} aria-label="选择工作表">
              {fileData.sheets.map((item,i)=><option key={item.name} value={i}>{item.name}</option>)}
            </select></label>}
            <label>表头所在行 <select value={headerRow} onChange={event=>chooseHeader(event.target.value)} aria-label="选择表头所在行">
              {sheet.matrix.slice(0,Math.min(12,sheet.matrix.length)).map((row,i)=><option key={i} value={i}>第{i+1}行：{row.slice(0,3).map(v=>String(v||'').slice(0,9)).join(' / ')||'空行'}</option>)}
            </select></label>
          </div>
          <div className="so-import-section-title"><h3>确认列对应关系</h3><span>自动识别后可手动改列，不会修改原文件</span></div>
          <div className="so-import-mapping">
            {ORDER_FIELDS.map(field=><label key={field.key}>
              <span>{field.label}{field.required?<b> *</b>:null}</span>
              <select value={mapping[field.key]??''} onChange={event=>setMapping(m=>({...m,[field.key]:event.target.value}))} aria-label={'对应字段：'+field.label}>
                <option value="">不使用</option>
                {headers.map((name,i)=><option key={i} value={i}>{String(name||('第'+(i+1)+'列')).slice(0,65)}</option>)}
              </select>
            </label>)}
          </div>
          <p className="so-import-hint">至少要有订单编号、实付金额、支付日期，以及游戏名称或游戏 ID。缺少类型列时仅能作为待确认的游戏充值预览。</p>
          {!!missing.length&&<p className="so-import-error" role="alert">
            字段还未匹配完整：{missing.map(key=>key==='duplicateColumn'?'同一列被重复选择':key==='gameName'?'游戏名称或游戏 ID':FIELD_TITLES[key]||key).join('、')}
          </p>}
          {preview?.error&&<p className="so-import-error" role="alert">{preview.error}</p>}
          {!preview?.error&&!missing.length&&<>
            <div className="so-import-stats">
              <article><span>识别行数</span><strong>{total.rows||0}</strong></article>
              <article><span>有效游戏充值</span><strong>{cents(total.gameCents)}</strong><small>{total.validGames||0}条</small></article>
              <article><span>竹B现金充值（单列）</span><strong>{cents(total.coinCents)}</strong><small>{total.validCoins||0}条</small></article>
              <article><span>需关注记录</span><strong>{(total.duplicates||0)+(total.conflicts||0)+(total.invalid||0)+(total.review||0)+(total.excluded||0)}</strong><small>不计入有效收入</small></article>
            </div>
            <div className="so-import-counters">
              <span>文件内重复：{total.duplicates||0}</span><span>订单冲突：{total.conflicts||0}</span>
              <span>字段错误：{total.invalid||0}</span><span>待核对：{total.review||0}</span>
              <span>未支付/退款等排除：{total.excluded||0}</span>
            </div>
            {!!preview.assumptions?.length&&<div className="so-import-warnings">{preview.assumptions.map((warning,i)=><p key={i}>{warning}</p>)}</div>}
            <div className="so-import-section-title"><h3>订单核对明细</h3><span>显示前20条，完整统计覆盖所有读取行</span></div>
            <div className="so-import-table-scroll"><table className="so-import-table">
              <thead><tr><th>原行号</th><th>订单号</th><th>游戏/ID</th><th>账期</th><th>实付</th><th>归类</th><th>检查结果</th></tr></thead>
              <tbody>{preview.records.slice(0,20).map((row,i)=><tr key={i}>
                <td>{row.line}</td><td title={row.orderId}>{row.orderId||'—'}</td>
                <td>{row.gameName||row.gameId||'—'}</td><td>{row.month||'—'}</td>
                <td>{row.amountCents===null?'无效':cents(row.amountCents)}</td>
                <td>{row.kind==='coin'?'竹B充值':row.kind==='game'?'游戏充值':'待确认'}</td>
                <td title={row.reason}><span className={'so-import-tag is-'+row.disposition}>{DISPOSITION_TEXT[row.disposition]}</span></td>
              </tr>)}
              {!preview.records.length&&<tr><td colSpan={7}>没有数据行</td></tr>}</tbody>
            </table></div>
            {!!preview.issues.length&&<p className="so-import-info">注意：{preview.issues.length} 条异常样例已识别，完整异常数见上方汇总。不同金额或状态的相同订单号不会自动合并。</p>}
          </>}
        </>}
      </div>
      <footer className="so-import-footer">
        <div><strong>仅本次会话预览</strong><span>关闭页面或刷新后清空；尚未接入正式保存和跨文件去重。</span></div>
        <button type="button" className="so-import-cancel" onClick={onClose}>取消</button>
        <button type="button" className="so-import-apply" disabled={!ready||loading} onClick={apply}>在页面查看有效订单（不保存）</button>
      </footer>
    </section>
  </div>
}
