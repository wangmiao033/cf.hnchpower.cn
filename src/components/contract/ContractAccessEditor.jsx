import React, { useEffect, useMemo, useState } from 'react'
import {
  createContractAccessItem,
  deleteContractAccessItem,
  updateContractAccessItem
} from '@/lib/api/contract.ts'
import {
  listContractAccessTerms,
  upsertContractAccessTerms
} from '@/lib/api/contractTerms.ts'
import ContractRuleReadinessNotice from './ContractRuleReadinessNotice.jsx'
import './ContractAccessEditor.css'
import './ContractAccessListSimple.css'

const EMPTY_FORM = {
  channel_name: '',
  agreement_type: '联合运营',
  platform_record_id: '',
  product_name: '',
  app_id: '',
  platform: '全版本',
  language: '',
  category: '',
  rights_source: '授权获得',
  game_status: '',
  agreement_status: '已签约',
  authorization_start: '',
  authorization_end: '',
  share_rate: '',
  channel_fee_rate: '0',
  software_copyright_no: '',
  isbn: '',
  territory: '中国大陆（不含港澳台）',
  status: '生效',
  remarks: '',
  settlement_mode: '分成',
  settlement_basis: '后台流水',
  unit_price: '',
  currency: 'CNY',
  settlement_cycle: '自然月',
  payment_terms: '',
  invoice_tax_rate: '',
  invoice_type: '',
  refund_rule: '',
  testing_fee: '',
  server_cost_bearer: '',
  prepayment_amount: '',
  minimum_guarantee_amount: '',
  deduction_rule: ''
}

const FORM_KEYS = Object.keys(EMPTY_FORM)
const PLATFORM_OPTIONS = ['全版本', 'Android', 'iOS', 'Android / iOS', 'H5', '小游戏', 'PC', '其他']
const PLATFORM_LABELS = {
  全版本: '全版本',
  Android: '安卓',
  iOS: 'iOS',
  'Android / iOS': '安卓 / iOS',
  H5: 'H5',
  小游戏: '小游戏',
  PC: 'PC',
  其他: '其他'
}

function firstCommonValue(items, key) {
  const values = Array.from(
    new Set(
      (items || [])
        .map((entry) => String(entry?.[key] ?? '').trim())
        .filter(Boolean)
    )
  )
  return values.length === 1 ? values[0] : ''
}

function mergeEntryTerms(entry, termsById) {
  const terms = termsById?.[String(entry?.id || '')] || entry?.terms || {}
  return { ...entry, ...terms, terms }
}

function newFormForContract(contract, template = null, existingItems = []) {
  const source = template || {}
  const existing = existingItems || []
  const inherited = (key, fallback = '') => {
    const sourceValue = source[key]
    if (sourceValue !== undefined && sourceValue !== null && String(sourceValue).trim() !== '') {
      return String(sourceValue)
    }
    return firstCommonValue(existing, key) || fallback
  }

  return {
    ...EMPTY_FORM,
    channel_name: inherited('channel_name'),
    agreement_type: inherited('agreement_type', '联合运营'),
    platform: inherited('platform', '全版本'),
    authorization_start: inherited('authorization_start') || contract?.effective_date || '',
    authorization_end: inherited('authorization_end') || contract?.end_date || '',
    share_rate: inherited('share_rate'),
    channel_fee_rate: inherited('channel_fee_rate', '0'),
    rights_source: inherited('rights_source', '授权获得'),
    territory: inherited('territory', '中国大陆（不含港澳台）'),
    status: inherited('status', '生效'),
    agreement_status: inherited('agreement_status', '已签约'),
    settlement_mode: inherited('settlement_mode', '分成'),
    settlement_basis: inherited('settlement_basis', '后台流水'),
    unit_price: inherited('unit_price'),
    currency: inherited('currency', 'CNY'),
    settlement_cycle: inherited('settlement_cycle', '自然月'),
    payment_terms: inherited('payment_terms'),
    invoice_tax_rate: inherited('invoice_tax_rate'),
    invoice_type: inherited('invoice_type'),
    refund_rule: inherited('refund_rule'),
    testing_fee: inherited('testing_fee'),
    server_cost_bearer: inherited('server_cost_bearer'),
    prepayment_amount: inherited('prepayment_amount'),
    minimum_guarantee_amount: inherited('minimum_guarantee_amount'),
    deduction_rule: inherited('deduction_rule')
  }
}

