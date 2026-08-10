import React, { useMemo, useRef, useState } from 'react'
import {
  createInvoiceRecord,
  getInvoiceRecord,
  parseElectronicInvoiceFile
} from '@/lib/api/invoice.ts'
import { completeFinanceInvoiceTask } from '@/lib/api/financeTasks.ts'
import {
  buildElectronicInvoiceRecord,
  calculateTaxSplit,
  taskInvoiceAmountState
} from '@/domain/invoice/electronicInvoiceQuickEntry.js'
import './ElectronicInvoiceQuickEntry.css'

const TAX_RATE_STORAGE_KEY = 'invoice-quick-last-tax-rate'

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function readLastTaxRate() {
  if (typeof window === 'undefined') return 6
  const value = Number(window.localStorage.getItem(TAX_RATE_STORAGE_KEY) || 6)
  return Number.isFinite(value) && value >= 0 ? value : 6
}

function payloadFromForm(form) {
  return {
    ...form,
    invoice_identity_key: form.digital_invoice_no
      ? `digital:${String(form.digital_invoice_no).trim()}`
      : form.invoice_code && form.invoice_no
        ? `legacy:${String(form.invoice_code).trim()}:${String(form.invoice_no).trim()}`
        : null,
    title: form.buyer_name || null,
    tax_no: form.buyer_tax_no || null,
    verified: false,
    verified_amount: 0,
    verified_record_ids: []
  }
}

