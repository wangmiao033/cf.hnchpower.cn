import React, { useEffect, useMemo, useState } from 'react'
import { getGroupForView, getTabView, SIDEBAR_GROUPS, VIEW_ICONS } from '@/app/routes.js'
import './Sidebar.css'

function Sidebar({ activeView, onNavigate, collapsed = false }) {
  const activeGroup = useMemo(() => getGroupForView(activeView), [activeView])
  const activeGroupId = activeGroup?.id
  const activeTabView = getTabView(activeView)
  const [expandedGroups, setExpandedGroups] = useState(() => new Set(
    SIDEBAR_GROUPS
      .filter((group) => group.items.length > 1)
      .map((group) => group.id)
  ))

  useEffect(() => {
    if (!activeGroupId || activeGroup?.items.length <= 1) {
      return
    }

    setExpandedGroups((current) => {
      if (current.has(activeGroupId)) {
        return current
      }

      const next = new Set(current)
      next.add(activeGroupId)
      return next
    })
  }, [activeGroup, activeGroupId])

  const toggleGroup = (groupId) => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const renderItems = (group, nested = false) => (
    <div className={`sidebar-sub-list ${nested ? 'sidebar-sub-list--nested' : ''}`}>
      {group.items.map((item) => {
        const isActive = item.view === activeTabView
        return (
          <button
            key={item.view}
            type="button"
            className={`sidebar-item ${nested ? 'sidebar-item--nested' : ''} ${isActive ? 'active' : ''}`}
            onClick={() => onNavigate?.(item.view)}
          >
            <span className="sidebar-item-icon" aria-hidden>
              {VIEW_ICONS[item.view] || ''}
            </span>
            <span className="sidebar-item-label">{item.label}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <aside className={`app-sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="主导航">
      <div className="app-sidebar-inner">
        <div className="sidebar-brand">
          <div className="sidebar-brand__logo" aria-hidden>对</div>
          <div className="sidebar-brand__title">对账管理系统</div>
          <div className="sidebar-brand__subtitle">核心财务后台</div>
        </div>

        <nav className="sidebar-nav" aria-label="功能分组">
          {SIDEBAR_GROUPS.map((group) => {
            const isSingleton = group.items.length === 1
            const groupActive = activeGroupId === group.id
            const firstItem = group.items[0]
            const isExpanded = expandedGroups.has(group.id)

            if (isSingleton) {
              return (
                <div key={group.id} className="sidebar-group sidebar-group--singleton">
                  <div className="sidebar-group-title sidebar-group-title--static">{group.label}</div>
                  {renderItems(group)}
                </div>
              )
            }

            return (
              <div key={group.id} className={`sidebar-group ${groupActive ? 'active' : ''}`}>
                <button
                  type="button"
                  className={`sidebar-group-entry ${groupActive ? 'active' : ''}`}
                  aria-expanded={isExpanded}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span className="sidebar-group-entry__mark" aria-hidden>
                    {VIEW_ICONS[firstItem.view] || ''}
                  </span>
                  <span className="sidebar-group-entry__label">{group.label}</span>
                  <span
                    className={`sidebar-group-entry__arrow ${isExpanded ? 'is-open' : ''}`}
                    aria-hidden
                  />
                </button>
                {isExpanded && renderItems(group, true)}
              </div>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}

export default Sidebar
