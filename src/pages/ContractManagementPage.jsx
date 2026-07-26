import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import {
  createContract,
  deleteContract,
  importContracts,
  listContracts,
  relinkContracts,
  updateContract
} from '@/lib/api/contract.ts'
import ContractStatusTag from '@/components/contract/ContractStatusTag.jsx'
import ContractDetailsDrawer from '@/components/contract/ContractDetailsDrawer.jsx'
import './contract-management.css'

const PAGE_SIZE_OPTIONS = [20, 50, 100]
const QUICK_TABS = ['全部', '生效中', '即将到期', '已过期', '未关联客户', '编号重复']
const EMPTY_SUMMARY = {
  total: 0,
  linked: 0,
  expiring_30: 0,
  expired: 0,
  amount_total: '0'
}
const EMPTY_FORM = {
  contract_name: '',
  contract_type: '无固定总价合同',
  amount: '',
  counterparty: '',
  contract_no: '',
  signing_date: '',
  signing_status: '',
  effective_date: '',
  end_date: '',
  performance_status: '',
  payment_type: '',
  attachments: ''
}

function formatAmount(value) {
  if (value === null || value === undefined || value === '') return '-'
  return `¥ ${Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function parseCsv(source) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  const text = String(source || '').replace(/^\uFEFF/, '')

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        value += char
      }
      continue
    }

    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(value)
      value = ''
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''))
      rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }

  if (value || row.length) {
    row.push(value.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => String(cell).trim()))
}

function wpsRowsToPayload(rows) {
  if (rows.length < 2) return []
  const headers = rows[0].map((header) => String(header).trim())
  const required = ['合同名称', '合同类型', '合同签约方', '终止日期']
  const missing = required.filter((header) => !headers.includes(header))
  if (missing.length) {
    throw new Error(`缺少 WPS 字段：${missing.join('、')}`)
  }

  return rows.slice(1).map((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))
    return {
      contract_name: record['合同名称'],
      contract_type: record['合同类型'],
      amount: record['合同总额'] || null,
      counterparty: record['合同签约方'],
      contract_no: record['合同编号'],
      signing_date: record['签订日期'] || null,
      signing_status: record['签订状态'],
      effective_date: record['生效日期'] || null,
      end_date: record['终止日期'] || null,
      performance_status: record['履约状态'],
      payment_type: record['账款类型'],
      attachments: String(record['合同附件'] || '')
        .split(/[;；\n]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    }
  })
}

function contractToForm(contract) {
  return {
    contract_name: contract.contract_name || '',
    contract_type: contract.contract_type || '',
    amount: contract.amount || '',
    counterparty: contract.counterparty || '',
    contract_no: contract.contract_no || '',
    signing_date: contract.signing_date || '',
    signing_status: contract.signing_status || '',
    effective_date: contract.effective_date || '',
    end_date: contract.end_date || '',
    performance_status: contract.performance_status || '',
    payment_type: contract.payment_type || '',
    attachments: (contract.attachments || []).join('；')
  }
}

function formToPayload(form) {
  return {
    ...form,
    amount: form.amount || null,
    signing_date: form.signing_date || null,
    effective_date: form.effective_date || null,
    end_date: form.end_date || null,
    attachments: String(form.attachments || '')
      .split(/[;；\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
}

function exportCsv(records) {
  const headers = [
    '合同名称',
    '合同类型',
    '合同总额',
    '合同签约方',
    '合同编号',
    '签订日期',
    '签订状态',
    '生效日期',
    '终止日期',
    '履约状态',
    '账款类型',
    '合同附件'
  ]
  const lines = records.map((record) =>
    [
      record.contract_name,
      record.contract_type,
      record.amount,
      record.counterparty,
      record.contract_no,
      record.signing_date,
      record.signing_status,
      record.effective_date,
      record.end_date,
      record.performance_status,
      record.payment_type,
      (record.attachments || []).join('；')
    ]
      .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
      .join(',')
  )
  const blob = new Blob([`\uFEFF${[headers.join(','), ...lines].join('\n')}`], {
    type: 'text/csv;charset=utf-8'
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `合同台账_${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

function ContractManagementPage() {
  const { showToast } = useAppState()
  const fileInputRef = useRef(null)
  const [records, setRecords] = useState([])
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [quickTab, setQuickTab] = useState('全部')
  const [contractType, setContractType] = useState('全部')
  const [paymentType, setPaymentType] = useState('全部')
  const [pageSize, setPageSize] = useState(100)
  const [page, setPage] = useState(1)
  const [selectedContract, setSelectedContract] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const loadContracts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await listContracts({ limit: 1000, offset: 0 })
      setRecords(Array.isArray(response.items) ? response.items : [])
      setSummary(response.summary || EMPTY_SUMMARY)
    } catch (loadError) {
      console.error(loadError)
      setError('合同数据暂时无法读取，请检查网络后重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadContracts()
  }, [loadContracts])

  const filterOptions = useMemo(() => {
    const types = new Set()
    const paymentTypes = new Set()
    records.forEach((record) => {
      if (record.contract_type) types.add(record.contract_type)
      if (record.payment_type) paymentTypes.add(record.payment_type)
    })
    return {
      types: ['全部', ...Array.from(types).sort((left, right) => left.localeCompare(right, 'zh-CN'))],
      paymentTypes: [
        '全部',
        ...Array.from(paymentTypes).sort((left, right) => left.localeCompare(right, 'zh-CN'))
      ]
    }
  }, [records])

  const filteredRecords = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    return records.filter((record) => {
      if (quickTab === '未关联客户' && record.partner_link_status !== 'unlinked') return false
      if (quickTab === '编号重复' && !record.contract_no_duplicate) return false
      if (
        !['全部', '未关联客户', '编号重复'].includes(quickTab) &&
        record.timeline_status !== quickTab
      ) {
        return false
      }
      if (contractType !== '全部' && record.contract_type !== contractType) return false
      if (paymentType !== '全部' && record.payment_type !== paymentType) return false
      if (!term) return true
      return [
        record.contract_name,
        record.contract_type,
        record.counterparty,
        record.contract_no,
        record.partner_name,
        record.partner_short_name,
        ...(record.attachments || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [contractType, keyword, paymentType, quickTab, records])

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize))
  const pagedRecords = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredRecords.slice(start, start + pageSize)
  }, [filteredRecords, page, pageSize])
  const rangeStart = filteredRecords.length ? (page - 1) * pageSize + 1 : 0
  const rangeEnd = Math.min(page * pageSize, filteredRecords.length)

  useEffect(() => {
    setPage(1)
  }, [contractType, keyword, pageSize, paymentType, quickTab])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const rows = parseCsv(await file.text())
      const items = wpsRowsToPayload(rows)
      if (!items.length) throw new Error('文件中没有可导入的合同')
      const result = await importContracts(items)
      showToast(
        `WPS 台账已同步：新增 ${result.created} 条，更新 ${result.updated} 条，已关联客户 ${result.linked} 条`,
        'success'
      )
      if (result.duplicate_contract_numbers?.length) {
        showToast(
          `发现 ${result.duplicate_contract_numbers.length} 组重复合同编号，已保留并标记待核验`,
          'info'
        )
      }
      await loadContracts()
    } catch (importError) {
      console.error(importError)
      showToast(importError?.message || 'WPS 台账导入失败', 'error')
    } finally {
      setImporting(false)
      event.target.value = ''
    }
  }

  const openCreateForm = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const openEditForm = (contract) => {
    setEditingId(contract.id)
    setForm(contractToForm(contract))
  }

  const closeEditor = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const saveContract = async (event) => {
    event.preventDefault()
    if (!form.contract_name.trim()) {
      showToast('请填写合同名称', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = formToPayload(form)
      if (editingId === 'new') {
        await createContract(payload)
        showToast('合同已新增并保存到服务器', 'success')
      } else {
        await updateContract(editingId, payload)
        showToast('合同资料已更新', 'success')
      }
      closeEditor()
      setSelectedContract(null)
      await loadContracts()
    } catch (saveError) {
      console.error(saveError)
      showToast(saveError?.message || '合同保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeContract = async (contract) => {
    if (!window.confirm(`确定删除合同「${contract.contract_name}」吗？`)) return
    try {
      await deleteContract(contract.id)
      showToast('合同已删除', 'success')
      await loadContracts()
    } catch (deleteError) {
      console.error(deleteError)
      showToast('合同删除失败', 'error')
    }
  }

  const relinkCustomers = async () => {
    try {
      const result = await relinkContracts()
      showToast(
        result.updated
          ? `已重新关联 ${result.updated} 条合同，当前共 ${result.linked} 条已关联`
          : `客户关联已是最新，共 ${result.linked} 条`,
        'success'
      )
      await loadContracts()
    } catch (relinkError) {
      console.error(relinkError)
      showToast('重新关联客户失败', 'error')
    }
  }

  const handleAttachmentUploaded = (updatedContract) => {
    setSelectedContract(updatedContract)
    setRecords((items) =>
      items.map((item) => (item.id === updatedContract.id ? updatedContract : item))
    )
  }

  return (
    <PageContainer hideHeader className="contract-page">
      <section className="contract-hero">
        <div className="contract-hero__copy">
          <p>合同中心</p>
          <h1>合同台账</h1>
          <span>统一维护 WPS 合同、签约方、金额、有效期和附件信息，数据保存于服务器。</span>
        </div>
        <div className="contract-hero__status">
          <span className="contract-sync-dot" aria-hidden="true" />
          <div>
            <strong>WPS 台账已接入</strong>
            <small>{summary.total ? `服务器现有 ${summary.total} 份合同` : '等待首次同步'}</small>
          </div>
        </div>
        <div className="contract-toolbar__actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleImportFile}
            hidden
          />
          <button
            type="button"
            className="btn-primary"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? '正在同步…' : '导入 WPS 台账'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => exportCsv(filteredRecords)}>
            导出当前结果
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              openCreateForm()
              setEditingId('new')
            }}
          >
            新增合同
          </button>
        </div>
      </section>

      <section className="contract-stats" aria-label="合同概览">
        <article className="is-blue">
          <span>合同总数</span>
          <strong>{summary.total}</strong>
          <small>当前服务器台账</small>
        </article>
        <article className="is-green">
          <span>已关联客户</span>
          <strong>{summary.linked}</strong>
          <small>共 {Math.max(summary.total - summary.linked, 0)} 条待补充关联</small>
        </article>
        <article className="is-amber">
          <span>30 天内到期</span>
          <strong>{summary.expiring_30}</strong>
          <small>已过期 {summary.expired} 条</small>
        </article>
        <article className="is-violet">
          <span>合同金额合计</span>
          <strong>{formatAmount(summary.amount_total)}</strong>
          <small>按已填写金额统计</small>
        </article>
      </section>

      <section className="contract-filter-card">
        <div className="contract-filter-main">
          <label className="contract-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索合同名称、签约方、客户简称、合同编号或附件"
            />
          </label>
          <select value={contractType} onChange={(event) => setContractType(event.target.value)}>
            {filterOptions.types.map((item) => (
              <option key={item} value={item}>{item === '全部' ? '全部合同类型' : item}</option>
            ))}
          </select>
          <select value={paymentType} onChange={(event) => setPaymentType(event.target.value)}>
            {filterOptions.paymentTypes.map((item) => (
              <option key={item} value={item}>{item === '全部' ? '全部账款类型' : item}</option>
            ))}
          </select>
          <button type="button" className="btn-reset" onClick={relinkCustomers}>刷新客户关联</button>
        </div>
        <div className="contract-quick-tabs" role="tablist" aria-label="合同状态筛选">
          {QUICK_TABS.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={quickTab === tab}
              key={tab}
              className={quickTab === tab ? 'active' : ''}
              onClick={() => setQuickTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
      </section>

      <section className="contract-table-card">
        <div className="contract-table-head">
          <div>
            <h2>合同列表</h2>
            <span>显示 {filteredRecords.length} / {records.length} 条</span>
          </div>
          <p>
            当前展示第 {rangeStart}–{rangeEnd} 条 · 点击合同查看详情和附件
          </p>
        </div>

        {loading ? (
          <div className="contract-loading" aria-label="正在加载合同">
            <div className="contract-loading__bar" />
            {Array.from({ length: 6 }, (_, index) => (
              <div className="contract-loading__row" key={index}>
                <span /><span /><span /><span /><span />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="contract-error-state">
            <strong>合同数据没有加载成功</strong>
            <p>{error}</p>
            <button type="button" className="btn-primary" onClick={loadContracts}>重新加载</button>
          </div>
        ) : (
          <>
            <div className="contract-table-wrap">
              <table className="contract-table">
                <thead>
                  <tr>
                    <th className="contract-index-col">序号</th>
                    <th>合同名称</th>
                    <th>签约方 / 客户</th>
                    <th>合同类型</th>
                    <th className="is-number">合同总额</th>
                    <th>有效期</th>
                    <th>状态</th>
                    <th>账款</th>
                    <th>附件</th>
                    <th className="col-sticky-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRecords.map((contract, index) => (
                    <tr key={contract.id} onClick={() => setSelectedContract(contract)}>
                      <td className="contract-index-col">
                        {(page - 1) * pageSize + index + 1}
                      </td>
                      <td className="contract-name-cell">
                        <strong title={contract.contract_name}>{contract.contract_name}</strong>
                        <span>{contract.contract_no || '未填写合同编号'}</span>
                        {contract.contract_no_duplicate ? (
                          <em>编号重复待核验</em>
                        ) : null}
                      </td>
                      <td className="contract-party-cell">
                        {contract.partner_link_status === 'linked' ? (
                          <span className="contract-party-avatar">
                            {(contract.partner_short_name || contract.counterparty || '客').slice(0, 1)}
                          </span>
                        ) : (
                          <span className="contract-party-avatar is-unlinked">?</span>
                        )}
                        <span>
                          <strong>
                            {contract.partner_short_name || contract.counterparty || '未填写签约方'}
                          </strong>
                          <small title={contract.counterparty}>
                            {contract.counterparty || '未关联客户库'}
                          </small>
                        </span>
                      </td>
                      <td><span className="contract-type-badge">{contract.contract_type || '-'}</span></td>
                      <td className="is-number contract-amount">{formatAmount(contract.amount)}</td>
                      <td className="contract-date-cell">
                        <strong>{contract.effective_date || '-'}</strong>
                        <span>至 {contract.end_date || '-'}</span>
                      </td>
                      <td className="contract-status-cell">
                        <ContractStatusTag status={contract.timeline_status} />
                        <small>
                          {[contract.signing_status, contract.performance_status].filter(Boolean).join(' · ') || '状态未填写'}
                        </small>
                      </td>
                      <td>
                        <span className={`contract-payment-tag is-${contract.payment_type || 'empty'}`}>
                          {contract.payment_type || '-'}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`contract-attachment-count ${
                            contract.attachment_files?.length ? 'has-files' : ''
                          }`}
                          title={`已导入 ${contract.attachment_files?.length || 0} 个真实文件`}
                        >
                          {contract.attachment_files?.length || 0}
                          <small>/</small>
                          {contract.attachments?.length || 0}
                        </span>
                      </td>
                      <td className="col-sticky-right" onClick={(event) => event.stopPropagation()}>
                        <div className="contract-row-actions">
                          <button type="button" onClick={() => setSelectedContract(contract)}>查看</button>
                          <button type="button" onClick={() => openEditForm(contract)}>编辑</button>
                          <button type="button" className="danger" onClick={() => removeContract(contract)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!pagedRecords.length ? (
                    <tr>
                      <td colSpan={10} className="contract-empty">
                        没有找到符合条件的合同
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="contract-pagination">
              <span>
                第 {rangeStart}–{rangeEnd} 条，共 {filteredRecords.length} 条
              </span>
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size} 条/页</option>
                ))}
              </select>
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                上一页
              </button>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </button>
            </div>
          </>
        )}
      </section>

      {editingId ? (
        <div className="contract-editor-mask" onClick={closeEditor}>
          <form className="contract-editor" onSubmit={saveContract} onClick={(event) => event.stopPropagation()}>
            <div className="contract-editor-head">
              <div>
                <p>{editingId === 'new' ? '新增合同' : '编辑合同'}</p>
                <h3>{editingId === 'new' ? '录入合同资料' : form.contract_name}</h3>
              </div>
              <button type="button" onClick={closeEditor}>关闭</button>
            </div>
            <div className="contract-form-grid">
              <Field label="合同名称" required value={form.contract_name} onChange={(value) => setForm({ ...form, contract_name: value })} wide />
              <Field label="合同编号" value={form.contract_no} onChange={(value) => setForm({ ...form, contract_no: value })} />
              <Field label="合同类型" value={form.contract_type} onChange={(value) => setForm({ ...form, contract_type: value })} />
              <Field label="合同总额" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} inputMode="decimal" />
              <Field label="合同签约方" value={form.counterparty} onChange={(value) => setForm({ ...form, counterparty: value })} wide />
              <Field label="签订日期" type="date" value={form.signing_date} onChange={(value) => setForm({ ...form, signing_date: value })} />
              <Field label="生效日期" type="date" value={form.effective_date} onChange={(value) => setForm({ ...form, effective_date: value })} />
              <Field label="终止日期" type="date" value={form.end_date} onChange={(value) => setForm({ ...form, end_date: value })} />
              <SelectField label="签订状态" value={form.signing_status} options={['', '签约中', '已签约']} onChange={(value) => setForm({ ...form, signing_status: value })} />
              <SelectField label="履约状态" value={form.performance_status} options={['', '履约中', '已履约']} onChange={(value) => setForm({ ...form, performance_status: value })} />
              <SelectField label="账款类型" value={form.payment_type} options={['', '收款', '付款']} onChange={(value) => setForm({ ...form, payment_type: value })} />
              <Field label="合同附件名称" value={form.attachments} onChange={(value) => setForm({ ...form, attachments: value })} placeholder="多个附件用分号分隔" wide />
            </div>
            <div className="contract-form-actions">
              <button type="button" className="contract-cancel-btn" onClick={closeEditor}>取消</button>
              <button type="submit" className="contract-save-btn" disabled={saving}>
                {saving ? '正在保存…' : '保存合同'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ContractDetailsDrawer
        contract={selectedContract}
        onClose={() => setSelectedContract(null)}
        onEdit={(contract) => {
          setSelectedContract(null)
          openEditForm(contract)
        }}
        onAttachmentUploaded={handleAttachmentUploaded}
        onToast={showToast}
      />
    </PageContainer>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  wide = false,
  inputMode,
  placeholder
}) {
  return (
    <label className={wide ? 'is-wide' : ''}>
      <span>{label}{required ? ' *' : ''}</span>
      <input
        type={type}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option || 'empty'} value={option}>{option || '未填写'}</option>
        ))}
      </select>
    </label>
  )
}

export default ContractManagementPage
