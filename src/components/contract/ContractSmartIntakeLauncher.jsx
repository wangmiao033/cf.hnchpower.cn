import React, { useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import ContractSmartIntakeModal from './ContractSmartIntakeModal.jsx'
import './ContractSmartIntakeLauncher.css'

export const CONTRACT_SMART_SAVED_EVENT = 'cf:contract-smart-saved'

export default function ContractSmartIntakeLauncher() {
  const { can } = useAuth()
  const [open, setOpen] = useState(false)

  if (!can('contracts.manage')) return null

  return (
    <>
      <button
        type="button"
        className="contract-smart-launcher"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">✦</span>
        <strong>上传合同智能录入</strong>
        <small>PDF / 扫描件自动填表</small>
      </button>
      {open ? (
        <ContractSmartIntakeModal
          onClose={() => setOpen(false)}
          onSaved={() => {
            window.dispatchEvent(new Event(CONTRACT_SMART_SAVED_EVENT))
            setOpen(false)
          }}
        />
      ) : null}
    </>
  )
}
