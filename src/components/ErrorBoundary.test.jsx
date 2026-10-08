import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ErrorBoundary from './ErrorBoundary.jsx'

describe('页面模块加载失败的恢复界面', () => {
  it('shows a neutral recovery state only for broken dynamic imports', () => {
    const error = new Error('Failed to fetch dynamically imported module')
    const state = ErrorBoundary.getDerivedStateFromError(error)
    expect(state.recoveringChunk).toBe(true)
    const boundary = new ErrorBoundary({ children: null })
    boundary.state = state
    const html = renderToStaticMarkup(boundary.render())
    expect(html).toContain('正在恢复页面资源')
    expect(html).not.toContain('应用程序遇到了一个错误')
  })
  it('keeps real JavaScript errors visible instead of hiding them', () => {
    const error = new Error('Unable to read a property')
    const state = ErrorBoundary.getDerivedStateFromError(error)
    expect(state.recoveringChunk).toBe(false)
    const boundary = new ErrorBoundary({ children: null })
    boundary.state = state
    expect(renderToStaticMarkup(boundary.render())).toContain('出现错误')
  })
})
