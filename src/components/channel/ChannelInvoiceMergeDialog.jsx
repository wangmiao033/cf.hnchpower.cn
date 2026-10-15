import React, { useEffect, useMemo, useState } from 'react'
import { getBillInvoiceSummary } from '@/lib/api/billInvoiceAllocations.ts'
import { recordIssuedChannelInvoiceMerge } from '@/lib/api/channelInvoiceMerge.ts'
import { prepareChannelInvoiceMerge, yuanFromCents } from '@/domain/channel/channelInvoiceMerge.js'
import { listChannelRecords, apiChannelRowToFrontend } from '@/lib/api/channel.ts'
import ChannelInvoiceSmartUpload from './ChannelInvoiceSmartUpload.jsx'
import ChannelInvoiceBillSuggestions from './ChannelInvoiceBillSuggestions.jsx'
import {
  eligibleInvoicePartnerRows, invoiceBuyerMatchesPartner, recommendInvoiceBillSet,
  scannedInvoiceAmountState
} from '@/domain/channel/channelInvoiceUploadMatch.js'
import './ChannelInvoiceMergeDialog.css'

const money = cents => '¥' + (Number(cents || 0) / 100).toLocaleString('zh-CN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
})
const INVOICE_TYPES = [
  '数电发票（增值税普通发票）', '数电发票（增值税专用发票）',
  '增值税普通发票', '增值税专用发票',
  '电子发票', '电子发票（增值税普通发票）', '电子发票（增值税专用发票）'
]

