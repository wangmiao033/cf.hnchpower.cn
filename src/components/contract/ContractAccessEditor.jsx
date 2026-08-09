import React, { useState } from 'react'
import {
  createContractAccessItem,
  deleteContractAccessItem,
  updateContractAccessItem
} from '@/lib/api/contract.ts'
import './ContractAccessEditor.css'

const EMPTY_FORM = {
  channel_name: '',
  agreement_type: '联合运营',
  platform_record_id: '',
  product_name: '',
  app_id: '',
  platform: '',
  language: '',
  category: '',
  rights_source: '授权获得',
  game_status: '',
  agreement_status: '已签约',
  authorization_start: '',
  authorization_end: '',
  share_rate: '',
  channel_fee_rate: '',
  software_copyright_no: '',
  isbn: '',
  territory: '中国大陆（不含港澳台）',
  status: '生效',
  remarks: ''
}

const FORM_KEYS = Object.keys(EMPTY_FORM)

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

function newFormForContract(contract, template = null) {
  const existing = contract?.access_items || []
  const source = template || {}
  return {
    ...EMPTY_FORM,
    channel_name:
      String(source.channel_name || '').trim() || firstCommonValue(existing, 'channel_name'),
    agreement_type:
      String(source.agreement_type || '').trim() || firstCommonValue(existing, 'agreement_type') || '联合运营',
    platform:
      String(source.platform || '').trim() || firstCommonValue(existing, 'platform'),
    authorization_start:
      String(source.authorization_start || '').trim() ||
      firstCommonValue(existing, 'authorization_start') ||
      contract?.effective_date ||
      '',
    authorization_end:
      String(source.authorization_end || '').trim() ||
      firstCommonValue(existing, 'authorization_end') ||
      contract?.end_date ||
      '',
    share_rate:
      source.share_rate !== undefined && source.share_rate !== null
        ? String(source.share_rate)
        : firstCommonValue(existing, 'share_rate'),
    channel_fee_rate:
      source.channel_fee_rate !== undefined && source.channel_fee_rate !== null
        ? String(source.channel_fee_rate)
        : firstCommonValue(existing, 'channel_fee_rate'),
    rights_source:
      String(source.rights_source || '').trim() || firstCommonValue(existing, 'rights_source') || '授权获得',
    territory:
      String(source.territory || '').trim() ||
      firstCommonValue(existing, 'territory') ||
      '中国大陆（不含港澳台）',
    status:
      String(source.status || '').trim() || firstCommonValue(existing, 'status') || '生效',
    agreement_status:
      String(source.agreement_status || '').trim() ||
      firstCommonValue(existing, 'agreement_status') ||
      '已签约'
  }
}

function itemToForm(item, contract) {
  if (!item) return newFormForContract(contract)
  return Object.fromEntries(
    FORM_KEYS.map((key) => [
      key,
      item[key] === null || item[key] === undefined ? EMPTY_FORM[key] : String(item[key])
    ])
  )
}

