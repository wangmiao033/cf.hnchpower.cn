import React from 'react'
import { getGroupForView, getTabView, VIEW_ICONS } from '@/app/routes.js'
import './TopSubnav.css'

function TopSubnav({ activeView, onNavigate, openTabs = [], onCloseTab }) {
  const group = getGroupForView(activeView)
  const activeTab = getTabView(activeView)
  const visibleItems = group?.items.filter((item) => openTabs.includes(item.view)) || []
  const isInvoiceGroup = group?.id === 'invoices'
  const canCloseTabs = !isInvoiceGroup && visibleItems.length > 1

  if (!group || group.items.length <= 1 || visibleItems.length === 0) {
    return null
  }

  return (
    <nav
      className={`app-top-subnav ${isInvoiceGroup ? 'app-top-subnav--invoices' : 'app-top-subnav--workspace'}`}
      aria-label={`${group.label}子导航`}
    >
      <div className="app-top-subnav__inner">
        <div
          className={`app-top-subnav__tabs ${isInvoiceGroup ? 'app-top-subnav__tabs--segmented' : ''}`.trim()}
          role="tablist"
          aria-label={isInvoiceGroup ? '发票类型' : `${group.label}已打开页面`}
        >
          {visibleItems.map((item) => {
            const active = item.view === activeTab

            return (
              <div
                key={item.view}
                className={`app-top-subnav__tab ${active ? 'active' : ''}`}
                role="presentation"
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
                {canCloseTabs ? (
                  <button
                    type="button"
                    className="app-top-subnav__close"
                    aria-label={`关闭${item.label}`}
                    title={`关闭${item.label}`}
                    onClick={() => onCloseTab?.(item.view)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

export default TopSubnav
