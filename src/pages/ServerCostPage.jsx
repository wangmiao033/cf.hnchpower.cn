import React, { useEffect, useMemo, useState } from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'
import { findExactPartner } from '@/components/shared/PartnerPicker.jsx'
import { useAppState } from '@/app/AppStateContext.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { getProfitAnalysis } from '@/lib/api/profitAnalysis.ts'
import {
  createServerCost,
  listServerCosts,
  restoreServerCost,
  updateServerCost,
  voidServerCost
} from '@/lib/api/serverCosts.ts'
import './ServerCostPage.css'

const CATEGORY_OPTIONS = [
  ['cloud_server', '云服务器'],
  ['cdn', 'CDN'],
  ['database', '数据库'],
  ['bandwidth', '带宽'],
  ['domain', '域名'],
  ['other', '其他']
]
const CATEGORY_LABELS = Object.fromEntries(CATEGORY_OPTIONS)
const PROVIDER_OPTIONS = ['火山云', '华为云', '腾讯云', '其他云']

function currentMonth() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function emptyForm(month) {
  return {
    expenseMonth: month || currentMonth(),
    expenseDate: '',
    providerName: '',
    category: 'cloud_server',
    amount: '',
    gameName: '',
    payerEntity: '',
    payerPartnerId: '',
    remark: ''
  }
}

