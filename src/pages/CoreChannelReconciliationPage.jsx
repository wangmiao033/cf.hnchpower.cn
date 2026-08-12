import React from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import ChannelMonthCloseLauncher from '@/components/channel/ChannelMonthCloseLauncher.jsx'
import CoreChannelReconciliationPageBase from './CoreChannelReconciliationPageBase.jsx'

export default function CoreChannelReconciliationPage() {
  const {
    recon,
    showToast,
    setActiveView,
    openChannelReconciliationEdit
  } = useAppState()

  return (
    <>
      <div style={{ padding: '16px 20px 0' }}>
        <ChannelMonthCloseLauncher
          channelRecords={recon.channelRecords || []}
          onNavigate={setActiveView}
          onOpenEdit={openChannelReconciliationEdit}
          onNotice={(message, tone = 'info') => showToast(message, tone)}
        />
      </div>
      <CoreChannelReconciliationPageBase />
    </>
  )
}
