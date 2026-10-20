/**
 * 大熊游戏订单文件本地预览（第二阶段 A）。
 * 不读取历史账单、不访问服务器、不向数据库保存任何数据。
 * 提交正式入账前必须单独完成生产备份、服务端幂等校验及财务核对。
 */
export const MAX_IMPORT_FILE_BYTES = 12 * 1024 * 1024
export const MAX_IMPORT_ROWS = 30000

export const ORDER_FIELDS = Object.freeze([
  { key: 'orderId', label: '订单编号', required: true, aliases: ['订单号','订单编号','订单id','交易订单号','商户订单号','平台订单号','第三方订单号','支付订单号','订单流水号','outtradeno','orderid','orderno','tradeid','transactionid'] },
  { key: 'paidAmount', label: '实付金额', required: true, aliases: ['实付金额','现金实付','实付','支付金额','付款金额','实际支付','实际支付金额','实收金额','实际收款','人民币金额','充值金额','订单金额','交易金额','金额','amount','paidamount','payamount','totalamount'] },
  { key: 'paidAt', label: '支付日期', required: true, aliases: ['支付时间','支付日期','付款时间','充值时间','订单时间','下单时间','完成时间','创建时间','到账时间','交易时间','日期','paytime','paidat','createtime','ordertime','tradetime','date'] },
  { key: 'gameName', label: '游戏名称', required: false, aliases: ['游戏名称','游戏名','游戏','产品名称','产品名','产品','game','gamename','productname'] },
  { key: 'gameId', label: '游戏 ID', required: false, aliases: ['游戏id','游戏编号','产品id','产品编号','gameid','productid','appid'] },
  { key: 'status', label: '支付状态', required: false, aliases: ['订单状态','支付状态','交易状态','充值状态','付款状态','状态','status','orderstatus','paystatus'] },
  { key: 'orderType', label: '订单类型', required: false, aliases: ['订单类型','充值类型','业务类型','交易类型','商品类型','充值内容','商品名称','商品名','充值商品','类型','ordertype','producttype','tradetype'] }
])

const FIELD_ALIASES = Object.fromEntries(ORDER_FIELDS.map(field => [field.key, new Set(field.aliases)]))
const REQUIRED_FIELDS = ['orderId','paidAmount','paidAt']
const MONEY_FORMAT = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/

export function normalizeHeader(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').toLowerCase()
    .replace(/[\s\u3000_\-/\\:：()[\]【】（）.·]+/g, '')
}

export function detectOrderHeader(matrix) {
  const sample = matrix.slice(0, Math.min(12, matrix.length))
  let best = { index: 0, score: -1 }
  sample.forEach((row, index) => {
    const mapping = suggestFieldMapping(row)
    const score = REQUIRED_FIELDS.reduce((n,key) => n+(mapping[key]!==''?4:0),0)
      + ((mapping.gameName!==''||mapping.gameId!=='')?4:0)
      + (mapping.status!==''?1:0) + (mapping.orderType!==''?1:0)
    if(score>best.score)best={index,score}
  })
  return best.index
}

export function suggestFieldMapping(headers) {
  const used=new Set()
  const mapping={}
  ORDER_FIELDS.forEach(field=>{
    let chosen=''
    const alias=FIELD_ALIASES[field.key]
    for(let i=0;i<headers.length;i++){
      const normalized=normalizeHeader(headers[i])
      if(!normalized||used.has(i))continue
      if(alias.has(normalized)){chosen=String(i);break}
    }
    if(chosen!=='')used.add(Number(chosen))
    mapping[field.key]=chosen
  })
  return mapping
}

export function getMissingMapping(mapping) {
  const missing=REQUIRED_FIELDS.filter(key=>mapping?.[key]===''||mapping?.[key]==null)
  if(!mapping?.gameName && !mapping?.gameId && mapping?.gameName!== '0' && mapping?.gameId!=='0')missing.push('gameName')
  const selected=Object.values(mapping||{}).filter(v=>v!==''&&v!=null).map(String)
  if(selected.length!==new Set(selected).size)missing.push('duplicateColumn')
  return missing
}

export function readAmountCents(value) {
  const v=String(value??'').trim().replace(/[¥￥元\s]/g,'')
  if(!v||!MONEY_FORMAT.test(v))return null
  const negative=v.startsWith('-')
  const clean=v.replace(/[,-]/g,'')
  const parts=clean.split('.')
  const cents=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'))
  return Number.isSafeInteger(cents)?(negative?-cents:cents):null
}