function nextFormFromSaved(saved, contract) {
  return {
    ...newFormForContract(contract, saved),
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

function buildPayload(form) {
  return {
    ...form,
    authorization_start: form.authorization_start || null,
    authorization_end: form.authorization_end || null,
    share_rate: String(form.share_rate ?? '').trim() === '' ? null : form.share_rate,
    channel_fee_rate:
      String(form.channel_fee_rate ?? '').trim() === '' ? null : form.channel_fee_rate
  }
}

function validateForm(form) {
  const errors = {}
  if (!String(form.product_name || '').trim()) errors.product_name = '请填写游戏 / 项目名称'

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
  validateRate('share_rate', '我方分成')
  validateRate('channel_fee_rate', '渠道费')
  return errors
}

function ContractAccessEditor({ contract, item, onClose, onSaved, onToast }) {
  const initialItems = (() => {
    const rows = [...(contract?.access_items || [])]
    if (item?.id && !rows.some((entry) => String(entry.id) === String(item.id))) rows.push(item)
    return rows
  })()

  const [items, setItems] = useState(initialItems)
  const [selectedId, setSelectedId] = useState(item?.id ? String(item.id) : '')
  const [form, setForm] = useState(() => itemToForm(item, contract))
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [errors, setErrors] = useState({})
  const [dirty, setDirty] = useState(false)
  const [changed, setChanged] = useState(false)
  const [createdCount, setCreatedCount] = useState(0)

  const selectedItem = selectedId
    ? items.find((entry) => String(entry.id) === selectedId) || null
    : null
  const isEditing = Boolean(selectedItem)

  const setValue = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: '' }))
    setDirty(true)
  }

  const confirmDiscard = () => {
    if (!dirty) return true
    return window.confirm('当前清单还有未保存的修改，确定放弃并切换吗？')
  }

  const selectItem = (entry) => {
    if (!confirmDiscard()) return
    setSelectedId(String(entry.id))
    setForm(itemToForm(entry, contract))
    setErrors({})
    setDirty(false)
  }

  const startNew = (template = null) => {
    if (!confirmDiscard()) return
    setSelectedId('')
    setForm(template ? nextFormFromSaved(template, contract) : newFormForContract(contract))
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
      onToast?.('清单还有必填项或格式需要检查', 'error')
      return
    }

    setSaving(true)
    try {
      const payload = buildPayload(form)
      const saved = isEditing
        ? await updateContractAccessItem(contract.id, selectedItem.id, payload)
        : await createContractAccessItem(contract.id, payload)

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
        isEditing ? `「${saved.product_name}」清单已更新` : `已新增「${saved.product_name}」清单`,
        'success'
      )

      if (closeAfter) {
        await onSaved?.(saved)
        return
      }

      if (continueAdding && !isEditing) {
        setSelectedId('')
        setForm(nextFormFromSaved(saved, contract))
        return
      }

      setSelectedId(String(saved.id))
      setForm(itemToForm(saved, contract))
    } catch (error) {
      console.error(error)
      onToast?.(error?.message || '合同合作清单保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const removeItem = async (entry) => {
    if (!entry?.id || deletingId) return
    if (!window.confirm(`确定删除「${entry.product_name || '未命名'}」这条合同合作清单吗？`)) return
    setDeletingId(String(entry.id))
    try {
      await deleteContractAccessItem(contract.id, entry.id)
      setItems((current) => current.filter((row) => String(row.id) !== String(entry.id)))
      setChanged(true)
      if (String(entry.id) === selectedId) {
        setSelectedId('')
        setForm(newFormForContract({ ...contract, access_items: items.filter((row) => String(row.id) !== String(entry.id)) }))
        setDirty(false)
        setErrors({})
      }
      onToast?.('合同合作清单已删除', 'success')
    } catch (error) {
      console.error(error)
      onToast?.(error?.message || '合同合作清单删除失败', 'error')
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
        aria-label="合同合作清单工作台"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="contract-access-workbench__head">
          <div className="contract-access-workbench__title">
            <span className="contract-access-workbench__eyebrow">CONTRACT ITEMS</span>
            <div>
              <h3>合同合作清单</h3>
              <p>{contract?.contract_name || '未命名合同'}</p>
            </div>
          </div>
          <div className="contract-access-workbench__head-actions">
            <span className="contract-access-workbench__count">{items.length} 条</span>
            {createdCount ? <span className="contract-access-workbench__created">本次新增 {createdCount}</span> : null}
            <button type="button" onClick={() => void finish()} disabled={saving}>关闭</button>
          </div>
        </header>

        <div className="contract-access-workbench__body">
          <aside className="contract-access-workbench__sidebar">
            <div className="contract-access-context">
              <span>归属合同</span>
              <strong>{contract?.internal_contract_no || contract?.contract_no || '系统合同'}</strong>
              <small>{contract?.partner_short_name || contract?.counterparty || '签约方未填写'}</small>
              <small>
                {contract?.effective_date || '未填生效日'} → {contract?.end_date || '未填终止日'}
              </small>
            </div>

            <button type="button" className="contract-access-new-btn" onClick={() => startNew()}>
              <span>＋</span>
              新增一条清单
            </button>

            <div className="contract-access-side-title">
              <span>已录入清单</span>
              <small>点击可直接编辑</small>
            </div>

            <div className="contract-access-side-list">
              {items.length ? items.map((entry, index) => {
                const active = String(entry.id) === selectedId
                return (
                  <div className={`contract-access-side-item ${active ? 'is-active' : ''}`} key={entry.id}>
                    <button type="button" className="contract-access-side-main" onClick={() => selectItem(entry)}>
                      <span className="contract-access-side-index">{index + 1}</span>
                      <span className="contract-access-side-copy">
                        <strong>{entry.product_name || '未命名项目'}</strong>
                        <small>{entry.channel_name || '未填写渠道 / 平台'}</small>
                        <em>
                          {entry.share_rate == null || entry.share_rate === '' ? '分成未填' : `分成 ${Number(entry.share_rate)}%`}
                          {' · '}
                          {entry.timeline_status || entry.status || '状态未填'}
                        </em>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="contract-access-side-delete"
                      title="删除此清单"
                      disabled={deletingId === String(entry.id)}
                      onClick={() => void removeItem(entry)}
                    >
                      {deletingId === String(entry.id) ? '…' : '×'}
                    </button>
                  </div>
                )
              }) : (
                <div className="contract-access-side-empty">
                  <strong>还没有合作清单</strong>
                  <span>先录游戏名称、渠道、授权期和结算规则即可，其他资料都可以以后补。</span>
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
              <section className="contract-access-form-intro">
                <div>
                  <span>{isEditing ? '正在编辑' : '快速新增'}</span>
                  <h4>{isEditing ? selectedItem.product_name || '未命名清单' : '先填常用字段，几十秒完成一条'}</h4>
                  <p>应用 ID、软著、ISBN 等资料已移到“可选信息”，不再挡住日常录入。</p>
                </div>
                <div className="contract-access-form-hint">
                  <strong>⌘ / Ctrl + Enter</strong>
                  <span>快速保存当前清单</span>
                </div>
              </section>

              <section className="contract-access-form-section">
                <div className="contract-access-form-section__head">
                  <div>
                    <span>01</span>
                    <div>
                      <h5>核心合作信息</h5>
                      <p>游戏、渠道、授权期限和结算比例是日常最常用的字段。</p>
                    </div>
                  </div>
                  <em>游戏名称必填</em>
                </div>

                <div className="contract-access-core-grid">
                  <Field
                    label="游戏 / 项目名称"
                    required
                    wide
                    autoFocus={!isEditing}
                    value={form.product_name}
                    error={errors.product_name}
                    onChange={(value) => setValue('product_name', value)}
                    placeholder="例如：云上征途、魔力契约"
                  />
                  <Field
                    label="合作渠道 / 平台"
                    value={form.channel_name}
                    onChange={(value) => setValue('channel_name', value)}
                    placeholder="例如：TapTap、小米、火烈鸟、快手直播"
                  />
                  <SelectField
                    label="合作模式"
                    value={form.agreement_type}
                    onChange={(value) => setValue('agreement_type', value)}
                    options={['联合运营', '联运SDK', '广告投放', '小游戏广告', '发行代理', '授权', '其他']}
                  />
                  <SelectField
                    label="运行平台"
                    value={form.platform}
                    onChange={(value) => setValue('platform', value)}
                    options={['', 'Android', 'iOS', 'Android / iOS', 'H5', '小游戏', 'PC', '其他']}
                  />
                  <SelectField
                    label="清单状态"
                    value={form.status}
                    onChange={(value) => setValue('status', value)}
                    options={['生效', '待生效', '已终止']}
                  />
                  <Field
                    label="授权开始日期"
                    type="date"
                    value={form.authorization_start}
                    onChange={(value) => setValue('authorization_start', value)}
                  />
                  <Field
                    label="授权结束日期"
                    type="date"
                    value={form.authorization_end}
                    error={errors.authorization_end}
                    onChange={(value) => setValue('authorization_end', value)}
                  />
                  <Field
                    label="我方分成（%）"
                    inputMode="decimal"
                    value={form.share_rate}
                    error={errors.share_rate}
                    onChange={(value) => setValue('share_rate', value)}
                    placeholder="例如：83"
                  />
                  <Field
                    label="支付渠道成本（%）"
                    inputMode="decimal"
                    value={form.channel_fee_rate}
                    error={errors.channel_fee_rate}
                    onChange={(value) => setValue('channel_fee_rate', value)}
                    placeholder="例如：5"
                  />
                  <TextareaField
                    label="结算 / 特殊条款备注"
                    wide
                    value={form.remarks}
                    onChange={(value) => setValue('remarks', value)}
                    placeholder="例如：CPA 10 元/新增注册；自然月结算；6%增值税专票；测试费、通道费、退款等扣除规则。"
                  />
                </div>
              </section>

              <details className="contract-access-advanced">
                <summary>
                  <span>
                    <strong>02 · 应用 / 资质等可选信息</strong>
                    <small>App ID、平台记录号、软著、ISBN、区域等，不需要时可以完全不填</small>
                  </span>
                  <em>展开</em>
                </summary>
                <div className="contract-access-advanced-grid">
                  <Field label="应用 ID / App ID" value={form.app_id} onChange={(value) => setValue('app_id', value)} placeholder="渠道应用标识，可留空" />
                  <Field label="平台记录 ID" value={form.platform_record_id} onChange={(value) => setValue('platform_record_id', value)} placeholder="平台后台记录号，可留空" />
                  <Field label="接入分类" value={form.category} onChange={(value) => setValue('category', value)} placeholder="例如：A 类、第二类" />
                  <Field label="语言" value={form.language} onChange={(value) => setValue('language', value)} placeholder="例如：简体中文" />
                  <Field label="权限来源" value={form.rights_source} onChange={(value) => setValue('rights_source', value)} />
                  <SelectField label="游戏状态" value={form.game_status} onChange={(value) => setValue('game_status', value)} options={['', '上架', '下架', '测试', '未上线']} />
                  <Field label="协议状态" value={form.agreement_status} onChange={(value) => setValue('agreement_status', value)} placeholder="例如：已签约、续签中" />
                  <Field label="软件著作权登记号" value={form.software_copyright_no} onChange={(value) => setValue('software_copyright_no', value)} />
                  <Field label="ISBN / 版号" value={form.isbn} onChange={(value) => setValue('isbn', value)} />
                  <Field label="授权区域" wide value={form.territory} onChange={(value) => setValue('territory', value)} />
                </div>
              </details>
            </div>

            <footer className="contract-access-workbench__footer">
              <div>
                <strong>{isEditing ? `编辑：${selectedItem.product_name || '未命名'}` : '新增清单'}</strong>
                <span>{dirty ? '有未保存修改' : changed ? '本次修改已保存到服务器' : '尚未修改'}</span>
              </div>
              <div className="contract-access-workbench__footer-actions">
                <button type="button" className="contract-access-done-btn" onClick={() => void finish()} disabled={saving}>
                  完成并关闭
                </button>
                {!isEditing ? (
                  <button type="button" className="contract-access-next-btn" onClick={() => void persist({ continueAdding: true })} disabled={saving}>
                    {saving ? '保存中…' : '保存并新增下一条'}
                  </button>
                ) : null}
                <button type="button" className="contract-access-save-btn" onClick={() => void persist()} disabled={saving}>
                  {saving ? '正在保存…' : isEditing ? '保存修改' : '保存当前'}
                </button>
                <button type="button" className="contract-access-save-close-btn" onClick={() => void persist({ closeAfter: true })} disabled={saving}>
                  {saving ? '正在保存…' : '保存并关闭'}
                </button>
              </div>
            </footer>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, wide, error, autoFocus, ...props }) {
  return (
    <label className={`contract-access-field ${wide ? 'is-wide' : ''} ${error ? 'has-error' : ''}`}>
      <span>{label}{required ? ' *' : ''}</span>
      <input autoFocus={autoFocus} {...props} />
      {error ? <small>{error}</small> : null}
    </label>
  )
}

function SelectField({ label, options, ...props }) {
  return (
    <label className="contract-access-field">
      <span>{label}</span>
      <select {...props}>
        {options.map((option) => (
          <option key={option || 'empty'} value={option}>{option || '未设置'}</option>
        ))}
      </select>
    </label>
  )
}

function TextareaField({ label, wide, ...props }) {
  return (
    <label className={`contract-access-field ${wide ? 'is-wide' : ''}`}>
      <span>{label}</span>
      <textarea rows={4} {...props} />
    </label>
  )
}

export default ContractAccessEditor
