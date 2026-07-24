import React from 'react'
import { getGroupForView, getTabView, VIEW_ICONS } from '@/app/routes.js'
import './TopSubnav.css'

function TopSubnav({ activeView, onNavigate, openTabs = [], onCloseTab }) {
  const group = getGroupForView(activeView)
  const activeTab = getTabView(activeView)
  const visibleItems = group?.items.filter((item) => openTabs.includes(item.view)) || []

  if (!group || group.items.length <= 1 || visibleItems.length === 0) {
    return null
  }

  return (
    <nav className="app-top-subnav" aria-label={`${group.label}子导航`}>
      <div className="app-top-subnav__inner">
        <div className="app-top-subnav__group">
          <span className="app-top-subnav__caption">当前模块</span>
          <strong>{group.label}</strong>
        </div>
        <div className="app-top-subnav__tabs" role="tablist" aria-label={group.label}>
          {visibleItems.map((item) => {
            const active = item.view === activeTab

            return (
              <div
                key={item.view}
                className={`app-top-subnav__tab ${active ? 'active' : ''}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="app-top-subnav__tab-main"
                  onClick={() => onNavigate?.(item.view)}
                >
                  <span className="app-top-subnav__icon" aria-hidden>
                    {VIEW_ICONS[item.view] || ''}
                  </span>
                  <span>{item.label}</span>
                </button>
                <button
                  type="button"
                  className="app-top-subnav__close"
                  aria-label={`关闭${item.label}`}
                  title={`关闭${item.label}`}
                  onClick={() => onCloseTab?.(item.view)}
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

export default TopSubnav
