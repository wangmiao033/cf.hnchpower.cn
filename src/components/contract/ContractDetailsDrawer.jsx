import React, { useMemo, useState } from 'react'
import { uploadContractAttachment } from '@/lib/api/contract.ts'
import ContractStatusTag from './ContractStatusTag.jsx'

function DetailRow({ label, value }) {
  return (
    <div className="contract-detail-row">
      <span className="contract-detail-label">{label}</span>
      <span className="contract-detail-value">{value || '-'}</span>
    </div>
  )
}

function formatAmount(value) {
  if (value === null || value === undefined || value === '') return '-'
  return `¥ ${Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function normalizeAttachmentName(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase()
}

function formatFileSize(size) {
  const bytes = Number(size || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fileIcon(fileName) {
  const extension = String(fileName || '').split('.').pop()?.toLowerCase()
  if (extension === 'pdf') return 'PDF'
  if (['doc', 'docx', 'wps'].includes(extension)) return 'W'
  if (['xls', 'xlsx', 'et'].includes(extension)) return 'X'
  if (['jpg', 'jpeg', 'png'].includes(extension)) return '图'
  return '件'
}

function ContractDetailsDrawer({
  contract,
  onClose,
  onEdit,
  onAttachmentUploaded,
  onToast
}) {
  const [uploadingNames, setUploadingNames] = useState([])
  const [bulkUploading, setBulkUploading] = useState(false)

  const filesByExpectedName = useMemo(() => {
    const map = new Map()
    ;(contract?.attachment_files || []).forEach((file) => {
      const keys = [file.expected_name, file.file_name]
        .map(normalizeAttachmentName)
        .filter(Boolean)
      keys.forEach((key) => {
        if (!map.has(key)) map.set(key, file)
      })
    })
    return map
  }, [contract?.attachment_files])

  if (!contract) return null

  const expectedAttachments = contract.attachments || []
  const importedCount = contract.attachment_files?.length || 0

  const uploadOne = async (file, expectedName, { quiet = false } = {}) => {
    const key = expectedName || file.name
    setUploadingNames((items) => [...items, key])
    try {
      const result = await uploadContractAttachment(contract.id, file, expectedName)
      onAttachmentUploaded?.(result.contract)
      if (!quiet) {
        onToast?.(
          result.deduplicated ? `附件「${file.name}」已经导入过` : `附件「${file.name}」已导入`,
          'success'
        )
      }
      return true
    } catch (error) {
      onToast?.(error?.message || `附件「${file.name}」导入失败`, 'error')
      return false
    } finally {
      setUploadingNames((items) => items.filter((item) => item !== key))
    }
  }

  const handleBulkFiles = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setBulkUploading(true)
    let matched = 0
    let succeeded = 0
    for (const file of files) {
      const expectedName = expectedAttachments.find(
        (name) => normalizeAttachmentName(name) === normalizeAttachmentName(file.name)
      )
      if (!expectedName) continue
      matched += 1
      if (await uploadOne(file, expectedName, { quiet: true })) succeeded += 1
    }
    setBulkUploading(false)
    if (!matched) {
      onToast?.('所选文件名与当前合同的附件名称不一致，请单独选择对应文件。', 'info')
    } else {
      onToast?.(`批量导入完成：成功 ${succeeded} 个，匹配 ${matched} 个`, 'success')
    }
  }

  return (
    <div className="contract-drawer-mask" onClick={onClose}>
      <aside
        className="contract-drawer"
        aria-label="合同详情"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="contract-drawer-head">
          <div>
            <p>合同详情</p>
            <h3>{contract.contract_name || '-'}</h3>
            <div className="contract-drawer-badges">
              <ContractStatusTag status={contract.timeline_status} />
              {contract.partner_link_status === 'linked' ? (
                <span className="contract-link-badge">已关联客户库</span>
              ) : (
                <span className="contract-link-badge is-unlinked">未关联客户</span>
              )}
              {contract.contract_no_duplicate ? (
                <span className="contract-duplicate-badge">客户/原编号重复待核验</span>
              ) : null}
            </div>
          </div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>

        <div className="contract-drawer-amount">
          <span>合同总额</span>
          <strong>{formatAmount(contract.amount)}</strong>
          <small>{contract.payment_type || '账款类型未填写'}</small>
        </div>

        <div className="contract-drawer-section">
          <h4>基础信息</h4>
          <DetailRow label="我司合同编号" value={contract.internal_contract_no || '生成中'} />
          <DetailRow label="客户/原合同编号" value={contract.contract_no} />
          <DetailRow label="合同类型" value={contract.contract_type} />
          <DetailRow label="签订状态" value={contract.signing_status} />
          <DetailRow label="履约状态" value={contract.performance_status} />
          <DetailRow label="数据来源" value={contract.source === 'wps' ? 'WPS 合同台账' : '手工录入'} />
        </div>

        <div className="contract-drawer-section">
          <h4>合同主体</h4>
          <DetailRow label="签约方" value={contract.counterparty} />
          <DetailRow label="客户简称" value={contract.partner_short_name} />
          <DetailRow label="关联客户" value={contract.partner_name} />
        </div>

        <div className="contract-drawer-section">
          <h4>关键日期</h4>
          <DetailRow label="签订日期" value={contract.signing_date} />
          <DetailRow label="生效日期" value={contract.effective_date} />
          <DetailRow label="终止日期" value={contract.end_date} />
        </div>

        <div className="contract-drawer-section">
          <div className="contract-drawer-section__title">
            <h4>游戏接入清单</h4>
            <span>{contract.access_items?.length || 0} 个游戏</span>
          </div>
          {contract.access_items?.length ? (
            <div className="contract-drawer-access-list">
              {contract.access_items.map((item) => (
                <div key={item.id}>
                  <span>
                    <strong>{item.product_name}</strong>
                    <small>{item.channel_name || '渠道未填写'} · {item.agreement_type || '业务类型未填写'}</small>
                  </span>
                  <span>
                    <strong>{item.app_id || item.platform_record_id || '-'}</strong>
                    <small>{item.authorization_start || '-'} 至 {item.authorization_end || '-'}</small>
                  </span>
                  <ContractStatusTag status={item.timeline_status} />
                </div>
              ))}
            </div>
          ) : (
            <p className="contract-placeholder">尚未建立游戏接入清单</p>
          )}
        </div>

        <div className="contract-drawer-section contract-drawer-section--attachments">
          <div className="contract-attachment-heading">
            <div>
              <h4>合同附件</h4>
              <span>
                已导入 {importedCount} / {expectedAttachments.length} 个真实文件
              </span>
            </div>
            <label className={`contract-bulk-upload ${bulkUploading ? 'is-loading' : ''}`}>
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.wps,.et,.ofd,.txt,.jpg,.jpeg,.png,.zip,.rar,.7z"
                onChange={handleBulkFiles}
                disabled={bulkUploading}
              />
              {bulkUploading ? '正在匹配…' : '批量选择文件'}
            </label>
          </div>

          {expectedAttachments.length ? (
            <ul className="contract-attachment-list">
              {expectedAttachments.map((attachment, index) => {
                const importedFile = filesByExpectedName.get(normalizeAttachmentName(attachment))
                const uploading = uploadingNames.includes(attachment)
                return (
                  <li
                    className={importedFile ? 'is-imported' : 'is-pending'}
                    key={`${attachment}-${index}`}
                  >
                    <span className="contract-file-icon">
                      {fileIcon(importedFile?.file_name || attachment)}
                    </span>
                    <span className="contract-file-copy">
                      <strong>{attachment}</strong>
                      <small>
                        {importedFile
                          ? `已导入 · ${formatFileSize(importedFile.size_bytes)}`
                          : '等待导入真实文件'}
                      </small>
                    </span>
                    <span className="contract-file-actions">
                      {importedFile ? (
                        <>
                          <a
                            href={importedFile.preview_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            预览
                          </a>
                          <a href={importedFile.download_url}>下载</a>
                        </>
                      ) : (
                        <label className={uploading ? 'is-loading' : ''}>
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.wps,.et,.ofd,.txt,.jpg,.jpeg,.png,.zip,.rar,.7z"
                            disabled={uploading}
                            onChange={(event) => {
                              const file = event.target.files?.[0]
                              event.target.value = ''
                              if (file) uploadOne(file, attachment)
                            }}
                          />
                          {uploading ? '导入中…' : '选择文件'}
                        </label>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="contract-placeholder">该合同没有记录附件名称</p>
          )}
        </div>

        <div className="contract-drawer-actions">
          <button type="button" className="is-primary" onClick={() => onEdit?.(contract)}>
            编辑合同
          </button>
          <button type="button" onClick={onClose}>返回列表</button>
        </div>
      </aside>
    </div>
  )
}

export default ContractDetailsDrawer
