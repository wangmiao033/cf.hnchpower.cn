import React, { useEffect, useMemo, useState } from 'react'
import { getBillLifecycle, transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'
import './BillLifecyclePanel.css'

function money(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`
}

function errorMessage(error) {
  if (!error) return '操作失败'
  if (error.detail?.message) return error.detail.message
  if (error.data?.detail?.message) return error.data.detail.message
  if (error.body?.detail?.message) return error.body.detail.message
  if (typeof error.body?.detail === 'string') return error.body.detail
  return error.message || '操作失败'
}

function simpleReviewLabel(status) {
  const normalized = String(status || 'pending').toLowerCase()
  if (normalized === 'cancelled' || normalized === 'canceled') return '已取消'
  if (normalized === 'draft' || normalized === 'pending') return '待核对'
  return '已核对'
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId, billType])

  const currentStatus = lifecycle?.status || recordStatus || 'pending'
  const normalizedStatus = String(currentStatus || 'pending').toLowerCase()
  const reviewLabel = simpleReviewLabel(normalizedStatus)
  const transitions = lifecycle?.transitions || []

  const confirmOption = useMemo(
    () => transitions.find((option) => option.status === 'confirmed'),
    [transitions]
  )
  const returnOption = useMemo(
    () => transitions.find((option) => option.status === 'pending'),
    [transitions]
  )
  const cancelOption = useMemo(
    () => transitions.find((option) => option.status === 'cancelled'),
    [transitions]
  )

  const runTransition = async (option, labelOverride = '') => {
    if (!option) return
    if (!option.available) {
      showToast?.(option.blocked_reason || '当前条件不满足该操作', 'error')
      return
    }

    let reason = ''
    if (option.requires_reason) {
      reason = window.prompt(
        option.status === 'cancelled' ? '请输入取消账单原因：' : '请输入退回修改原因：',
        ''
      ) || ''
      if (!reason.trim()) return
    }

    if (option.danger && option.status !== 'pending') {
      const confirmed = window.confirm(`确定执行“${labelOverride || option.label}”吗？`)
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
      showToast?.(
        option.status === 'confirmed'
          ? '核对完成，账单已锁定'
          : option.status === 'pending'
            ? '账单已退回待核对，可以继续修改'
            : `账单已更新为“${result.status_label}”`,
        'success'
      )
    } catch (transitionError) {
      showToast?.(errorMessage(transitionError), 'error')
    } finally {
      setBusyStatus('')
    }
  }

  if (loading && !lifecycle) {
    return <section className="bill-lifecycle-panel is-loading" aria-label="账单核对">正在读取账单核对状态…</section>
  }

  if (error && !lifecycle) {
    return <section className="bill-lifecycle-panel is-error" aria-label="账单核对">核对信息读取失败：{error}</section>
  }

  if (!lifecycle) return null

  const isPending = normalizedStatus === 'draft' || normalizedStatus === 'pending'
  const isCancelled = normalizedStatus === 'cancelled' || normalizedStatus === 'canceled'

  return (
    <section
      className={`bill-lifecycle-panel ${lifecycle.locked ? 'is-locked' : 'is-editable'}`}
      aria-label="账单核对"
    >
      <div className="bill-lifecycle-head">
        <div>
          <span>账单核对</span>
          <strong>{reviewLabel}</strong>
          <small>
            {isCancelled
              ? '该账单已取消。'
              : isPending
                ? '确认数据无误后点击“确认核对”；确认后自动锁定。'
                : '账单已核对。发票与资金进度由系统实时统计，不需要手工改状态。'}
          </small>
        </div>
        <div className="bill-lifecycle-facts">
          <span>
            <b>{lifecycle.payment_label}</b>
            <small>{money(lifecycle.paid_amount)} / {money(lifecycle.bill_amount)}</small>
          </span>
          <span>
            <b>发票 {Number(lifecycle.invoice_coverage_percent || 0).toFixed(1)}%</b>
            <small>缺口 {money(lifecycle.invoice_remaining_amount)}</small>
          </span>
        </div>
      </div>

      <div className="bill-review-simple-actions">
        {confirmOption ? (
          <button
            type="button"
            className="is-primary"
            disabled={Boolean(busyStatus) || !confirmOption.available}
            onClick={() => runTransition(confirmOption, '确认核对')}
            title={confirmOption.available ? '确认核对' : confirmOption.blocked_reason || '当前不能确认核对'}
          >
            {busyStatus === 'confirmed' ? '正在确认…' : '确认核对'}
          </button>
        ) : null}

        {returnOption && !isPending ? (
          <button
            type="button"
            className="is-return"
            disabled={Boolean(busyStatus) || !returnOption.available}
            onClick={() => runTransition(returnOption, '退回修改')}
            title={returnOption.available ? '退回修改' : returnOption.blocked_reason || '当前不能退回修改'}
          >
            {busyStatus === 'pending' ? '正在退回…' : isCancelled ? '重新打开' : '退回修改'}
          </button>
        ) : null}

        {!confirmOption && !(returnOption && !isPending) ? (
          <span className="bill-lifecycle-no-action">当前不需要人工处理核对状态。</span>
        ) : null}
      </div>

      {!confirmOption?.available && confirmOption?.blocked_reason ? (
        <div className="bill-review-blocked-reason">还不能确认：{confirmOption.blocked_reason}</div>
      ) : null}

      {cancelOption ? (
        <details className="bill-review-more-actions">
          <summary>更多操作</summary>
          <button
            type="button"
            disabled={Boolean(busyStatus) || !cancelOption.available}
            onClick={() => runTransition(cancelOption, '取消账单')}
          >
            取消账单
          </button>
          {!cancelOption.available && cancelOption.blocked_reason ? <small>{cancelOption.blocked_reason}</small> : null}
        </details>
      ) : null}
    </section>
  )
}
