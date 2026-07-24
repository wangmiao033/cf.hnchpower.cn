import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import './PartnerPage.css'

const EMPTY_PARTNER = {
  name: '',
  category: '研发商',
  tag2: '',
  taxRegistrationNo: '',
  bankName: '',
  bankAccount: '',
  invoiceContent: '',
  recipient: '',
  recipientPhone: '',
  mailingAddress: ''
}

const CATEGORIES = ['研发商', '发行商', '渠道', '供应商', '其他']

function partnerNameKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/\s+/g, '')
}

function PartnerPage() {
  const { settings, recon, showToast } = useAppState()
  const { partners, setPartners } = settings
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_PARTNER)

  useEffect(() => {
    const existingNames = new Set()
    const retainedPartners = []
    for (const partner of partners || []) {
      const key = partnerNameKey(partner.name)
      const isMigrated = String(partner.id || '').startsWith('migrated-')
      if (key && existingNames.has(key) && isMigrated) continue
      if (key) existingNames.add(key)
      retainedPartners.push(partner)
    }
    const candidates = [
      ...(recon.records || []).map((record) => ({
        name: record.partner,
        category: '研发商'
      })),
      ...(recon.channelRecords || []).map((record) => ({
        name: record.partner || record.partnerName,
        category: '渠道'
      }))
    ]
    const additions = []

    for (const candidate of candidates) {
      const name = String(candidate.name || '').trim()
      const key = partnerNameKey(name)
      if (!key || existingNames.has(key)) continue
      existingNames.add(key)
      additions.push({
        ...EMPTY_PARTNER,
        name,
        category: candidate.category,
        id: `migrated-${candidate.category}-${key}`,
        createdAt: new Date().toISOString()
      })
    }

    if (additions.length > 0 || retainedPartners.length !== (partners || []).length) {
      setPartners([...retainedPartners, ...additions])
    }
  }, [partners, recon.channelRecords, recon.records, setPartners])

  const filteredPartners = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (partners || []).filter((partner) => {
      const matchesCategory = category === '全部' || partner.category === category
      const searchable = [
        partner.name,
        partner.category,
        partner.tag2,
        partner.taxRegistrationNo,
        partner.bankName,
        partner.recipient
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return matchesCategory && (!q || searchable.includes(q))
    })
  }, [partners, query, category])

  const resetForm = () => {
    setEditingId(null)
    setForm(EMPTY_PARTNER)
  }

  const savePartner = () => {
    const name = form.name.trim()
    if (!name) {
      showToast('请填写客户名称', 'error')
      return
    }

    const payload = {
      ...form,
      name,
      tag2: form.tag2.trim(),
      taxRegistrationNo: form.taxRegistrationNo.trim(),
      bankName: form.bankName.trim(),
      bankAccount: form.bankAccount.trim(),
      invoiceContent: form.invoiceContent.trim(),
      recipient: form.recipient.trim(),
      recipientPhone: form.recipientPhone.trim(),
      mailingAddress: form.mailingAddress.trim()
    }

    if (editingId) {
      setPartners((partners || []).map((item) => (item.id === editingId ? { ...item, ...payload } : item)))
      showToast('客户资料已更新', 'success')
    } else {
      setPartners([...(partners || []), { ...payload, id: Date.now(), createdAt: new Date().toISOString() }])
      showToast('客户已加入客户库', 'success')
    }
    resetForm()
  }

  const editPartner = (partner) => {
    setEditingId(partner.id)
    setForm({ ...EMPTY_PARTNER, ...partner })
  }

  const deletePartner = (partner) => {
    if (!window.confirm(`确定删除「${partner.name}」吗？`)) return
    setPartners((partners || []).filter((item) => item.id !== partner.id))
    showToast('客户已删除', 'success')
  }

  return (
    <PageContainer hideHeader className="customer-library-page">
      <section className="customer-head">
        <div>
          <p>基础资料</p>
          <h1>客户库</h1>
          <span>维护合作方资料，供研发账单和渠道账单复用。</span>
        </div>
        <div className="customer-filters">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="全部">全部类型</option>
            {CATEGORIES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称、税号、联系人"
          />
        </div>
      </section>

      <section className="customer-form-panel">
        <div className="customer-form-head">
          <h2>{editingId ? '编辑客户' : '新增客户'}</h2>
          {editingId ? <button type="button" onClick={resetForm}>取消编辑</button> : null}
        </div>
        <div className="customer-form-grid">
          <Field label="客户名称" required value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <label>
            <span>客户类型</span>
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <Field label="标签/备注" value={form.tag2} onChange={(tag2) => setForm({ ...form, tag2 })} />
          <Field label="税务登记号" value={form.taxRegistrationNo} onChange={(taxRegistrationNo) => setForm({ ...form, taxRegistrationNo })} />
          <Field label="开户行" value={form.bankName} onChange={(bankName) => setForm({ ...form, bankName })} />
          <Field label="银行账号" value={form.bankAccount} onChange={(bankAccount) => setForm({ ...form, bankAccount })} />
          <Field label="开票内容" value={form.invoiceContent} onChange={(invoiceContent) => setForm({ ...form, invoiceContent })} />
          <Field label="收件人" value={form.recipient} onChange={(recipient) => setForm({ ...form, recipient })} />
          <Field label="收件电话" value={form.recipientPhone} onChange={(recipientPhone) => setForm({ ...form, recipientPhone })} />
          <Field label="邮寄地址" value={form.mailingAddress} onChange={(mailingAddress) => setForm({ ...form, mailingAddress })} wide />
        </div>
        <div className="customer-form-actions">
          <button type="button" className="customer-primary-btn" onClick={savePartner}>
            {editingId ? '保存修改' : '新增客户'}
          </button>
        </div>
      </section>

      <section className="customer-list-panel">
        <div className="customer-list-head">
          <h2>客户列表</h2>
          <span>{filteredPartners.length} / {(partners || []).length} 个</span>
        </div>
        <div className="customer-table-wrap">
          <table className="customer-table">
            <thead>
              <tr>
                <th>客户名称</th>
                <th>类型</th>
                <th>税号</th>
                <th>开户行</th>
                <th>联系人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredPartners.length === 0 ? (
                <tr>
                  <td colSpan={6} className="customer-empty">暂无客户资料</td>
                </tr>
              ) : (
                filteredPartners.map((partner) => (
                  <tr key={partner.id || partner.name}>
                    <td>
                      <strong>{partner.name}</strong>
                      {partner.tag2 ? <small>{partner.tag2}</small> : null}
                    </td>
                    <td>{partner.category || '-'}</td>
                    <td>{partner.taxRegistrationNo || '-'}</td>
                    <td>{partner.bankName || '-'}</td>
                    <td>{partner.recipient || '-'}</td>
                    <td>
                      <button type="button" onClick={() => editPartner(partner)}>编辑</button>
                      <button type="button" className="danger" onClick={() => deletePartner(partner)}>删除</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </PageContainer>
  )
}

function Field({ label, value, onChange, required = false, wide = false }) {
  return (
    <label className={wide ? 'is-wide' : ''}>
      <span>{label}{required ? ' *' : ''}</span>
      <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

export default PartnerPage
