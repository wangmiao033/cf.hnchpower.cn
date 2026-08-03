import React from 'react'

function AdminDrawerLayout({ children, className = '', ...props }) {
  return <aside className={`admin-drawer-surface ${className}`.trim()} {...props}>{children}</aside>
}

export default AdminDrawerLayout
