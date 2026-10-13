import React from 'react'
import CoreRdBillFormPage from './CoreRdBillFormPage.jsx'

// Details are always visible; editing an already reviewed bill requires a
// recorded modification note before the main editor becomes available.
export default function ReconciliationEditPage() {
  return <CoreRdBillFormPage mode="edit" />
}
