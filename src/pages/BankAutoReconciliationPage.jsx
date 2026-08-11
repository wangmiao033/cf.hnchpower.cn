import React, { useState } from 'react'
import BankAllocationDock from '@/components/bank/BankAllocationDock.jsx'
import BankCenterPageV2 from './BankCenterPageV2.jsx'

export default function BankAutoReconciliationPage() {
  const [revision, setRevision] = useState(0)
  return (
    <>
      <BankCenterPageV2 key={revision} />
      <BankAllocationDock onChanged={() => setRevision((value) => value + 1)} />
    </>
  )
}
