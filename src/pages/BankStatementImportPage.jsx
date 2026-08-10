import React, { useMemo, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import PageContainer from '@/components/layout/PageContainer.jsx'
import BankPasteAutoParseBlock from '@/components/bank/BankPasteAutoParseBlock.jsx'
import { ApiError } from '@/lib/api/client.ts'
import { bulkImportBankTransactions, createBankTransaction } from '@/lib/api/bankTransaction.ts'
import { buildStatementImportPayload } from '@/lib/bank/bankTransactionPayloads.js'
import { icbcRowToBankTransaction, parseIcbcStatementExcel } from '@/utils/icbcStatementExcel.js'
import { parseBankText } from '@/utils/parseBankText.js'
import { parseBankReceipt } from '@/utils/parseBankReceipt.js'
import '@/components/reconciliation/reconciliation-admin.css'

const INITIAL = {
  tradeDate: '',
  bankAccount: '',
  counterpartyName: '',
  counterpartyAccount: '',
  summary: '',
  incomeAmount: '',
  expenseAmount: '',
  balance: '',
  serialNo: '',
  remark: ''
}

const DROP_STYLE = {
  border: '1.5px dashed var(--admin-border, #cbd5e1)',
  borderRadius: 12,
  padding: '28px 20px',
  textAlign: 'center',
  background: 'var(--admin-surface-2, #f8fafc)',
  transition: 'all .15s ease',
  cursor: 'pointer'
}

function fmtMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function BatchMetric({ label, value, sub }) {
  return (
    <div style={{ border: '1px solid var(--admin-border, #e2e8f0)', borderRadius: 10, padding: '12px 14px', minWidth: 150 }}>
      <div style={{ fontSize: 12, color: 'var(--admin-text-sub, #64748b)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: 'var(--admin-text-sub, #64748b)', marginTop: 4 }}>{sub}</div> : null}
    </div>
  )
}

function BankStatementImportPage() {
  const { showToast } = useAppState()
  const fileInputRef = useRef(null)
  const [batchFile, setBatchFile] = useState(null)
  const [batchData, setBatchData] = useState(null)
  const [bankAccount, setBankAccount] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  const [form, setForm] = useState(INITIAL)
  const [pasteText, setPasteText] = useState('')
  const [receiptText, setReceiptText] = useState('')
  const [receiptParse, setReceiptParse] = useState(null)
  const [saving, setSaving] = useState(false)

  const previewRows = useMemo(() => batchData?.rows?.slice(0, 50) || [], [batchData])
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const resetManual = (notify = true) => {
    setForm(INITIAL)
    setPasteText('')
    setReceiptText('')
    setReceiptParse(null)
    if (notify) showToast('已清空表单', 'info')
  }

  const parseFile = async (file) => {
    if (!file) return
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
      showToast('请选择工商银行导出的 .xlsx 或 .xls 文件', 'info')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast('文件超过 20MB，请拆分后再导入', 'info')
      return
    }
    setParsing(true)
    setImportResult(null)
    try {
      const parsed = await parseIcbcStatementExcel(file)
      setBatchFile(file)
      setBatchData(parsed)
      setBankAccount(parsed.metadata?.bankAccount || '')
      showToast(`已识别 ${parsed.rows.length} 笔有效流水，请核对后导入`, 'success')
    } catch (error) {
      setBatchFile(null)
      setBatchData(null)
      showToast(error instanceof Error ? error.message : 'Excel 解析失败', 'info')
    } finally {
      setParsing(false)
    }
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setDragActive(false)
    void parseFile(event.dataTransfer?.files?.[0])
  }

  const handleBatchImport = async () => {
    if (!batchData?.rows?.length || !batchFile) return
    setImporting(true)
    setImportResult(null)
    try {
      const items = batchData.rows.map((row) =>
        icbcRowToBankTransaction(row, {
          bankAccount,
          sourceBank: 'ICBC',
          fileName: batchFile.name
        })
      )
      const result = await bulkImportBankTransactions({
        source_bank: 'ICBC',
        source_file_name: batchFile.name,
        bank_account: bankAccount.trim() || null,
        items
      })
      setImportResult(result)
      if (result.inserted > 0) {
        showToast(`导入完成：新增 ${result.inserted} 笔，重复跳过 ${result.duplicates} 笔`, 'success')
      } else if (result.duplicates > 0) {
        showToast(`没有新增流水：${result.duplicates} 笔均已存在，系统已自动防重复`, 'info')
      } else {
        showToast('没有可导入的有效流水', 'info')
      }
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : '批量导入失败，请稍后重试', 'info')
    } finally {
      setImporting(false)
    }
  }

  const handleReceiptRecognize = () => {
    try {
      const r = parseBankReceipt(receiptText)
      setReceiptParse(r)
      if (!r.recognized) {
        showToast('未能从文本中识别出有效字段，可换行粘贴或检查是否含回单关键词', 'info')
        return
      }
      showToast('已解析，请核对预览后点击「确认填充」', 'success')
    } catch {
      showToast('识别过程异常，请简化文本后重试', 'info')
    }
  }

  const handleReceiptConfirmFill = () => {
    if (!receiptParse?.formPatch) return
    try {
      const patch = receiptParse.formPatch
      const { remark: patchRemark, ...rest } = patch
      setForm((prev) => {
        const next = { ...prev }
        for (const [k, v] of Object.entries(rest)) {
          if (v == null || String(v).trim() === '') continue
          if (k in next) next[k] = String(v).trim()
        }
        if (patchRemark && String(patchRemark).trim()) {
          const add = String(patchRemark).trim()
          next.remark = [prev.remark, add].filter(Boolean).join('\n').trim()
        }
        return next
      })
      showToast('已按预览填充表单', 'success')
    } catch {
      showToast('填充失败，请手动核对', 'info')
    }
  }

  const handleAutoFill = () => {
    try {
      const { fields, matchedLines } = parseBankText(pasteText)
      if (matchedLines === 0) {
        showToast('未能识别有效字段行，请使用「字段名: 值」格式分行粘贴', 'info')
        return
      }
      setForm((prev) => {
        const next = { ...prev }
        const assign = (key, val) => {
          if (val === null || val === undefined) return
          const s = typeof val === 'string' ? val.trim() : val
          if (s === '') return
          if (key in next) next[key] = typeof val === 'boolean' ? val : String(s)
        }
        assign('tradeDate', fields.tradeDate)
        assign('bankAccount', fields.bankAccount)
        assign('counterpartyName', fields.counterpartyName)
        assign('counterpartyAccount', fields.counterpartyAccount)
        assign('summary', fields.summary)
        assign('incomeAmount', fields.incomeAmount)
        assign('expenseAmount', fields.expenseAmount)
        assign('balance', fields.balance)
        assign('serialNo', fields.statement_serial_no || fields.bank_reference_no || fields.transaction_serial)
        if (fields.payment_remark) assign('remark', fields.payment_remark)
        return next
      })
      showToast(`已根据识别结果填充（共 ${matchedLines} 行有效映射）`, 'success')
    } catch {
      showToast('解析时出现问题，请检查文本格式后重试', 'info')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const body = buildStatementImportPayload(form, pasteText, receiptText)
      await createBankTransaction(body)
      showToast('保存成功。已写入服务端。', 'success')
      resetManual(false)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '保存失败，请检查网络或后端配置', 'info')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageContainer hideHeader className="page-container--admin-workspace">
      <div className="admin-workspace">
        <div className="admin-workspace__card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>工商银行 Excel 批量导入</h2>
              <p className="admin-workspace__card-desc" style={{ margin: 0 }}>
                直接拖入工行导出的 Excel。自动识别借/贷、对方单位、用途、摘要、附言、转入/转出金额和余额；后台按交易特征自动去重。
              </p>
            </div>
            {batchFile ? (
              <button type="button" className="rec-btn rec-btn--secondary" onClick={() => fileInputRef.current?.click()} disabled={parsing || importing}>
                更换文件
              </button>
            ) : null}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void parseFile(file)
            }}
          />

          <div
            role="button"
            tabIndex={0}
            onClick={() => !parsing && !importing && fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && !parsing && !importing) fileInputRef.current?.click()
            }}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true) }}
            onDragLeave={(event) => { event.preventDefault(); setDragActive(false) }}
            onDrop={handleDrop}
            style={{ ...DROP_STYLE, borderColor: dragActive ? 'var(--admin-primary, #2563eb)' : undefined, background: dragActive ? 'rgba(37, 99, 235, .06)' : DROP_STYLE.background }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>⇩</div>
            <strong>{parsing ? '正在读取并识别 Excel…' : batchFile ? batchFile.name : '拖拽工商银行 Excel 到这里'}</strong>
            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--admin-text-sub, #64748b)' }}>
              支持 .xlsx / .xls，单文件不超过 20MB
            </div>
          </div>

          {batchData ? (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <BatchMetric label="有效流水" value={`${batchData.summary.validRows} 笔`} sub={batchData.summary.invalidRows ? `${batchData.summary.invalidRows} 行未通过校验` : '全部通过格式校验'} />
                <BatchMetric label="收入" value={fmtMoney(batchData.summary.incomeTotal)} sub={`${batchData.summary.incomeRows} 笔`} />
                <BatchMetric label="支出" value={fmtMoney(batchData.summary.expenseTotal)} sub={`${batchData.summary.expenseRows} 笔`} />
                <BatchMetric label="净流入" value={fmtMoney(batchData.summary.netAmount)} sub={`${batchData.summary.dateFrom || '—'} 至 ${batchData.summary.dateTo || '—'}`} />
                <BatchMetric label="期末余额" value={fmtMoney(batchData.summary.lastBalance)} sub={`识别工作表：${batchData.sheetName}`} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 420px) 1fr', gap: 12, alignItems: 'end', marginTop: 16 }}>
                <label className="rec-bank-payment__field">
                  本方银行账号（选填）
                  <input
                    className="admin-input"
                    type="text"
                    value={bankAccount}
                    onChange={(event) => setBankAccount(event.target.value)}
                    placeholder="Excel 如包含账号会自动识别；本文件没有可留空"
                  />
                </label>
                <div style={{ color: 'var(--admin-text-sub, #64748b)', fontSize: 13, paddingBottom: 8 }}>
                  防重复规则：同银行的日期 + 收支方向 + 金额 + 余额 + 对方单位 + 摘要/用途一致时，只保留一笔。
                </div>
              </div>

              {batchData.invalidRows?.length ? (
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(245, 158, 11, .08)', fontSize: 13 }}>
                  有 {batchData.invalidRows.length} 行无法安全识别，将不会导入。示例：第 {batchData.invalidRows.slice(0, 3).map((row) => row.sourceRowNo).join('、')} 行。
                </div>
              ) : null}

              <div style={{ marginTop: 16, border: '1px solid var(--admin-border, #e2e8f0)', borderRadius: 10, overflow: 'auto', maxHeight: 460 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980, fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--admin-surface, #fff)', zIndex: 1 }}>
                    <tr>
                      {['Excel行', '日期', '方向', '对方单位', '用途 / 摘要', '收入', '支出', '余额'].map((label) => (
                        <th key={label} style={{ textAlign: 'left', padding: '9px 10px', borderBottom: '1px solid var(--admin-border, #e2e8f0)', whiteSpace: 'nowrap' }}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={`${row.sourceRowNo}-${row.tradeDate}-${row.balance ?? ''}`}>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--admin-border, #eef2f7)' }}>{row.sourceRowNo}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--admin-border, #eef2f7)', whiteSpace: 'nowrap' }}>{row.tradeDate}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--admin-border, #eef2f7)' }}>{row.direction === 'credit' ? '贷 · 收入' : '借 · 支出'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--admin-border, #eef2f7)', maxWidth: 240 }}>{row.counterparty || '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--admin-border, #eef2f7)', maxWidth: 260 }}>{row.purpose || row.summary || row.remark || '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--admin-border, #eef2f7)', whiteSpace: 'nowrap' }}>{row.incomeAmount != null ? fmtMoney(row.incomeAmount) : '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--admin-border, #eef2f7)', whiteSpace: 'nowrap' }}>{row.expenseAmount != null ? fmtMoney(row.expenseAmount) : '—'}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--admin-border, #eef2f7)', whiteSpace: 'nowrap' }}>{fmtMoney(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {batchData.rows.length > previewRows.length ? (
                <div style={{ marginTop: 8, color: 'var(--admin-text-sub, #64748b)', fontSize: 12 }}>预览前 {previewRows.length} 笔，导入时会处理全部 {batchData.rows.length} 笔。</div>
              ) : null}

              {importResult ? (
                <div style={{ marginTop: 14, padding: '12px 14px', border: '1px solid var(--admin-border, #e2e8f0)', borderRadius: 10 }}>
                  <strong>本次导入结果：</strong>新增 {importResult.inserted} 笔，重复跳过 {importResult.duplicates} 笔，异常跳过 {importResult.invalid} 笔。
                </div>
              ) : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button type="button" className="rec-btn rec-btn--secondary" onClick={() => fileInputRef.current?.click()} disabled={importing || parsing}>
                  重新选择
                </button>
                <button type="button" className="rec-btn rec-btn--primary" onClick={handleBatchImport} disabled={importing || parsing || !batchData.rows.length}>
                  {importing ? '正在批量写入…' : `确认导入 ${batchData.rows.length} 笔`}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="admin-workspace__card" style={{ marginTop: 16 }}>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 700, padding: '4px 0' }}>备用：单条流水录入 / 回单文本识别</summary>
            <div style={{ marginTop: 18 }}>
              <div className="bank-paste-auto-parse" style={{ marginBottom: 24 }}>
                <h3 className="bank-paste-auto-parse__title" style={{ fontSize: '1rem', margin: '0 0 8px' }}>粘贴回单文本</h3>
                <p className="admin-workspace__card-desc" style={{ margin: '0 0 8px' }}>支持工行等电子回单粘贴（标签+值）与分行键值；识别后请预览再确认写入表单。</p>
                <textarea className="admin-input" value={receiptText} onChange={(e) => { setReceiptText(e.target.value); setReceiptParse(null) }} rows={6} placeholder="粘贴整段电子回单或银行回单文本…" style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 120 }} />
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" className="rec-btn rec-btn--secondary" onClick={handleReceiptRecognize}>自动识别</button>
                  <button type="button" className="rec-btn rec-btn--primary" onClick={handleReceiptConfirmFill} disabled={!receiptParse?.recognized}>确认填充</button>
                </div>
                {receiptParse?.previewRows?.length > 0 ? (
                  <div style={{ marginTop: 14, padding: 12, borderRadius: 8, border: '1px solid var(--admin-border, #e2e8f0)', background: 'var(--admin-surface-2, #f8fafc)', fontSize: 13, maxHeight: 280, overflow: 'auto' }}>
                    <strong style={{ display: 'block', marginBottom: 8 }}>识别预览</strong>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <tbody>{receiptParse.previewRows.map((row, i) => <tr key={`${row.label}-${i}`}><td style={{ padding: '4px 8px 4px 0', verticalAlign: 'top', color: 'var(--admin-text-sub, #64748b)', width: '36%' }}>{row.label}</td><td style={{ padding: '4px 0' }}>{row.value || '—'}</td></tr>)}</tbody>
                    </table>
                  </div>
                ) : null}
              </div>

              <BankPasteAutoParseBlock pasteText={pasteText} onPasteTextChange={setPasteText} onAutoFill={handleAutoFill} />
              <form onSubmit={handleSubmit}>
                <div className="rec-bank-payment__grid">
                  <label className="rec-bank-payment__field">交易日期<input className="admin-input" type="date" value={form.tradeDate} onChange={set('tradeDate')} /></label>
                  <label className="rec-bank-payment__field">银行账户<input className="admin-input" type="text" value={form.bankAccount} onChange={set('bankAccount')} placeholder="本方账户" /></label>
                  <label className="rec-bank-payment__field">对方户名<input className="admin-input" type="text" value={form.counterpartyName} onChange={set('counterpartyName')} /></label>
                  <label className="rec-bank-payment__field">对方账号<input className="admin-input" type="text" value={form.counterpartyAccount} onChange={set('counterpartyAccount')} /></label>
                  <label className="rec-bank-payment__field rec-bank-payment__field--full">摘要 / 用途<input className="admin-input" type="text" value={form.summary} onChange={set('summary')} /></label>
                  <label className="rec-bank-payment__field">收入金额<input className="admin-input" type="number" step="0.01" value={form.incomeAmount} onChange={set('incomeAmount')} /></label>
                  <label className="rec-bank-payment__field">支出金额<input className="admin-input" type="number" step="0.01" value={form.expenseAmount} onChange={set('expenseAmount')} /></label>
                  <label className="rec-bank-payment__field">余额<input className="admin-input" type="number" step="0.01" value={form.balance} onChange={set('balance')} /></label>
                  <label className="rec-bank-payment__field">流水号<input className="admin-input" type="text" value={form.serialNo} onChange={set('serialNo')} /></label>
                  <label className="rec-bank-payment__field rec-bank-payment__field--full">备注<textarea className="admin-input" rows={2} value={form.remark} onChange={set('remark')} /></label>
                </div>
                <div className="rec-bank-payment__footer-actions" style={{ marginTop: 16 }}>
                  <button type="button" className="rec-btn rec-btn--ghost" onClick={() => resetManual(true)}>清空</button>
                  <button type="submit" className="rec-btn rec-btn--primary" disabled={saving}>{saving ? '提交中…' : '提交保存'}</button>
                </div>
              </form>
            </div>
          </details>
        </div>
      </div>
    </PageContainer>
  )
}

export default BankStatementImportPage
