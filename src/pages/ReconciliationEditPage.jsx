import React from 'react'
import { useAppState } from '@/app/AppStateContext.jsx'
import { VIEWS } from '@/app/routes.js'
import LockedBillEditNotice from '@/components/reconciliation/LockedBillEditNotice.jsx'
import { isBillLockedStatus } from '@/domain/reconciliation/billLifecycle.js'
import CoreRdBillFormPage from './CoreRdBillFormPage.jsx'

function ReconciliationEditPage() {
  const {
    recon,
    reconEditRecordId,
    reconReturnView,
    openBill360,
    setActiveView
  } = useAppState()
  const record = (recon.records || []).find((item) => String(item.id) === String(reconEditRecordId))

  if (record && isBillLockedStatus(record.status)) {
    return (
      <LockedBillEditNotice
        billType="rd"
        record={record}
        onOpen360={() => {
          setActiveView(reconReturnView || VIEWS.RECON_RD)
          openBill360('rd', String(record.id), record)
        }}
        onBack={() => setActiveView(reconReturnView || VIEWS.RECON_RD)}
      />
    )
  }

  return <CoreRdBillFormPage mode="edit" />
}

export default ReconciliationEditPage
