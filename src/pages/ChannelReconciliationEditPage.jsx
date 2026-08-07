import React from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import LockedBillEditNotice from '@/components/reconciliation/LockedBillEditNotice.jsx'
import { isBillLockedStatus } from '@/domain/reconciliation/billLifecycle.js'
import CoreChannelBillFormPage from './CoreChannelBillFormPage.jsx'

function ChannelReconciliationEditPage() {
  const {
    recon,
    channelEditRecordId,
    channelReturnView,
    openBill360,
    setActiveView
  } = useAppState()
  const record = (recon.channelRecords || []).find(
    (item) => String(item.id) === String(channelEditRecordId)
  )

  if (record && isBillLockedStatus(record.status)) {
    return (
      <LockedBillEditNotice
        billType="channel"
        record={record}
        onOpen360={() => {
          setActiveView(channelReturnView || VIEWS.RECON_CHANNEL)
          openBill360('channel', String(record.id), record)
        }}
        onBack={() => setActiveView(channelReturnView || VIEWS.RECON_CHANNEL)}
      />
    )
  }

  return <CoreChannelBillFormPage mode="edit" />
}

export default ChannelReconciliationEditPage
