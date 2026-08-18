import React from 'react'
import CoreChannelBillFormPage from './CoreChannelBillFormPage.jsx'
import './ChannelBillInputColumns.css'

// Shared input columns and multiline bill remarks are loaded for channel bill entry.
function ChannelReconciliationCreatePage() {
  return <CoreChannelBillFormPage mode="create" />
}

export default ChannelReconciliationCreatePage
