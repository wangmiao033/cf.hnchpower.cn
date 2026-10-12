import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import {
  createPartnerEntityLink, getPartnerEntities, getPartnerEntityResolution,
  updatePartnerEntityLink
} from '@/lib/api/legalEntities.ts'

const ROLES = [
  { id: 'contract', label: '合同签约主体' },
  { id: 'payer', label: '对方付款主体' },
  { id: 'invoice', label: '开票抬头（独立确认）' }
]
const defaultMonth = (() => {
  const now = new Date()
  return String(now.getFullYear()) + '-' + String(now.getMonth() + 1).padStart(2, '0')
})()
const emptyForm = {
  legal_name: '', role: 'payer', effective_month: defaultMonth,
  end_month: '', tax_registration_no: '', note: ''
}
const overlay = {
  position: 'fixed', inset: 0, zIndex: 1400, background: 'rgba(12,25,41,.52)',
  display: 'flex', justifyContent: 'flex-end'
}
const side = {
  width: 'min(720px, 100vw)', overflow: 'auto', padding: 24,
  background: 'var(--color-surface, #fff)', color: 'var(--text-primary, #223047)'
}
const input = { width: '100%', padding: 10, borderRadius: 7, border: '1px solid #cbd5e1' }
const btn = { padding: '8px 14px', borderRadius: 7, border: '1px solid #cbd5e1', cursor: 'pointer' }
const label = { display: 'grid', gap: 5, minWidth: 0 }
function roleText(role) {
  return ROLES.find((item) => item.id === role)?.label || role
}

export default function PartnerLegalEntitiesDock({ partner, onClose }) {
  const { can } = useAuth()
  const canManage = can('partners.manage')
  const [data, setData] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [month, setMonth] = useState(defaultMonth)
  const [resolution, setResolution] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(null)
  const partnerId = String(partner?.id || '')
  const links = useMemo(() => data?.links || [], [data])

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getPartnerEntities(partnerId)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '主体资料读取失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [partnerId])
  useEffect(() => {
    if (!partnerId || !month) return
    let live = true
    getPartnerEntityResolution(partnerId, month)
      .then((res) => { if (live) setResolution(res) })
      .catch(() => { if (live) setResolution(null) })
    return () => { live = false }
  }, [partnerId, month, links])

  const add = async (event) => {
    event.preventDefault()
    if (!canManage || saving) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await createPartnerEntityLink(partnerId, {
        ...form,
        end_month: form.end_month || null
      })
      setData(result)
      setForm(emptyForm)
      setNotice('主体关联已保存。历史账单及已核销流水没有变动。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '主体关联保存失败')
    } finally {
      setSaving(false)
    }
  }

  const saveEnd = async (event) => {
    event.preventDefault()
    if (!editing || !canManage || saving) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await updatePartnerEntityLink(partnerId, editing.id, {
        end_month: editing.end_month || null,
        note: editing.note
      })
      setData((old) => ({ ...old, links: result.links }))
      setEditing(null)
      setNotice('适用期间已更新，历史账单快照保持不变。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside style={side} role="dialog" aria-modal="true" aria-label="合作客户主体管理">
        <header style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <small>合作客户 / 合同主体 / 付款方 / 发票抬头</small>
            <h2 style={{ margin: '6px 0 2px' }}>主体与结算关系</h2>
            <strong>{partner?.shortName || partner?.name}</strong>
            <p style={{ fontSize: 13, lineHeight: 1.7 }}>
              一个业务客户对应多个法律公司。新增付款方不会新增客户、改签合同或修改历史账单。
            </p>
          </div>
          <button style={btn} type="button" onClick={onClose} aria-label="关闭主体管理">关闭</button>
        </header>

        {error ? <p role="alert" style={{ color: '#b42318' }}>{error}</p> : null}
        {notice ? <p role="status" style={{ color: '#167149' }}>{notice}</p> : null}

        <section style={{ padding: 14, border: '1px solid #d9e1ea', borderRadius: 10, marginBottom: 18 }}>
          <label style={label}>按账期查看当前适用主体
            <input type="month" style={input} value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <div style={{ display: 'grid', gap: 6, paddingTop: 12 }}>
            {ROLES.map((role) => (
              <div key={role.id}>
                <strong>{role.label}：</strong>
                {resolution?.[role.id]?.legal_name || '未配置'}
              </div>
            ))}
          </div>
          <small>账期依据收入所属月份，不是银行实际打款日；发票抬头不能根据付款方自动猜测。</small>
        </section>

        <h3>已关联的法律主体</h3>
        {loading ? <p>读取主体关系中…</p> : links.length === 0 ? <p>尚未配置。先登记合同主体，再登记按月生效的付款主体。</p> : (
          <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
            {links.map((item) => (
              <div key={item.id} style={{ border: '1px solid #d9e1ea', borderRadius: 9, padding: 12 }}>
                <strong>{item.legal_name}</strong>
                <p style={{ margin: '4px 0' }}>
                  {roleText(item.role)} · {item.effective_month} 至 {item.end_month || '持续生效'}
                </p>
                {item.note ? <small>{item.note}</small> : null}
                {canManage ? <button style={btn} type="button" onClick={() => setEditing({
                  id: item.id, end_month: item.end_month || '', note: item.note || ''
                })}>修改结束账期</button> : null}
              </div>
            ))}
          </div>
        )}

        {editing && (
          <form onSubmit={saveEnd} style={{ display: 'grid', gap: 10, padding: 14, border: '1px solid #cbd5e1', borderRadius: 9 }}>
            <h3>修改生效截止日期</h3>
            <label style={label}>结束账期（空白表示继续生效）
              <input type="month" style={input} value={editing.end_month} onChange={(e) => setEditing({ ...editing, end_month: e.target.value })} />
            </label>
            <label style={label}>调整依据
              <input style={input} value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={btn} disabled={saving}>保存</button>
              <button type="button" style={btn} onClick={() => setEditing(null)}>取消</button>
            </div>
          </form>
        )}

        {canManage && <form onSubmit={add} style={{ display: 'grid', gap: 12, padding: 15, borderRadius: 10, background: '#f5f8fb', color: '#263445' }}>
          <h3 style={{ margin: 0 }}>新增主体关系</h3>
          <label style={label}>角色
            <select style={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label style={label}>法律公司全称 *
            <input style={input} required maxLength={250} value={form.legal_name}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })} placeholder="按营业执照或银行户名填写全称" />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={label}>生效账期 *
              <input style={input} type="month" required value={form.effective_month}
                onChange={(e) => setForm({ ...form, effective_month: e.target.value })} />
            </label>
            <label style={label}>截止账期
              <input style={input} type="month" value={form.end_month}
                onChange={(e) => setForm({ ...form, end_month: e.target.value })} />
            </label>
          </div>
          <label style={label}>统一社会信用代码 / 税号（可选）
            <input style={input} value={form.tax_registration_no}
              onChange={(e) => setForm({ ...form, tax_registration_no: e.target.value })} />
          </label>
          <label style={label}>备注 / 变更依据
            <input style={input} value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="例如：8 月起由新公司代付款；合同主体不变" />
          </label>
          <p style={{ fontSize: 12, margin: 0 }}>同一角色按账期仅能有一个默认主体。新增后自动截止较早的持续生效规则，历史月份仍保留原公司。</p>
          <button style={btn} type="submit" disabled={saving || !form.legal_name.trim()}>{saving ? '保存中…' : '关联到当前客户'}</button>
        </form>}
      </aside>
    </div>
  )
}
