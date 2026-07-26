import React, { useEffect, useRef, useState } from 'react'
import './NotificationCenter.css'

function NotificationCenter() {
  const [notifications, setNotifications] = useState([])
  const [isOpen, setIsOpen] = useState(false)
  const timersRef = useRef(new Set())

  useEffect(() => {
    const handleNotification = (event) => {
      const { message, type, duration } = event.detail
      const displayDuration = Number.isFinite(duration) ? duration : 5000
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const notification = {
        id,
        message,
        type: type || 'info',
        timestamp: new Date()
      }
      setNotifications((current) => [notification, ...current].slice(0, 10))

      if (displayDuration > 0) {
        const timer = window.setTimeout(() => {
          setNotifications((current) => current.filter((item) => item.id !== id))
          timersRef.current.delete(timer)
        }, displayDuration)
        timersRef.current.add(timer)
      }
    }

    window.addEventListener('app-notification', handleNotification)
    return () => {
      window.removeEventListener('app-notification', handleNotification)
      timersRef.current.forEach((timer) => window.clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  const clearAll = () => {
    setNotifications([])
  }

  const unreadCount = notifications.length

  if (unreadCount === 0 && !isOpen) {
    return null
  }

  return (
    <div className="notification-center">
      <button
        type="button"
        className="notification-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="通知中心"
        aria-label={`通知中心，${unreadCount} 条通知`}
        aria-expanded={isOpen}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5.2 8.3a4.8 4.8 0 0 1 9.6 0v2.2c0 1 .4 2 1.1 2.7l.4.4H3.7l.4-.4c.7-.7 1.1-1.7 1.1-2.7V8.3Z" />
          <path d="M8.1 15.2a2 2 0 0 0 3.8 0" />
        </svg>
        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            className="notification-overlay"
            aria-label="关闭通知中心"
            onClick={() => setIsOpen(false)}
          />
          <div className="notification-panel" role="dialog" aria-label="通知中心">
            <div className="notification-header">
              <h4>通知中心</h4>
              <div className="notification-header-actions">
                {notifications.length > 0 && (
                  <button type="button" className="clear-all-btn" onClick={clearAll}>
                    清空
                  </button>
                )}
                <button
                  type="button"
                  className="close-notification-btn"
                  aria-label="关闭通知中心"
                  onClick={() => setIsOpen(false)}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="notification-list">
              {notifications.length === 0 ? (
                <div className="empty-notifications">暂无通知</div>
              ) : (
                notifications.map(notification => (
                  <div 
                    key={notification.id} 
                    className={`notification-item notification-${notification.type}`}
                  >
                    <div className="notification-content">
                      <span className="notification-message">{notification.message}</span>
                      <span className="notification-time">
                        {new Date(notification.timestamp).toLocaleTimeString('zh-CN', { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="notification-close"
                      aria-label="删除通知"
                      onClick={() => removeNotification(notification.id)}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// 导出通知函数供其他组件使用
export const showNotification = (message, type = 'info', duration = 5000) => {
  const event = new CustomEvent('app-notification', {
    detail: { message, type, duration }
  })
  window.dispatchEvent(event)
}

export default NotificationCenter
