import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:3100', headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI
  }
})
