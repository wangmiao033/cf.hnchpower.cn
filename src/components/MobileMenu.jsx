import React, { useEffect, useId, useState } from 'react'
import './MobileMenu.css'

function MobileMenu({ children }) {
  const [isOpen, setIsOpen] = useState(false)
  const menuId = useId()

  useEffect(() => {
    if (!isOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  const closeAfterNavigation = (event) => {
    if (event.target.closest('button, a, [role="menuitem"]')) setIsOpen(false)
  }

  return (
    <>
      <button
        type="button"
        className="mobile-menu-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? '关闭菜单' : '打开菜单'}
        aria-expanded={isOpen}
        aria-controls={menuId}
      >
        <span aria-hidden>{isOpen ? '✕' : '☰'}</span>
      </button>

      {isOpen ? (
        <>
          <div className="mobile-menu-overlay" role="presentation" onMouseDown={() => setIsOpen(false)} />
          <div id={menuId} className="mobile-menu" role="dialog" aria-modal="true" aria-label="系统导航">
            <div className="mobile-menu-content" onClickCapture={closeAfterNavigation}>
              {children}
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}

export default MobileMenu