function itemToForm(item, contract, termsById = {}) {
  if (!item) return newFormForContract(contract)
  const merged = mergeEntryTerms(item, termsById)
  return Object.fromEntries(
    FORM_KEYS.map((key) => {
      const value = merged[key]
      const empty = value === null || value === undefined || String(value).trim() === '' || /^(null|undefined)$/i.test(String(value).trim())
      return [key, empty ? EMPTY_FORM[key] : String(value)]
    })
  )
}

function nextFormFromSaved(saved, contract, existingItems) {
  return {
    ...newFormForContract(contract, saved, existingItems),
    product_name: '',
    app_id: '',
    platform_record_id: '',
    category: '',
    game_status: '',
    software_copyright_no: '',
    isbn: '',
    remarks: ''
  }
}

function nullable(value) {
  return String(value ?? '').trim() === '' ? null : value
}

function buildAccessPayload(form) {
  return {
    channel_name: form.channel_name,
    agreement_type: form.agreement_type,
    platform_record_id: form.platform_record_id,
    product_name: form.product_name,
    app_id: form.app_id,
    platform: form.platform,
    language: form.language,
    category: form.category,
    rights_source: form.rights_source,
    game_status: form.game_status,
    agreement_status: form.agreement_status,
    authorization_start: form.authorization_start || null,
    authorization_end: form.authorization_end || null,
    share_rate: nullable(form.share_rate),
    channel_fee_rate: nullable(form.channel_fee_rate),
    software_copyright_no: form.software_copyright_no,
    isbn: form.isbn,
    territory: form.territory,
    status: form.status,
    remarks: form.remarks
  }
}

function buildTermsPayload(form, contractId) {
  return {
    contract_id: contractId,
    settlement_mode: form.settlement_mode,
    settlement_basis: form.settlement_basis,
    unit_price: nullable(form.unit_price),
    currency: form.currency || 'CNY',
    settlement_cycle: form.settlement_cycle,
    payment_terms: form.payment_terms,
    invoice_tax_rate: nullable(form.invoice_tax_rate),
    invoice_type: form.invoice_type,
    refund_rule: form.refund_rule,
    testing_fee: nullable(form.testing_fee),
    server_cost_bearer: form.server_cost_bearer,
    prepayment_amount: nullable(form.prepayment_amount),
    minimum_guarantee_amount: nullable(form.minimum_guarantee_amount),
    deduction_rule: form.deduction_rule
  }
}

function validateForm(form) {
  const errors = {}
  if (!String(form.product_name || '').trim()) errors.product_name = '请填写合作游戏名称'
  if (!String(form.channel_name || '').trim()) errors.channel_name = '请填写合作渠道，渠道账单会用它参与匹配'
  if (!String(form.platform || '').trim()) errors.platform = '请选择版本；不区分版本时选“全版本”'
  if (!String(form.authorization_start || '').trim()) errors.authorization_start = '请选择授权开始日期'
  if (!String(form.authorization_end || '').trim()) errors.authorization_end = '请选择授权结束日期'
  if (!String(form.share_rate ?? '').trim()) errors.share_rate = '请填写我方分成比例'

  if (form.authorization_start && form.authorization_end && form.authorization_start > form.authorization_end) {
    errors.authorization_end = '授权结束日期不能早于开始日期'
  }

  const validateRate = (key, label) => {
    const raw = String(form[key] ?? '').trim()
    if (!raw) return
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      errors[key] = `${label}请输入 0–100 之间的数字`
    }
  }

  const validateMoney = (key, label) => {
    const raw = String(form[key] ?? '').trim()
    if (!raw) return
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) {
      errors[key] = `${label}请输入大于等于 0 的数字`
    }
  }

  validateRate('share_rate', '我方分成')
  validateRate('channel_fee_rate', '支付通道费率')
  validateRate('invoice_tax_rate', '发票税率')
  validateMoney('unit_price', '结算单价')
  validateMoney('testing_fee', '测试费')
  validateMoney('prepayment_amount', '预付款')
  validateMoney('minimum_guarantee_amount', '保底金额')
  return errors
}

