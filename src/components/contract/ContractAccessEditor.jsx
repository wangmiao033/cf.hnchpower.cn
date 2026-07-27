import React, { useMemo, useState } from 'react'
import {
  createContractAccessItem,
  updateContractAccessItem
} from '@/lib/api/contract.ts'

const EMPTY_FORM = {
  channel_name: '',
  agreement_type: '联合运营',
  platform_record_id: '',
  product_name: '',
  app_id: '',
  platform: 'Android',
  language: '简体中文',
  category: '',
  rights_source: '授权获得',
  game_status: '上架',
  agreement_status: '已任职',
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

function toForm(item, contract) {
  if (!item) {
    return {
      ...EMPTY_FORM,
      channel_name: contract?.partner_short_name || contract?.counterparty || ''
    }
  }
  return Object.fromEntries(
    Object.keys(EMPTY_FORM).map((key) => [key, item[key] ?? EMPTY_FORM[key]])
  )
}

function ContractAccessEditor({ contract, item, onClose, onSaved, onToast }) {
  const initialForm = useMemo(() => toForm(item, contract), [contract, item])
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)

  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    if (!form.product_name.trim()) {
      onToast?.('请填写接入游戏名称', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        authorization_start: form.authorization_start || null,
        authorization_end: form.authorization_end || null,
        share_rate: form.share_rate === '' ? null : form.share_rate,
        channel_fee_rate: form.channel_fee_rate === '' ? null : form.channel_fee_rate
      }
      const saved = item
        ? await updateContractAccessItem(contract.id, item.id, payload)
        : await createContractAccessItem(contract.id, payload)
      onToast?.(item ? '游戏接入清单已更新' : '游戏接入清单已新增', 'success')
      onSaved?.(saved)
    } catch (error) {
      console.error(error)
      onToast?.(error?.message || '游戏接入清单保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="contract-editor-mask" onClick={onClose}>
      <form
        className="contract-editor contract-access-editor"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="contract-editor-head">
          <div>
            <p>{item ? '编辑接入清单' : '新增接入清单'}</p>
            <h3>{contract.contract_name}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="contract-access-editor__context">
          <span>归属主合同</span>
          <strong>{contract.contract_no || '未填写合同编号'}</strong>
          <span>签约方</span>
          <strong>{contract.partner_short_name || contract.counterparty || '-'}</strong>
        </div>

        <div className="contract-form-grid contract-access-form-grid">
          <Field label="合同渠道" value={form.channel_name} onChange={(value) => setValue('channel_name', value)} placeholder="例如：小米开放平台、火烈鸟" />
          <SelectField label="业务类型" value={form.agreement_type} onChange={(value) => setValue('agreement_type', value)} options={['联合运营', '联运SDK', '广告投放', '小游戏广告', '其他']} />
          <Field label="平台记录 ID" value={form.platform_record_id} onChange={(value) => setValue('platform_record_id', value)} placeholder="例如：27136" />
          <Field label="应用 ID" value={form.app_id} onChange={(value) => setValue('app_id', value)} />

          <Field label="游戏名称" required wide value={form.product_name} onChange={(value) => setValue('product_name', value)} />
          <SelectField label="系统平台" value={form.platform} onChange={(value) => setValue('platform', value)} options={['Android', 'iOS', 'Android / iOS', 'H5', '小游戏', '其他']} />
          <Field label="语言" value={form.language} onChange={(value) => setValue('language', value)} />
          <Field label="接入分类" value={form.category} onChange={(value) => setValue('category', value)} placeholder="例如：第二类、A 类" />
          <Field label="权限来源" value={form.rights_source} onChange={(value) => setValue('rights_source', value)} />
          <SelectField label="游戏状态" value={form.game_status} onChange={(value) => setValue('game_status', value)} options={['上架', '下架', '测试', '未上线', '']} />
          <Field label="协议状态" value={form.agreement_status} onChange={(value) => setValue('agreement_status', value)} placeholder="例如：已任职、已签约" />
          <SelectField label="清单状态" value={form.status} onChange={(value) => setValue('status', value)} options={['生效', '待生效', '已终止']} />

          <Field label="授权开始日期" type="date" value={form.authorization_start} onChange={(value) => setValue('authorization_start', value)} />
          <Field label="授权结束日期" type="date" value={form.authorization_end} onChange={(value) => setValue('authorization_end', value)} />
          <Field label="我方分成比例（%）" inputMode="decimal" value={form.share_rate} onChange={(value) => setValue('share_rate', value)} />
          <Field label="支付渠道成本（%）" inputMode="decimal" value={form.channel_fee_rate} onChange={(value) => setValue('channel_fee_rate', value)} />

          <Field label="软件著作权登记号" value={form.software_copyright_no} onChange={(value) => setValue('software_copyright_no', value)} />
          <Field label="ISBN / 版号" value={form.isbn} onChange={(value) => setValue('isbn', value)} />
          <Field label="授权区域" wide value={form.territory} onChange={(value) => setValue('territory', value)} />
          <Field label="备注" wide value={form.remarks} onChange={(value) => setValue('remarks', value)} />
        </div>

        <div className="contract-form-actions">
          <button type="button" className="contract-cancel-btn" onClick={onClose}>取消</button>
          <button type="submit" className="contract-save-btn" disabled={saving}>
            {saving ? '正在保存…' : '保存接入清单'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, required, wide, ...props }) {
  return (
    <label className={wide ? 'is-wide' : ''}>
      <span>{label}{required ? ' *' : ''}</span>
      <input required={required} {...props} />
    </label>
  )
}

function SelectField({ label, options, ...props }) {
  return (
    <label>
      <span>{label}</span>
      <select {...props}>
        {options.map((option) => (
          <option key={option || 'empty'} value={option}>{option || '未设置'}</option>
        ))}
      </select>
    </label>
  )
}

export default ContractAccessEditor
