import React, { useEffect } from 'react'
import { getRecentApiErrorMessage } from '@/lib/api/client.ts'
import './Toast.css'

const GENERIC_SERVER_ERROR_RE = /(更新|保存|同步|删除).*(服务器).*失败|服务器.*(?:失败|没有接受|未接受)|账单未保存|保存\s*\/\s*核对未完成/i

function Toast({ message, type = 'success', isVisible, onClose }) {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose()
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [isVisible, onClose])

  if (!isVisible) return null

  const displayMessage =
    type === 'error' && GENERIC_SERVER_ERROR_RE.test(String(message || ''))
      ? getRecentApiErrorMessage() || message
      : message

  return (
    <div className={`toast toast-${type}`}>
      <span className="toast-icon">
        {type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}
      </span>
      <span className="toast-message">{displayMessage}</span>
      <button className="toast-close" onClick={onClose}>×</button>
    </div>
  )
}

export default Toast