function formatRate(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return '-'
  const number = Number(raw)
  if (!Number.isFinite(number)) return '-'
  return `${Number(number.toFixed(2))}%`
}

function counterpartyRate(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const number = Number(raw)
  if (!Number.isFinite(number)) return ''
  return String(Number(Math.max(0, 100 - number).toFixed(2)))
}

function platformLabel(value) {
  return PLATFORM_LABELS[value] || value || '全版本'
}

function ContractAccessEditor({ contract, item, onClose, onSaved, onToast }) {
  const initialItems = (() => {
    const rows = [...(contract?.access_items || [])]
    if (item?.id && !rows.some((entry) => String(entry.id) === String(item.id))) rows.push(item)
    return rows
  })()

  const [items, setItems] = useState(initialItems)
  const [termsById, setTermsById] = useState({})
  const [termsLoading, setTermsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(item?.id ? String(item.id) : '')
  const [form, setForm] = useState(() => itemToForm(item, contract))
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [errors, setErrors] = useState({})
  const [dirty, setDirty] = useState(false)
  const [changed, setChanged] = useState(false)
  const [createdCount, setCreatedCount] = useState(0)

  useEffect(() => {
    if (!contract?.id) return undefined
    let cancelled = false
    setTermsLoading(true)
    listContractAccessTerms({ contractId: String(contract.id) })
      .then((response) => {
        if (cancelled) return
        const map = Object.fromEntries(
          (response.items || []).map((entry) => [String(entry.access_item_id), entry])
        )
        setTermsById(map)
        setItems((current) => current.map((entry) => mergeEntryTerms(entry, map)))
        if (item?.id && !dirty) {
          const selected = initialItems.find((entry) => String(entry.id) === String(item.id)) || item
          setForm(itemToForm(selected, contract, map))
        }
      })
      .catch((error) => {
        console.error(error)
        onToast?.('扩展条款暂时读取失败，基础合作清单仍可正常使用', 'info')
      })
      .finally(() => {
        if (!cancelled) setTermsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contract?.id])

  const mergedItems = useMemo(
    () => items.map((entry) => mergeEntryTerms(entry, termsById)),
    [items, termsById]
  )

  const selectedItem = selectedId
    ? mergedItems.find((entry) => String(entry.id) === selectedId) || null
    : null
  const isEditing = Boolean(selectedItem)
  const otherShareRate = counterpartyRate(form.share_rate)

  const setValue = (key, value) => {
    const normalizedValue = value?.target ? value.target.value : value
    setForm((current) => ({ ...current, [key]: normalizedValue }))
    setErrors((current) => ({ ...current, [key]: '' }))
    setDirty(true)
  }

  const confirmDiscard = () => {
    if (!dirty) return true
    return window.confirm('当前清单还有未保存修改，确定放弃并切换吗？')
  }

  const selectItem = (entry) => {
    if (!confirmDiscard()) return
    setSelectedId(String(entry.id))
    setForm(itemToForm(entry, contract, termsById))
    setErrors({})
    setDirty(false)
  }

  const startNew = (template = null) => {
    if (!confirmDiscard()) return
    setSelectedId('')
    setForm(
      template
        ? nextFormFromSaved(template, contract, mergedItems)
        : newFormForContract(contract, null, mergedItems)
    )
    setErrors({})
    setDirty(false)
  }

  const finish = async () => {
    if (dirty && !window.confirm('当前填写还没有保存，确定关闭并放弃这些修改吗？')) return
    if (changed) {
      await onSaved?.()
      return
    }
    onClose?.()
  }

  const persist = async ({ continueAdding = false, closeAfter = false } = {}) => {
    if (saving) return
    const nextErrors = validateForm(form)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      onToast?.('请先补齐自动匹配必填项，再保存合作清单', 'error')
      return
    }

    setSaving(true)
    try {
      const accessPayload = buildAccessPayload(form)
      const savedAccess = isEditing
        ? await updateContractAccessItem(contract.id, selectedItem.id, accessPayload)
        : await createContractAccessItem(contract.id, accessPayload)

      let savedTerms
      try {
        savedTerms = await upsertContractAccessTerms(
          String(savedAccess.id),
          buildTermsPayload(form, String(contract.id))
        )
      } catch (termsError) {
        console.error(termsError)
        onToast?.('基础合作信息已保存，但扩展条款保存失败，请再次保存重试', 'error')
        setSelectedId(String(savedAccess.id))
        setItems((current) => {
          const exists = current.some((entry) => String(entry.id) === String(savedAccess.id))
          return exists
            ? current.map((entry) => (String(entry.id) === String(savedAccess.id) ? savedAccess : entry))
            : [...current, savedAccess]
        })
        setDirty(true)
        return
      }

      const saved = { ...savedAccess, ...savedTerms, terms: savedTerms }
      setTermsById((current) => ({ ...current, [String(saved.id)]: savedTerms }))
      setItems((current) => {
        const exists = current.some((entry) => String(entry.id) === String(saved.id))
        if (exists) {
          return current.map((entry) => (String(entry.id) === String(saved.id) ? saved : entry))
        }
        return [...current, saved]
      })
      setChanged(true)
      setDirty(false)
      setErrors({})
      if (!isEditing) setCreatedCount((count) => count + 1)

      onToast?.(
        isEditing ? `「${saved.product_name}」合作信息已更新` : `已新增「${saved.product_name}」`,
        'success'
      )

      if (closeAfter) {
        await onSaved?.(saved)
        return
      }

      if (continueAdding && !isEditing) {
        setSelectedId('')
        setForm(nextFormFromSaved(saved, contract, [...mergedItems, saved]))
        return
      }

      setSelectedId(String(saved.id))
      setForm(itemToForm(saved, contract, { ...termsById, [String(saved.id)]: savedTerms }))
    } catch (error) {
      console.error(error)
      onToast?.(error?.message || '合同合作清单保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeItem = async (entry) => {
    if (!entry?.id || deletingId) return
    if (!window.confirm(`确定删除「${entry.product_name || '未命名'}」这条合作清单吗？`)) return
    setDeletingId(String(entry.id))
    try {
      await deleteContractAccessItem(contract.id, entry.id)
      const remaining = items.filter((row) => String(row.id) !== String(entry.id))
      setItems(remaining)
      setTermsById((current) => {
        const next = { ...current }
        delete next[String(entry.id)]
        return next
      })
      setChanged(true)
      if (String(entry.id) === selectedId) {
        setSelectedId('')
        setForm(newFormForContract({ ...contract, access_items: remaining }, null, remaining))
        setDirty(false)
        setErrors({})
      }
      onToast?.('合作清单已删除', 'success')
    } catch (error) {
      console.error(error)
      onToast?.(error?.message || '合作清单删除失败', 'error')
    } finally {
      setDeletingId('')
    }
  }

  const handleShortcut = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void persist()
    }
  }

  return (
    <div className="contract-editor-mask contract-access-workbench-mask" onClick={() => void finish()}>
      <div
        className="contract-editor contract-access-workbench"
        role="dialog"
        aria-modal="true"
        aria-label="合同合作清单"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="contract-access-workbench__head">
          <div className="contract-access-workbench__title">
            <div>
              <h3>合作清单</h3>
              <p>{contract?.contract_name || '未命名合同'}</p>
            </div>
          </div>
          <div className="contract-access-workbench__head-actions">
            <span className="contract-access-workbench__count">共 {items.length} 条</span>
            {createdCount ? <span className="contract-access-workbench__created">本次新增 {createdCount}</span> : null}
            <button type="button" onClick={() => void finish()} disabled={saving}>关闭</button>
          </div>
        </header>

        <div className="contract-access-workbench__body">
          <aside className="contract-access-workbench__sidebar">
            <button type="button" className="contract-access-new-btn" onClick={() => startNew()}>
              ＋ 添加合作游戏
            </button>

            <div className="contract-access-side-title">
              <span>已录入</span>
              <small>{termsLoading ? '读取中…' : '点击即可编辑'}</small>
            </div>

            <div className="contract-access-side-list">
              {mergedItems.length ? mergedItems.map((entry, index) => {
                const active = String(entry.id) === selectedId
                return (
                  <div className={`contract-access-side-item ${active ? 'is-active' : ''}`} key={entry.id}>
                    <button type="button" className="contract-access-side-main" onClick={() => selectItem(entry)}>
                      <span className="contract-access-side-index">{index + 1}</span>
                      <span className="contract-access-side-copy">
                        <strong>{entry.product_name || '未命名游戏'}</strong>
                        <small>{entry.channel_name || '未填写渠道'} · {platformLabel(entry.platform)}</small>
                        <em>{formatRate(entry.share_rate) === '-' ? '分成未填' : `我方 ${formatRate(entry.share_rate)}`}</em>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="contract-access-side-delete"
                      title="删除"
                      disabled={deletingId === String(entry.id)}
                      onClick={() => void removeItem(entry)}
                    >
                      {deletingId === String(entry.id) ? '…' : '×'}
                    </button>
                  </div>
                )
              }) : (
                <div className="contract-access-side-empty">
                  <strong>还没有合作游戏</strong>
                  <span>点击上方按钮录入第一条。</span>
                </div>
              )}
            </div>
          </aside>

          <form
            className="contract-access-workbench__form"
            onSubmit={(event) => {
              event.preventDefault()
              void persist()
            }}
            onKeyDown={handleShortcut}
          >
            <div className="contract-access-workbench__scroll">
              <section className="contract-access-simple-card">
                <div className="contract-access-simple-card__head">
                  <div>
                    <span>{isEditing ? '编辑合作游戏' : '新增合作游戏'}</span>
                    <h4>{isEditing ? selectedItem.product_name || '未命名游戏' : '先把自动匹配关键字段填完整'}</h4>
                  </div>
                  <small>＊为渠道账单自动匹配必填；通道费默认 0，版本不区分时选“全版本”</small>
                </div>

                <ContractRuleReadinessNotice form={form} contract={contract} />

                <div className="contract-access-simple-grid">
                  <Field
                    label="合作游戏"
                    required
                    wide
                    autoFocus={!isEditing}
                    value={form.product_name}
                    error={errors.product_name}
                    onChange={(value) => setValue('product_name', value)}
                    placeholder="例如：一起来修仙005折"
                  />
                  <Field
                    label="合作渠道"
                    required
                    value={form.channel_name}
                    error={errors.channel_name}
                    onChange={(value) => setValue('channel_name', value)}
                    placeholder="例如：3011 / 朋克 / 九一玩"
                  />
                  <SelectField
                    label="版本"
                    required
                    value={form.platform}
                    error={errors.platform}
                    onChange={(value) => setValue('platform', value)}
                    options={PLATFORM_OPTIONS}
                    optionLabels={PLATFORM_LABELS}
                  />
                  <Field
                    label="授权开始"
                    required
                    type="date"
                    value={form.authorization_start}
                    error={errors.authorization_start}
                    onChange={(value) => setValue('authorization_start', value)}
                  />
                  <Field
                    label="授权结束"
                    required
                    type="date"
                    value={form.authorization_end}
                    error={errors.authorization_end}
                    onChange={(value) => setValue('authorization_end', value)}
                  />
                  <Field
                    label="支付通道费率（%）"
                    inputMode="decimal"
                    value={form.channel_fee_rate}
                    error={errors.channel_fee_rate}
                    onChange={(value) => setValue('channel_fee_rate', value)}
                    placeholder="没有通道费填 0"
                  />
                  <Field
                    label="我方分成（%）"
                    required
                    inputMode="decimal"
                    value={form.share_rate}
                    error={errors.share_rate}
                    onChange={(value) => setValue('share_rate', value)}
                    placeholder="例如：77"
                  />
                  <Field
                    label="对方分成（自动）"
                    value={otherShareRate}
                    readOnly
                    placeholder="根据我方分成自动计算"
                  />
                  <SelectField
                    label="状态"
                    value={form.status}
                    onChange={(value) => setValue('status', value)}
                    options={['生效', '待生效', '已终止']}
                  />
                  <TextareaField
                    label="备注"
                    wide
                    value={form.remarks}
                    onChange={(value) => setValue('remarks', value)}
                    placeholder="只写特殊约定；没有可留空。"
                  />
                </div>
              </section>

              <details className="contract-access-more">
                <summary>
                  <span>
                    <strong>更多结算条款（可选）</strong>
                    <small>默认按“分成 + 后台流水 + 自然月”处理；CPA、账期、发票等需要时再展开</small>
                  </span>
                  <em>展开</em>
                </summary>
                <div className="contract-access-more-grid">
                  <SelectField label="合作模式" value={form.agreement_type} onChange={(value) => setValue('agreement_type', value)} options={['联合运营', '联运SDK', '广告投放', '小游戏广告', '发行代理', '授权', '其他']} />
                  <SelectField label="结算方式" value={form.settlement_mode} onChange={(value) => setValue('settlement_mode', value)} options={['', '分成', 'CPA', 'CPS', 'CPI', '固定金额', '混合', '其他']} />
                  <Field label="计费口径" value={form.settlement_basis} onChange={(value) => setValue('settlement_basis', value)} placeholder="例如：实付流水、注册、激活" />
                  <Field label="结算单价" inputMode="decimal" value={form.unit_price} error={errors.unit_price} onChange={(value) => setValue('unit_price', value)} />
                  <SelectField label="币种" value={form.currency} onChange={(value) => setValue('currency', value)} options={['CNY', 'USD', 'SGD', 'HKD', 'EUR', 'JPY', 'KRW', '其他']} />
                  <SelectField label="结算周期" value={form.settlement_cycle} onChange={(value) => setValue('settlement_cycle', value)} options={['', '自然月', '月结', '周结', '季度', '按项目', '其他']} />
                  <Field label="账期 / 回款周期" value={form.payment_terms} onChange={(value) => setValue('payment_terms', value)} placeholder="例如：T+30" />
                  <Field label="发票税率（%）" inputMode="decimal" value={form.invoice_tax_rate} error={errors.invoice_tax_rate} onChange={(value) => setValue('invoice_tax_rate', value)} />
                  <SelectField label="发票类型" value={form.invoice_type} onChange={(value) => setValue('invoice_type', value)} options={['', '增值税专用发票', '增值税普通发票', '不开票', '其他']} />
                  <Field label="测试费" inputMode="decimal" value={form.testing_fee} error={errors.testing_fee} onChange={(value) => setValue('testing_fee', value)} />
                  <SelectField label="服务器成本承担" value={form.server_cost_bearer} onChange={(value) => setValue('server_cost_bearer', value)} options={['', '我方承担', '对方承担', '双方分摊', '按项目约定', '其他']} />
                  <Field label="预付款（抵扣研发结算）" inputMode="decimal" min="0" value={form.prepayment_amount} error={errors.prepayment_amount} onChange={(value) => setValue('prepayment_amount', value)} placeholder="不适用则留空" />
                  <Field label="保底 / 最低保证" inputMode="decimal" value={form.minimum_guarantee_amount} error={errors.minimum_guarantee_amount} onChange={(value) => setValue('minimum_guarantee_amount', value)} />
                  <TextareaField label="退款 / 退费规则" wide value={form.refund_rule} onChange={(value) => setValue('refund_rule', value)} />
                  <TextareaField label="其他扣除规则" wide value={form.deduction_rule} onChange={(value) => setValue('deduction_rule', value)} />
                </div>
              </details>

              <details className="contract-access-more contract-access-more--secondary">
                <summary>
                  <span>
                    <strong>应用与资质（可选）</strong>
                    <small>App ID、软著、ISBN、区域等资料，不需要可以不填</small>
                  </span>
                  <em>展开</em>
                </summary>
                <div className="contract-access-more-grid">
                  <Field label="应用 ID / App ID" value={form.app_id} onChange={(value) => setValue('app_id', value)} />
                  <Field label="平台记录 ID" value={form.platform_record_id} onChange={(value) => setValue('platform_record_id', value)} />
                  <Field label="接入分类" value={form.category} onChange={(value) => setValue('category', value)} />
                  <Field label="语言" value={form.language} onChange={(value) => setValue('language', value)} />
                  <Field label="权限来源" value={form.rights_source} onChange={(value) => setValue('rights_source', value)} />
                  <SelectField label="游戏状态" value={form.game_status} onChange={(value) => setValue('game_status', value)} options={['', '上架', '下架', '测试', '未上线']} />
                  <Field label="协议状态" value={form.agreement_status} onChange={(value) => setValue('agreement_status', value)} />
                  <Field label="软件著作权登记号" value={form.software_copyright_no} onChange={(value) => setValue('software_copyright_no', value)} />
                  <Field label="ISBN / 版号" value={form.isbn} onChange={(value) => setValue('isbn', value)} />
                  <Field label="授权区域" wide value={form.territory} onChange={(value) => setValue('territory', value)} />
                </div>
              </details>
            </div>

            <footer className="contract-access-workbench__footer">
              <div>
                <strong>{isEditing ? `编辑：${selectedItem.product_name || '未命名'}` : '新增合作游戏'}</strong>
                <span>{dirty ? '有未保存修改' : changed ? '已保存到服务器' : '尚未修改'}</span>
              </div>
              <div className="contract-access-workbench__footer-actions">
                <button type="button" className="contract-access-done-btn" onClick={() => void finish()} disabled={saving}>完成</button>
                {!isEditing ? (
                  <button type="button" className="contract-access-next-btn" onClick={() => void persist({ continueAdding: true })} disabled={saving}>
                    {saving ? '保存中…' : '保存并新增下一条'}
                  </button>
                ) : null}
                <button type="button" className="contract-access-save-btn" onClick={() => void persist()} disabled={saving}>
                  {saving ? '保存中…' : isEditing ? '保存修改' : '保存当前'}
                </button>
                <button type="button" className="contract-access-save-close-btn" onClick={() => void persist({ closeAfter: true })} disabled={saving}>
                  {saving ? '保存中…' : '保存并关闭'}
                </button>
              </div>
            </footer>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, wide, error, onChange, readOnly, ...props }) {
  return (
    <label className={`contract-access-field ${wide ? 'is-wide' : ''} ${error ? 'has-error' : ''} ${readOnly ? 'is-readonly' : ''}`}>
      <span>{label}{required ? ' *' : ''}</span>
      <input
        required={required}
        readOnly={readOnly}
        {...props}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {error ? <small>{error}</small> : null}
    </label>
  )
}

function TextareaField({ label, wide, value, onChange, placeholder }) {
  return (
    <label className={`contract-access-field ${wide ? 'is-wide' : ''}`}>
      <span>{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
        rows={3}
      />
    </label>
  )
}

function SelectField({ label, options, value, onChange, optionLabels, required, error }) {
  return (
    <label className={`contract-access-field ${error ? 'has-error' : ''}`}>
      <span>{label}{required ? ' *' : ''}</span>
      <select required={required} value={value} onChange={(event) => onChange?.(event.target.value)}>
        {options.map((option) => (
          <option key={option || 'empty'} value={option}>{optionLabels?.[option] || option || '未设置'}</option>
        ))}
      </select>
      {error ? <small>{error}</small> : null}
    </label>
  )
}

export default ContractAccessEditor