import { test, expect } from '@playwright/test'
for (const type of ['channel', 'rd']) {
  for (const allowed of [true, false]) {
    test(`${type} reviewed history is visible and audit-only (permission ${allowed})`, async ({ page }) => {
      const requests = []
      await page.route(url => url.pathname.startsWith('/api/'), route => {
        const request = route.request(), url = new URL(request.url())
        requests.push({method:request.method(),path:url.pathname})
        if (url.pathname === '/api/auth/me') return route.fulfill({json:{id:'viewer',role:'viewer',permissions:allowed?['audit.view']:[]}})
        if (url.pathname === `/api/operation-logs/bill-actors/${type}/audit-test`) return route.fulfill({json:{entered:{actor_email:'entry@example.test',actor_user_id:'entry-id',created_at:'2026-09-01T01:00:00Z'},verified:null,modified:null}})
        if (url.pathname === '/api/operation-logs') {
          expect(url.searchParams.get('entity_type')).toBe(type)
          expect(url.searchParams.get('entity_id')).toBe('audit-test')
          return route.fulfill({json:{total:2,items:[
            {id:'review',action:'status_change',summary:'首次核对',actor_email:'review@example.test',actor_user_id:'review-id',created_at:'2026-09-02T01:00:00Z',metadata:{reason:'平台结算单核实'},changes:{status:{before:'pending',after:'confirmed'}}},
            {id:'amend',action:'update',summary:'修改账单',actor_email:'editor@example.test',actor_user_id:'editor-id',created_at:'2026-09-03T01:00:00Z',metadata:{reason:'补充原始证据'},changes:{remark:{before:'旧备注',after:'新备注'}}}
          ]}})
        }
        return route.abort()
      })
      await page.goto(`/tests/fixtures/bill-audit-history.html?type=${type}`)
      await expect(page.getByText('权限已加载',{exact:true})).toBeVisible()
      const button = page.getByRole('button',{name:type==='channel'?'核对记录':'查看核对结果',exact:true})
      await expect(page.getByText('原账单金额 ¥475.81')).toBeVisible()
      await expect(page.locator('.bill360-workspace-host')).toBeHidden()
      if (allowed) {
        await expect(button).toBeVisible()
        await button.click()
        const panel = page.getByRole('region',{name:'账单核对记录'})
        await expect(panel).toBeVisible()
        await expect(panel.getByText('首次核对',{exact:true})).toBeVisible()
        await expect(panel.getByText('原因：平台结算单核实')).toBeVisible()
        await expect(panel.getByText('原因：补充原始证据')).toBeVisible()
        await expect(panel.getByText('entry@example.test',{exact:false})).toBeVisible()
        await expect(panel.getByText('review@example.test',{exact:false})).toBeVisible()
        await expect(panel.locator('.bill-lifecycle-panel')).toHaveCount(0)
        await button.click()
        await expect(panel).toHaveCount(0)
      } else {
        await expect(button).toHaveCount(0)
        expect(requests.filter(r=>r.path.startsWith('/api/operation-logs'))).toEqual([])
      }
      expect(requests.every(r=>r.method==='GET')).toBe(true)
      expect(requests.some(r=>r.path.includes('lifecycle'))).toBe(false)
      await expect(page.getByText('原账单金额 ¥475.81')).toBeVisible()
    })
  }
}
