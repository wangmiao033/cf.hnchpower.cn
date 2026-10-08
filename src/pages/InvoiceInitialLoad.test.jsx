import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppStateProvider } from '@/app/AppStateContext.jsx'
import InvoicePage from './InvoicePage.jsx'
import { VIEWS } from '@/app/routes.js'

describe('发票列表首次进入', () => {
  it('shows a loading state instead of misleading zero counts', () => {
    const html = renderToStaticMarkup(
      <AppStateProvider value={{ invoice: { invoiceLoadStatus: 'loading' } }}>
        <InvoicePage section={VIEWS.INVOICE_INPUT} />
      </AppStateProvider>
    )
    expect(html).toContain('正在加载进项发票')
    expect(html).not.toContain('发票数量')
    expect(html).not.toContain('暂无发票数据')
  })
})
