import React, { useEffect, useMemo, useRef, useState } from 'react'
import { getBillInvoiceSummary, clearBillInvoiceSummaryCache } from '@/lib/api/billInvoiceAllocations.ts'
import { registerRdInputInvoiceMerge } from '@/lib/api/rdInvoiceMerge.ts'
import { prepareRdInvoiceMerge, yuanFromCents } from '@/domain/reconciliation/rdInvoiceMerge.js'
import '@/components/channel/ChannelInvoiceMergeDialog.css'

const money = cents => '¥' + (Number(cents || 0) / 100).toLocaleString('zh-CN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
})

const INVOICE_TYPES = [
  '数电发票（增值税普通发票）',
  '数电发票（增值税专用发票）',
  '增值税普通发票',
  '增值税专用发票'
]

export default function RdInvoiceMergeDialog({
  rows,
  onClose,
  onReceived,
  onOpenExisting,
  showToast
}) {
  const [summaries, setSummaries] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [showReceiveForm, setShowReceiveForm] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const submittingRef = useRef(false)
  const [receiveError, setReceiveError] = useState('')

  // A R&D supplier is the seller of the incoming invoice, NOT the buyer.
  const [sellerName, setSellerName] = useState(String(rows?.[0]?.partner || '').trim())
  const [sellerTaxNo, setSellerTaxNo] = useState('')
  const [buyerName, setBuyerName] = useState('')
  const [buyerTaxNo, setBuyerTaxNo] = useState('')
  const [invoiceType, setInvoiceType] = useState('')
  const [numberType, setNumberType] = useState('digital')
  const [digitalInvoiceNo, setDigitalInvoiceNo] = useState('')
  const [invoiceCode, setInvoiceCode] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [taxAmount, setTaxAmount] = useState('')
  const [remark, setRemark] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    setSummaries(null)
    Promise.all((rows || []).map(row => getBillInvoiceSummary('rd', String(row.id))))
      .then(next => { if (active) setSummaries(next) })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : '研发账单进项发票状态读取失败')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [rows, reloadVersion])

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape' && !submittingRef.current) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const preview = useMemo(
    () => prepareRdInvoiceMerge(rows, summaries),
    [rows, summaries]
  )
  const effectiveError = loadError || (loading ? '' : preview.error)
  const taxNumber = Number(taxAmount)
  const taxCents = taxAmount.trim() === '' || !Number.isFinite(taxNumber)
    ? NaN : Math.round(taxNumber * 100)
  const taxValid = Number.isInteger(taxCents) &&
    taxCents >= 0 && taxCents <= preview.totalCents &&
    Math.abs(taxNumber * 100 - taxCents) < 0.000001
  const netCents = taxValid ? preview.totalCents - taxCents : 0
  const numberValid = numberType === 'digital'
    ? Boolean(digitalInvoiceNo.trim())
    : Boolean(invoiceCode.trim() && invoiceNo.trim())
  const canSubmit = Boolean(
    !loading && !effectiveError && !receiving &&
    sellerName.trim() && sellerTaxNo.trim() &&
    buyerName.trim() && buyerTaxNo.trim() &&
    invoiceType && invoiceDate && numberValid && taxValid
  )

  const retryCoverage = () => {
    for (const row of rows || []) clearBillInvoiceSummaryCache('rd', String(row.id))
    setReloadVersion(version => version + 1)
  }

  const copyInvoiceRequest = async () => {
    if (loading || effectiveError || !preview.totalCents) return
    const lines = [
      '研发账单合并收票清单（向研发方索取进项发票，非税务发票）',
      '研发公司（销售方）：' + preview.partnerName,
      '购买方（我司）：' + (buyerName.trim() || '待核对实际收票主体'),
      '购买方税号：' + (buyerTaxNo.trim() || '待填写'),
      '拟收进项发票价税合计：' + money(preview.totalCents),
      '账单明细：',
      ...preview.items.map(item => '· ' + item.period + ' / ' + item.number + ' / ' + money(item.remainingCents)),
      '说明：按研发原始结算金额减去已关联有效发票金额计算；已付款、未付款及预付款抵扣不决定待收票余额。',
      '正式发票由研发方在税务平台开出。收到后请在系统登记号码并关联原账单。'
    ]
    const contents = lines.join('\n')
    try {
      await navigator.clipboard.writeText(contents)
      showToast?.('已复制研发进项发票收票清单；尚未登记正式发票', 'success')
    } catch {
      window.prompt('请复制以下收票清单', contents)
    }
  }

  const registerReceived = async event => {
    event.preventDefault()
    if (!canSubmit || submittingRef.current) return
    const number = numberType === 'digital'
      ? digitalInvoiceNo.trim()
      : invoiceCode.trim() + '-' + invoiceNo.trim()
    if (!window.confirm(
      '确认已从研发公司收到真实进项发票：' + number + '\n' +
      '研发公司（销售方）：' + sellerName.trim() + '\n' +
      '我司（购买方）：' + buyerName.trim() + '\n' +
      '关联 ' + rows.length + ' 张研发账单，价税合计 ' + money(preview.totalCents) + '。\n\n' +
      '确认后系统将录入进项发票并关联账单，不会修改账单、付款或预付款抵扣。'
    )) return

    submittingRef.current = true
    setReceiving(true)
    setReceiveError('')
    try {
      const result = await registerRdInputInvoiceMerge({
        bill_ids: preview.items.map(item => item.id),
        buyer_name: buyerName.trim(),
        buyer_tax_no: buyerTaxNo.trim(),
        seller_name: sellerName.trim(),
        seller_tax_no: sellerTaxNo.trim(),
        invoice_type: invoiceType,
        digital_invoice_no: numberType === 'digital' ? digitalInvoiceNo.trim() : null,
        invoice_code: numberType === 'legacy' ? invoiceCode.trim() : null,
        invoice_no: numberType === 'legacy' ? invoiceNo.trim() : null,
        invoice_date: invoiceDate,
        invoice_amount: Number(yuanFromCents(netCents)),
        tax_amount: Number(yuanFromCents(taxCents)),
        amount_with_tax: Number(yuanFromCents(preview.totalCents)),
        remark: remark.trim() || null
      })
      showToast?.('已登记研发进项发票 ' + result.invoice_number + ' 并关联 ' + result.allocated_bills + ' 张账单', 'success')
      try {
        await onReceived?.(result)
      } catch {
        onClose()
        showToast?.('发票关联成功，但列表刷新失败，请刷新页面查看', 'info')
      }
    } catch (error) {
      setReceiveError(error instanceof Error ? error.message : '进项发票登记失败，请核对并重试')
    } finally {
      submittingRef.current = false
      setReceiving(false)
    }
  }

  return (
    <div className="channel-invoice-merge-backdrop">
      <section className="channel-invoice-merge-dialog" role="dialog" aria-modal="true" aria-labelledby="rd-input-invoice-title">
        <header className="channel-invoice-merge-head">
          <div>
            <span>研发账单 / 进项发票</span>
            <h2 id="rd-input-invoice-title">{rows.length > 1 ? '合并收票' : '研发账单收票'}</h2>
            <p>从同一研发公司收取一张进项发票，关联多笔研发结算账单。</p>
          </div>
          <button type="button" aria-label="关闭研发收票窗口" className="channel-invoice-merge-close"
            onClick={onClose} disabled={receiving}>×</button>
        </header>

        <div className="channel-invoice-merge-body">
          <div className="channel-invoice-merge-notice">
            <strong>收票清单 ≠ 正式进项发票</strong>
            <span>先核对原始账单尚未关联的进项发票金额，向研发方索票。收到真实发票后，才登记号码与税额。</span>
          </div>

          <div className="channel-invoice-merge-totals">
            <div><span>已选择</span><strong>{rows.length} 张</strong></div>
            <div><span>研发公司（销售方）</span><strong className="is-company">{preview.partnerName || rows[0]?.partner || '待核对'}</strong></div>
            <div className="is-total"><span>待收进项发票（价税合计）</span>
              <strong>{loading ? '核对中…' : effectiveError ? '—' : money(preview.totalCents)}</strong></div>
          </div>

          {loading ? <p className="channel-invoice-merge-loading" role="status">正在核对现有进项发票关联记录，防止重复收票…</p> : null}
          {effectiveError ? (
            <div className="channel-invoice-merge-error" role="alert">
              <span>{effectiveError}</span>
              <button type="button" onClick={retryCoverage}>重新核对</button>
            </div>
          ) : null}

          {preview.items?.length ? (
            <div className="channel-invoice-merge-table-wrap">
              <table className="channel-invoice-merge-table">
                <thead><tr><th>账期</th><th>账单编号</th><th>研发应结</th><th>已关联进项发票</th><th>本次待收票</th></tr></thead>
                <tbody>{preview.items.map(item => (
                  <tr key={item.id}>
                    <td>{item.period}</td><td title={item.number}>{item.number}</td>
                    <td>{money(item.settlementCents)}</td><td>{money(item.allocatedCents)}</td>
                    <td className="is-emphasis">{money(item.remainingCents)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : null}

          <p className="channel-invoice-merge-explanation">
            <b>注意：</b>研发应结金额与实际付款金额不同。预付款抵扣、已付或未付款不会自动改变进项发票的应收取金额。
          </p>

          {!showReceiveForm && !loading && !effectiveError ? (
            <section className="channel-invoice-merge-steps">
              <strong>接下来</strong>
              <p>可复制收票清单发给研发公司。正式进项发票收到后，点击“登记已收进项发票并关联”。
                如果发票此前已录入系统，请到进项发票中心直接关联，避免重复登记。</p>
            </section>
          ) : null}

          {showReceiveForm && !loading && !effectiveError ? (
            <form id="rd-input-invoice-receive-form" onSubmit={event => void registerReceived(event)}>
              <div className="channel-invoice-merge-form-head">
                <h3>登记已实际收到的进项发票</h3>
                <p>以下信息必须与正式发票一致。请不要用尚未开出的收票申请代替正式发票。</p>
              </div>
              <div className="channel-invoice-merge-grid">
                <label><span>销售方：研发公司全称 *</span>
                  <input value={sellerName} onChange={event => setSellerName(event.target.value)} required /></label>
                <label><span>销售方税号 *</span>
                  <input value={sellerTaxNo} onChange={event => setSellerTaxNo(event.target.value)} placeholder="按真实发票填写" required /></label>
                <label><span>购买方：我司收票主体 *</span>
                  <input value={buyerName} onChange={event => setBuyerName(event.target.value)} placeholder="按发票购买方抬头填写" required /></label>
                <label><span>购买方税号 *</span>
                  <input value={buyerTaxNo} onChange={event => setBuyerTaxNo(event.target.value)} required /></label>
                <label><span>正式发票类型 *</span>
                  <select value={invoiceType} onChange={event => setInvoiceType(event.target.value)} required>
                    <option value="">选择票种</option>
                    {INVOICE_TYPES.map(type => <option value={type} key={type}>{type}</option>)}
                  </select></label>
                <label><span>实际开票日期 *</span>
                  <input type="date" value={invoiceDate} onChange={event => setInvoiceDate(event.target.value)} required /></label>
                <label><span>号码类型</span>
                  <select value={numberType} onChange={event => setNumberType(event.target.value)}>
                    <option value="digital">数电发票号码</option>
                    <option value="legacy">传统发票代码 + 发票号码</option>
                  </select></label>
                {numberType === 'digital' ? (
                  <label><span>正式数电发票号码 *</span>
                    <input value={digitalInvoiceNo} onChange={event => setDigitalInvoiceNo(event.target.value)} required /></label>
                ) : (
                  <>
                    <label><span>发票代码 *</span>
                      <input value={invoiceCode} onChange={event => setInvoiceCode(event.target.value)} required /></label>
                    <label><span>发票号码 *</span>
                      <input value={invoiceNo} onChange={event => setInvoiceNo(event.target.value)} required /></label>
                  </>
                )}
                <label><span>正式发票税额（元）*</span>
                  <input type="number" min="0" max={yuanFromCents(preview.totalCents)} step="0.01"
                    value={taxAmount} onChange={event => setTaxAmount(event.target.value)}
                    placeholder="按真实进项发票税额填写" required /></label>
                <div className="channel-invoice-merge-calculated">
                  <span>金额校验</span>
                  <strong>{taxValid ? money(netCents) : '—'} + {taxValid ? money(taxCents) : '—'} = {money(preview.totalCents)}</strong>
                  <small>不含税金额 + 税额 = 价税合计</small>
                </div>
                <label className="is-wide"><span>备注（可选）</span>
                  <input value={remark} onChange={event => setRemark(event.target.value)} placeholder="例如：2026年5—8月研发分成结算" /></label>
              </div>
              {sellerName.trim() && preview.partnerName &&
                sellerName.replace(/\s+/g, '') !== preview.partnerName.replace(/\s+/g, '') ? (
                <p className="channel-invoice-merge-warning">进项发票销售方与账单研发公司名称不同。请核对，后台会拒绝跨主体关联。</p>
              ) : null}
              {receiveError ? <div className="channel-invoice-merge-error" role="alert">{receiveError}</div> : null}
            </form>
          ) : null}
        </div>

        <footer className="channel-invoice-merge-footer">
          <button type="button" disabled={receiving} onClick={onClose}>取消</button>
          {!showReceiveForm ? (
            <>
              {onOpenExisting ? <button type="button" onClick={onOpenExisting} disabled={receiving}>已有发票，去进项中心关联</button> : null}
              <button type="button" disabled={loading || Boolean(effectiveError)} onClick={() => void copyInvoiceRequest()}>复制收票清单</button>
              <button type="button" className="is-primary" disabled={loading || Boolean(effectiveError)}
                onClick={() => setShowReceiveForm(true)}>已收到发票，登记并关联</button>
            </>
          ) : (
            <>
              <button type="button" disabled={receiving} onClick={() => setShowReceiveForm(false)}>返回清单</button>
              <button type="submit" form="rd-input-invoice-receive-form" className="is-primary"
                disabled={!canSubmit}>
                {receiving ? '正在登记关联…' : '确认收票并关联 ' + money(preview.totalCents)}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
