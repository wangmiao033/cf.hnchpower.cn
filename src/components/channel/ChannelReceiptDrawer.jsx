import React, { useEffect, useMemo, useState } from 'react'
import { getChannelRecordId, uploadChannelReceiptAttachment } from '@/lib/api/channel.ts'
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
  return `¥${n.toFixed(2)}`
}

/**
 * 渠道对账收款登记：这里选择的是“我方收款主体/收款账户”，
 * 不复用合同甲乙方银行资料，避免把付款方与收款方混在一起。
 */
function ChannelReceiptDrawer({
  open,
  record,
  channelApiEnabled,
  showToast,
  onClose,
  onRegisterReceipt
}) {
  const [amount, setAmount] = useState('')
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [entityId, setEntityId] = useState(DEFAULT_RECEIVING_ENTITY_ID)
  const [bankSelect, setBankSelect] = useState(DEFAULT_RECEIVING_ACCOUNT_ID)
  const [manualBankName, setManualBankName] = useState('')
  const [manualAccountNumber, setManualAccountNumber] = useState('')
  const [remark, setRemark] = useState('')
  const [file, setFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)

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
    // 普通“收款登记”也默认带入未收金额；财务仍可手动修改为部分收款。
    setAmount(unpaid > 1e-6 ? unpaid.toFixed(2) : '')
    setReceiptDate(today)
    setEntityId(DEFAULT_RECEIVING_ENTITY_ID)
    setBankSelect(DEFAULT_RECEIVING_ACCOUNT_ID)
    setManualBankName('')
    setManualAccountNumber('')
    setRemark('')
    setFile(null)
  }, [open, record, record?.id])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open || !record) return null

  const recordId = getChannelRecordId(record)
  const totals = getChannelTotals(record)
  const receivable = totals.settlementAmount
  const received = getChannelReceivedAmount(record)
  const unpaid = getChannelUnpaidAmount(record)
  const settled = isChannelReceiptSettled(record)

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
      showToast?.('上传或提交失败，请重试', 'error')
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
          <h2 id="channel-receipt-drawer-title" className="rec-drawer__title">
            收款登记
          </h2>
          <button type="button" className="rec-drawer__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="rec-drawer__body rec-drawer__body--light">
          {!channelApiEnabled ? (
            <p className="channel-receipt-offline muted">离线模式下无法登记收款，请恢复渠道 API 连接。</p>
          ) : null}
          {channelApiEnabled && settled ? (
            <p className="channel-receipt-settled-note">该对账已结清，无需继续登记收款。</p>
          ) : null}

          <div className="channel-receipt-section">
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
              <dd>{formatMoney(unpaid)}</dd>
            </dl>
          </div>

          <form className="channel-receipt-section" onSubmit={handleSubmit}>
            <div className="channel-receipt-section__title">收款录入</div>
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
                  disabled={settled}
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
                  disabled={settled}
                />
              </div>

              <div className="form-group full-width">
                <label htmlFor="channel-receipt-entity">收款主体 *</label>
                <select
                  id="channel-receipt-entity"
                  className="admin-input"
                  value={entityId}
                  onChange={(e) => handleEntityChange(e.target.value)}
                  disabled={settled}
                >
                  {RECEIVING_ENTITIES.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
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
                  disabled={settled}
                >
                  {receivingAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {receivingAccountOptionLabel(account)}
                    </option>
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
                      disabled={settled}
                    />
                    <input
                      type="text"
                      className="admin-input"
                      value={manualAccountNumber}
                      onChange={(e) => setManualAccountNumber(e.target.value)}
                      placeholder="收款账号"
                      disabled={settled}
                    />
                  </div>
                ) : selectedAccount ? (
                  <div className="channel-receipt-account-card">
                    <div className="channel-receipt-account-card__entity">{receivingEntity?.name}</div>
                    <div className="channel-receipt-account-card__row">
                      <span>开户行</span>
                      <span>{selectedAccount.bankName}</span>
                    </div>
                    <div className="channel-receipt-account-card__row">
                      <span>账号</span>
                      <span>{selectedAccount.accountNumber}</span>
                    </div>
                    <div className="channel-receipt-account-card__row">
                      <span>税号</span>
                      <span>{receivingEntity?.taxId}</span>
                    </div>
                    <div className="channel-receipt-account-card__row">
                      <span>开户地址</span>
                      <span>{receivingEntity?.registeredAddressPhone}</span>
                    </div>
                  </div>
                ) : null}
                <div className="channel-receipt-field-hint">
                  此处仅选择我方实际收款账户；付款方/来款账户应通过银行流水单独核对。
                </div>
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
                  disabled={settled}
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
                  disabled={settled}
                />
                {file ? <span className="muted channel-receipt-file-name">{file.name}</span> : null}
              </div>
            </div>
            <div className="channel-receipt-actions">
              <button type="button" className="rec-btn rec-btn--secondary" onClick={onClose} disabled={submitting}>
                取消
              </button>
              <button
                type="submit"
                className="rec-btn rec-btn--primary"
                disabled={submitting || !channelApiEnabled || settled}
              >
                {submitting ? '提交中…' : '确认收款'}
              </button>
            </div>
          </form>
        </div>
      </aside>
    </>
  )
}

export default ChannelReceiptDrawer
