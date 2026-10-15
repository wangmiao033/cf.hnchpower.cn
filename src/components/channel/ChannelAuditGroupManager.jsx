import React, { useMemo, useState } from 'react'
import './ChannelAuditGroupManager.css'

const clean = value => String(value || '').trim()
const groupKey = value => clean(value).normalize('NFKC').toLocaleLowerCase('zh-CN')

export default function ChannelAuditGroupManager({ partners = [], enabled = false, onSave }) {
  const [open, setOpen] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState('')
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const groups = useMemo(() => {
    const map = new Map()
    for (const p of partners) {
      const group = clean(p.channelAuditGroup)
      const key = groupKey(group)
      if (!key || !p.id) continue
      if (!map.has(key)) map.set(key, { name: group, ids: [] })
      map.get(key).ids.push(String(p.id))
    }
    return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))
  }, [partners])
  const sorted = useMemo(() => [...partners].filter(p=>p.id&&p.name)
    .sort((a,b)=>String(a.category==='渠道'?0:1).localeCompare(String(b.category==='渠道'?0:1)) ||
      String(a.name).localeCompare(String(b.name),'zh-CN')), [partners])
  const visible = useMemo(() => {
    const keyword=search.trim().toLocaleLowerCase('zh-CN')
    return sorted.filter(p => !keyword ||
      [p.name,p.shortName,p.category,p.channelAuditGroup].some(v=>String(v||'').toLocaleLowerCase('zh-CN').includes(keyword)))
  }, [sorted,search])
  const currentGroup = groups.find(g=>groupKey(g.name)===groupKey(selectedPreset))
  const selectedPartners = sorted.filter(p=>chosen.includes(String(p.id)))
  const reset = () => {
    setSelectedPreset(''); setName(''); setChosen([]); setSearch(''); setError('')
  }
  const selectPreset = (value) => {
    setSelectedPreset(value)
    setName(value)
    setChosen(groups.find(g=>g.name===value)?.ids||[])
    setSearch('')
    setError('')
  }
  const toggle = (id, checked) => {
    setChosen(ids=>checked ? [...ids.filter(v=>v!==id),id] : ids.filter(v=>v!==id))
    setError('')
  }
  const save = async (clearAll = false) => {
    if (busy) return
    const target=clearAll?'':name.trim()
    const ids=clearAll?[]:chosen
    const original=currentGroup?.ids||[]
    const removeIds=clearAll ? original : original.filter(id=>!ids.includes(id))
    if (!clearAll && (target.length<2 || target.length>80 || ids.length<2)) {
      setError('关联组名称至少2个字，且至少选中两家公司')
      return
    }
    if (clearAll && !original.length) return
    const transfers=selectedPartners.filter(p=>p.channelAuditGroup &&
      groupKey(p.channelAuditGroup)!==groupKey(selectedPreset) &&
      groupKey(p.channelAuditGroup)!==groupKey(target))
    const mergeExisting=groups.some(g=>groupKey(g.name)===groupKey(target)&&groupKey(g.name)!==groupKey(selectedPreset))
    const explanation=[
      clearAll ? '确定解除整个巡检关联组？' : '确认保存渠道巡检关联组？',
      clearAll ? selectedPreset : target,
      '关联成员：'+(clearAll?original.length:ids.length)+'家公司',
      '仅调整账期巡检的统计分组；不修改客户名称、合同、银行账户、发票或账单金额。',
      ...(transfers.length?['以下成员将从旧组转入新组：'+transfers.map(p=>p.name).join('、')]:[]),
      ...(mergeExisting?['目标组名已存在，保存后将与该组成员一起展示。']:[])
    ].join('\n')
    if (!window.confirm(explanation)) return
    setBusy(true);setError('')
    try {
      const ok=await onSave?.({
        partnerIds:ids,groupName:target,
        removeIds,expectedGroupName:selectedPreset
      })
      if (!ok) {
        setError('保存失败，请检查提示后重试；当前配置未被本页覆盖')
        return
      }
      setOpen(false);reset()
    } catch (e) {
      setError(e?.message||'保存失败，请刷新后重试')
    } finally { setBusy(false) }
  }
  return <>
    <button type="button" className="channel-audit-groups-launch" disabled={!enabled}
      title={enabled?'为不同法律主体建立统一的巡检统计组':'客户库尚未连接服务器，暂不能维护跨设备关联'}
      onClick={()=>{reset();setOpen(true)}}>管理关联渠道</button>
    {open ? <div className="channel-audit-groups-backdrop" onMouseDown={()=>!busy&&setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label="管理巡检关联渠道" className="channel-audit-groups-dialog"
        onMouseDown={e=>e.stopPropagation()}>
        <header>
          <div><h3>管理巡检关联渠道</h3>
            <p>适合渠道更换结算公司、同一运营渠道多法律主体的情况。这里只合并巡检月份，不合并账单财务。</p>
          </div>
          <button type="button" onClick={()=>setOpen(false)} disabled={busy} aria-label="关闭关联渠道管理">×</button>
        </header>
        <div className="channel-audit-groups-body">
          <div className="channel-audit-groups-form">
            <label><span>编辑已有组 / 新建</span>
              <select value={selectedPreset} disabled={busy} onChange={e=>selectPreset(e.target.value)}>
                <option value="">＋ 新建关联渠道组</option>
                {groups.map(g=><option key={g.name} value={g.name}>{g.name}（{g.ids.length}家公司）</option>)}
              </select>
            </label>
            <label><span>关联组显示名称</span>
              <input value={name} maxLength={80} disabled={busy} onChange={e=>setName(e.target.value)}
                placeholder="例如：瓜子渠道（仅巡检用）" aria-label="巡检关联组名称"/>
            </label>
          </div>
          <div className="channel-audit-groups-search">
            <label htmlFor="audit-group-search">选择要关联的公司（客户库）</label>
            <input id="audit-group-search" type="search" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="搜索公司全称或简称，例如：曦晨、杨桃" disabled={busy}/>
          </div>
          {selectedPartners.length>0 && <p className="channel-audit-groups-chosen">
            已选 {selectedPartners.length} 家：{selectedPartners.map(p=>p.shortName||p.name).join('、')}
          </p>}
          <div className="channel-audit-groups-list" role="group" aria-label="选择巡检关联组成员">
            {visible.length===0 ? <p>没有找到客户库公司。请先在「合同与客户 → 客户库」建立两家独立客户记录。</p>
              :visible.map(p=><label key={p.id}>
                <input type="checkbox" disabled={busy} checked={chosen.includes(String(p.id))}
                  onChange={e=>toggle(String(p.id),e.target.checked)}/>
                <span><strong>{p.shortName||p.name}</strong><small>{p.name}</small></span>
                {p.channelAuditGroup&&<em>现属：{p.channelAuditGroup}</em>}
              </label>)}
          </div>
          <p className="channel-audit-groups-note">提示：账期巡检将按关联组覆盖月份，点某个月仍能回到各自公司的真实账单；清除关联后恢复独立渠道巡检。</p>
          {error?<p role="alert" className="channel-audit-groups-error">{error}</p>:null}
        </div>
        <footer>
          {currentGroup?.ids?.length>0 && <button type="button" disabled={busy} className="is-remove" onClick={()=>void save(true)}>解除整个关联组</button>}
          <span/>
          <button type="button" disabled={busy} onClick={()=>setOpen(false)}>取消</button>
          <button type="button" disabled={busy||chosen.length<2||name.trim().length<2} className="is-primary" onClick={()=>void save(false)}>
            {busy?'保存中…':'保存关联组'}
          </button>
        </footer>
      </section>
    </div>:null}
  </>
}
