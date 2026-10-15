import React, { useRef, useState } from 'react'
import { parseElectronicInvoiceFile } from '@/lib/api/invoice.ts'

const SUFFIXES = ['.pdf', '.ofd', '.xml']

/** One existing backend invoice parser for all channel invoices; this widget
 * never creates a tax invoice or confirms a billing allocation on upload.
 */
export default function ChannelInvoiceSmartUpload({
  onParsed, onError, disabled = false, fileName = '', warnings = [], existing = false
}) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const receive = async file => {
    if (!file || disabled || busy) return
    if (!SUFFIXES.some(ext => String(file.name || '').toLowerCase().endsWith(ext))) {
      onError?.('仅支持原始电子发票 PDF、OFD 或 XML 文件')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      onError?.('单张电子发票不可超过 4MB')
      return
    }
    setBusy(true)
    try {
      // "output": channel payouts paid to us require the customer's
      // buyer name and our seller info, never an input invoice.
      const result = await parseElectronicInvoiceFile(file, 'output')
      await onParsed?.(result, file)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : '发票识别失败；可选择手工登记')
    } finally {
      setBusy(false)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <section className="channel-invoice-smart-upload" aria-label="上传已经开具的电子发票">
      <input ref={ref} hidden type="file" accept=".pdf,.ofd,.xml,application/pdf"
        aria-label="选择电子发票文件" onChange={event => void receive(event.target.files?.[0])} />
      <div className={'channel-invoice-smart-upload__drop ' + (dragging ? 'is-dragging' : '')}
        onDragEnter={event => { event.preventDefault(); setDragging(true) }}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={event => { event.preventDefault(); setDragging(false) }}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)
          void receive(event.dataTransfer.files?.[0])
        }}>
        <div className="channel-invoice-smart-upload__icon" aria-hidden="true">票</div>
        <div>
          <strong>{busy ? '正在读取正式发票信息…' : fileName ? '发票文件已识别' : '已经收到发票？直接上传识别'}</strong>
          <small>{fileName || '拖入 PDF / OFD / XML，或点击右侧选择文件 · ≤4MB'}</small>
        </div>
        <button type="button" disabled={disabled || busy} onClick={() => ref.current?.click()}>
          {busy ? '识别中…' : fileName ? '重新选择' : '选择电子发票'}
        </button>
      </div>
      {existing ? <p className="channel-invoice-smart-upload__existing">这张正式发票已在发票库中，系统会优先关联已有记录，避免重复建票。</p> : null}
      {warnings?.length ? <p className="channel-invoice-smart-upload__warnings" role="status">识别提醒：{warnings.join('；')}。请核对后确认。</p> : null}
    </section>
  )
}
