import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import Customer360Drawer from '@/components/partner/Customer360Drawer.jsx'
import { partnerKey } from '@/components/shared/PartnerPicker.jsx'
import {
  consumePartnerFocus,
  GLOBAL_SEARCH_FOCUS_EVENT
} from '@/lib/search/globalSearchFocus.ts'
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
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [customer360Id, setCustomer360Id] = useState(null)
  const [pendingGlobalFocus, setPendingGlobalFocus] = useState('')

  useEffect(() => {
    const applyFocus = (value) => {
      const normalized = String(value || '').trim()
      if (!normalized) return
      setCategory('全部')
      setQuery(normalized)
      setPendingGlobalFocus(normalized)
    }

    applyFocus(consumePartnerFocus())
    const handleGlobalFocus = (event) => {
      if (event?.detail?.kind !== 'partner') return
      applyFocus(consumePartnerFocus() || event.detail.value)
    }
    window.addEventListener(GLOBAL_SEARCH_FOCUS_EVENT, handleGlobalFocus)
    return () => window.removeEventListener(GLOBAL_SEARCH_FOCUS_EVENT, handleGlobalFocus)
  }, [])

  useEffect(() => {
    const key = partnerKey(pendingGlobalFocus)
    if (!key || !(partners || []).length) return
    const matches = (partners || []).filter((partner) =>
      [partner.name, partner.shortName].some((candidate) => partnerKey(candidate) === key)
    )
    const unique = new Map(
      matches.map((partner) => [String(partner.id || partner.name), partner])
    )
    if (unique.size !== 1) return
    const partner = [...unique.values()][0]
    setCustomer360Id(String(partner.id || ''))
    setPendingGlobalFocus('')
  }, [partners, pendingGlobalFocus])

  const filteredPartners = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (partners || [])
      .filter((partner) => {
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
      .sort((left, right) => {
        const leftKey = String(left.shortName || left.name || '').trim()
        const rightKey = String(right.shortName || right.name || '').trim()
        const primary = leftKey.localeCompare(rightKey, 'zh-CN', {
          numeric: true,
          sensitivity: 'base'
        })
        if (primary !== 0) return primary
        return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN', {
          numeric: true,
          sensitivity: 'base'
        })
      })
  }, [partners, query, category])

  const summary = useMemo(() => {
    const items = partners || []
    return {
      total: items.length,
      filtered: filteredPartners.length,
      invoiceReady: items.filter(
        (partner) => partner.taxRegistrationNo && (partner.bankAccount || partner.bankName)
      ).length,
      recipientReady: items.filter(
        (partner) => partner.recipient || partner.recipientPhone || partner.mailingAddress
      ).length
    }
  }, [filteredPartners.length, partners])

  const resetForm = () => {
    setEditingId(null)
    setForm(EMPTY_PARTNER)
    setIsFormOpen(false)
  }

  const openCreateForm = () => {
    setEditingId(null)
    setForm(EMPTY_PARTNER)
    setIsFormOpen(true)
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
    setCustomer360Id(null)
    setEditingId(partner.id)
    setForm({ ...EMPTY_PARTNER, ...partner })
    setIsFormOpen(true)
  }

  const openCustomer360 = (partner) => {
    const id = String(partner?.id || '')
    if (!id) {
      showToast('该客户缺少服务器 ID，暂时无法打开 360°', 'error')
      return
    }
    setCustomer360Id(id)
  }

  const deletePartner = async (partner) => {
    if (!window.confirm(`确定删除「${partner.name}」吗？`)) return
    const ok = await deletePartnerById(partner.id)
    if (!ok) return
    if (String(customer360Id || '') === String(partner.id || '')) setCustomer360Id(null)
    showToast('客户已删除', 'success')
  }

  const selected360Partner = useMemo(
    () => (partners || []).find((partner) => String(partner.id || '') === String(customer360Id || '')),
    [partners, customer360Id]
  )

  return (
    <PageContainer
      hideHeader
      className={`customer-library-page ${isFormOpen ? 'has-open-form' : ''}`}
    >
      <section className="customer-head">
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
        <div className="customer-head-actions">
          <span className={`customer-sync-state ${partnerApiEnabled ? '' : 'is-local'}`}>
            {partnerLoading
              ? '正在读取客户资料'
              : partnerApiEnabled
                ? '服务器资料已同步'
                : '当前使用本机缓存'}
          </span>
          <button
            type="button"
            className="customer-add-btn"
            onClick={() => {
              if (isFormOpen && !editingId) resetForm()
              else openCreateForm()
            }}
          >
            {isFormOpen && !editingId ? '收起表单' : '新增客户'}
          </button>
        </div>
      </section>

      <section className="customer-summary" aria-label="客户资料概览">
        <div>
          <span>客户总数</span>
          <strong>{summary.total}</strong>
          <small>服务器客户库</small>
        </div>
        <div>
          <span>当前结果</span>
          <strong>{summary.filtered}</strong>
          <small>{category === '全部' ? '全部类型' : category}</small>
        </div>
        <div>
          <span>开票资料完整</span>
          <strong>{summary.invoiceReady}</strong>
          <small>已录入税号及银行资料</small>
        </div>
        <div>
          <span>收件信息完整</span>
          <strong>{summary.recipientReady}</strong>
          <small>已录入联系人或地址</small>
        </div>
      </section>

      {isFormOpen ? (
        <section className="customer-form-panel">
          <div className="customer-form-head">
            <h2>{editingId ? '编辑客户' : '新增客户'}</h2>
            <button type="button" onClick={resetForm}>
              {editingId ? '取消编辑' : '关闭'}
            </button>
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
      ) : null}

      <section className="customer-list-panel">
        <div className="customer-list-head">
          <h2>客户列表</h2>
          <span>{filteredPartners.length} / {(partners || []).length} 个</span>
        </div>
        <div className="customer-table-wrap">
          <table className="customer-table">
            <thead>
              <tr>
                <th>客户简称</th>
                <th>客户名称</th>
                <th>类型</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredPartners.length === 0 ? (
                <tr>
                  <td colSpan={4} className="customer-empty">暂无客户资料</td>
                </tr>
              ) : (
                filteredPartners.map((partner) => (
                  <tr key={partner.id || partner.name}>
                    <td>
                      <button type="button" className="customer-name-link" onClick={() => openCustomer360(partner)}>
                        {partner.shortName || '-'}
                      </button>
                    </td>
                    <td>
                      <button type="button" className="customer-name-link" onClick={() => openCustomer360(partner)}>
                        {partner.name}
                      </button>
                    </td>
                    <td><span className="customer-category-tag">{partner.category || '-'}</span></td>
                    <td>
                      <button type="button" className="customer-360-btn" onClick={() => openCustomer360(partner)}>360°</button>
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

      {customer360Id ? (
        <Customer360Drawer
          partnerId={customer360Id}
          onClose={() => setCustomer360Id(null)}
          onEdit={() => {
            if (selected360Partner) editPartner(selected360Partner)
          }}
        />
      ) : null}
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
