import React, { useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import './PartnerPage.css'

const EMPTY_PARTNER = {
  name: '',
  shortName: '',
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

function PartnerPage() {
  const { settings, showToast } = useAppState()
  const {
    partners,
    partnerApiEnabled,
    partnerLoading,
    persistPartner,
    deletePartnerById
  } = settings
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_PARTNER)
  const [saving, setSaving] = useState(false)

  const filteredPartners = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (partners || []).filter((partner) => {
      const matchesCategory = category === '全部' || partner.category === category
      const searchable = [
        partner.name,
        partner.shortName,
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

  const savePartner = async () => {
    const name = form.name.trim()
    if (!name) {
      showToast('请填写客户名称', 'error')
      return
    }

    const payload = {
      ...form,
      name,
      shortName: form.shortName.trim(),
      tag2: form.tag2.trim(),
      taxRegistrationNo: form.taxRegistrationNo.trim(),
      bankName: form.bankName.trim(),
      bankAccount: form.bankAccount.trim(),
      invoiceContent: form.invoiceContent.trim(),
      recipient: form.recipient.trim(),
      recipientPhone: form.recipientPhone.trim(),
      mailingAddress: form.mailingAddress.trim()
    }

    setSaving(true)
    const ok = await persistPartner(payload, { editingId })
    setSaving(false)
    if (!ok) return
    showToast(editingId ? '客户资料已更新并保存到服务器' : '客户已加入服务器客户库', 'success')
    resetForm()
  }

  const editPartner = (partner) => {
    setEditingId(partner.id)
    setForm({ ...EMPTY_PARTNER, ...partner })
  }

  const deletePartner = async (partner) => {
    if (!window.confirm(`确定删除「${partner.name}」吗？`)) return
    const ok = await deletePartnerById(partner.id)
    if (!ok) return
    showToast('客户已删除', 'success')
  }

  return (
    <PageContainer hideHeader className="customer-library-page">
      <section className="customer-head">
        <div>
          <p>基础资料</p>
          <h1>客户库</h1>
          <span>
            {partnerLoading
              ? '正在从服务器读取客户资料…'
              : partnerApiEnabled
                ? '客户资料已由服务器统一保存，可跨设备复用。'
                : '服务器暂不可用，当前显示本机缓存。'}
          </span>
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
            placeholder="搜索名称、简称、税号、联系人"
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
          <Field label="客户简称" value={form.shortName} onChange={(shortName) => setForm({ ...form, shortName })} />
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
          <button
            type="button"
            className="customer-primary-btn"
            onClick={savePartner}
            disabled={saving || partnerLoading}
          >
            {saving ? '正在保存…' : editingId ? '保存修改' : '新增客户'}
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
                      {partner.shortName ? <small>简称：{partner.shortName}</small> : null}
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
