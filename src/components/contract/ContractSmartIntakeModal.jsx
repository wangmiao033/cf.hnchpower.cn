import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import {
  createContract,
  createContractAccessItem,
  uploadContractAttachment
} from '@/lib/api/contract.ts'
import { scanContractFile } from '@/lib/api/contractSmartScan.ts'
import './ContractSmartIntakeModal.css'

const CONTRACT_FIELDS = [
  ['contract_name', '合同名称', true],
  ['counterparty', '合同签约方', true],
  ['contract_type', '合同类型'],
  ['contract_no', '客户/原合同编号'],
  ['amount', '固定合同总额'],
  ['signing_date', '签订日期', false, 'date'],
  ['effective_date', '生效日期', false, 'date'],
  ['end_date', '终止日期', false, 'date'],
  ['signing_status', '签订状态'],
  ['performance_status', '履约状态'],
  ['payment_type', '账款类型']
]

const DOCUMENT_TYPE_OPTIONS = [
  ['master', '主合同'],
  ['supplement', '补充协议'],
  ['transfer', '主体变更 / 转让'],
  ['other', '其他']
]

function confidenceTone(value) {
  const score = Number(value || 0)
  if (score >= 0.85) return 'high'
  if (score >= 0.6) return 'medium'
  return 'low'
}

function confidenceText(value) {
  const score = Number(value || 0)
  if (score >= 0.85) return `高 ${Math.round(score * 100)}%`
  if (score >= 0.6) return `需确认 ${Math.round(score * 100)}%`
  return `低 ${Math.round(score * 100)}%`
}

function bytes(value) {
  const number = Number(value || 0)
  if (number < 1024 * 1024) return `${Math.max(1, Math.round(number / 1024))} KB`
  return `${(number / 1024 / 1024).toFixed(1)} MB`
}

function initialContractForm(result) {
  return {
    ...result.contract,
    document_type: result.contract.document_type || 'master',
    platform_record_id: '',
    attachments: ''
  }
}

function initialAccessRows(result) {
  return (result.access_items || []).map((item, index) => ({
    id: `scan-access-${index}`,
    enabled: true,
    values: {
      channel_name: item.values.channel_name || '',
      agreement_type: item.values.agreement_type || '联合运营',
      platform_record_id: '',
      product_name: item.values.product_name || '',
      app_id: '',
      platform: item.values.platform || '其他',
      language: '简体中文',
      category: '',
      rights_source: '授权获得',
      game_status: '上架',
      agreement_status: '已签约',
      authorization_start: item.values.authorization_start || result.contract.effective_date || '',
      authorization_end: item.values.authorization_end || result.contract.end_date || '',
      share_rate: item.values.share_rate || '',
      channel_fee_rate: item.values.channel_fee_rate || '',
      software_copyright_no: '',
      isbn: '',
      territory: '',
      status: item.values.status || '生效',
      remarks: item.values.remarks || ''
    },
    confidence: item.confidence || {},
    evidence: item.evidence || {}
  }))
}

