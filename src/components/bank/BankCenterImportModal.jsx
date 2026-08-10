import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { ApiError } from '@/lib/api/client.ts'
import { bulkImportBankTransactions } from '@/lib/api/bankTransaction.ts'
import { icbcRowToBankTransaction, parseIcbcStatementExcel } from '@/utils/icbcStatementExcel.js'

function money(value, empty = '¥0.00') {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return empty
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function BankCenterImportModal({
  open,
  onClose,
  onImported,
  onMoreImport,
  onGoPending,
  onViewImports
}) {
  const { showToast } = useAppState()
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [bankAccount, setBankAccount] = useState('')
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const reset = useCallback(() => {
    setFile(null)
    setParsed(null)
    setBankAccount('')
    setDragging(false)
    setParsing(false)
    setImporting(false)
    setResult(null)
  }, [])

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  if (!open) return null

  const parseFile = async (nextFile) => {
    if (!nextFile) return
    const lower = nextFile.name.toLowerCase()
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
      showToast('请选择工商银行导出的 .xlsx 或 .xls 文件', 'info')
      return
    }
    if (nextFile.size > 20 * 1024 * 1024) {
      showToast('文件超过 20MB，请拆分后再导入', 'info')
      return
    }

    setParsing(true)
    setResult(null)
    try {
      const data = await parseIcbcStatementExcel(nextFile)
      setFile(nextFile)
      setParsed(data)
      setBankAccount(data.metadata?.bankAccount || '')
      showToast(`已识别 ${data.rows.length} 笔有效流水，请确认后导入`, 'success')
    } catch (error) {
      setFile(null)
      setParsed(null)
      showToast(error instanceof Error ? error.message : 'Excel 解析失败', 'info')
    } finally {
      setParsing(false)
    }
  }

  const confirmImport = async () => {
    if (!file || !parsed?.rows?.length) return
    setImporting(true)
    setResult(null)
    try {
      const items = parsed.rows.map((row) => icbcRowToBankTransaction(row, {
        bankAccount,
        sourceBank: 'ICBC',
        fileName: file.name
      }))
      const response = await bulkImportBankTransactions({
        source_bank: 'ICBC',
        source_file_name: file.name,
        source_sheet_name: parsed.sheetName || null,
        bank_account: bankAccount.trim() || null,
        source_total_rows: Number(parsed.summary?.validRows || 0) + Number(parsed.summary?.invalidRows || 0),
        source_invalid_row_nos: (parsed.invalidRows || []).map((row) => Number(row.sourceRowNo)).filter(Number.isFinite),
        items
      })
      setResult(response)
      if (response.inserted > 0) {
        showToast(`导入完成：新增 ${response.inserted} 笔，重复跳过 ${response.duplicates} 笔`, 'success')
      } else if (response.duplicates > 0) {
        showToast(`没有新增流水：${response.duplicates} 笔均已存在，系统已自动防重复`, 'info')
      } else {
        showToast('没有可导入的有效流水', 'info')
      }
      onImported?.(response)
    } catch (error) {
      showToast(error instanceof ApiError ? error.message : '批量导入失败，请稍后重试', 'info')
    } finally {
      setImporting(false)
    }
  }

  const preview = parsed?.rows?.slice(0, 30) || []

  return (
    <div className="bank-center-modal-mask" role="presentation" onMouseDown={onClose}>
      <section
        className="bank-center-import"
        role="dialog"
        aria-modal="true"
        aria-label="导入银行流水"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="bank-center-import__head">
          <div>
            <span>导入银行流水</span>
            <h2>工商银行 Excel 批量导入</h2>
            <p>继续使用现有工行解析和防重复指纹；本次升级只增加导入批次审计与来源追踪。</p>
          </div>
          <button type="button" className="bank-center-icon-btn" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <div className="bank-center-import__body">
          {!parsed ? (
            <div
              className={`bank-center-dropzone ${dragging ? 'is-dragging' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => !parsing && fileRef.current?.click()}
              onKeyDown={(event) => {
                if ((event.key === 'Enter' || event.key === ' ') && !parsing) fileRef.current?.click()
              }}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                void parseFile(event.dataTransfer?.files?.[0])
              }}
            >
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  event.target.value = ''
                  void parseFile(selected)
                }}
              />
              <span className="bank-center-dropzone__icon">⇩</span>
              <strong>{parsing ? '正在读取并识别 Excel…' : '拖拽工商银行 Excel 到这里'}</strong>
              <small>支持 .xlsx / .xls · 单文件不超过 20MB</small>
              <button type="button" disabled={parsing}>{parsing ? '识别中…' : '选择 Excel 文件'}</button>
            </div>
          ) : (
            <>
              <div className="bank-center-import__filebar">
                <div>
                  <span>当前文件</span>
                  <strong>{file?.name}</strong>
                  <small>工作表：{parsed.sheetName || '-'}</small>
                </div>
                <button type="button" onClick={() => fileRef.current?.click()} disabled={parsing || importing}>更换文件</button>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={(event) => {
                    const selected = event.target.files?.[0]
                    event.target.value = ''
                    void parseFile(selected)
                  }}
                />
              </div>

              <div className="bank-center-import__metrics">
                <article>
                  <span>有效流水</span>
                  <strong>{parsed.summary.validRows} 笔</strong>
                  <small>{parsed.summary.invalidRows ? `${parsed.summary.invalidRows} 行异常` : '格式校验通过'}</small>
                </article>
                <article className="is-income"><span>收入</span><strong>{money(parsed.summary.incomeTotal)}</strong><small>{parsed.summary.incomeRows} 笔</small></article>
                <article className="is-expense"><span>支出</span><strong>{money(parsed.summary.expenseTotal)}</strong><small>{parsed.summary.expenseRows} 笔</small></article>
                <article><span>净流入</span><strong>{money(parsed.summary.netAmount)}</strong><small>{parsed.summary.dateFrom || '-'} 至 {parsed.summary.dateTo || '-'}</small></article>
                <article><span>期末余额</span><strong>{money(parsed.summary.lastBalance)}</strong><small>识别完成后再写入</small></article>
              </div>

              <label className="bank-center-account-field">
                <span>本方银行账号（选填）</span>
                <input value={bankAccount} onChange={(event) => setBankAccount(event.target.value)} placeholder="Excel 如包含账号会自动识别" />
                <small>防重复仍使用原有稳定指纹；批次 ID 只用于追踪，不参与去重。</small>
              </label>

              {parsed.invalidRows?.length ? (
                <div className="bank-center-import__warning">
                  有 {parsed.invalidRows.length} 行无法安全识别，将自动跳过并记录到本次导入批次。示例：第 {parsed.invalidRows.slice(0, 4).map((row) => row.sourceRowNo).join('、')} 行。
                </div>
              ) : null}

              <div className="bank-center-import__preview">
                <table>
                  <thead><tr><th>Excel 行</th><th>日期</th><th>方向</th><th>对方单位</th><th>用途 / 摘要</th><th>收入</th><th>支出</th><th>余额</th></tr></thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={`${row.sourceRowNo}-${row.tradeDate}-${row.balance ?? ''}`}>
                        <td>{row.sourceRowNo}</td>
                        <td>{row.tradeDate || '-'}</td>
                        <td>{row.direction === 'credit' ? '收入' : '支出'}</td>
                        <td>{row.counterparty || '-'}</td>
                        <td title={row.purpose || row.summary || row.remark || ''}>{row.purpose || row.summary || row.remark || '-'}</td>
                        <td className="is-income">{row.incomeAmount != null ? money(row.incomeAmount) : '-'}</td>
                        <td className="is-expense">{row.expenseAmount != null ? money(row.expenseAmount) : '-'}</td>
                        <td>{money(row.balance, '-')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.rows.length > preview.length ? (
                <small className="bank-center-import__preview-note">这里只预览前 {preview.length} 笔，确认导入会处理全部 {parsed.rows.length} 笔。</small>
              ) : null}

              {result ? (
                <div className="bank-center-import__result bank-center-import__result--audited">
                  <strong>导入完成</strong>
                  <span>新增 {result.inserted} 笔</span>
                  <span>重复跳过 {result.duplicates} 笔</span>
                  <span>异常跳过 {result.invalid} 笔</span>
                  <small>批次号：{result.batch_id}</small>
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="bank-center-import__foot">
          <button type="button" className="is-ghost" onClick={onMoreImport}>更多导入方式</button>
          <div>
            {result ? (
              <>
                <button type="button" onClick={onViewImports}>查看导入记录</button>
                <button type="button" className="is-primary" onClick={onGoPending}>去处理待核销</button>
              </>
            ) : (
              <>
                <button type="button" onClick={onClose}>取消</button>
                {parsed ? (
                  <button type="button" className="is-primary" disabled={importing || !parsed.rows.length} onClick={confirmImport}>
                    {importing ? '正在批量写入…' : `确认导入 ${parsed.rows.length} 笔`}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  )
}
