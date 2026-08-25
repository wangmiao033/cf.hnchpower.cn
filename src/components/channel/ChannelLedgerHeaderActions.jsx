import React from 'react'
import { VIEWS } from '@/app/routes.js'
import './ChannelLedgerHeaderActions.css'

function clickLedgerControl(selector) {
  const control = document.querySelector(selector)
  if (control instanceof HTMLElement) control.click()
}

function ChannelLedgerHeaderActions({ activeView, onNavigate }) {
  if (activeView !== VIEWS.RECON_CHANNEL) return null

  return (
    <div className="channel-ledger-header-actions" role="group" aria-label="渠道账单操作">
      <button
        type="button"
        onClick={() => clickLedgerControl('.core-channel-recon-page input[type="file"]')}
      >
        导入 Excel
      </button>
      <button
        type="button"
        onClick={() => clickLedgerControl('.core-channel-recon-page .core-recon-actions button:nth-of-type(2)')}
      >
        导出
      </button>
      <button
        type="button"
        className="primary"
        onClick={() => onNavigate?.(VIEWS.CHANNEL_RECON_CREATE)}
      >
        新增账单
      </button>
    </div>
  )
}

export default ChannelLedgerHeaderActions
