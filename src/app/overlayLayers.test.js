import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const rule = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
  expect(match, `Missing CSS rule: ${selector}`).not.toBeNull()
  return match[1]
}

describe('application overlay layer boundaries', () => {
  it('does not isolate every route below the shell navigation', () => {
    const body = rule(read('../styles/ui-v4.css'), '.app-workspace > *')
    expect(body).toMatch(/position:\s*relative/)
    expect(body).not.toMatch(/z-index\s*:/)
    expect(body).not.toMatch(/(?:isolation|transform|filter|opacity|contain)\s*:/)
  })

  it('keeps navigation above ordinary menus and below open mobile navigation and business dialogs', () => {
    for (const [path, selector] of [
      ['../components/layout/TopSubnav.css', '.app-top-subnav'],
      ['../styles/GlobalShellPolish.css', '.app-top-subnav--workspace']
    ]) {
      expect(rule(read(path), selector)).toMatch(/z-index:\s*var\(--app-navigation-layer,\s*51\)/)
    }
    const shell = read('./AppShell.css')
    expect(rule(shell, '.app-shell-mobile-navigation:has(.mobile-menu)')).toMatch(/z-index:\s*55/)
    const contract = read('../pages/contract-management.css')
    expect(rule(contract, '.contract-drawer-mask')).toMatch(/z-index:\s*60/)
  })

  it('does not trap the game-presets modal inside a translucent toolbar', () => {
    expect(rule(read('../styles/SimplifiedBillReview.css'), '.core-bill-form-page--rd .rd-recon-meta-header')).toMatch(/opacity:\s*1\s*;/)
  })
})
