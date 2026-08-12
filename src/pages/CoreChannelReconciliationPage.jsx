import React from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import ChannelMonthCloseLauncher from '@/components/channel/ChannelMonthCloseLauncher.jsx'
import CoreChannelReconciliationPageBase from './CoreChannelReconciliationPageBase.jsx'

export default function CoreChannelReconciliationPage() {
  const {
    recon,
    settings,
    showToast,
    setActiveView,
    openChannelReconciliationEdit,
    openBill360
  } = useAppState()
  const { can } = useAuth()

  return (
    <>
      {can('contracts.view') ? (
        <div style={{ padding: '16px 20px 0' }}>
          <ChannelMonthCloseLauncher
            channelRecords={recon.channelRecords || []}
            partners={settings?.partners || []}
            onNavigate={setActiveView}
            onOpenEdit={openChannelReconciliationEdit}
            onOpenView={(billId) => openBill360?.('channel', billId)}
            onNotice={(message, tone = 'info') => showToast(message, tone)}
          />
        </div>
      ) : null}
      <CoreChannelReconciliationPageBase />
    </>
  )
}
