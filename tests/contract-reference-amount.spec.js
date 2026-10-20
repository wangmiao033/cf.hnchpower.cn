import { test, expect } from '@playwright/test'

test('manual contract reference keeps fee mismatch visible and disables monetary actions', async ({ page }) => {
  const requests = []
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    requests.push(route.request().url())
    return route.abort()
  })
  await page.goto('/tests/fixtures/contract-reference-amount.html')
  const card = page.locator('.contract-difference-card')
  await expect(card).toContainText('合同参考金额（非应结依据） ¥376.00')
  await expect(card).toContainText('渠道费率：账单 0 / 合同 5')
  await expect(card).not.toContainText('合同应结')
  await expect(card).not.toContainText('少结 ¥354.45')
  await expect(page.getByRole('button', { name: '生成补差项' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '转下月冲抵' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '修改当前账单' })).toBeEnabled()
  await page.getByRole('button', { name: '特殊结算确认', exact: true }).click()
  await expect(page.getByLabel('合同参考金额（非应结依据）')).toHaveValue('¥376.00')
  await expect(page.getByLabel('本期差异')).toHaveValue('待核验，参考金额不作为差额依据')
  expect(requests).toHaveLength(0)
})
