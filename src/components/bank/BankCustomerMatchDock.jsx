import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { listPartners } from '@/lib/api/partner.ts'
import {
  getBankCustomerMatchCenter,
  linkBankCounterparty,
  unlinkBankCounterparty
} from '@/lib/api/bankPartner.ts'
import './BankCustomerMatchDock.css'

function money(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '¥0.00'
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function methodLabel(value, explicit) {
  if (explicit || value === 'manual') return '人工固定'
  if (value === 'bank_account') return '银行账号'
  if (value === 'exact_name') return '全称一致'
  if (value === 'normalized_name') return '名称归一'
  return '自动识别'
}

export default function BankCustomerMatchDock({ onChanged }) {
  const { showToast } = useAppState()
  const { can } = useAuth()
  const canManage = can('funds.manage')
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [editingKey, setEditingKey] = useState('')
  const [partnerSearch, setPartnerSearch] = useState('')
  const [selectedPartnerId, setSelectedPartnerId] = useState('')
  const [saving, setSaving] = useState(false)

  const loadCenter = async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const result = await getBankCustomerMatchCenter()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '客户匹配数据读取失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    void loadCenter(true)
  }, [])

  useEffect(() => {
    if (!open || partners.length) return
    listPartners()
      .then((result) => setPartners(result.items || []))
      .catch((err) => setError(err instanceof Error ? err.message : '客户中心读取失败'))
  }, [open, partners.length])

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (data?.items || []).filter((row) => {
      if (status === 'matched' && !row.matched) return false
      if (status === 'unmatched' && row.matched) return false
      if (!term) return true
      const suggestion = row.suggested_partner || {}
      return [
        row.counterparty_name,
        row.partner_short_name,
        row.partner_name,
        suggestion.partner_short_name,
        suggestion.partner_name,
        ...(row.accounts || [])
      ].filter(Boolean).join(' ').toLowerCase().includes(term)
    })
  }, [data?.items, search, status])

  const partnerChoices = useMemo(() => {
    const term = partnerSearch.trim().toLowerCase()
    const list = partners.filter((partner) => {
      if (!term) return true
      return [partner.short_name, partner.name, partner.category, partner.tag]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
    return list.slice(0, 18)
  }, [partners, partnerSearch])

  const startEdit = (row, partnerId = '') => {
    setEditingKey(row.counterparty_key)
    setPartnerSearch('')
    setSelectedPartnerId(partnerId || row.partner_id || row.suggested_partner?.partner_id || '')
  }

  const saveLink = async (row, forcedPartnerId = '') => {
    const partnerId = forcedPartnerId || selectedPartnerId
    if (!partnerId || !canManage) return
    setSaving(true)
    try {
      const saved = await linkBankCounterparty(row.counterparty_name, partnerId)
      showToast?.(`已将“${row.counterparty_name}”匹配为 ${saved.partner_short_name || saved.partner_name}`, 'success')
      setEditingKey('')
      setSelectedPartnerId('')
      await loadCenter(true)
      onChanged?.()
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : '客户匹配保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeLink = async (row) => {
    if (!canManage || !row.explicit) return
    if (!window.confirm(`解除“${row.counterparty_name}”与“${row.partner_short_name || row.partner_name}”的固定客户匹配？\n\n不会删除银行流水或客户资料。`)) return
    setSaving(true)
    try {
      await unlinkBankCounterparty(row.counterparty_name)
      showToast?.('已解除固定客户匹配；系统仍会继续尝试按客户全称自动识别。', 'success')
      await loadCenter(true)
      onChanged?.()
    } catch (err) {
      showToast?.(err instanceof Error ? err.message : '解除匹配失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const stats = data?.stats || { counterparties: 0, matched: 0, manual: 0, unmatched: 0 }

  return (
    <>
      <button type="button" className="bank-customer-launcher" onClick={() => { setOpen(true); void loadCenter(false) }}>
        <span>客</span>
        <div><strong>客户简称匹配</strong><small>银行户名 ↔ 客户中心</small></div>
        {stats.unmatched > 0 ? <em>{stats.unmatched}</em> : null}
      </button>

      {open ? (
        <div className="bank-customer-mask" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
          <aside className="bank-customer-drawer" role="dialog" aria-modal="true" aria-label="客户匹配中心">
            <header className="bank-customer-head">
              <div>
                <span>BANK CUSTOMER IDENTITY</span>
                <h2>客户匹配中心</h2>
                <p>把银行里的“对方单位”固定到客户中心。匹配后银行中心优先显示客户简称，同名流水自动沿用，并参与推荐账单评分。</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setOpen(false)}>×</button>
            </header>

            <section className="bank-customer-stats">
              <article><span>银行对方单位</span><strong>{stats.counterparties} 个</strong></article>
              <article className="is-matched"><span>已识别客户</span><strong>{stats.matched} 个</strong></article>
              <article className="is-unmatched"><span>待匹配</span><strong>{stats.unmatched} 个</strong></article>
            </section>

            <div className="bank-customer-toolbar">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索银行户名 / 客户简称 / 客户全称 / 账号" />
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">全部状态</option>
                <option value="unmatched">只看待匹配</option>
                <option value="matched">只看已匹配</option>
              </select>
              <button type="button" onClick={() => loadCenter(false)} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
            </div>

            {error ? <div className="bank-customer-error">{error}</div> : null}

            <div className="bank-customer-list">
              {!loading && rows.length === 0 ? <div className="bank-customer-empty">当前条件下没有需要显示的银行对方单位。</div> : null}
              {rows.map((row) => {
                const editing = editingKey === row.counterparty_key
                const suggested = row.suggested_partner
                return (
                  <article className="bank-customer-row" key={row.counterparty_key}>
                    <div className="bank-customer-row__main">
                      <div className="bank-customer-party">
                        <strong title={row.counterparty_name}>{row.counterparty_name}</strong>
                        <small>{row.last_trade_date || '-'} · {row.transaction_count} 笔{row.accounts?.length ? ` · ${row.accounts.length} 个对方账号` : ''}</small>
                        <div className="bank-customer-money">
                          {Number(row.income_total || 0) > 0 ? <b className="is-income">收 {money(row.income_total)}</b> : null}
                          {Number(row.expense_total || 0) > 0 ? <b className="is-expense">付 {money(row.expense_total)}</b> : null}
                        </div>
                      </div>

                      <div className={`bank-customer-match ${row.matched ? '' : 'is-unmatched'}`}>
                        <span>客户中心</span>
                        {row.matched ? (
                          <>
                            <strong><em>{row.partner_short_name || '未设简称'}</em>{row.explicit ? '已固定' : '已识别'}</strong>
                            <small title={row.partner_name || ''}>{row.partner_name || '-' } · {methodLabel(row.match_method, row.explicit)}</small>
                          </>
                        ) : suggested ? (
                          <>
                            <strong>待确认</strong>
                            <small className="bank-customer-suggestion">建议：{suggested.partner_short_name || suggested.partner_name} · {suggested.score}分</small>
                          </>
                        ) : (
                          <><strong>未匹配</strong><small>请选择客户中心里的客户简称</small></>
                        )}
                      </div>

                      <div className="bank-customer-actions">
                        {canManage && suggested && !row.matched ? <button type="button" className="is-primary" disabled={saving} onClick={() => saveLink(row, suggested.partner_id)}>确认建议</button> : null}
                        {canManage ? <button type="button" onClick={() => startEdit(row)}>{row.matched ? '更换' : '匹配客户'}</button> : null}
                        {canManage && row.explicit ? <button type="button" className="is-danger" disabled={saving} onClick={() => removeLink(row)}>解除</button> : null}
                      </div>
                    </div>

                    {editing ? (
                      <div className="bank-customer-choice">
                        <div className="bank-customer-choice__top">
                          <input autoFocus value={partnerSearch} onChange={(event) => setPartnerSearch(event.target.value)} placeholder="搜索客户简称 / 公司全称 / 分类 / 标签" />
                          <button type="button" onClick={() => { setEditingKey(''); setSelectedPartnerId('') }}>取消</button>
                        </div>
                        <div className="bank-customer-choice__results">
                          {partnerChoices.map((partner) => (
                            <button
                              type="button"
                              key={partner.id}
                              className={selectedPartnerId === partner.id ? 'is-selected' : ''}
                              onClick={() => setSelectedPartnerId(partner.id)}
                            >
                              <strong>{partner.short_name || '未设简称'} · {partner.category || '客户'}</strong>
                              <small title={partner.name}>{partner.name}</small>
                            </button>
                          ))}
                        </div>
                        <div className="bank-customer-choice__foot">
                          <span>{partnerChoices.length ? `显示 ${partnerChoices.length} 个候选；客户简称优先展示。` : '没有找到客户，请先到客户中心维护。'}</span>
                          <button type="button" className="is-primary" disabled={!selectedPartnerId || saving} onClick={() => saveLink(row)}>{saving ? '保存中…' : '固定为这个客户'}</button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>

            <footer className="bank-customer-note">
              客户匹配只建立身份关系，不修改银行原始流水，也不会自动确认核销。人工固定后，后续同名流水会直接显示客户简称并优先匹配该客户的账单。
            </footer>
          </aside>
        </div>
      ) : null}
    </>
  )
}
