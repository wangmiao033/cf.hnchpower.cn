import React, { useEffect, useMemo, useState } from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'

const LOADING_FIELDS = [
  { id: 'identity', size: 'wide' },
  { id: 'period', size: 'medium' },
  { id: 'line-items', size: 'full' },
  { id: 'amount', size: 'wide' }
]

function compactText(value) {
  const text = value == null ? '' : String(value).trim()
  return text || '-'
}

export function CoreBillLoadingState({
  billType,
  summary = [],
  error = '',
  onRetry,
  onBack
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (error) return undefined
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    }, 500)
    return () => window.clearInterval(timer)
  }, [error])

  const normalizedSummary = useMemo(
    () =>
      (Array.isArray(summary) ? summary : [])
        .filter((item) => item && item.label)
        .slice(0, 4),
    [summary]
  )

  const isSlow = elapsedSeconds >= 2
  const isVerySlow = elapsedSeconds >= 8

  return (
    <PageContainer hideHeader className="core-bill-form-page core-bill-loading-page">
      <section
        className={`core-bill-card core-bill-loading ${error ? 'is-error' : ''}`}
        role="status"
        aria-live="polite"
        aria-busy={!error}
      >
        {!error ? (
          <div
            className="core-bill-loading__progress"
            role="progressbar"
            aria-label={`正在加载${billType}`}
          >
            <span />
          </div>
        ) : null}

        <div className="core-bill-loading__content">
          <div className="core-bill-loading__intro">
            <span
              className={error ? 'core-bill-loading__error-icon' : 'core-bill-loading__spinner'}
              aria-hidden="true"
            >
              {error ? '!' : null}
            </span>
            <div className="core-bill-loading__copy">
              <p>{error ? '账单加载未完成' : '正在同步账单数据'}</p>
              <h1>{error ? `无法打开${billType}` : `正在打开${billType}`}</h1>
              <span>
                {error ||
                  (isVerySlow
                    ? '服务器正在唤醒或网络较慢，可以继续等待，也可以重试。'
                    : '正在读取账单明细，完成后会自动进入编辑状态。')}
              </span>
            </div>
            <div className="core-bill-loading__meta">
              {!error && isSlow ? <span>已等待 {elapsedSeconds} 秒</span> : null}
              <div className="core-bill-loading__actions">
                {onBack ? (
                  <button type="button" onClick={onBack}>返回列表</button>
                ) : null}
                {(error || isSlow) && onRetry ? (
                  <button type="button" className="primary" onClick={onRetry}>重新加载</button>
                ) : null}
              </div>
            </div>
          </div>

          {normalizedSummary.length > 0 ? (
            <div className="core-bill-loading__summary" aria-label="待打开账单概览">
              {normalizedSummary.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong title={compactText(item.value)}>{compactText(item.value)}</strong>
                </div>
              ))}
            </div>
          ) : null}

          {!error ? (
            <div className="core-bill-loading__skeleton" aria-hidden="true">
              {LOADING_FIELDS.map((field) => (
                <div
                  className={`core-bill-loading__field core-bill-loading__field--${field.size}`}
                  key={field.id}
                >
                  <span />
                  <i />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </PageContainer>
  )
}
