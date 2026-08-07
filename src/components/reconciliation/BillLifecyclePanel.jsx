import React, { useEffect, useMemo, useState } from 'react'
import { getBillLifecycle, transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'
import { billStatusLabel } from '@/domain/reconciliation/billLifecycle.js'
import './BillLifecyclePanel.css'

const FLOW_STEPS = [
  ['pending', '待核对'],
  ['confirmed', '已核对'],
  ['invoiced', '发票已齐'],
  ['completed', '已完成'],
  ['reconciled', '已核销']
]

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function stepIndex(status) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'settled') return 3
  if (normalized === 'verified') return 4
  return FLOW_STEPS.findIndex(([value]) => value === normalized)
}

function errorMessage(error) {
  if (!error) return '状态流转失败'
  if (error.detail?.message) return error.detail.message
  if (error.data?.detail?.message) return error.data.detail.message
  if (error.body?.detail?.message) return error.body.detail.message
  if (typeof error.body?.detail === 'string') return error.body.detail
  return error.message || '状态流转失败'
}

export default function BillLifecyclePanel({
  billType,
  billId,
  recordStatus,
  onLifecycleChange,
  onTransitioned,
  showToast
}) {
  const [lifecycle, setLifecycle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyStatus, setBusyStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!billId) return undefined
    let cancelled = false
    setLoading(true)
    setError('')
    getBillLifecycle(billType, billId)
      .then((result) => {
        if (!cancelled) {
          setLifecycle(result)
          onLifecycleChange?.(result)
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // onLifecycleChange intentionally excluded: lifecycle reloads only when the bill identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId, billType])

  const currentStatus = lifecycle?.status || recordStatus || 'pending'
  const currentIndex = useMemo(() => stepIndex(currentStatus), [currentStatus])
  const hasCancelTransition = Boolean(
    lifecycle?.transitions?.some((option) => option.status === 'cancelled')
  )

  const runTransition = async (option) => {
    if (!option.available) {
      showToast?.(option.blocked_reason || '当前条件不满足该状态流转', 'error')
      return
    }

    let reason = ''
    if (option.requires_reason) {
      reason = window.prompt(
        option.status === 'cancelled' ? '请输入取消账单原因：' : '请输入退回/重新打开原因：',
        ''
      ) || ''
      if (!reason.trim()) return
    }

    if (option.danger) {
      const confirmed = window.confirm(`确定执行“${option.label}”吗？该操作会改变账单锁定状态。`)
      if (!confirmed) return
    }

    setBusyStatus(option.status)
    try {
      const result = await transitionBillLifecycle(
        billType,
        billId,
        option.status,
        reason.trim()
      )
      setLifecycle(result)
      onLifecycleChange?.(result)
      await onTransitioned?.(result)
      showToast?.(`账单已流转为“${result.status_label}”`, 'success')
    } catch (transitionError) {
      showToast?.(errorMessage(transitionError), 'error')
    } finally {
      setBusyStatus('')
    }
  }

  if (loading && !lifecycle) {
    return <section className="bill-lifecycle-panel is-loading" aria-label="账单生命周期">正在读取账单状态与结算条件…</section>
  }

  if (error && !lifecycle) {
    return <section className="bill-lifecycle-panel is-error" aria-label="账单生命周期">状态流转信息读取失败：{error}</section>
  }

  if (!lifecycle) return null

  return (
    <section
      className={`bill-lifecycle-panel ${lifecycle.locked ? 'is-locked' : 'is-editable'}`}
      aria-label="账单生命周期"
    >
      <div className="bill-lifecycle-head">
        <div>
          <span>账单生命周期</span>
          <strong>{lifecycle.status_label || billStatusLabel(currentStatus)}</strong>
          <small>{lifecycle.locked ? '财务与业务字段已锁定' : '当前账单允许编辑'}</small>
        </div>
        <div className="bill-lifecycle-facts">
          <span><b>{lifecycle.payment_label}</b><small>{money(lifecycle.paid_amount)} / {money(lifecycle.bill_amount)}</small></span>
          <span><b>发票 {Number(lifecycle.invoice_coverage_percent || 0).toFixed(1)}%</b><small>缺口 {money(lifecycle.invoice_remaining_amount)}</small></span>
        </div>
      </div>

      {currentStatus !== 'cancelled' && currentStatus !== 'canceled' ? (
        <div className="bill-lifecycle-steps">
          {FLOW_STEPS.map(([status, label], index) => {
            const active = index === currentIndex
            const done = currentIndex >= 0 && index < currentIndex
            return (
              <div key={status} className={`${active ? 'is-active' : ''} ${done ? 'is-done' : ''}`}>
                <span>{done ? '✓' : index + 1}</span>
                <em>{label}</em>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bill-lifecycle-cancelled">该账单已取消，重新启用需要填写原因。</div>
      )}

      <div className="bill-lifecycle-actions">
        {(lifecycle.transitions || []).map((option) => (
          <div className="bill-lifecycle-action" key={option.status}>
            <button
              type="button"
              className={`${option.danger ? 'is-danger' : ''} ${option.available ? '' : 'is-blocked'}`}
              disabled={Boolean(busyStatus)}
              onClick={() => runTransition(option)}
              title={option.available ? option.label : option.blocked_reason || '当前不可执行'}
            >
              {busyStatus === option.status ? '处理中…' : option.label}
            </button>
            {!option.available && option.blocked_reason ? <small>{option.blocked_reason}</small> : null}
          </div>
        ))}
        {(lifecycle.transitions || []).length === 0 ? <span className="bill-lifecycle-no-action">当前状态没有可继续流转的操作。</span> : null}
      </div>
      {hasCancelTransition ? (
        <div className="bill-lifecycle-cancelled">
          资金安全规则：取消账单前必须先解除已关联的付款/收款与发票分配。
        </div>
      ) : null}
    </section>
  )
}