export default function ChannelInvoiceMergeDialog({ rows, onClose, onIssued, showToast }) {
  const [summaries, setSummaries] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [showIssueForm, setShowIssueForm] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState('')
  const [buyerName, setBuyerName] = useState(String(rows?.[0]?.partnerName || '').trim())
  const [buyerTaxNo, setBuyerTaxNo] = useState('')
  const [sellerName, setSellerName] = useState('')
  const [sellerTaxNo, setSellerTaxNo] = useState('')
  const [invoiceType, setInvoiceType] = useState('')
  const [numberType, setNumberType] = useState('digital')
  const [digitalInvoiceNo, setDigitalInvoiceNo] = useState('')
  const [invoiceCode, setInvoiceCode] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [taxAmount, setTaxAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => (rows || []).map(item => String(item.id)))
  const [otherBills, setOtherBills] = useState([])
  const [otherBillSummaries, setOtherBillSummaries] = useState({})
  const [findingBills, setFindingBills] = useState(false)
  const [matchingWarning, setMatchingWarning] = useState('')
  const [scanned, setScanned] = useState(null)
  const [invoiceGross, setInvoiceGross] = useState('')
  const [showFields, setShowFields] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const allRows = useMemo(() => {
    const byId = new Map()
    ;[...(rows || []), ...otherBills].forEach(row => byId.set(String(row.id), row))
    return [...byId.values()]
  }, [rows, otherBills])
  const selectedRows = useMemo(() =>
    allRows.filter(row => selectedIds.includes(String(row.id))),
  [allRows, selectedIds])

  useEffect(() => {
    let active = true
    setSummaries(null)
    setLoadError('')
    setLoading(true)
    Promise.all(selectedRows.map(row => getBillInvoiceSummary('channel', String(row.id))))
      .then(result => { if (active) setSummaries(result) })
      .catch(error => {
        if (active) setLoadError(error instanceof Error ? error.message : '发票关联状态读取失败')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedRows, retry])

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape' && !issuing) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [issuing, onClose])

  const preview = useMemo(
    () => prepareChannelInvoiceMerge(selectedRows, summaries),
    [selectedRows, summaries]
  )
  const effectiveError = loadError || (loading ? '' : preview.error)
  const taxCents = taxAmount.trim() === '' ? NaN : Math.round(Number(taxAmount) * 100)
  const validTax = Number.isFinite(taxCents) && taxCents >= 0 && taxCents <= preview.totalCents
  const netCents = validTax ? preview.totalCents - taxCents : null
  const amountMatch = !scanned || scannedInvoiceAmountState(invoiceGross, preview.totalCents).kind === 'match'
  const buyerMatches = !scanned || invoiceBuyerMatchesPartner(buyerName, rows?.[0]?.partnerName)
  const recommended = useMemo(() => {
    if (!scanned || !summaries || findingBills) return { ids: [], unique: false, ambiguous: false }
    return recommendInvoiceBillSet(invoiceGross, selectedRows, summaries,
      otherBills.filter(row => !selectedIds.includes(String(row.id))).map(row => ({
        id: String(row.id),
        remaining_amount: otherBillSummaries[String(row.id)]?.remaining_amount ?? 0
      })))
  }, [scanned, invoiceGross, selectedRows, summaries, findingBills, otherBills, selectedIds, otherBillSummaries])
  const officialNumberValid = numberType === 'digital'
    ? Boolean(digitalInvoiceNo.trim())
    : Boolean(invoiceCode.trim() && invoiceNo.trim())
  const readyToRecord = !loading && !effectiveError && !issuing &&
    buyerName.trim() && buyerTaxNo.trim() && sellerName.trim() &&
    invoiceType && invoiceDate && officialNumberValid && validTax && amountMatch && buyerMatches


  const findOtherInvoiceBills = async parsed => {
    const partner = String(rows?.[0]?.partnerName || '').trim()
    if (!partner || !parsed?.invoice) return
    setFindingBills(true)
    setMatchingWarning('')
    try {
      const result = await listChannelRecords({ search: partner, limit: 500, offset: 0 })
      const otherIds = (rows || []).map(item => String(item.id))
      const candidates = eligibleInvoicePartnerRows(
        (result.items || []).map(apiChannelRowToFrontend), partner, otherIds
      ).slice(0, 30)
      const matching = await Promise.all(candidates.map(async row => {
        const summary = await getBillInvoiceSummary('channel', String(row.id))
        return { row, summary }
      }))
      const withRemaining = matching.filter(item => Number(item.summary.remaining_amount || 0) > 0.009)
      setOtherBills(withRemaining.map(item => item.row))
      setOtherBillSummaries(Object.fromEntries(withRemaining.map(item => [String(item.row.id), item.summary])))
      if (Number(result.total) > 500) setMatchingWarning('历史账单超过500张，只展示当前加载的同主体账单；如未找到完整组合，请在账单列表勾选其他月份后关联。')
    } catch (error) {
      setMatchingWarning(error instanceof Error ? error.message : '其他月份的账单暂时查询失败，请手动选择相关账单')
    } finally {
      setFindingBills(false)
    }
  }

  const handleParsedFile = async (parsed, file) => {
    const invoice = parsed.invoice || {}
    const gross = Number(invoice.amount_with_tax || 0)
    setScanned({
      fileName: file.name,
      confidence: Number(parsed.confidence || 0),
      warnings: parsed.warnings || [],
      proof: parsed.source_file_proof || '',
      existingInvoiceId: String(parsed.existing_invoice_id || '')
    })
    setInvoiceGross(gross > 0 ? gross.toFixed(2) : '')
    setBuyerName(String(invoice.buyer_name || rows?.[0]?.partnerName || '').trim())
    setBuyerTaxNo(String(invoice.buyer_tax_no || ''))
    setSellerName(String(invoice.seller_name || ''))
    setSellerTaxNo(String(invoice.seller_tax_no || ''))
    setInvoiceType(String(invoice.invoice_type || ''))
    const legacy = !invoice.digital_invoice_no && Boolean(invoice.invoice_code)
    setNumberType(legacy ? 'legacy' : 'digital')
    setDigitalInvoiceNo(String(invoice.digital_invoice_no || ''))
    setInvoiceCode(String(invoice.invoice_code || ''))
    setInvoiceNo(String(invoice.invoice_no || ''))
    setInvoiceDate(String(invoice.invoice_date || ''))
    setTaxAmount(invoice.tax_amount == null ? '' : Number(invoice.tax_amount).toFixed(2))
    setShowIssueForm(true)
    setIssueError('')
    setUploadError('')
    const complete = Boolean(
      invoice.buyer_name && invoice.buyer_tax_no && invoice.seller_name &&
      invoice.invoice_date && (invoice.digital_invoice_no || (invoice.invoice_code && invoice.invoice_no)) &&
      gross > 0 && invoice.tax_amount != null
    )
    setShowFields(!complete)
    // Recommendations use independent legal-party plus server-side invoice
    // remaining amounts; no matching based on the uploaded filename.
    await findOtherInvoiceBills(parsed)
  }

  const toggleCandidate = (billId, checked) => {
    setSelectedIds(previous => checked
      ? [...new Set([...previous, billId])]
      : previous.filter(id => id !== billId)
    )
  }
  const addRecommendedBills = () => {
    setSelectedIds(previous => [...new Set([...previous, ...recommended.ids])])
  }

  const copyDetails = async () => {
    if (effectiveError || loading || !preview.totalCents) return
    const content = [
      '合并开票资料（开票申请，非正式税务发票）',
      '购方名称：' + (buyerName.trim() || preview.partnerName),
      '购方税号：' + (buyerTaxNo.trim() || '待填写'),
      '拟开票价税合计：' + money(preview.totalCents),
      '发票类型：' + (invoiceType || '待确认'),
      '涉及账单：',
      ...preview.items.map(item => '· ' + item.period + ' / ' + item.number + ' / ' + money(item.remainingCents)),
      '备注：此清单仅用于开票申请，实际开票后请返回系统登记号码并关联原账单。'
    ].join('\n')
    try {
      await navigator.clipboard.writeText(content)
      showToast?.('已复制合并开票资料；尚未生成正式发票', 'success')
    } catch {
      window.prompt('请复制以下开票资料', content)
    }
  }

  const recordIssued = async event => {
    event.preventDefault()
    if (!readyToRecord) return
    const number = numberType === 'digital' ? digitalInvoiceNo : invoiceCode + '-' + invoiceNo
    if (!window.confirm(
      '请确认：税务平台已实际开出发票 ' + number + '。\n' +
      '本次关联 ' + selectedRows.length + ' 张账单，价税合计 ' + money(preview.totalCents) + '。\n\n' +
      (scanned?.existingInvoiceId ? '将复用发票库已存在的正式发票，不再重复录入。' : '将登记该正式发票并关联账单。') +
      '不会修改原账单金额或回款数据。'
    )) return
    setIssuing(true)
    setIssueError('')
    try {
      const result = await recordIssuedChannelInvoiceMerge({
        bill_ids: preview.items.map(item => item.id),
        buyer_name: buyerName.trim(),
        buyer_tax_no: buyerTaxNo.trim(),
        seller_name: sellerName.trim(),
        seller_tax_no: sellerTaxNo.trim() || null,
        invoice_type: invoiceType,
        digital_invoice_no: numberType === 'digital' ? digitalInvoiceNo.trim() : null,
        invoice_code: numberType === 'legacy' ? invoiceCode.trim() : null,
        invoice_no: numberType === 'legacy' ? invoiceNo.trim() : null,
        invoice_date: invoiceDate,
        invoice_amount: Number(yuanFromCents(netCents)),
        tax_amount: Number(yuanFromCents(taxCents)),
        amount_with_tax: Number(yuanFromCents(preview.totalCents)),
        source_file_proof: scanned?.proof || null,
        existing_invoice_id: scanned?.existingInvoiceId || null,
        remark: remark.trim() || null
      })
      showToast?.('发票 ' + result.invoice_number + (result.linked_existing ? ' 已复用并关联 ' : ' 已登记并关联 ') + result.allocated_bills + ' 张账单', 'success')
      try {
        await onIssued?.(result)
      } catch {
        showToast?.('发票关联成功，但列表刷新失败，请手动刷新页面查看', 'info')
        onClose()
      }
    } catch (error) {
      setIssueError(error instanceof Error ? error.message : '发票登记失败，请刷新数据后重试')
    } finally {
      setIssuing(false)
    }
  }

  return (
    <div className="channel-invoice-merge-backdrop">
      <section className="channel-invoice-merge-dialog" role="dialog" aria-modal="true" aria-labelledby="channel-invoice-merge-title">
        <header className="channel-invoice-merge-head">
          <div>
            <span>渠道账单 / 发票</span>
            <h2 id="channel-invoice-merge-title">{rows.length > 1 ? '多账单发票关联' : '智能发票关联'}</h2>
            <p>上传已有电子发票，自动识别号码、金额并推荐账单；确认前不会修改记录。</p>
          </div>
          <button type="button" className="channel-invoice-merge-close" aria-label="关闭合并开票" disabled={issuing} onClick={onClose}>×</button>
        </header>

        <div className="channel-invoice-merge-body">
          <div className="channel-invoice-merge-notice">
            <strong>已经拿到正式电子发票？上传即可识别</strong>
            <span>尚未开票可以复制下方清单。系统只登记关联已开的发票，不会代替税务平台开票。</span>
          </div>
          <div className="channel-invoice-merge-totals">
            <div><span>已选原始账单</span><strong>{selectedRows.length} 张</strong></div>
            <div><span>合作方</span><strong className="is-company">{preview.partnerName || rows[0]?.partnerName || '待确认'}</strong></div>
            <div className="is-total"><span>剩余可开票（价税合计）</span><strong>{loading ? '核对中…' : effectiveError ? '—' : money(preview.totalCents)}</strong></div>
          </div>

          <ChannelInvoiceSmartUpload disabled={issuing}
            fileName={scanned?.fileName || ''}
            warnings={scanned?.warnings || []}
            existing={Boolean(scanned?.existingInvoiceId)}
            onParsed={handleParsedFile}
            onError={message => { setUploadError(message); showToast?.(message, 'error') }}
          />
          {uploadError ? <p className="channel-invoice-merge-error" role="alert">{uploadError}。可用原始 PDF/OFD/XML 重试，或选择手工登记。</p> : null}
          {loading ? <p className="channel-invoice-merge-loading" role="status">正在核对已关联发票金额，防止重复开票…</p> : null}
          {effectiveError ? (
            <div className="channel-invoice-merge-error" role="alert">
              <span>{effectiveError}</span>
              <button type="button" onClick={() => setRetry(current => current + 1)}>重新核对</button>
            </div>
          ) : null}
          {preview.items?.length ? (
            <div className="channel-invoice-merge-table-wrap">
              <table className="channel-invoice-merge-table">
                <thead><tr><th>账期</th><th>原账单编号</th><th>账单结算额</th><th>已关联发票</th><th>本次拟开票</th></tr></thead>
                <tbody>{preview.items.map(item => (
                  <tr key={item.id}>
                    <td>{item.period || '—'}</td><td title={item.number}>{item.number}</td>
                    <td>{money(item.settlementCents)}</td><td>{money(item.invoicedCents)}</td>
                    <td className="is-emphasis">{money(item.remainingCents)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : null}
          <p className="channel-invoice-merge-explanation">计算依据为<b>发票关联余额</b>，不是“未收款”。已开票但未回款的账单不会重复开票。</p>

          {!effectiveError && !loading && !showIssueForm ? (
            <section className="channel-invoice-merge-steps">
              <strong>还没有正式发票？</strong>
              <p>可以复制开票清单交给开票人员，拿到正式发票后再上传。结算单 PDF 不等于正式税务发票。</p>
            </section>
          ) : null}

          {showIssueForm && !effectiveError && !loading ? (
            <form id="channel-invoice-issue-form" onSubmit={event => void recordIssued(event)}>
              <div className="channel-invoice-merge-form-head">
                <h3>{scanned ? '最后核对正式发票' : '手工登记正式发票'}</h3>
                <p>票号、购方、销方和税额必须以发票原件为准；系统不会开具新的税务发票。</p>
                {scanned ? <button type="button" className="channel-invoice-smart-extract__edit"
                  onClick={() => setShowFields(value => !value)}>
                  {showFields ? '收起校对字段' : '识别有误？展开校对字段'}
                </button> : null}
              </div>
              {showFields ? <div className="channel-invoice-merge-grid">
                <label><span>购方公司名称 *</span><input value={buyerName} onChange={event => setBuyerName(event.target.value)} required /></label>
                <label><span>购方税号 *</span><input value={buyerTaxNo} onChange={event => setBuyerTaxNo(event.target.value)} placeholder="购方统一社会信用代码" required /></label>
                <label><span>开票方公司名称 *</span><input value={sellerName} onChange={event => setSellerName(event.target.value)} placeholder="正式发票实际销售方" required /></label>
                <label><span>开票方税号</span><input value={sellerTaxNo} onChange={event => setSellerTaxNo(event.target.value)} /></label>
                <label><span>发票类型 *</span>
                  <select value={invoiceType} onChange={event => setInvoiceType(event.target.value)} required>
                    <option value="">请选择实际发票类型</option>
                    {INVOICE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label><span>开票日期 *</span><input type="date" value={invoiceDate} onChange={event => setInvoiceDate(event.target.value)} required /></label>
                <label><span>号码类型</span><select value={numberType} onChange={event => setNumberType(event.target.value)}>
                  <option value="digital">数电发票号码</option><option value="legacy">传统发票代码 + 号码</option>
                </select></label>
                {numberType === 'digital' ? (
                  <label><span>正式数电发票号码 *</span><input value={digitalInvoiceNo} onChange={event => setDigitalInvoiceNo(event.target.value)} required /></label>
                ) : (
                  <>
                    <label><span>发票代码 *</span><input value={invoiceCode} onChange={event => setInvoiceCode(event.target.value)} required /></label>
                    <label><span>发票号码 *</span><input value={invoiceNo} onChange={event => setInvoiceNo(event.target.value)} required /></label>
                  </>
                )}
                <label><span>发票实际税额（元）*</span>
                  <input type="number" min="0" max={yuanFromCents(preview.totalCents)} step="0.01" value={taxAmount}
                    onChange={event => setTaxAmount(event.target.value)} placeholder="照抄真实发票税额；零税额填 0" required />
                </label>
                <div className="channel-invoice-merge-calculated">
                  <span>金额核对</span>
                  <strong>{validTax ? money(netCents) : '—'} + {validTax ? money(taxCents) : '—'} = {money(preview.totalCents)}</strong>
                  <small>不含税金额 + 税额 = 开票价税合计</small>
                </div>
                <label className="is-wide"><span>备注（选填）</span><input value={remark} onChange={event => setRemark(event.target.value)} placeholder="例如：覆盖 2025 年 12 月至 2026 年 2 月" /></label>
              </div> : null}
              {!showFields && scanned ? <p className="channel-invoice-smart-extract__complete">
                识别字段已预填。请核对上方号码、主体与金额；如有识别错误，展开校对字段再确认。
              </p> : null}
              {buyerName.trim() && preview.partnerName && buyerName.trim() !== preview.partnerName ? (
                <p className="channel-invoice-merge-warning">购方名称与账单合作方不一致，请确认是否属于同一真实交易主体。</p>
              ) : null}
              {issueError ? <div className="channel-invoice-merge-error" role="alert">{issueError}</div> : null}
            </form>
          ) : null}
        </div>

        <footer className="channel-invoice-merge-footer">
          <button type="button" onClick={onClose} disabled={issuing}>取消</button>
          {!showIssueForm ? (
            <>
              <button type="button" disabled={loading || Boolean(effectiveError)} onClick={() => void copyDetails()}>复制开票清单</button>
              <button type="button" disabled={loading || Boolean(effectiveError)} onClick={() => { setShowFields(true); setShowIssueForm(true) }}>手动登记发票</button>
            </>
          ) : (
            <>
              <button type="button" disabled={issuing} onClick={() => setShowIssueForm(false)}>返回清单</button>
              <button type="submit" form="channel-invoice-issue-form" className="is-primary" disabled={!readyToRecord}>
                {issuing ? '正在核对并关联…' : '确认登记并关联 ' + money(preview.totalCents)}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
