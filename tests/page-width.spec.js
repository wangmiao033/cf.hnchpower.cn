import { test, expect } from '@playwright/test'

// Synthetic API responses only. No production account, request or financial record.
for (const width of [390, 1280, 1440, 1740, 2048]) {
  for (const mode of ['contract', 'dashboard']) {
    test(`${mode} page stays inside its shell at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 })
      const writes = []
      await page.route(url => url.pathname.startsWith('/api/'), route => {
        const req = route.request(), path = new URL(req.url()).pathname
        if (!['GET', 'HEAD'].includes(req.method())) writes.push(path)
        if (path === '/api/auth/me') return route.fulfill({ json: { id: 'layout-test', role: 'admin', permissions: [] } })
        if (path === '/api/contracts') return route.fulfill({ json: {
          items: [{ id: 'layout-test', contract_name: '布局测试合同', counterparty: '布局测试客户', contract_type: '无固定总价合同', access_items: [], attachments: [] }], total: 1, summary: { total: 1 }
        } })
        return route.fulfill({ json: { items: [], total: 0, month: '2026-10', summary: {}, trends: [] } })
      })
      await page.goto(`/tests/fixtures/page-width.html?mode=${mode}`)
      await expect(page.getByTestId('auth-ready')).toHaveText('true')
      await expect(page.locator('.page-container-body')).toBeVisible()
      const geometry = await page.evaluate(() => {
        const selectors = ['.app', '.app-dashboard', '.app-sidebar', '.app-main-shell', '.app-workspace', '.page-container', '.page-container-body', '.contract-hero', '.contract-filter-card', '.contract-stats', '.f4-profit-grid', '.f4-metrics']
        return selectors.flatMap(selector => {
          const e = document.querySelector(selector)
          if (!e) return []
          const r = e.getBoundingClientRect(), s = getComputedStyle(e)
          return [{ selector, x: r.x, right: r.right, width: r.width, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, marginLeft: s.marginLeft, minWidth: s.minWidth, maxWidth: s.maxWidth, display: s.display, flex: s.flex }]
        })
      })
      const viewport = await page.evaluate(() => ({
        innerWidth, clientWidth: document.documentElement.clientWidth, devicePixelRatio,
        visualViewport: window.visualViewport ? {
          width: visualViewport.width, scale: visualViewport.scale, offsetLeft: visualViewport.offsetLeft
        } : null
      }))
      console.log(JSON.stringify({ mode, requestedWidth: width, viewport, geometry }))
      await info.attach('layout-geometry', { body: JSON.stringify({ viewport, geometry }, null, 2), contentType: 'application/json' })
      await info.attach('page', { body: await page.screenshot(), contentType: 'image/png' })
      for (const selector of ['.app-main-shell', '.app-workspace', '.page-container', '.page-container-body']) {
        const rect = geometry.find(item => item.selector === selector)
        expect.soft(rect.right, `${selector} must not be clipped`).toBeLessThanOrEqual(width + 1)
      }
      expect(writes).toEqual([])
    })
  }
}
