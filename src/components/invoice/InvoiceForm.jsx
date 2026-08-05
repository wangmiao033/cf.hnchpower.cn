import React, { useEffect, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { parseInvoiceText } from '@/domain/invoice/parseInvoiceText.js'

const defaultInvoiceForm = {
  invoiceDirection: 'output',
  invoiceType: '',
  digitalInvoiceNo: '',
  invoiceCode: '',
  invoiceNo: '',
  buyerName: '',
  buyerTaxNo: '',
  sellerName: '',
  sellerTaxNo: '',
  title: '',
  taxNo: '',
  amount: '',
  taxAmount: '',
  amountWithTax: '',
  status: '未开',
  taxStatus: 'normal',
  issueDate: '',
  issuer: '',
  invoiceSource: '',
  remark: ''
}

function recordToForm(inv) {
  return {
    invoiceDirection: inv.invoiceDirection || inv.invoice_direction || 'output',
    invoiceType: inv.invoiceType || '',
    digitalInvoiceNo: inv.digitalInvoiceNo || '',
    invoiceCode: inv.invoiceCode || '',
    invoiceNo: inv.invoiceNo || '',
    buyerName: inv.buyerName || inv.title || '',
    buyerTaxNo: inv.buyerTaxNo || inv.taxNo || '',
    sellerName: inv.sellerName || '',
    sellerTaxNo: inv.sellerTaxNo || '',
    title: inv.title || '',
    taxNo: inv.taxNo || '',
    amount: inv.amount != null ? String(inv.amount) : '',
    taxAmount: inv.taxAmount != null ? String(inv.taxAmount) : '',
    amountWithTax:
      inv.amountWithTax != null
        ? String(inv.amountWithTax)
        : (
            (parseFloat(String(inv.amount ?? 0)) || 0) +
            (parseFloat(String(inv.taxAmount ?? 0)) || 0)
          ).toFixed(2),
    status: inv.status || '未开',
    taxStatus: inv.taxStatus || inv.tax_status || 'normal',
    issueDate: inv.issueDate || '',
    issuer: inv.issuer || '',
    invoiceSource: inv.invoiceSource || '',
    remark: inv.remark || ''
  }
}

function InvoiceForm({
  formId,
  mode = 'add',
  sourceRecord = null,
  seedFromStore = false,
  submitIntentRef,
  submitInvoiceFromForm,
  onAfterSubmit,
  onPreviewChange,
  showToast
}) {
  const { invoice } = useAppState()
  const { invoiceForm } = invoice
  const [formData, setFormData] = useState(defaultInvoiceForm)
  const [rawInvoiceText, setRawInvoiceText] = useState('')

  useEffect(() => {
    const amt = parseFloat(formData.amount || 0)
    onPreviewChange?.(Number.isFinite(amt) ? amt : 0)
  }, [formData.amount, onPreviewChange])

  useEffect(() => {
    if (mode === 'edit' && sourceRecord) {
      setFormData(recordToForm(sourceRecord))
      return
    }
    if (
      mode === 'add' &&
      seedFromStore &&
      (invoiceForm.title || invoiceForm.taxNo || invoiceForm.amount || invoiceForm.digitalInvoiceNo)
    ) {
      setFormData({
        invoiceDirection: invoiceForm.invoiceDirection || 'output',
        invoiceType: invoiceForm.invoiceType || '',
        digitalInvoiceNo: invoiceForm.digitalInvoiceNo || '',
        invoiceCode: invoiceForm.invoiceCode || '',
        invoiceNo: invoiceForm.invoiceNo || '',
        buyerName: invoiceForm.buyerName || invoiceForm.title || '',
        buyerTaxNo: invoiceForm.buyerTaxNo || invoiceForm.taxNo || '',
        sellerName: invoiceForm.sellerName || '',
        sellerTaxNo: invoiceForm.sellerTaxNo || '',
        title: invoiceForm.title || '',
        taxNo: invoiceForm.taxNo || '',
        amount: invoiceForm.amount != null ? String(invoiceForm.amount) : '',
        taxAmount: invoiceForm.taxAmount != null ? String(invoiceForm.taxAmount) : '',
        amountWithTax:
          invoiceForm.amountWithTax != null
            ? String(invoiceForm.amountWithTax)
            : (
                (parseFloat(String(invoiceForm.amount || 0)) || 0) +
                (parseFloat(String(invoiceForm.taxAmount || 0)) || 0)
              ).toFixed(2),
        status: invoiceForm.status || '未开',
        taxStatus: invoiceForm.taxStatus || 'normal',
        issueDate: invoiceForm.issueDate || '',
        issuer: invoiceForm.issuer || '',
        invoiceSource: invoiceForm.invoiceSource || '',
        remark: invoiceForm.remark || ''
      })
      return
    }
    if (mode === 'add' && !seedFromStore) {
      setFormData({ ...defaultInvoiceForm })
    }
  }, [mode, sourceRecord?.id, seedFromStore, invoiceForm])

  const setField = (key, value) => setFormData((previous) => ({ ...previous, [key]: value }))

  const applyParsedInvoiceText = () => {
    const parsed = parseInvoiceText(rawInvoiceText, formData.invoiceDirection || 'output')
    if (!parsed) {
      showToast?.('未识别到有效发票文本', 'error')
      return
    }
    setFormData((previous) => {
      const next = {
        ...previous,
        invoiceType: parsed.invoice_type || previous.invoiceType,
        digitalInvoiceNo: parsed.digital_invoice_no || previous.digitalInvoiceNo,
        invoiceCode: parsed.invoice_code || '',
        invoiceNo: parsed.invoice_no || '',
        amount: parsed.amount || previous.amount,
        taxAmount: parsed.tax_amount || previous.taxAmount,
        amountWithTax: parsed.total_amount || previous.amountWithTax,
        issueDate: parsed.invoice_date || previous.issueDate,
        issuer: parsed.issuer || previous.issuer,
        invoiceSource: parsed.invoice_source || previous.invoiceSource,
        status: parsed.invoice_status || previous.status,
        remark: [previous.remark, parsed.remark]
          .filter(Boolean)
          .join(previous.remark && parsed.remark ? '；' : '')
      }
      if ((previous.invoiceDirection || 'output') === 'input') {
        next.sellerName = parsed.seller_name || previous.sellerName
        next.sellerTaxNo = parsed.seller_tax_no || previous.sellerTaxNo
      } else {
        const buyerName = parsed.buyer_name || previous.buyerName || previous.title
        const buyerTaxNo = parsed.buyer_tax_no || previous.buyerTaxNo || previous.taxNo
        next.buyerName = buyerName
        next.buyerTaxNo = buyerTaxNo
        next.title = buyerName
        next.taxNo = buyerTaxNo
      }
      return next
    })
    showToast?.('已识别并填充发票字段', 'success')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const intent = submitIntentRef?.current ?? 'back'
    const editId = mode === 'edit' && sourceRecord ? sourceRecord.id : undefined
    const resetFormAfterAdd = mode === 'add' && intent !== 'continue'

    const ok = await submitInvoiceFromForm(formData, { editId, resetFormAfterAdd })
    if (!ok) return

    if (mode === 'add' && intent === 'continue') {
      setFormData({ ...defaultInvoiceForm })
      setRawInvoiceText('')
    }
    onAfterSubmit?.(intent)
    if (submitIntentRef) submitIntentRef.current = 'back'
  }

  const isInput = formData.invoiceDirection === 'input'

  return (
    <form id={formId} className="invoice-form invoice-form--page" onSubmit={handleSubmit}>
      {mode === 'add' ? (
        <section className="invoice-form-section invoice-form-section--parse">
          <div className="invoice-form-section__head">
            <strong>发票文本识别</strong>
            <span>可选 · 粘贴税务系统复制文本后自动填充</span>
          </div>
          <div className="invoice-form__row">
            <textarea
              className="admin-input"
              rows={4}
              value={rawInvoiceText}
              onChange={(event) => setRawInvoiceText(event.target.value)}
              placeholder="粘贴整条发票文本；没有文本时可直接填写下方字段"
            />
          </div>
          <div className="invoice-form__quick">
            <button
              type="button"
              className="rec-btn rec-btn--secondary"
              onClick={applyParsedInvoiceText}
            >
              识别并填充
            </button>
          </div>
        </section>
      ) : null}

      <section className="invoice-form-section invoice-form-section--base">
        <div className="invoice-form-section__head">
          <strong>基础信息</strong>
          <span>票据编号与交易方资料</span>
        </div>
        <div className="invoice-form__grid">
          <Field label="发票方向">
            <select
              className="admin-input"
              value={formData.invoiceDirection}
              onChange={(event) => {
                const nextDirection = event.target.value
                setFormData((previous) => {
                  const next = { ...previous, invoiceDirection: nextDirection }
                  if (nextDirection === 'output') {
                    next.title = previous.buyerName || previous.title
                    next.taxNo = previous.buyerTaxNo || previous.taxNo
                  }
                  return next
                })
              }}
            >
              <option value="output">销项发票</option>
              <option value="input">进项发票</option>
            </select>
          </Field>

          <Field label="票种" className="is-span-2">
            <input
              type="text"
              className="admin-input"
              value={formData.invoiceType}
              onChange={(event) => setField('invoiceType', event.target.value)}
              placeholder="例如：数电发票（增值税专用发票）"
            />
          </Field>

          <Field label="发票状态">
            <select
              className="admin-input"
              value={formData.status}
              onChange={(event) => setField('status', event.target.value)}
            >
              <option value="未开">未开</option>
              <option value="已开">已开</option>
              <option value="作废">作废</option>
            </select>
          </Field>

          <Field label="数电发票号码" className="is-span-2">
            <input
              type="text"
              className="admin-input"
              value={formData.digitalInvoiceNo}
              onChange={(event) => setField('digitalInvoiceNo', event.target.value)}
              placeholder="数电发票号码"
            />
          </Field>

          <Field label="发票代码">
            <input
              type="text"
              className="admin-input"
              value={formData.invoiceCode}
              onChange={(event) => setField('invoiceCode', event.target.value)}
              placeholder="发票代码"
            />
          </Field>

          <Field label="发票号码">
            <input
              type="text"
              className="admin-input"
              value={formData.invoiceNo}
              onChange={(event) => setField('invoiceNo', event.target.value)}
              placeholder="发票号码"
            />
          </Field>

          <Field label={isInput ? '销售方名称 *' : '购买方名称 *'} className="is-span-2">
            <input
              type="text"
              className="admin-input"
              value={isInput ? formData.sellerName : formData.buyerName || formData.title}
              onChange={(event) => {
                const value = event.target.value
                if (isInput) setField('sellerName', value)
                else {
                  setFormData((previous) => ({
                    ...previous,
                    buyerName: value,
                    title: value
                  }))
                }
              }}
              placeholder="公司名称"
            />
          </Field>

          <Field label={isInput ? '销售方纳税人识别号 *' : '购买方纳税人识别号 *'} className="is-span-2">
            <input
              type="text"
              className="admin-input"
              value={isInput ? formData.sellerTaxNo : formData.buyerTaxNo || formData.taxNo}
              onChange={(event) => {
                const value = event.target.value
                if (isInput) setField('sellerTaxNo', value)
                else {
                  setFormData((previous) => ({
                    ...previous,
                    buyerTaxNo: value,
                    taxNo: value
                  }))
                }
              }}
              placeholder="纳税人识别号"
            />
          </Field>
        </div>
      </section>

      <section className="invoice-form-section invoice-form-section--amount">
        <div className="invoice-form-section__head">
          <strong>金额与日期</strong>
          <span>金额统一按人民币元录入</span>
        </div>
        <div className="invoice-form__grid">
          <Field label="不含税金额">
            <input
              type="number"
              step="0.01"
              className="admin-input"
              value={formData.amount}
              onChange={(event) => setField('amount', event.target.value)}
              placeholder="0.00"
            />
          </Field>

          <Field label="税额">
            <input
              type="number"
              step="0.01"
              className="admin-input"
              value={formData.taxAmount}
              onChange={(event) => setField('taxAmount', event.target.value)}
              placeholder="0.00"
            />
          </Field>

          <Field label="价税合计">
            <input
              type="number"
              step="0.01"
              className="admin-input"
              value={formData.amountWithTax}
              onChange={(event) => setField('amountWithTax', event.target.value)}
              placeholder="0.00"
            />
          </Field>

          <Field label="开票日期">
            <input
              type="date"
              className="admin-input"
              value={formData.issueDate}
              onChange={(event) => setField('issueDate', event.target.value)}
            />
          </Field>

          <Field label="开票人" className="is-span-2">
            <input
              type="text"
              className="admin-input"
              value={formData.issuer}
              onChange={(event) => setField('issuer', event.target.value)}
              placeholder="选填"
            />
          </Field>
        </div>
      </section>

      <section className="invoice-form-section invoice-form-section--status">
        <div className="invoice-form-section__head">
          <strong>税务状态与备注</strong>
          <span>仅保留后续核验需要的信息</span>
        </div>
        <div className="invoice-form__grid">
          <Field label="税务状态">
            <select
              className="admin-input"
              value={formData.taxStatus}
              onChange={(event) => setField('taxStatus', event.target.value)}
            >
              <option value="normal">正常</option>
              <option value="red">红冲</option>
              <option value="void">作废</option>
              <option value="unknown">待确认</option>
            </select>
          </Field>

          <Field label="备注">
            <input
              type="text"
              className="admin-input"
              value={formData.remark}
              onChange={(event) => setField('remark', event.target.value)}
              placeholder="选填：收件人、邮箱或异常说明"
            />
          </Field>
        </div>
      </section>
    </form>
  )
}

function Field({ label, className = '', children }) {
  return (
    <div className={`invoice-form__field ${className}`.trim()}>
      <label>{label}</label>
      {children}
    </div>
  )
}

export default InvoiceForm
export { defaultInvoiceForm, recordToForm }
