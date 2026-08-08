import React from 'react'
import './StatusManager.css'

export const STATUS_OPTIONS = [
  { value: 'pending', label: '待核对', color: '#f59e0b', icon: '⏳' },
  { value: 'confirmed', label: '已核对', color: '#3b82f6', icon: '✓' },
  { value: 'settled', label: '已结算', color: '#10b981', icon: '💰' },
  { value: 'invoiced', label: '发票已齐', color: '#6c5ce7', icon: '📄' },
  { value: 'completed', label: '已完成', color: '#10b981', icon: '✓' },
  { value: 'reconciled', label: '已核销', color: '#06b6d4', icon: '✅' },
  { value: 'verified', label: '已核销', color: '#06b6d4', icon: '✅' },
  { value: 'cancelled', label: '已取消', color: '#ef4444', icon: '×' }
]

export const getStatusInfo = (status) => {
  return STATUS_OPTIONS.find((item) => item.value === status) || STATUS_OPTIONS[0]
}

export function StatusTag({ status, onClick, className = '' }) {
  const statusInfo = getStatusInfo(status)
  return (
    <span
      className={`status-tag status-${status} ${className}`}
      onClick={onClick}
      style={{
        backgroundColor: `${statusInfo.color}15`,
        borderColor: statusInfo.color,
        color: statusInfo.color
      }}
      title={statusInfo.label}
    >
      <span className="status-icon">{statusInfo.icon}</span>
      <span className="status-label">{statusInfo.label}</span>
    </span>
  )
}

/**
 * 状态由“确认核对 / 退回修改”和资金、发票业务动作驱动。
 * 列表中的状态标签只读，避免再次出现直接改状态却被后端工作流拦截的情况。
 */
export function StatusSelector({ currentStatus, className = '' }) {
  return <StatusTag status={currentStatus} className={`disabled ${className}`} />
}

/**
 * 旧的批量状态修改入口不再展示。
 * 批量直接改状态会绕过锁单与审计规则，统一改走账单核对动作。
 */
export function BatchStatusUpdate() {
  return null
}

export default { StatusTag, StatusSelector, BatchStatusUpdate, STATUS_OPTIONS, getStatusInfo }
