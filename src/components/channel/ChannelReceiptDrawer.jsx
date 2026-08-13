import React, { useEffect, useMemo, useState } from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { getChannelRecordId, uploadChannelReceiptAttachment } from '@/lib/api/channel.ts'
import {
  allocateBankTransaction,
  getBankBillAllocationSummary,
  getBankMultiAllocationDashboard
} from '@/lib/api/bankAutoReconciliation.ts'
import {
  getChannelTotals,
  getChannelReceivedAmount,
  getChannelUnpaidAmount,
  isChannelReceiptSettled
} from '@/domain/channel/channelAggregates.js'
import {
  DEFAULT_RECEIVING_ACCOUNT_ID,
  DEFAULT_RECEIVING_ENTITY_ID,
  RECEIVING_ENTITIES,
  findReceivingAccount,
  findReceivingEntity,
  manualReceivingAccountStorageValue,
  receivingAccountOptionLabel,
  receivingAccountStorageValue
} from '@/domain/channel/channelReceiptAccounts.js'
import './ChannelReceiptDrawer.css'

function formatMoney(amount) {
  const n = parseFloat(amount)
  if (!Number.isFinite(n)) return '¥0.00'
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function numberValue(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function confidenceMeta(score) {
  const value = numberValue(score)
  if (value >= 80) return { label: '高度匹配', tone: 'high' }
  if (value >= 60) return { label: '可能匹配', tone: 'medium' }
  return { label: '待核对', tone: 'low' }
}

function displayDate(value) {
  const raw = String(value || '').trim()
  if (!raw) return '日期未识别'
  return raw.slice(0, 10)
}

/**
 * 渠道收款登记：优先直接关联银行中心已有流水；只有银行中心确实没有流水时，
 * 才回退到手工登记。银行关联走统一 P2 allocation 引擎，会同步生成渠道收款事实。
 */
function ChannelReceiptDrawer({
  open,
  record,
  channelApiEnabled,
  showToast,
  onClose,
  onRegisterReceipt
}) {
  const { recon, setActiveView } = useAppState()
  const { can } = useAuth()
  const canManageBank = can('funds.manage')

  const [amount, setAmount] = useState('')
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [entityId, setEntityId] = useState(DEFAULT_RECEIVING_ENTITY_ID)
  const [bankSelect, setBankSelect] = useState(DEFAULT_RECEIVING_ACCOUNT_ID)
  const [manualBankName, setManualBankName] = useState('')
  const [manualAccountNumber, setManualAccountNumber] = useState('')
  const [remark, setRemark] = useState('')
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  const [bankLoading, setBankLoading] = useState(false)
  const [bankError, setBankError] = useState('')
  const [bankMatches, setBankMatches] = useState([])
  const [bankBillSummary, setBankBillSummary] = useState(null)
  const [bankReloadKey, setBankReloadKey] = useState(0)
  const [allocatingTxId, setAllocatingTxId] = useState('')

  const recordId = useMemo(() => (record ? getChannelRecordId(record) : ''), [record])
  const receivingEntity = useMemo(() => findReceivingEntity(entityId), [entityId])
  const receivingAccounts = receivingEntity?.accounts || []
  const selectedAccount = useMemo(
    () => (bankSelect === '__custom__' ? null : findReceivingAccount(receivingEntity, bankSelect)),
    [receivingEntity, bankSelect]
  )

  useEffect(() => {
    if (!open || !record) return
    const today = new Date().toISOString().slice(0, 10)
    const unpaid = getChannelUnpaidAmount(record)
    setAmount(unpaid > 1e-6 ? unpaid.toFixed(2) : '')
    setReceiptDate(today)
    setEntityId(DEFAULT_RECEIVING_ENTITY_ID)
    setBankSelect(DEFAULT_RECEIVING_ACCOUNT_ID)
    setManualBankName('')
    setManualAccountNumber('')
    setRemark('')
    setFile(null)
    setManualOpen(false)
    setBankError('')
    setBankMatches([])
    setBankBillSummary(null)
    setAllocatingTxId('')
  }, [open, recordId])

  useEffect(() => {
    if (!open || !recordId || !channelApiEnabled) return undefined
    let cancelled = false
    setBankLoading(true)
    setBankError('')

    Promise.all([
      getBankMultiAllocationDashboard(500),
      getBankBillAllocationSummary('channel', recordId)
    ])
      .then(([dashboard, billSummary]) => {
        if (cancelled) return
        const matches = (dashboard?.suggestions || [])
          .filter((item) => item?.direction === 'collection' && numberValue(item?.remaining_amount) > 0.01)
          .map((item) => {
            const candidate = (item?.candidates || []).find(
              (row) => row?.bill_type === 'channel' && String(row?.bill_id || '') === String(recordId)
            )
            return candidate ? { transaction: item, candidate } : null
          })
          .filter(Boolean)
          .sort((a, b) => {
            const scoreDiff = numberValue(b.candidate?.score) - numberValue(a.candidate?.score)
            if (Math.abs(scoreDiff) > 0.001) return scoreDiff
            return String(b.transaction?.trade_date || '').localeCompare(String(a.transaction?.trade_date || ''))
          })
          .slice(0, 5)

        setBankMatches(matches)
        setBankBillSummary(billSummary || null)
      })
      .catch((error) => {
        if (cancelled) return
        setBankMatches([])
        setBankBillSummary(null)
        setBankError(error instanceof Error ? error.message : '银行流水匹配读取失败')
      })
      .finally(() => {
        if (!cancelled) setBankLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, recordId, channelApiEnabled, bankReloadKey])

  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open || !record) return null

  const totals = getChannelTotals(record)
  const receivable = totals.settlementAmount
  const received = getChannelReceivedAmount(record)
  const unpaid = getChannelUnpaidAmount(record)
  const settled = isChannelReceiptSettled(record)
  const linkedAllocations = bankBillSummary?.allocations || []

  const resolveBankAccount = () => {
    if (bankSelect === '__custom__') {
      if (!manualBankName.trim() || !manualAccountNumber.trim()) return null
      return manualReceivingAccountStorageValue(
        receivingEntity,
        manualBankName,
        manualAccountNumber
      )
    }
    return receivingAccountStorageValue(receivingEntity, selectedAccount) || null
  }

  const handleEntityChange = (nextEntityId) => {
    const entity = findReceivingEntity(nextEntityId)
    setEntityId(nextEntityId)
    setBankSelect(entity?.accounts?.[0]?.id || '__custom__')
    setManualBankName('')
    setManualAccountNumber('')
  }

  const handleBankAllocate = async (match) => {
    if (!channelApiEnabled || settled || !recordId || allocatingTxId) return
    if (!canManageBank) {
      showToast?.('当前账号没有银行资金核销权限', 'error')
      return
    }

    const transaction = match?.transaction || {}
    const candidate = match?.candidate || {}
    const txRemaining = Math.max(0, numberValue(transaction.remaining_amount || transaction.amount))
    const recommended = Math.max(0, numberValue(candidate.recommended_amount) || Math.min(txRemaining, unpaid))
    const linkedAmount = Math.min(unpaid, txRemaining, recommended)
    if (linkedAmount <= 0.01) {
      showToast?.('该流水或账单已经没有可分配余额', 'error')
      return
    }

    const score = numberValue(candidate.score)
    if (score < 80) {
      const confirmed = window.confirm(
        `该流水匹配度为 ${Math.round(score)}%，建议人工确认付款方和金额。\n\n` +
        `${transaction.counterparty_name || '付款方未识别'} · ${formatMoney(linkedAmount)}\n` +
        `确认关联到当前渠道账单吗？`
      )
      if (!confirmed) return
    }

    setAllocatingTxId(String(transaction.transaction_id || ''))
    try {
      await allocateBankTransaction(String(transaction.transaction_id), [
        { bill_type: 'channel', bill_id: recordId, amount: Number(linkedAmount.toFixed(2)) }
      ])
      showToast?.(`已关联银行流水并登记收款 ${formatMoney(linkedAmount)}`, 'success')
      await recon?.refetchChannelFromApi?.()
      onClose?.()
    } catch (error) {
      console.error(error)
      showToast?.(error instanceof Error ? error.message : '银行流水关联失败', 'error')
      setBankReloadKey((value) => value + 1)
    } finally {
      setAllocatingTxId('')
    }
  }

  const handleOpenBankCenter = () => {
    onClose?.()
    setActiveView?.(VIEWS.BANK_RECONCILIATION)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amt = parseFloat(String(amount).replace(/,/g, ''))
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast?.('请输入大于 0 的收款金额', 'error')
      return
    }
    if (amt - unpaid > 0.01) {
      showToast?.(`本次收款不能超过未收金额 ${formatMoney(unpaid)}`, 'error')
      return
    }
    const bank_account = resolveBankAccount()
    if (!bank_account) {
      showToast?.(
        bankSelect === '__custom__' ? '请填写完整的开户行和收款账号' : '请选择我方收款账户',
        'error'
      )
      return
    }
    if (!channelApiEnabled) {
      showToast?.('当前为离线模式，无法登记收款', 'error')
      return
    }
    if (settled) {
      showToast?.('该对账已结清', 'error')
      return
    }
    setSubmitting(true)
    let attachment_url = null
    try {
      if (file) {
        const up = await uploadChannelReceiptAttachment(file)
        attachment_url = up.url
      }
      const ok = await onRegisterReceipt?.(recordId, {
        amount: amt,
        receipt_date: receiptDate || null,
        bank_account,
        remark: remark.trim() || null,
        attachment_url
      })
      if (ok) onClose?.()
    } catch (err) {
      console.error(err)
      showToast?.(err instanceof Error ? err.message : '上传或提交失败，请重试', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button type="button" className="rec-drawer-backdrop" aria-label="关闭" onClick={onClose} />
      <aside
        className="rec-drawer rec-drawer--light channel-receipt-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-receipt-drawer-title"
      >
        <div className="rec-drawer__head">
          <div>
            <h2 id="channel-receipt-drawer-title" className="rec-drawer__title">收款登记</h2>
            <p className="channel-receipt-head-hint">优先关联银行流水，确认后自动同步收款与核销状态。</p>
          </div>
          <button type="button" className="rec-drawer__close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="rec-drawer__body rec-drawer__body--light">
          {!channelApiEnabled ? (
            <p className="channel-receipt-offline muted">离线模式下无法登记收款，请恢复渠道 API 连接。</p>
          ) : null}
          {channelApiEnabled && settled ? (
            <p className="channel-receipt-settled-note">该对账已结清，无需继续登记收款。</p>
          ) : null}

          <div className="channel-receipt-section channel-receipt-summary-section">
            <div className="channel-receipt-section__title">对账信息</div>
            <dl className="rec-light-dl">
              <dt>渠道名称</dt>
              <dd>{record.channelName || '—'}</dd>
              <dt>结算周期</dt>
              <dd>
                {record.settlementMonth ? `${record.settlementMonth} · ` : ''}
                {record.startDate || '—'} ~ {record.endDate || '—'}
              </dd>
              <dt>应收金额</dt>
              <dd className="rec-light-dl__emph">{formatMoney(receivable)}</dd>
              <dt>已收金额</dt>
              <dd>{formatMoney(received)}</dd>
              <dt>未收金额</dt>
              <dd className="channel-receipt-unpaid">{formatMoney(unpaid)}</dd>
            </dl>
          </div>

          <section className="channel-receipt-section channel-receipt-bank-section">
            <div className="channel-receipt-section-title-row">
              <div>
                <div className="channel-receipt-section__title">银行流水智能匹配</div>
                <p>系统从银行中心未核销收入中查找当前账单，按匹配度自动排序。</p>
              </div>
              <button
                type="button"
                className="channel-receipt-refresh"
                onClick={() => setBankReloadKey((value) => value + 1)}
                disabled={bankLoading || settled}
              >
                {bankLoading ? '匹配中…' : '重新匹配'}
              </button>
            </div>

            {linkedAllocations.length > 0 ? (
              <div className="channel-receipt-linked-block">
                <div className="channel-receipt-linked-block__head">
                  <strong>已关联银行流水</strong>
                  <span>{linkedAllocations.length} 笔 · {formatMoney(bankBillSummary?.bank_allocated_amount)}</span>
                </div>
                {linkedAllocations.slice(0, 3).map((item) => (
                  <div className="channel-receipt-linked-row" key={item.match_id}>
                    <div>
                      <strong>{item.counterparty_name || '付款方未识别'}</strong>
                      <span>{displayDate(item.trade_date)} · {item.transaction_no || '无流水号'}</span>
                    </div>
                    <b>{formatMoney(item.linked_amount)}</b>
                  </div>
                ))}
                {linkedAllocations.length > 3 ? <small>另有 {linkedAllocations.length - 3} 笔，可在银行中心查看完整记录。</small> : null}
              </div>
            ) : null}

            {bankLoading ? (
              <div className="channel-receipt-match-loading">
                <span />
                <div><b>正在匹配银行流水</b><small>核对金额、付款方、账期及摘要…</small></div>
              </div>
            ) : null}

            {!bankLoading && bankError ? (
              <div className="channel-receipt-match-empty is-error">
                <strong>银行匹配暂时读取失败</strong>
                <span>{bankError}</span>
                <button type="button" onClick={() => setBankReloadKey((value) => value + 1)}>重试</button>
              </div>
            ) : null}

            {!bankLoading && !bankError && bankMatches.length > 0 ? (
              <div className="channel-receipt-match-list">
                <div className="channel-receipt-match-count">找到 {bankMatches.length} 笔候选流水</div>
                {bankMatches.map((match) => {
                  const tx = match.transaction || {}
                  const candidate = match.candidate || {}
                  const scoreMeta = confidenceMeta(candidate.score)
                  const txRemaining = Math.max(0, numberValue(tx.remaining_amount || tx.amount))
                  const recommended = Math.max(0, numberValue(candidate.recommended_amount) || Math.min(txRemaining, unpaid))
                  const linkedAmount = Math.min(unpaid, txRemaining, recommended)
                  const reasons = (candidate.reasons || []).slice(0, 2)
                  const busy = allocatingTxId === String(tx.transaction_id || '')
                  return (
                    <article className={`channel-receipt-match-card is-${scoreMeta.tone}`} key={tx.transaction_id}>
                      <div className="channel-receipt-match-card__head">
                        <div>
                          <strong>{tx.counterparty_name || '付款方未识别'}</strong>
                          <span>{displayDate(tx.trade_date)} · {tx.transaction_no || '无流水号'}</span>
                        </div>
                        <em className={`channel-receipt-confidence is-${scoreMeta.tone}`}>
                          {Math.round(numberValue(candidate.score))}% {scoreMeta.label}
                        </em>
                      </div>
                      <div className="channel-receipt-match-card__amounts">
                        <span>流水剩余 <b>{formatMoney(txRemaining)}</b></span>
                        <span>本账单建议收款 <strong>{formatMoney(linkedAmount)}</strong></span>
                      </div>
                      {tx.summary ? <p className="channel-receipt-match-summary">摘要：{tx.summary}</p> : null}
                      {reasons.length ? (
                        <div className="channel-receipt-match-reasons">
                          {reasons.map((reason) => <span key={reason}>{reason}</span>)}
                        </div>
                      ) : null}
                      {txRemaining - linkedAmount > 0.01 ? (
                        <div className="channel-receipt-match-note">关联本账单后，流水仍剩 {formatMoney(txRemaining - linkedAmount)}，可继续分配其他账单。</div>
                      ) : null}
                      <div className="channel-receipt-match-card__actions">
                        <button
                          type="button"
                          className="rec-btn rec-btn--primary"
                          onClick={() => void handleBankAllocate(match)}
                          disabled={busy || Boolean(allocatingTxId) || settled || !canManageBank}
                        >
                          {busy ? '关联中…' : `确认关联并收款 ${formatMoney(linkedAmount)}`}
                        </button>
                      </div>
                    </article>
                  )
                })}
                {!canManageBank ? <div className="channel-receipt-permission-note">当前账号可查看匹配结果，但没有银行资金核销权限。</div> : null}
              </div>
            ) : null}

            {!bankLoading && !bankError && bankMatches.length === 0 ? (
              <div className="channel-receipt-match-empty">
                <strong>暂未找到明确匹配的银行流水</strong>
                <span>可能尚未导入银行流水，或付款方/金额需要人工确认。无需在账单列表和银行中心之间来回翻找。</span>
              </div>
            ) : null}

            <div className="channel-receipt-bank-actions">
              <button type="button" className="rec-btn rec-btn--secondary" onClick={handleOpenBankCenter}>去银行中心查看</button>
              {!settled ? (
                <button type="button" className="channel-receipt-manual-trigger" onClick={() => setManualOpen((value) => !value)}>
                  {manualOpen ? '收起手工登记' : '银行中心没有这笔？手工登记'}
                </button>
              ) : null}
            </div>
          </section>

          {!settled ? (
            <details
              className="channel-receipt-manual-details"
              open={manualOpen}
              onToggle={(event) => setManualOpen(event.currentTarget.open)}
            >
              <summary>
                <span><strong>手工登记收款</strong><small>仅在银行中心确实没有对应流水时使用</small></span>
                <b>{manualOpen ? '收起' : '展开'}</b>
              </summary>
              <form className="channel-receipt-section channel-receipt-manual-form" onSubmit={handleSubmit}>
                <div className="channel-receipt-manual-warning">
                  手工登记不会自动关联已有银行流水。若银行流水已经导入，优先使用上方“确认关联并收款”，避免重复记账。
                </div>
                <div className={`channel-receipt-form-grid ${settled ? 'is-disabled' : ''}`}>
                  <div className="form-group">
                    <label htmlFor="channel-receipt-amount">收款金额 *</label>
                    <input
                      id="channel-receipt-amount"
                      type="number"
                      className="admin-input"
                      step="0.01"
                      min="0.01"
                      max={unpaid > 0 ? unpaid.toFixed(2) : undefined}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="元"
                      required
                      disabled={settled || Boolean(allocatingTxId)}
                    />
                    <div className="channel-receipt-field-hint">默认带入未收金额，可修改为本次实际部分收款。</div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="channel-receipt-date">收款日期</label>
                    <input
                      id="channel-receipt-date"
                      type="date"
                      className="admin-input"
                      value={receiptDate}
                      onChange={(e) => setReceiptDate(e.target.value)}
                      disabled={settled || Boolean(allocatingTxId)}
                    />
                  </div>

                  <div className="form-group full-width">
                    <label htmlFor="channel-receipt-entity">收款主体 *</label>
                    <select
                      id="channel-receipt-entity"
                      className="admin-input"
                      value={entityId}
                      onChange={(e) => handleEntityChange(e.target.value)}
                      disabled={settled || Boolean(allocatingTxId)}
                    >
                      {RECEIVING_ENTITIES.map((entity) => (
                        <option key={entity.id} value={entity.id}>{entity.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group full-width">
                    <label htmlFor="channel-receipt-bank">我方收款账户 *</label>
                    <select
                      id="channel-receipt-bank"
                      className="admin-input"
                      value={bankSelect}
                      onChange={(e) => setBankSelect(e.target.value)}
                      disabled={settled || Boolean(allocatingTxId)}
                    >
                      {receivingAccounts.map((account) => (
                        <option key={account.id} value={account.id}>{receivingAccountOptionLabel(account)}</option>
                      ))}
                      <option value="__custom__">+ 手动录入临时收款账户</option>
                    </select>

                    {bankSelect === '__custom__' ? (
                      <div className="channel-receipt-manual-grid">
                        <input
                          type="text"
                          className="admin-input"
                          value={manualBankName}
                          onChange={(e) => setManualBankName(e.target.value)}
                          placeholder="开户银行，例如：中国工商银行广州XX支行"
                          disabled={settled || Boolean(allocatingTxId)}
                        />
                        <input
                          type="text"
                          className="admin-input"
                          value={manualAccountNumber}
                          onChange={(e) => setManualAccountNumber(e.target.value)}
                          placeholder="收款账号"
                          disabled={settled || Boolean(allocatingTxId)}
                        />
                      </div>
                    ) : selectedAccount ? (
                      <details className="channel-receipt-account-card">
                        <summary>
                          <span><strong>{receivingEntity?.name}</strong><small>{receivingAccountOptionLabel(selectedAccount)}</small></span>
                          <b>查看账户详情</b>
                        </summary>
                        <div className="channel-receipt-account-card__details">
                          <div className="channel-receipt-account-card__row"><span>开户行</span><span>{selectedAccount.bankName}</span></div>
                          <div className="channel-receipt-account-card__row"><span>账号</span><span>{selectedAccount.accountNumber}</span></div>
                          <div className="channel-receipt-account-card__row"><span>税号</span><span>{receivingEntity?.taxId}</span></div>
                          <div className="channel-receipt-account-card__row"><span>开户地址</span><span>{receivingEntity?.registeredAddressPhone}</span></div>
                        </div>
                      </details>
                    ) : null}
                  </div>

                  <div className="form-group full-width">
                    <label htmlFor="channel-receipt-remark">备注</label>
                    <input
                      id="channel-receipt-remark"
                      type="text"
                      className="admin-input"
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      placeholder="选填"
                      disabled={settled || Boolean(allocatingTxId)}
                    />
                  </div>
                  <div className="form-group full-width">
                    <label htmlFor="channel-receipt-file">附件（银行回单）</label>
                    <input
                      id="channel-receipt-file"
                      type="file"
                      className="channel-receipt-file"
                      accept="image/*,.pdf,.png,.jpg,.jpeg,.webp"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                      disabled={settled || Boolean(allocatingTxId)}
                    />
                    {file ? <span className="muted channel-receipt-file-name">{file.name}</span> : null}
                  </div>
                </div>
                <div className="channel-receipt-actions">
                  <button type="button" className="rec-btn rec-btn--secondary" onClick={() => setManualOpen(false)} disabled={submitting}>收起</button>
                  <button type="submit" className="rec-btn rec-btn--primary" disabled={submitting || !channelApiEnabled || settled || Boolean(allocatingTxId)}>
                    {submitting ? '提交中…' : '确认手工收款'}
                  </button>
                </div>
              </form>
            </details>
          ) : null}
        </div>
      </aside>
    </>
  )
}

export default ChannelReceiptDrawer
