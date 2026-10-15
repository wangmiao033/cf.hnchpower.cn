import { test, expect } from '@playwright/test'

test('company and month never insert contract or historical games unless the user explicitly generates', async ({page}) => {
  const apiCalls = []
  const contracts = [{
    id: 'contract-1', partner_name: '示例渠道公司', partner_short_name: '示例渠道公司',
    access_items: [
      { product_name: '合同游戏甲', timeline_status: '生效中', authorization_start:'2025-01', authorization_end:'2027-12' },
      { product_name: '合同游戏乙', timeline_status: '生效中', authorization_start:'2025-01', authorization_end:'2027-12' }
    ]
  }]
  await page.route(url => url.pathname.startsWith('/api/'), route => {
    const name = new URL(route.request().url()).pathname
    apiCalls.push(name)
    if (name === '/api/contracts') return route.fulfill({json:{items:contracts,total:1}})
    return route.abort()
  })
  await page.goto('/tests/fixtures/channel-manual-games.html')
  const generated = page.getByTestId('generated-events')
  const games = page.getByTestId('game-list')
  const generate = page.getByRole('button', {name:'手动生成 / 补齐游戏清单'})
  await expect(generate).toBeEnabled()
  await expect(page.locator('.channel-smart-entry__source')).toContainText('合同游戏')
  await expect(games).toHaveText('[""]')
  await expect(generated).toHaveText('0')

  // Previously this change + async contract loading generated multiple rows
  // without an explicit action, overriding the only blank entry line.
  await page.locator('.channel-smart-entry__controls input[type="month"]').fill('2026-09')
  await expect(page.locator('.channel-smart-entry__controls input[type="month"]')).toHaveValue('2026-09')
  await page.waitForTimeout(300)
  await expect(games).toHaveText('[""]')
  await expect(generated).toHaveText('0')

  // An explicit manual click must remain available for users who want it.
  await generate.click()
  await expect(generated).toHaveText('1')
  await expect(games).toContainText('合同游戏甲')
  await expect(games).toContainText('合同游戏乙')
  await expect(games).toContainText('上月历史游戏')
  await expect(page.getByTestId('statement-month')).toHaveText('2026-09')
  expect(apiCalls.filter(call => call === '/api/contracts').length).toBeGreaterThan(0)
})
