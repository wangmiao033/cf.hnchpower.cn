import { useEffect, useRef, useState } from 'react'

import {
  billAttachmentFileUrl,
  deleteBillAttachment,
  listBillAttachments,
  uploadBillAttachment,
} from '@/lib/api/billAttachments'

import './BillScanAttachments.css'

const MAX_FILE_SIZE = 4 * 1024 * 1024
const ACCEPTED_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.xlsx',
  '.xls',
  '.csv',
  '.docx',
  '.doc',
]
const ACCEPT_VALUE = ACCEPTED_EXTENSIONS.join(',')
const PREVIEWABLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'])
const FILE_KIND_LABELS = {
  '.jpg': 'JPG',
  '.jpeg': 'JPG',
  '.png': 'PNG',
  '.gif': 'GIF',
  '.webp': 'WEBP',
  '.pdf': 'PDF',
  '.xlsx': 'XLSX',
  '.xls': 'XLS',
  '.csv': 'CSV',
  '.docx': 'DOCX',
  '.doc': 'DOC',
}

const formatSize = (value) => {
  if (!value) return '0 KB'
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

const fileExtension = (name = '') => {
  const dotIndex = name.lastIndexOf('.')
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : ''
}

const fileKind = (name = '') => FILE_KIND_LABELS[fileExtension(name)] || 'FILE'
const canPreview = (name = '') => PREVIEWABLE_EXTENSIONS.has(fileExtension(name))

export default function BillScanAttachments({ billType, billId }) {
  const inputRef = useRef(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    if (!billId) {
      setItems([])
      return
    }
    setLoading(true)
    setError('')
    try {
      setItems(await listBillAttachments(billType, billId))
    } catch (err) {
      setError(err?.message || '读取附件失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [billType, billId])

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    if (!billId) {
      setError('请先保存账单，再上传附件。')
      return
    }

    const unsupported = files.find((file) => !ACCEPTED_EXTENSIONS.includes(fileExtension(file.name)))
    if (unsupported) {
      setError(`${unsupported.name} 格式不支持，请上传 Excel、CSV、PDF、Word 或图片文件。`)
      return
    }

    const oversized = files.find((file) => file.size > MAX_FILE_SIZE)
    if (oversized) {
      setError(`${oversized.name} 超过 4 MB`)
      return
    }

    setUploading(true)
    setDragging(false)
    setError('')
    setMessage('')
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        setMessage(`正在上传 ${index + 1}/${files.length}：${file.name}`)
        await uploadBillAttachment(billType, billId, file)
      }
      setMessage(`已上传 ${files.length} 个附件`)
      await refresh()
    } catch (err) {
      setMessage('')
      setError(err?.message || '上传附件失败')
    } finally {
      setUploading(false)
    }
  }

  const handleFiles = async (event) => {
    // FileList is live. Snapshot it before clearing the input so the selected
    // files are not discarded before uploadFiles reads them.
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    await uploadFiles(files)
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    if (!billId || uploading) return
    event.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDragging(false)
  }

  const handleDrop = async (event) => {
    event.preventDefault()
    setDragging(false)
    if (!billId || uploading) return
    await uploadFiles(event.dataTransfer.files)
  }

  const handleDelete = async (item) => {
    if (!window.confirm(`确定删除附件“${item.file_name}”吗？`)) return
    setError('')
    setMessage('')
    try {
      await deleteBillAttachment(billType, billId, item.id)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      setMessage('附件已删除')
    } catch (err) {
      setError(err?.message || '删除附件失败')
    }
  }

  return (
    <section
      className={`bill-scan-attachments ${dragging ? 'is-dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-busy={uploading || loading}
    >
      <div className="bill-scan-attachments__head">
        <div className="bill-scan-attachments__heading">
          <div className="bill-scan-attachments__title-row">
            <h3>账单附件</h3>
            {billId && !loading ? (
              <span className="bill-scan-attachments__count">{items.length} 个</span>
            ) : null}
          </div>
          <p>支持 JPG、PNG、GIF、WebP、PDF、Excel、CSV、Word，单个文件不超过 4 MB。</p>
          <span className="bill-scan-attachments__types">
            Excel / CSV / PDF / Word / 图片 · 支持多选与拖拽上传
          </span>
        </div>
        <button
          type="button"
          className="bill-scan-attachments__upload"
          disabled={!billId || uploading}
          onClick={() => inputRef.current?.click()}
          title={!billId ? '请先保存账单' : '选择一个或多个附件上传'}
        >
          {uploading ? '上传中...' : !billId ? '先保存账单' : '＋ 上传附件'}
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept={ACCEPT_VALUE}
          onChange={handleFiles}
        />
      </div>

      {!billId ? (
        <div className="bill-scan-attachments__empty">保存账单后即可上传表格、PDF、Word 或图片附件。</div>
      ) : null}
      {loading ? <div className="bill-scan-attachments__empty">正在读取附件...</div> : null}
      {dragging ? <div className="bill-scan-attachments__drop-hint">松开鼠标即可上传</div> : null}
      {error ? <div className="bill-scan-attachments__error">{error}</div> : null}
      {message ? <div className="bill-scan-attachments__success">{message}</div> : null}

      {billId && !loading && items.length === 0 && !dragging ? (
        <div className="bill-scan-attachments__empty">暂无附件，可点击右上角上传，也可直接将文件拖到这里。</div>
      ) : null}

      {items.length > 0 ? (
        <div className="bill-scan-attachments__list">
          {items.map((item) => (
            <div className="bill-scan-attachments__item" key={item.id}>
              <div className="bill-scan-attachments__meta">
                <div className="bill-scan-attachments__file-line">
                  <span className="bill-scan-attachments__type">{fileKind(item.file_name)}</span>
                  <strong title={item.file_name}>{item.file_name}</strong>
                </div>
                <span>
                  {formatSize(item.file_size)}
                  {item.created_at ? ` · ${new Date(item.created_at).toLocaleString('zh-CN')}` : ''}
                </span>
              </div>
              <div className="bill-scan-attachments__actions">
                {canPreview(item.file_name) ? (
                  <a
                    href={billAttachmentFileUrl(billType, billId, item.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    预览
                  </a>
                ) : null}
                <a href={billAttachmentFileUrl(billType, billId, item.id, false)}>下载</a>
                <button type="button" onClick={() => handleDelete(item)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