export function normalizePaidDate(value) {
  const v=String(value??'').trim()
  if(!v)return null
  let year,month,day
  const compact=v.match(/^(20\d{2})(\d{2})(\d{2})(?:\D|$)/)
  const dashed=v.match(/^(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|[T\s:]|$)/)
  if(compact){year=Number(compact[1]);month=Number(compact[2]);day=Number(compact[3])}
  else if(dashed){year=Number(dashed[1]);month=Number(dashed[2]);day=Number(dashed[3])}
  else if(/^\d{5}(?:\.\d+)?$/.test(v)){
    const date=new Date(Date.UTC(1899,11,30)+Math.floor(Number(v))*86400000)
    year=date.getUTCFullYear();month=date.getUTCMonth()+1;day=date.getUTCDate()
  }else return null
  if(year<2020||year>2100||month<1||month>12||day<1||day>31)return null
  const date=new Date(Date.UTC(year,month-1,day))
  if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)return null
  return [year,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-')
}

function paymentState(value,present) {
  if(!present)return {status:'paid',assumed:true}
  const text=String(value??'').trim().toLowerCase()
  if(!text)return {status:'review'}
  if(/退款|退单|已退|退款中|refund|失败|已取消|取消|待支付|未支付|未付款|关闭|交易关闭|作废|撤销|未成功|支付中|未完成|reject|failed|cancel|pending|closed|unpaid/.test(text))return {status:'excluded'}
  if(/成功|已支付|已付款|已完成|已到账|已入账|收款成功|已收款|交易完成|已结算|paid|success|complete|settled|finished/.test(text))return {status:'paid'}
  return {status:'review'}
}

function orderKind(value,present) {
  if(!present)return {kind:'game',assumed:true}
  const text=String(value??'').trim().toLowerCase()
  if(!text)return {kind:'unknown'}
  if(/退|退款|冲正|refund/.test(text))return {kind:'excluded'}
  if(/竹b|竹币|竹幣|代币充值|虛擬幣儲值|虚拟币充值|币充值|coin.*topup|currencytopup/.test(text))return {kind:'coin'}
  if(/游戏|充值|现金|直充|角色|礼包|月卡|首充|支付|商品|game|recharge|order|iap|purchase/.test(text))return {kind:'game'}
  return {kind:'unknown'}
}

function cell(row,mapping,key) {
  const idx=mapping[key]
  return idx===''||idx==null ? '' : row[Number(idx)]??''
}

function isBlank(row) {
  return row.every(value=>String(value??'').trim()==='')
}

export function inspectOrderRows(matrix,{ headerRow=detectOrderHeader(matrix), mapping=null }={}) {
  if(!Array.isArray(matrix)||!matrix.length)throw new Error('未发现有效工作表数据')
  const headers=(matrix[headerRow]||[]).map(value=>String(value??'').trim())
  const fields=mapping||suggestFieldMapping(headers)
  const missing=getMissingMapping(fields)
  const rows=matrix.slice(headerRow+1).filter(row=>Array.isArray(row)&&!isBlank(row))
  if(rows.length>MAX_IMPORT_ROWS)throw new Error('单次最多预览30,000行，请按月份拆分原始报表')
  const result={
    headers,fields,headerRow,missing,totalRows:rows.length,
    records:[],issues:[],months:[],
    summary:{rows:rows.length,validGames:0,validCoins:0,gameCents:0,coinCents:0,duplicates:0,conflicts:0,invalid:0,review:0,excluded:0}
  }
  if(missing.length)return result
  const firstSeen=new Map()
  const seenConflicts=new Set()
  rows.forEach((row,index)=>{
    const line=headerRow+index+2
    const orderId=String(cell(row,fields,'orderId')).trim()
    const gameName=String(cell(row,fields,'gameName')).trim()
    const gameId=String(cell(row,fields,'gameId')).trim()
    const amountCents=readAmountCents(cell(row,fields,'paidAmount'))
    const paidDate=normalizePaidDate(cell(row,fields,'paidAt'))
    const pay=paymentState(cell(row,fields,'status'),fields.status!=='')
    const kind=orderKind(cell(row,fields,'orderType'),fields.orderType!=='')
    const record={
      line,orderId,gameName,gameId,amountCents,paidDate,
      month:paidDate?.slice(0,7)||'',kind:kind.kind,payment:pay.status,
      disposition:'ready',reason:''
    }
    if(!orderId||amountCents===null||!paidDate||(!gameName&&!gameId)){
      record.disposition='invalid'
      record.reason=[
        !orderId&&'缺少订单编号',amountCents===null&&'实付金额格式无效',
        !paidDate&&'日期无法识别',!gameName&&!gameId&&'缺少游戏'
      ].filter(Boolean).join('、')
    }else if(pay.status==='excluded'||kind.kind==='excluded'||amountCents<0){
      record.disposition='excluded';record.reason='取消、失败、退款或负数订单，不能直接计入收入'
    }else if(pay.status==='review'||kind.kind==='unknown'||amountCents===0){
      record.disposition='review';record.reason='状态、类型或零金额需人工核对'
    }
    const first=firstSeen.get(orderId)
    if(orderId&&first){
      const fingerprint=x=>[x.gameId,x.gameName,x.amountCents,x.paidDate,x.kind,x.payment].join('|')
      if(first.disposition==='conflict'||fingerprint(first)!==fingerprint(record)){
        first.disposition='conflict';first.reason='同一订单号出现不同金额、日期或业务信息'
        record.disposition='conflict';record.reason='同一订单号出现不同金额、日期或业务信息'
        seenConflicts.add(orderId)
      }else{
        record.disposition='duplicate';record.reason='当前文件内重复订单，已排除重复行'
      }
    }else if(orderId)firstSeen.set(orderId,record)
    result.records.push(record)
  })
  for(const record of result.records){
    const s=result.summary
    if(record.disposition==='ready'){
      if(record.kind==='coin'){s.validCoins++;s.coinCents+=record.amountCents}
      else{s.validGames++;s.gameCents+=record.amountCents}
    }else if(record.disposition==='duplicate')s.duplicates++
    else if(record.disposition==='conflict')s.conflicts++
    else if(record.disposition==='invalid')s.invalid++
    else if(record.disposition==='review')s.review++
    else s.excluded++
    if(record.disposition!=='ready'&&result.issues.length<100)result.issues.push(record)
  }
  result.summary.gameCents=Math.round(result.summary.gameCents)
  result.summary.coinCents=Math.round(result.summary.coinCents)
  result.months=[...new Set(result.records.filter(r=>r.disposition==='ready').map(r=>r.month))].sort().reverse()
  result.assumptions=[
    ...(fields.status===''?['未提供支付状态列：有效行暂按已支付试算，正式入账前必须补充确认。']:[]),
    ...(fields.orderType===''?['未提供业务类型列：暂按游戏充值归类，竹B充值请分开导入或手动映射类型。']:[]),
    ...((s=>s.conflicts?['存在订单号冲突，冲突行均已从收入试算中排除。']:[])(result.summary))
  ]
  return result
}

