import React from 'react'
import PageContainer from '@/components/layout/PageContainer.jsx'

const LOADING_FIELDS = [
  { id: 'bill-number', size: 'medium' },
  { id: 'date', size: 'short' },
  { id: 'partner', size: 'wide' },
  { id: 'memo', size: 'full' },
  { id: 'game', size: 'wide' },
  { id: 'flow', size: 'medium' },
  { id: 'share', size: 'short' },
  { id: 'amount', size: 'medium' }
]

export function CoreBillLoadingState({ billType }) {
  return (
    <PageContainer hideHeader className="core-bill-form-page">
      <section
        className="core-bill-card core-bill-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div
          className="core-bill-loading__progress"
          role="progressbar"
          aria-label={`正在加载${billType}`}
        >
          <span />
        </div>

        <div className="core-bill-loading__content">
          <div className="core-bill-loading__intro">
            <span className="core-bill-loading__spinner" aria-hidden="true" />
            <div>
              <p>账单数据同步中</p>
              <h1>正在加载{billType}</h1>
              <span>正在读取账单明细和客户资料，请稍候…</span>
            </div>
          </div>

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
        </div>
      </section>
    </PageContainer>
  )
}