export default function ServerCostPage() {
  const { showToast, settings } = useAppState()
  const { can } = useAuth()
  const canManage = can('analytics.manage')
  const partners = settings?.partners || []
  const partnerLoading = Boolean(settings?.partnerLoading)
  const [month, setMonth] = useState(currentMonth)
  const [category, setCategory] = useState('')
  const [gameName, setGameName] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('active')
  const [rows, setRows] = useState([])
  const [amountTotal, setAmountTotal] = useState(0)
  const [profit, setProfit] = useState(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [form, setForm] = useState(() => emptyForm(currentMonth()))
  const [payerQuery, setPayerQuery] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      listServerCosts({
        month: month || undefined,
        category: category || undefined,
        gameName: gameName || undefined,
        q: query || undefined,
        status,
        limit: 500
      }),
      getProfitAnalysis({ month: month || undefined, trendMonths: 2 })
    ])
      .then(([costs, profitRow]) => {
        if (cancelled) return
        setRows(costs.items || [])
        setAmountTotal(Number(costs.amount_total || 0))
        setProfit(profitRow)
      })
      .catch((error) => {
        if (!cancelled) showToast?.(error instanceof Error ? error.message : '服务器成本读取失败', 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [month, category, gameName, query, status, revision, showToast])

  const gameOptions = useMemo(
    () => [...new Set((profit?.games || []).map((item) => item.game_name).filter(Boolean))],
    [profit?.games]
  )

  const partnerOptions = useMemo(
    () => [...partners]
      .filter((partner) => partner?.id && partner?.name)
      .sort((left, right) => String(left.shortName || left.name || '').localeCompare(
        String(right.shortName || right.name || ''),
        'zh-CN',
        { numeric: true, sensitivity: 'base' }
      )),
    [partners]
  )

  const filteredPartnerOptions = useMemo(() => {
    const q = payerQuery.trim().toLowerCase()
    const matches = (q
      ? partnerOptions.filter((partner) => [
          partner.shortName,
          partner.name,
          partner.taxRegistrationNo,
          partner.category,
          partner.tag2
        ].filter(Boolean).join(' ').toLowerCase().includes(q))
      : partnerOptions
    ).slice(0, 80)
    const selected = partnerOptions.find(
      (partner) => String(partner.id || '') === String(form.payerPartnerId || '')
    )
    if (selected && !matches.some((partner) => String(partner.id) === String(selected.id))) {
      return [selected, ...matches]
    }
    return matches
  }, [partnerOptions, payerQuery, form.payerPartnerId])

  const openCreate = () => {
    if (!canManage) return
    setEditingId('')
    setForm(emptyForm(month))
    setPayerQuery('')
    setEditorOpen(true)
  }

  const openEdit = (row) => {
    if (!canManage || row.status === 'void') return
    const linkedPartner = partnerOptions.find(
      (partner) => String(partner.id || '') === String(row.payer_partner_id || '')
    ) || findExactPartner(partnerOptions, row.payer_entity)
    setEditingId(row.id)
    setForm({
      expenseMonth: row.expense_month || month,
      expenseDate: row.expense_date || '',
      providerName: PROVIDER_OPTIONS.includes(row.provider_name) ? row.provider_name : (row.provider_name ? '其他云' : ''),
      category: row.category || 'cloud_server',
      amount: String(row.amount ?? ''),
      gameName: row.game_name || '',
      payerEntity: linkedPartner?.name || row.payer_entity || '',
      payerPartnerId: linkedPartner ? String(linkedPartner.id || '') : String(row.payer_partner_id || ''),
      remark: row.remark || ''
    })
    setPayerQuery(linkedPartner?.shortName || linkedPartner?.name || row.payer_entity || '')
    setEditorOpen(true)
  }

  const closeEditor = () => {
    if (saving) return
    setEditorOpen(false)
    setEditingId('')
    setPayerQuery('')
  }

  const saveCost = async (event) => {
    event.preventDefault()
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast?.('服务器成本金额必须大于 0', 'error')
      return
    }
    if (!PROVIDER_OPTIONS.includes(form.providerName)) {
      showToast?.('请选择服务商', 'error')
      return
    }
    const payload = {
      expense_month: form.expenseMonth,
      expense_date: form.expenseDate || null,
      provider_name: form.providerName,
      category: form.category,
      amount,
      game_name: form.gameName.trim() || null,
      payer_entity: form.payerEntity.trim() || null,
      payer_partner_id: form.payerPartnerId || null,
      remark: form.remark.trim() || null,
      source: 'manual'
    }
    setSaving(true)
    try {
      if (editingId) {
        await updateServerCost(editingId, payload)
        showToast?.('服务器成本已更新', 'success')
      } else {
        await createServerCost(payload)
        showToast?.('服务器成本已录入', 'success')
      }
      setMonth(form.expenseMonth)
      setEditorOpen(false)
      setEditingId('')
      setPayerQuery('')
      setRevision((value) => value + 1)
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '服务器成本保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleVoid = async (row) => {
    const reason = window.prompt('请输入作废原因（可留空）：', '')
    if (reason === null) return
    if (!window.confirm(`确认作废这笔服务器成本 ${money(row.amount)} 吗？\n\n作废后不会进入利润计算，可随时恢复。`)) return
    try {
      await voidServerCost(row.id, reason.trim())
      showToast?.('服务器成本已作废', 'success')
      setRevision((value) => value + 1)
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '作废失败', 'error')
    }
  }

  const handleRestore = async (row) => {
    if (!window.confirm(`恢复这笔服务器成本 ${money(row.amount)} 并重新计入利润吗？`)) return
    try {
      await restoreServerCost(row.id)
      showToast?.('服务器成本已恢复', 'success')
      setRevision((value) => value + 1)
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '恢复失败', 'error')
    }
  }

  const payerPartnerExists = partnerOptions.some(
    (partner) => String(partner.id || '') === String(form.payerPartnerId || '')
  )

  return (
    <PageContainer hideHeader className="server-cost-page">
      <section className="server-cost-head">
        <div>
          <span>SERVER COST LEDGER</span>
          <h1>服务器成本</h1>
          <p>新服务器费用统一在这里录入；历史渠道账单里的服务器费继续兼容，不改旧账。</p>
        </div>
        <div className="server-cost-head__actions">
          <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button>
          {canManage ? <button type="button" className="is-primary" onClick={openCreate}>+ 录入成本</button> : null}
        </div>
      </section>

      <section className="server-cost-warning">
        <strong>避免重复录入：</strong>
        <span>利润中的“服务器成本”会同时包含历史渠道账单服务器费和本台账的独立服务器成本。旧账已有同一笔服务器费时，不要再次录入。</span>
      </section>

      <section className="server-cost-metrics">
        <article><span>本台账当前筛选</span><strong>{money(amountTotal)}</strong><small>{rows.length} 笔记录</small></article>
        <article><span>本月独立服务器成本</span><strong>{money(profit?.standalone_server_cost?.value)}</strong><small>{profit?.server_cost_count || 0} 笔有效录入</small></article>
        <article><span>历史渠道账单服务器费</span><strong>{money(profit?.legacy_server_cost?.value)}</strong><small>兼容历史账单口径</small></article>
        <article className="is-total"><span>利润口径服务器成本</span><strong>{money(profit?.server_cost?.value)}</strong><small>历史 + 独立台账</small></article>
      </section>

      <section className="server-cost-card">
        <div className="server-cost-toolbar">
          <label><span>月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
          <label><span>费用类型</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部类型</option>{CATEGORY_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span>游戏</span><input value={gameName} onChange={(event) => setGameName(event.target.value)} placeholder="全部游戏 / 公共" /></label>
          <label className="is-grow"><span>搜索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="服务商、实付主体、备注…" /></label>
          <label><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">有效</option><option value="void">已作废</option><option value="all">全部</option></select></label>
        </div>

        <div className="server-cost-table-wrap">
          <table>
            <thead><tr><th>费用月份</th><th>发生日期</th><th>服务商</th><th>费用类型</th><th>归属游戏</th><th>实付主体</th><th>备注</th><th className="is-right">金额</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={10} className="server-cost-empty">正在读取服务器成本…</td></tr> : null}
              {!loading && rows.length === 0 ? <tr><td colSpan={10} className="server-cost-empty">当前筛选条件下暂无服务器成本。</td></tr> : null}
              {!loading && rows.map((row) => (
                <tr key={row.id} className={row.status === 'void' ? 'is-void' : ''}>
                  <td><strong>{row.expense_month}</strong></td>
                  <td>{row.expense_date || '—'}</td>
                  <td>{row.provider_name || '—'}</td>
                  <td>{CATEGORY_LABELS[row.category] || row.category}</td>
                  <td>{row.game_name || <span className="server-cost-public">公共成本</span>}</td>
                  <td>{row.payer_entity || '—'}{row.payer_partner_id ? <small> · 客户库</small> : null}</td>
                  <td className="server-cost-remark" title={row.remark || ''}>{row.remark || '—'}</td>
                  <td className="is-right"><strong>{money(row.amount)}</strong></td>
                  <td><span className={`server-cost-status is-${row.status}`}>{row.status === 'void' ? '已作废' : '有效'}</span>{row.void_reason ? <small>{row.void_reason}</small> : null}</td>
                  <td><div className="server-cost-actions">
                    {canManage && row.status !== 'void' ? <><button type="button" onClick={() => openEdit(row)}>编辑</button><button type="button" className="is-danger" onClick={() => void handleVoid(row)}>作废</button></> : null}
                    {canManage && row.status === 'void' ? <button type="button" onClick={() => void handleRestore(row)}>恢复</button> : null}
                    {!canManage ? <span>只读</span> : null}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="server-cost-footnote">
        <strong>利润归属规则</strong>
        <p>选择具体游戏：服务器成本直接扣减该母游戏的产品可归属利润；归属游戏留空：作为公司公共服务器成本，只扣公司利润，不强行分摊。</p>
      </section>

      {editorOpen ? (
        <div className="server-cost-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor() }}>
          <section className="server-cost-editor" role="dialog" aria-modal="true" aria-label={editingId ? '编辑服务器成本' : '录入服务器成本'}>
            <header><div><span>SERVER COST</span><h2>{editingId ? '编辑服务器成本' : '录入服务器成本'}</h2></div><button type="button" onClick={closeEditor}>×</button></header>
            <form onSubmit={saveCost}>
              <div className="server-cost-editor-grid">
                <label><span>费用月份 *</span><input type="month" value={form.expenseMonth} onChange={(event) => setForm((current) => ({ ...current, expenseMonth: event.target.value }))} required /></label>
                <label><span>金额 *</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" required /></label>
                <label><span>发生 / 付款日期</span><input type="date" value={form.expenseDate} onChange={(event) => setForm((current) => ({ ...current, expenseDate: event.target.value }))} /></label>
                <label><span>费用类型 *</span><select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>{CATEGORY_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label><span>服务商 *</span><select value={form.providerName} onChange={(event) => setForm((current) => ({ ...current, providerName: event.target.value }))} required><option value="">请选择服务商</option>{PROVIDER_OPTIONS.map((provider) => <option value={provider} key={provider}>{provider}</option>)}</select></label>
                <label><span>归属游戏</span><input list="server-cost-game-options" value={form.gameName} onChange={(event) => setForm((current) => ({ ...current, gameName: event.target.value }))} placeholder="留空 = 公共成本" /><datalist id="server-cost-game-options">{gameOptions.map((name) => <option value={name} key={name} />)}</datalist></label>
                <label className="is-wide">
                  <span>实付主体 · 客户库</span>
                  <div className="server-cost-payer-picker">
                    <input
                      type="search"
                      value={payerQuery}
                      onChange={(event) => setPayerQuery(event.target.value)}
                      placeholder="搜索简称、公司全称、税号"
                      autoComplete="off"
                    />
                    <select value={form.payerPartnerId} onChange={(event) => {
                      const nextId = event.target.value
                      const partner = partnerOptions.find((item) => String(item.id || '') === nextId)
                      setForm((current) => ({
                        ...current,
                        payerPartnerId: nextId,
                        payerEntity: partner?.name || ''
                      }))
                      if (partner) setPayerQuery(partner.shortName || partner.name || '')
                    }} disabled={partnerLoading}>
                      <option value="">{partnerLoading ? '正在读取客户库…' : '请选择客户库主体'}</option>
                      {form.payerPartnerId && !payerPartnerExists ? <option value={form.payerPartnerId}>历史关联 · {form.payerEntity || form.payerPartnerId}</option> : null}
                      {filteredPartnerOptions.map((partner) => <option value={String(partner.id)} key={partner.id}>{partner.shortName ? `${partner.shortName} · ${partner.name}` : partner.name}</option>)}
                    </select>
                  </div>
                  <small>{payerQuery ? `匹配 ${filteredPartnerOptions.length} / ${partnerOptions.length} 个客户` : `客户库共 ${partnerOptions.length} 个，输入关键词可快速筛选`}</small>
                  {form.payerEntity && !form.payerPartnerId ? <small>历史未关联值：{form.payerEntity}，选择客户库主体后会建立正式关联。</small> : null}
                </label>
                <label className="is-wide"><span>备注</span><textarea rows={3} value={form.remark} onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))} placeholder="账单周期、实例、用途等" /></label>
              </div>
              <div className="server-cost-editor-note">实付主体支持搜索客户简称、公司全称和税号，并保存客户库 ID；服务商只允许选择火山云、华为云、腾讯云或其他云。归属游戏留空 = 公司公共服务器成本。</div>
              <footer><button type="button" onClick={closeEditor}>取消</button><button type="submit" className="is-primary" disabled={saving}>{saving ? '保存中…' : editingId ? '保存修改' : '确认录入'}</button></footer>
            </form>
          </section>
        </div>
      ) : null}
    </PageContainer>
  )
}
