import React, { useEffect, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import {
  createOwnBankAccount, getOwnBankAccounts, setOwnBankAccountActive
} from '@/lib/api/legalEntities.ts'

const empty = { legal_name: '广州熊动科技有限公司', account_no: '',
  bank_name: '', currency: 'CNY', account_label: '', tax_registration_no: '' }
const fieldStyle = { display: 'grid', gap: 5 }
const inputStyle = { padding: 9, border: '1px solid #cbd5e1', borderRadius: 7, width: '100%' }
const buttonStyle = { padding: '8px 13px', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer' }

export default function OwnReceivingAccountsDock({ onClose }) {
  const { can } = useAuth()
  const canManage = can('funds.manage')
  const [accounts, setAccounts] = useState([])
  const [form, setForm] = useState(empty)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getOwnBankAccounts()
      setAccounts(result.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取账户归属失败')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  const submit = async (event) => {
    event.preventDefault()
    if (busy || !canManage) return
    setBusy(true); setError(''); setNotice('')
    try {
      await createOwnBankAccount(form)
      setForm((old) => ({ ...old, account_no: '', account_label: '' }))
      setNotice('收款公司及账户归属已建立。不会修改任何银行流水或历史核销。')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  const toggle = async (item) => {
    if (!canManage || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await setOwnBankAccountActive(item.id, !item.is_active)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(12,25,41,.52)', display: 'flex', justifyContent: 'flex-end' }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside role="dialog" aria-modal="true" aria-label="我方收款主体与银行账户"
        style={{ width: 'min(680px, 100vw)', overflow: 'auto', padding: 24, background: 'var(--color-surface, #fff)', color: 'var(--text-primary, #223047)' }}>
        <header style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h2 style={{ margin: '0 0 6px' }}>我方收款主体与账户</h2>
            <p style={{ fontSize: 13 }}>按真实银行账号识别由哪家公司收款。一个公司可有多个账户，不需要新增合作客户。</p>
          </div>
          <button type="button" style={buttonStyle} onClick={onClose}>关闭</button>
        </header>
        {error ? <p role="alert" style={{ color: '#b42318' }}>{error}</p> : null}
        {notice ? <p role="status" style={{ color: '#167149' }}>{notice}</p> : null}
        <h3>已登记账户</h3>
        {loading ? <p>读取中…</p> : accounts.length ? <div style={{ display: 'grid', gap: 9 }}>
          {accounts.map((item) => (
            <section key={item.id} style={{ border: '1px solid #d9e1ea', borderRadius: 8, padding: 12 }}>
              <strong>{item.legal_name}</strong>
              <p style={{ margin: '4px 0' }}>{item.bank_name || '银行未注明'} · {item.account_label || '收款账户'} · {item.currency}</p>
              <p style={{ margin: '4px 0', fontSize: 13 }}>账号尾号：{String(item.account_no || '').slice(-6)}</p>
              <span style={{ color: item.is_active ? '#167149' : '#b42318' }}>{item.is_active ? '使用中' : '已停用'}</span>
              {canManage ? <button type="button" style={{ ...buttonStyle, marginLeft: 16 }} disabled={busy}
                onClick={() => toggle(item)}>{item.is_active ? '停用' : '重新启用'}</button> : null}
            </section>
          ))}
        </div> : <p>暂无银行账户。登记后可在银行流水核对实际收款主体。</p>}

        {canManage && <form onSubmit={submit}
          style={{ display: 'grid', gap: 12, background: '#f5f8fb', color: '#263445', borderRadius: 10, padding: 15, marginTop: 20 }}>
          <h3 style={{ margin: 0 }}>新增我方收款账户</h3>
          <label style={fieldStyle}>收款公司法律全称 *
            <input style={inputStyle} required value={form.legal_name}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
          </label>
          <label style={fieldStyle}>完整银行账号 *
            <input style={inputStyle} required minLength={6} value={form.account_no}
              onChange={(e) => setForm({ ...form, account_no: e.target.value })} />
          </label>
          <label style={fieldStyle}>开户行
            <input style={inputStyle} value={form.bank_name}
              onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
          </label>
          <label style={fieldStyle}>账户备注
            <input style={inputStyle} value={form.account_label}
              onChange={(e) => setForm({ ...form, account_label: e.target.value })} placeholder="如：对公收款账户" />
          </label>
          <label style={fieldStyle}>币种
            <select style={inputStyle} value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option value="CNY">CNY 人民币</option>
              <option value="USD">USD 美元</option>
              <option value="SGD">SGD 新加坡元</option>
              <option value="HKD">HKD 港元</option>
            </select>
          </label>
          <button type="submit" disabled={busy || !form.account_no.trim()} style={buttonStyle}>
            {busy ? '保存中…' : '保存账户归属'}
          </button>
          <small>账号仅用于身份匹配；实际到账数据仍以导入的银行流水为准。停用账户不会删除历史流水。</small>
        </form>}
      </aside>
    </div>
  )
}