export default function ContractSmartIntakeModal({ onClose, onSaved }) {
  const { showToast } = useAppState()
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [contractForm, setContractForm] = useState(null)
  const [accessRows, setAccessRows] = useState([])
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scanError, setScanError] = useState('')
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const flaggedCount = useMemo(() => {
    if (!scanResult) return 0
    return CONTRACT_FIELDS.filter(([key]) => Number(scanResult.confidence?.[key] || 0) < 0.85).length
  }, [scanResult])

  const startScan = async (nextFile) => {
    if (!nextFile) return
    const allowed = /\.(pdf|jpe?g|png|webp)$/i.test(nextFile.name)
    if (!allowed) {
      showToast('智能录入支持 PDF、JPG、PNG、WEBP 文件', 'error')
      return
    }
    if (nextFile.size > 4 * 1024 * 1024) {
      showToast('智能识别文件不能超过 4MB', 'error')
      return
    }
    setFile(nextFile)
    setScanResult(null)
    setContractForm(null)
    setAccessRows([])
    setScanError('')
    setScanning(true)
    try {
      const result = await scanContractFile(nextFile)
      setScanResult(result)
      setContractForm(initialContractForm(result))
      setAccessRows(initialAccessRows(result))
    } catch (error) {
      console.error(error)
      setScanError(error instanceof Error ? error.message : '合同智能识别失败，请稍后重试。')
    } finally {
      setScanning(false)
    }
  }

  const updateContractField = (key, value) => {
    setContractForm((current) => ({ ...current, [key]: value }))
  }

  const updateAccessField = (rowId, key, value) => {
    setAccessRows((rows) => rows.map((row) => (
      row.id === rowId ? { ...row, values: { ...row.values, [key]: value } } : row
    )))
  }

  const saveAll = async () => {
    if (!file || !contractForm || saving) return
    if (!String(contractForm.contract_name || '').trim()) {
      showToast('请确认合同名称', 'error')
      return
    }
    if (!String(contractForm.counterparty || '').trim()) {
      showToast('请确认合同签约方', 'error')
      return
    }
    setSaving(true)
    let created = null
    try {
      created = await createContract({
        ...contractForm,
        amount: contractForm.amount || null,
        signing_date: contractForm.signing_date || null,
        effective_date: contractForm.effective_date || null,
        end_date: contractForm.end_date || null,
        attachments: [file.name]
      })

      let attachmentSaved = true
      try {
        await uploadContractAttachment(created.id, file, file.name)
      } catch (attachmentError) {
        attachmentSaved = false
        console.error(attachmentError)
      }

      let accessCreated = 0
      let accessFailed = 0
      for (const row of accessRows) {
        if (!row.enabled || !String(row.values.product_name || '').trim()) continue
        try {
          await createContractAccessItem(created.id, {
            ...row.values,
            authorization_start: row.values.authorization_start || null,
            authorization_end: row.values.authorization_end || null,
            share_rate: row.values.share_rate === '' ? null : row.values.share_rate,
            channel_fee_rate: row.values.channel_fee_rate === '' ? null : row.values.channel_fee_rate
          })
          accessCreated += 1
        } catch (accessError) {
          console.error(accessError)
          accessFailed += 1
        }
      }

      const pieces = ['合同已保存', '我司合同编号已自动生成']
      pieces.push(attachmentSaved ? '原文件已归档' : '原文件归档失败，可在合同详情补传')
      if (accessCreated) pieces.push(`已创建 ${accessCreated} 条游戏接入清单`)
      if (accessFailed) pieces.push(`${accessFailed} 条接入清单需手工补录`)
      showToast(pieces.join(' · '), attachmentSaved && accessFailed === 0 ? 'success' : 'info')
      onSaved?.(created)
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : '智能录入保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const hasResult = Boolean(scanResult && contractForm)
  const isImage = file && /^image\//.test(file.type)

  return (
    <div className="contract-ai-mask" role="dialog" aria-modal="true" aria-label="智能录入合同">
      <div className="contract-ai-modal">
        <header className="contract-ai-head">
          <div>
            <span>AI CONTRACT INTAKE</span>
            <h2>上传合同，自动扫描填表</h2>
            <p>支持扫描版 PDF 和图片。系统只生成候选字段，确认后才写入合同台账。</p>
          </div>
          <button type="button" className="contract-ai-close" onClick={onClose} disabled={saving}>×</button>
        </header>

        {!file ? (
          <section
            className={`contract-ai-dropzone ${dragging ? 'is-dragging' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              void startScan(event.dataTransfer.files?.[0])
            }}
          >
            <div className="contract-ai-upload-icon" aria-hidden="true">⇧</div>
            <h3>拖一份合同到这里</h3>
            <p>PDF / JPG / PNG / WEBP · 最大 4MB</p>
            <button type="button" onClick={() => inputRef.current?.click()}>选择合同文件</button>
            <small>扫描件也可以直接识别，不要求 PDF 有文字层。</small>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => void startScan(event.target.files?.[0])}
            />
          </section>
        ) : (
          <div className="contract-ai-body">
            <section className="contract-ai-preview-panel">
              <div className="contract-ai-filebar">
                <div>
                  <strong>{file.name}</strong>
                  <span>{bytes(file.size)}</span>
                </div>
                <button type="button" disabled={scanning || saving} onClick={() => {
                  setFile(null)
                  setScanResult(null)
                  setContractForm(null)
                  setAccessRows([])
                  setScanError('')
                }}>换一份</button>
              </div>
              <div className="contract-ai-preview">
                {isImage ? <img src={previewUrl} alt="合同原件预览" /> : <iframe src={previewUrl} title="合同原件预览" />}
              </div>
              <div className="contract-ai-privacy">文件用于本次智能识别；识别结果不会自动写库，只有点击“确认并保存”才创建合同。</div>
            </section>

            <section className="contract-ai-result-panel">
              {scanning ? (
                <div className="contract-ai-scanning">
                  <span className="contract-ai-spinner" />
                  <h3>正在扫描合同…</h3>
                  <p>正在识别标题、双方主体、有效期、结算方式、金额和游戏合作信息。</p>
                  <small>扫描件通常需要几十秒，请不要关闭窗口。</small>
                </div>
              ) : scanError ? (
                <div className="contract-ai-error">
                  <strong>没有识别成功</strong>
                  <p>{scanError}</p>
                  <button type="button" onClick={() => void startScan(file)}>重新扫描</button>
                </div>
              ) : hasResult ? (
                <>
                  <div className="contract-ai-result-summary">
                    <div>
                      <span>提取结果</span>
                      <h3>{scanResult.summary || '合同字段已提取，请确认后保存'}</h3>
                    </div>
                    <div className={flaggedCount ? 'needs-review' : 'all-good'}>
                      <strong>{flaggedCount}</strong>
                      <span>项需确认</span>
                    </div>
                  </div>

                  {scanResult.warnings?.length ? (
                    <div className="contract-ai-warnings">
                      {scanResult.warnings.map((warning, index) => <span key={`${warning}-${index}`}>{warning}</span>)}
                    </div>
                  ) : null}

                  <div className="contract-ai-parties">
                    <span>甲方：{scanResult.parties?.party_a || '未识别'}</span>
                    <span>乙方：{scanResult.parties?.party_b || '未识别'}</span>
                    <span>系统主体：{scanResult.parties?.our_party || '需人工确认'}</span>
                    <span>我司合同编号：保存后自动生成</span>
                  </div>

                  <div className="contract-ai-fields">
                    <label className="contract-ai-field">
                      <span className="contract-ai-field-label">档案角色</span>
                      <select value={contractForm.document_type || 'master'} onChange={(event) => updateContractField('document_type', event.target.value)}>
                        {DOCUMENT_TYPE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    {CONTRACT_FIELDS.map(([key, label, required, type]) => (
                      <label className={`contract-ai-field confidence-${confidenceTone(scanResult.confidence?.[key])}`} key={key}>
                        <span className="contract-ai-field-label">
                          {label}{required ? ' *' : ''}
                          <em>{confidenceText(scanResult.confidence?.[key])}</em>
                        </span>
                        <input
                          type={type || 'text'}
                          required={Boolean(required)}
                          value={contractForm[key] || ''}
                          onChange={(event) => updateContractField(key, event.target.value)}
                          placeholder={Number(scanResult.confidence?.[key] || 0) < 0.6 ? 'AI 未确认，请人工填写' : ''}
                        />
                        {scanResult.evidence?.[key] ? <small title={scanResult.evidence[key]}>依据：{scanResult.evidence[key]}</small> : null}
                      </label>
                    ))}
                  </div>

                  {accessRows.length ? (
                    <div className="contract-ai-access-section">
                      <div className="contract-ai-section-title">
                        <div><strong>检测到游戏合作信息</strong><span>勾选后会随主合同一起创建游戏接入清单。</span></div>
                      </div>
                      {accessRows.map((row) => (
                        <div className="contract-ai-access-card" key={row.id}>
                          <label className="contract-ai-check">
                            <input type="checkbox" checked={row.enabled} onChange={(event) => setAccessRows((rows) => rows.map((item) => item.id === row.id ? { ...item, enabled: event.target.checked } : item))} />
                            <strong>同时创建接入清单</strong>
                          </label>
                          <div className="contract-ai-access-grid">
                            <Field label="游戏名称" value={row.values.product_name} onChange={(value) => updateAccessField(row.id, 'product_name', value)} />
                            <Field label="合作渠道/平台" value={row.values.channel_name} onChange={(value) => updateAccessField(row.id, 'channel_name', value)} />
                            <Field label="业务类型" value={row.values.agreement_type} onChange={(value) => updateAccessField(row.id, 'agreement_type', value)} />
                            <Field label="授权开始" type="date" value={row.values.authorization_start} onChange={(value) => updateAccessField(row.id, 'authorization_start', value)} />
                            <Field label="授权结束" type="date" value={row.values.authorization_end} onChange={(value) => updateAccessField(row.id, 'authorization_end', value)} />
                            <Field label="我方分成（%）" value={row.values.share_rate} onChange={(value) => updateAccessField(row.id, 'share_rate', value)} />
                            <Field label="支付渠道成本（%）" value={row.values.channel_fee_rate} onChange={(value) => updateAccessField(row.id, 'channel_fee_rate', value)} />
                            <Field label="结算/特殊条款" wide value={row.values.remarks} onChange={(value) => updateAccessField(row.id, 'remarks', value)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          </div>
        )}

        <footer className="contract-ai-footer">
          <div>
            {scanResult ? <span>模型：{scanResult.model} · 低置信字段请人工确认</span> : <span>不会自动覆盖已有合同</span>}
          </div>
          <div>
            <button type="button" onClick={onClose} disabled={saving}>取消</button>
            <button type="button" className="primary" onClick={() => void saveAll()} disabled={!hasResult || scanning || saving}>
              {saving ? '正在保存合同…' : '确认并保存'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function Field({ label, wide, onChange, ...props }) {
  return (
    <label className={wide ? 'is-wide' : ''}>
      <span>{label}</span>
      <input {...props} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
