/* 第一阶段只读演示数据：不是生产财务账本。 */
export const PREVIEW_MONTHS = {
 '2026-09':{
  label:'2026年9月',orders:756,
  games:[['920','异界深渊：大灵王',10580.40],['893','帝国雄师',6280.12],['124','雷鸣三国',5420.86],['880','六界仙尊',2300],['671','末世王者',219.08],['554','一起来修仙（0.05折）',80]],
  ads:[{id:'sep1',date:'09-04',kind:'topup',platform:'TapTap',game:'广告账户',amount:5000},{id:'sep2',date:'09-30',kind:'spend',platform:'TapTap',game:'异界深渊：大灵王',amount:1800},{id:'sep3',date:'09-30',kind:'spend',platform:'TapTap',game:'帝国雄师',amount:500}]
 },
 '2026-08':{
  label:'2026年8月',orders:620,
  games:[['124','雷鸣三国',7400],['893','帝国雄师',3900],['880','六界仙尊',1700],['920','异界深渊：大灵王',800],['937','破雪刃（0.1折买断免费版）',400],['955','命运圣契',2300.20]],
  ads:[{id:'aug1',date:'08-15',kind:'topup',platform:'TapTap',game:'广告账户',amount:3000},{id:'aug2',date:'08-31',kind:'spend',platform:'TapTap',game:'雷鸣三国',amount:1200}]
 }
}
const round=v=>Math.round((Number(v)||0)*100)/100
export function exactMoney(value){const v=Number(value)||0;return(v<0?'-':'')+'¥'+Math.abs(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}
export function compactMoney(value){const v=Number(value)||0;return Math.abs(v)>=10000?(v<0?'-':'')+'¥'+(Math.abs(v)/10000).toLocaleString('zh-CN',{minimumFractionDigits:1,maximumFractionDigits:2})+'万':exactMoney(v)}
export function previewFor(month='2026-09'){
 const s=PREVIEW_MONTHS[month]||PREVIEW_MONTHS['2026-09']
 const games=s.games.map(([id,name,cash])=>({id,name,cash}))
 const ads=s.ads.map(x=>({...x}))
 return{label:s.label,orders:s.orders,games,ads,cash:round(games.reduce((a,x)=>a+x.cash,0)),spent:round(ads.filter(x=>x.kind==='spend').reduce((a,x)=>a+x.amount,0)),topup:round(ads.filter(x=>x.kind==='topup').reduce((a,x)=>a+x.amount,0))}
}