export default function ElectronicInvoiceQuickEntry({
  task = null,
  direction = 'output',
  showToast,
  onSaved,
  onCancel,
  compact = false
}) {
  const fileInputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [parseMeta, setParseMeta] = useState(null)
  const [existingInvoiceId, setExistingInvoiceId] = useState('')
  const [form, setForm] = useState(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const taskAmountState = useMemo(() => {
    if (!task || !form) return null
    return taskInvoiceAmountState(form.amount_with_tax, task.requested_amount)
  }, [form, task])

  const partnerMismatch = useMemo(() => {
    if (!task?.partner_name || !form?.buyer_name) return false
    const normalize = (value) => String(value || '').replace(/[\s()（）·,，.。\-_/\\]/g, '').toLowerCase()
    const a = normalize(task.partner_name)
    const b = normalize(form.buyer_name)
    return Boolean(a && b && a !== b && !a.includes(b) && !b.includes(a))
  }, [form?.buyer_name, task?.partner_name])

  const updateGrossAndRate = (grossValue, rateValue) => {
    const gross = Number(grossValue)
    const rate = Number(rateValue)
    const split = calculateTaxSplit(gross, rate)
    setForm((current) => current ? {
      ...current,
      amount_with_tax: Number.isFinite(gross) ? gross : 0,
      tax_rate: Number.isFinite(rate) ? rate : 0,
      invoice_amount: split.net,
      tax_amount: split.tax
    } : current)
    if (typeof window !== 'undefined' && Number.isFinite(rate)) {
      window.localStorage.setItem(TAX_RATE_STORAGE_KEY, String(rate))
    }
  }

  const handleFile = async (file) => {
    if (!file || uploading) return
    const lower = String(file.name || '').toLowerCase()
    if (!['.pdf', '.ofd', '.xml'].some((suffix) => lower.endsWith(suffix))) {
      showToast?.('请上传电子发票 PDF、OFD 或 XML 文件', 'error')
      return
    }
    setUploading(true)
    try {
      const parsed = await parseElectronicInvoiceFile(file, direction === 'input' ? 'input' : 'output')
      const next = buildElectronicInvoiceRecord(parsed.invoice, task, readLastTaxRate())
      if (direction === 'input') next.invoice_direction = 'input'
      setParseMeta({
        parser: parsed.parser,
        confidence: parsed.confidence,
        warnings: parsed.warnings || [],
        fileName: file.name
      })
      setExistingInvoiceId(String(parsed.existing_invoice_id || ''))
      setForm(next)
      if (parsed.existing_invoice_id) {
        showToast?.('这张发票已存在，可直接用于当前开票任务', 'info')
      } else {
        showToast?.('电子发票已识别，请核对关键字段', 'success')
      }
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '电子发票识别失败', 'error')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const validate = () => {
    if (!form) return '请先上传电子发票文件'
    if (!String(form.digital_invoice_no || form.invoice_no || '').trim()) return '请确认发票号码'
    if (!String(form.invoice_date || '').trim()) return '请确认开票日期'
    if (!(Number(form.amount_with_tax) > 0)) return '请确认价税合计'
    const counterparty = form.invoice_direction === 'input' ? form.seller_name : form.buyer_name
    if (!String(counterparty || '').trim()) return '请确认交易方名称'
    return ''
  }

  const handleSave = async () => {
    const errorText = validate()
    if (errorText) return showToast?.(errorText, 'error')
    if (partnerMismatch && task) {
      const ok = window.confirm(`发票购买方与开票任务合作方不一致：\n\n任务：${task.partner_name}\n发票：${form.buyer_name}\n\n仍要继续吗？`)
      if (!ok) return
    }
    setSaving(true)
    try {
      let invoice
      if (existingInvoiceId) {
        invoice = await getInvoiceRecord(existingInvoiceId)
      } else {
        invoice = await createInvoiceRecord(payloadFromForm(form))
      }

      if (task) {
        const amountState = taskInvoiceAmountState(form.amount_with_tax, task.requested_amount)
        await completeFinanceInvoiceTask(task.id, {
          invoice_id: invoice.id,
          allocated_amount: Number(amountState.allocationAmount || 0)
        })
        showToast?.(
          existingInvoiceId
            ? '已有发票已关联，开票任务完成'
            : '发票已保存并自动关联到账单，开票任务完成',
          'success'
        )
      } else {
        showToast?.(existingInvoiceId ? '该发票已经存在' : '电子发票已保存', existingInvoiceId ? 'info' : 'success')
      }
      onSaved?.(invoice, { existing: Boolean(existingInvoiceId), taskCompleted: Boolean(task) })
    } catch (error) {
      showToast?.(error instanceof Error ? error.message : '保存电子发票失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`electronic-invoice-quick ${compact ? 'is-compact' : ''}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.ofd,.xml,application/pdf,application/xml"
        hidden
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      <button
        type="button"
        className={`electronic-invoice-drop ${dragging ? 'is-dragging' : ''} ${form ? 'has-file' : ''}`}
        disabled={uploading || saving}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          void handleFile(event.dataTransfer.files?.[0])
        }}
      >
        <span className="electronic-invoice-drop__icon">票</span>
        <span>
          <strong>{uploading ? '正在识别电子发票…' : form ? '重新上传电子发票' : '拖入电子发票，自动识别'}</strong>
          <small>{form ? parseMeta?.fileName : '支持 PDF / OFD / XML · 单张 ≤ 4MB'}</small>
        </span>
      </button>

      {form ? (
        <>
          <section className="electronic-invoice-review">
            <header>
              <div>
                <span>识别结果</span>
                <h3>{form.invoice_type || '电子发票（增值税专用发票）'}</h3>
              </div>
              <div className={`electronic-invoice-confidence is-${Number(parseMeta?.confidence || 0) >= 0.8 ? 'good' : 'warn'}`}>
                识别 {Math.round(Number(parseMeta?.confidence || 0) * 100)}%
              </div>
            </header>

            {existingInvoiceId ? <div className="electronic-invoice-note is-info">这张发票已经录入系统，本次不会重复创建。</div> : null}
            {parseMeta?.warnings?.length ? <div className="electronic-invoice-note is-warn">{parseMeta.warnings.join(' · ')}</div> : null}
            {partnerMismatch ? <div className="electronic-invoice-note is-error">购买方与来源账单合作方不一致，请重点核对。</div> : null}
            {taskAmountState ? <div className={`electronic-invoice-note is-${taskAmountState.key}`}>{taskAmountState.label}</div> : null}

            <div className="electronic-invoice-key-grid">
              <label>
                <span>数电发票号码</span>
                <input value={form.digital_invoice_no || ''} onChange={(event) => setForm((current) => ({ ...current, digital_invoice_no: event.target.value }))} placeholder="发票号码" />
              </label>
              <label>
                <span>开票日期</span>
                <input type="date" value={form.invoice_date || ''} onChange={(event) => setForm((current) => ({ ...current, invoice_date: event.target.value }))} />
              </label>
              <label>
                <span>价税合计</span>
                <div className="electronic-invoice-money-input"><b>¥</b><input type="number" step="0.01" value={form.amount_with_tax ?? ''} onChange={(event) => updateGrossAndRate(event.target.value, form.tax_rate)} /></div>
              </label>
              <label>
                <span>税率</span>
                <div className="electronic-invoice-rate-input"><input type="number" step="0.01" value={form.tax_rate ?? ''} onChange={(event) => updateGrossAndRate(form.amount_with_tax, event.target.value)} /><b>%</b></div>
              </label>
            </div>

            <div className="electronic-invoice-summary-line">
              <div><span>购买方</span><strong>{form.buyer_name || '待确认'}</strong><small>{form.buyer_tax_no || '税号待确认'}</small></div>
              <div><span>不含税金额</span><strong>{money(form.invoice_amount)}</strong></div>
              <div><span>税额</span><strong>{money(form.tax_amount)}</strong></div>
            </div>

            <button type="button" className="electronic-invoice-advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)}>
              {advancedOpen ? '收起高级信息' : '展开高级信息'}
            </button>

            {advancedOpen ? (
              <div className="electronic-invoice-advanced">
                <label><span>购买方名称</span><input value={form.buyer_name || ''} onChange={(event) => setForm((current) => ({ ...current, buyer_name: event.target.value, title: event.target.value }))} /></label>
                <label><span>购买方税号</span><input value={form.buyer_tax_no || ''} onChange={(event) => setForm((current) => ({ ...current, buyer_tax_no: event.target.value, tax_no: event.target.value }))} /></label>
                <label><span>销售方名称</span><input value={form.seller_name || ''} onChange={(event) => setForm((current) => ({ ...current, seller_name: event.target.value }))} /></label>
                <label><span>销售方税号</span><input value={form.seller_tax_no || ''} onChange={(event) => setForm((current) => ({ ...current, seller_tax_no: event.target.value }))} /></label>
                <label><span>不含税金额</span><input type="number" step="0.01" value={form.invoice_amount ?? ''} onChange={(event) => setForm((current) => ({ ...current, invoice_amount: Number(event.target.value) || 0 }))} /></label>
                <label><span>税额</span><input type="number" step="0.01" value={form.tax_amount ?? ''} onChange={(event) => setForm((current) => ({ ...current, tax_amount: Number(event.target.value) || 0 }))} /></label>
                <label><span>开票人</span><input value={form.issuer || ''} onChange={(event) => setForm((current) => ({ ...current, issuer: event.target.value }))} /></label>
                <label><span>原文件</span><input value={form.source_file_name || ''} readOnly /></label>
              </div>
            ) : null}
          </section>

          <div className="electronic-invoice-actions">
            {onCancel ? <button type="button" onClick={onCancel}>取消</button> : null}
            <button type="button" className="is-primary" disabled={saving || uploading} onClick={() => void handleSave()}>
              {saving ? '正在保存…' : task ? '确认保存并完成开票' : '确认保存发票'}
            </button>
          </div>
        </>
      ) : (
        <div className="electronic-invoice-empty-hint">
          <strong>正常情况下只需要：拖文件 → 看一眼 → 确认</strong>
          <span>系统自动识别票号、购买方、税号、金额、税额、税率和开票日期。</span>
        </div>
      )}
    </div>
  )
}
