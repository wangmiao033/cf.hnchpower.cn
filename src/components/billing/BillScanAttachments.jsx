import { useEffect, useRef, useState } from 'react'

import {
  billAttachmentFileUrl,
  deleteBillAttachment,
  listBillAttachments,
  uploadBillAttachment,
} from '@/lib/api/billAttachments'

import './BillScanAttachments.css'

const MAX_FILE_SIZE = 4 * 1024 * 1024

const formatSize = (value) => {
  if (!value) return '0 KB'
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export default function BillScanAttachments({ billType, billId }) {
  const inputRef = useRef(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
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

  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length || !billId) return
    const oversized = files.find((file) => file.size > MAX_FILE_SIZE)
    if (oversized) {
      setError(`${oversized.name} 超过 4 MB`)
      return
    }
    setUploading(true)
    setError('')
    setMessage('')
    try {
      for (const file of files) await uploadBillAttachment(billType, billId, file)
      setMessage(`已上传 ${files.length} 个文件`)
      await refresh()
    } catch (err) {
      setError(err?.message || '上传附件失败')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (item) => {
    if (!window.confirm(`确定删除附件“${item.file_name}”吗？`)) return
    setError('')
    try {
      await deleteBillAttachment(billType, billId, item.id)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
    } catch (err) {
      setError(err?.message || '删除附件失败')
    }
  }

  return (
    <section className="bill-scan-attachments">
      <div className="bill-scan-attachments__head">
        <div>
          <h3>盖章扫描件</h3>
          <p>支持 JPG、PNG、GIF、WebP、PDF，单个文件不超过 4 MB。</p>
        </div>
        <button
          type="button"
          className="bill-scan-attachments__upload"
          disabled={!billId || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? '上传中...' : '上传附件'}
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
          onChange={handleFiles}
        />
      </div>

      {!billId ? <div className="bill-scan-attachments__empty">请先保存账单，再上传盖章扫描件。</div> : null}
      {loading ? <div className="bill-scan-attachments__empty">正在读取附件...</div> : null}
      {error ? <div className="bill-scan-attachments__error">{error}</div> : null}
      {message ? <div className="bill-scan-attachments__success">{message}</div> : null}

      {billId && !loading && items.length === 0 ? (
        <div className="bill-scan-attachments__empty">暂无盖章扫描件</div>
      ) : null}

      {items.length > 0 ? (
        <div className="bill-scan-attachments__list">
          {items.map((item) => (
            <div className="bill-scan-attachments__item" key={item.id}>
              <div className="bill-scan-attachments__meta">
                <strong title={item.file_name}>{item.file_name}</strong>
                <span>
                  {formatSize(item.file_size)}
                  {item.created_at ? ` · ${new Date(item.created_at).toLocaleString('zh-CN')}` : ''}
                </span>
              </div>
              <div className="bill-scan-attachments__actions">
                <a href={billAttachmentFileUrl(billType, billId, item.id)} target="_blank" rel="noreferrer">查看</a>
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
