import React, { useState } from 'react'
import BankAllocationDock from '@/components/bank/BankAllocationDock.jsx'
import BankCustomerMatchDock from '@/components/bank/BankCustomerMatchDock.jsx'
import BankCenterPageV2 from './BankCenterPageV2.jsx'

export default function BankAutoReconciliationPage() {
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision((value) => value + 1)
  return (
    <>
      <BankCenterPageV2 key={revision} />
      <BankCustomerMatchDock onChanged={refresh} />
      <BankAllocationDock onChanged={refresh} />
    </>
  )
}
