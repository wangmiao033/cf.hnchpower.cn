import React, { useEffect, useMemo, useState } from 'react'
import { getGroupForView, getTabView, SIDEBAR_GROUPS, VIEW_ICONS } from '@/app/routes.js'
import './Sidebar.css'

const EXPANDED_GROUPS_STORAGE_KEY = 'core-sidebar-expanded-groups-v2'
const EXPANDABLE_GROUP_IDS = new Set(
  SIDEBAR_GROUPS.filter((group) => group.items.length > 1).map((group) => group.id)
)

function readExpandedGroups() {
  if (typeof window === 'undefined') return new Set()

  try {
    const stored = JSON.parse(window.localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY) || '[]')
    if (!Array.isArray(stored)) return new Set()
    return new Set(stored.filter((groupId) => EXPANDABLE_GROUP_IDS.has(groupId)))
  } catch {
    return new Set()
  }
}

function Sidebar({ activeView, onNavigate, collapsed = false }) {
  const activeGroup = useMemo(() => getGroupForView(activeView), [activeView])
  const activeGroupId = activeGroup?.id
  const activeTabView = getTabView(activeView)
  const [expandedGroups, setExpandedGroups] = useState(readExpandedGroups)

  useEffect(() => {
    if (!activeGroupId || activeGroup?.items.length <= 1) return

    setExpandedGroups((current) => {
      if (current.has(activeGroupId)) return current
      const next = new Set(current)
      next.add(activeGroupId)
      return next
    })
  }, [activeGroup, activeGroupId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      EXPANDED_GROUPS_STORAGE_KEY,
      JSON.stringify([...expandedGroups])
    )
  }, [expandedGroups])

  const toggleGroup = (groupId) => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
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
            aria-current={isActive ? 'page' : undefined}
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
              const isActive = firstItem.view === activeTabView
              return (
                <div key={group.id} className="sidebar-group sidebar-group--singleton">
                  <button
                    type="button"
                    className={`sidebar-item sidebar-item--direct ${isActive ? 'active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    title={group.label}
                    onClick={() => onNavigate?.(firstItem.view)}
                  >
                    <span className="sidebar-item-icon" aria-hidden>
                      {VIEW_ICONS[firstItem.view] || ''}
                    </span>
                    <span className="sidebar-item-label">{firstItem.label}</span>
                  </button>
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
