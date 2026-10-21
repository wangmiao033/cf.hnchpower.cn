import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/channel-review-confirmation.html')
})

test('confirmation shows identity and consequences; cancel/Escape write nothing and restore focus', async ({ page }) => {
  let nativeDialogs = 0
  page.on('dialog', async dialog => { nativeDialogs++; await dialog.dismiss() })
  const trigger = page.getByRole('button', { name: '保存并确认核对', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('测试渠道')
  await expect(dialog).toContainText('2026-09')
  await expect(dialog).toContainText('¥ 100.00')
  await expect(dialog).toContainText('不会自动放行')
  await expect(page.getByRole('button', { name: '返回检查' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page.getByTestId('requests')).toHaveText('0')
  await trigger.click()
  await page.getByRole('button', { name: '返回检查' }).click()
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('textbox')).toHaveValue('保留我的输入')
  expect(nativeDialogs).toBe(0)
})

test('rapid repeated confirmation submits once, and reopening can submit again', async ({ page }) => {
  await page.getByRole('button', { name: '保存并确认核对', exact: true }).click()
  await page.getByRole('button', { name: '保存并开始核对' }).evaluate(button => { button.click(); button.click() })
  await expect(page.getByTestId('requests')).toHaveText('1')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '零结算', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('本期无需开票和收款')
  await page.getByRole('button', { name: '开始核对', exact: true }).click()
  await expect(page.getByTestId('requests')).toHaveText('2')
})

test('small screens keep confirmation controls visible and keyboard focus in the modal', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.getByRole('button', { name: '保存并确认核对', exact: true }).click()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: '保存并开始核对' })).toBeFocused()
  const box = await page.getByRole('dialog').boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(360)
  await expect(page.getByRole('button', { name: '保存并开始核对' })).toBeInViewport()
})
