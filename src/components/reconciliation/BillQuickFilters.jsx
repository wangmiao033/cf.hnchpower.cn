import React from 'react'
import './BillQuickFilters.css'

export default function BillQuickFilters({ value, items, onChange, busyKey = '' }) {
  return (
    <div className="bill-quick-filters" aria-label="账单快捷筛选">
      <span className="bill-quick-filters__label">快捷筛选</span>
      <div className="bill-quick-filters__items">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={value === item.key ? 'is-active' : ''}
            onClick={() => onChange(item.key)}
            disabled={busyKey === item.key}
          >
            <span>{busyKey === item.key ? `${item.label}核对中…` : item.label}</span>
            {item.count !== undefined && item.count !== null ? <em>{item.count}</em> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
