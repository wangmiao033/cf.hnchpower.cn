/** Presentation only: never changes reconciliation status or approval requirements.
 * Current calculation wins over the audit snapshot. Missing legacy metadata is
 * not proof that an amount was a reference calculation.
 */
export function differenceAmountPresentation(item, currentLine) {
  const amount = currentLine?.contract_amount ?? item?.source_snapshot?.contract_amount
  const isReference = amount
    ? amount.status === 'manual' || amount.deterministic === false
    : item?.amount_is_reference === true || item?.amount_certainty === 'reference'
  return {
    isReference,
    amount: amount ?? item,
    label: isReference ? '合同参考金额（非应结依据）' : '合同应结'
  }
}