export function reportFromInspectedRows(preview,month) {
  const matching=preview.records.filter(r=>r.disposition==='ready'&&r.kind==='game'&&r.month===month)
  const coins=preview.records.filter(r=>r.disposition==='ready'&&r.kind==='coin'&&r.month===month)
  const grouped=new Map()
  for(const row of matching){
    const key=row.gameId ? 'id:'+row.gameId : 'name:'+row.gameName
    const old=grouped.get(key)||{id:row.gameId||'—',name:row.gameName||'游戏 ID '+row.gameId,cash:0,orders:0}
    old.cash+=row.amountCents/100;old.orders++
    grouped.set(key,old)
  }
  const games=[...grouped.values()].map(item=>({...item,cash:Math.round(item.cash*100)/100})).sort((a,b)=>b.cash-a.cash)
  const cash=matching.reduce((n,r)=>n+r.amountCents,0)/100
  const coinCash=coins.reduce((n,r)=>n+r.amountCents,0)/100
  const match=/^(20\d{2})-(\d{2})$/.exec(month)
  return {
    label:match?match[1]+'年'+Number(match[2])+'月':month,
    orders:matching.length,cash,coinCash,games,ads:[],spent:null,topup:null,source:'file-preview'
  }
}

export async function readOrderFile(file) {
  if(!file)throw new Error('请选择 CSV 或 Excel 文件')
  if(file.size>MAX_IMPORT_FILE_BYTES)throw new Error('文件超过12MB，请按月份拆分再试')
  if(!/\.(csv|tsv|xlsx|xls)$/i.test(file.name))throw new Error('仅支持 .csv、.tsv、.xlsx、.xls')
  const XLSX=await import('xlsx')
  const buffer=await file.arrayBuffer()
  let book
  if(/\.(csv|tsv)$/i.test(file.name)){
    let content
    try{content=new TextDecoder('utf-8',{fatal:true}).decode(buffer)}
    catch{content=new TextDecoder('gb18030').decode(buffer)}
    const sep=/\.tsv$/i.test(file.name)?'\t':undefined
    book=XLSX.read(content.replace(/^\uFEFF/,''),{type:'string',...(sep?{FS:sep}:{})})
  }else{
    book=XLSX.read(buffer,{type:'array',cellDates:false,bookVBA:false})
  }
  const sheets=book.SheetNames.map(name=>{
    const matrix=XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:false,blankrows:false})
    const headerRow=matrix.length?detectOrderHeader(matrix):0
    const mapping=suggestFieldMapping(matrix[headerRow]||[])
    const mapped=7-getMissingMapping(mapping).length
    return {name,matrix,headerRow,score:mapped}
  }).filter(sheet=>sheet.matrix.length>0)
  if(!sheets.length)throw new Error('文件没有有效工作表')
  sheets.sort((a,b)=>b.score-a.score)
  return {fileName:file.name,sheets}
}
