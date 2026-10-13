import React from 'react'
import CoreChannelBillFormPage from './CoreChannelBillFormPage.jsx'
import './ChannelBillInputColumns.css'

// The form page reads the latest server state and renders reviewed records as
// full read-only details. A stale list snapshot must never hide the bill.
export default function ChannelReconciliationEditPage() {
  return <CoreChannelBillFormPage mode="edit" />
}
