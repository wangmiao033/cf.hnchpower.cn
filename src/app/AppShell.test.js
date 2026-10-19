import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VIEWS } from './routes.js'
import { canOpenView } from './viewPermissions.js'

const auth = vi.hoisted(() => ({ can: () => false, user: { display_name: '测试账号' } }))
vi.mock('@/features/auth/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('@/components/contract/ContractSmartIntakeLauncher.jsx', () => ({
  default: () => null,
  CONTRACT_SMART_SAVED_EVENT: 'contract-saved'
}))
import AppShell from './AppShell.jsx'
import Sidebar from '@/components/layout/Sidebar.jsx'

afterEach(() => vi.unstubAllGlobals())

describe('retired global header', () => {
  it('renders the page at the top without legacy search, settings or account menu', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null } })
    const html = renderToStaticMarkup(React.createElement(AppShell, {
      activeView: VIEWS.DASHBOARD,
      onNavigate: vi.fn()
    }, React.createElement('h1', null, '经营工作台正文')))
    expect(html).not.toContain('app-admin-header')
    expect(html).not.toContain('搜索合同')
    expect(html).not.toContain('打开账号菜单')
    expect(html).toContain('经营工作台正文')
    expect(html).toContain('系统管理')
    expect(html).toContain('测试账号')
    expect(html).toContain('打开菜单')
    const styles = readFileSync(new URL('./AppShell.css', import.meta.url), 'utf8')
    expect(styles).toMatch(/\.app-main-shell > \.app-top-subnav\s*\{\s*top: 0 !important;/)
  })

  it('keeps the existing user-center route available without granting business permissions', () => {
    const html = renderToStaticMarkup(React.createElement(Sidebar, {
      activeView: VIEWS.USER_CENTER,
      onNavigate: vi.fn()
    }))
    expect(html).toContain('系统管理')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).not.toContain('渠道账单')
    expect(canOpenView(auth.can, VIEWS.USER_CENTER)).toBe(true)
    expect(canOpenView(auth.can, VIEWS.CHANNEL_RECON_CREATE)).toBe(false)
    const sidebar = readFileSync(new URL('../components/layout/Sidebar.jsx', import.meta.url), 'utf8')
    expect(sidebar).toContain('onClick={() => onNavigate?.(VIEWS.USER_CENTER)}')
  })

  it('leaves native ledger actions visible after removing header proxy controls', () => {
    const styles = readFileSync(new URL('../components/channel/ChannelLedgerHeaderActions.css', import.meta.url), 'utf8')
    expect(styles).not.toMatch(/\.core-recon-workbar > \.core-recon-head\s*\{\s*display:\s*none/)
    const rdPage = readFileSync(new URL('../pages/CoreReconciliationPage.jsx', import.meta.url), 'utf8')
    expect(rdPage).toContain('headerActionsTarget ? createPortal(ledgerActions, headerActionsTarget) : ledgerActions')
  })
})
