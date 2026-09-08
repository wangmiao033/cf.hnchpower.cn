// Both dialogs must be accepted before the caller can submit a lifecycle change.
export function confirmRdBillDeletion(billNumber, { prompt, confirm, showError }) {
  const reason = prompt(
    `删除确认（1/2）\n\n账单：${billNumber}\n删除后将移入垃圾桶，历史记录保留，可恢复。\n\n请填写删除原因，点击“确定”进入下一步：`,
    ''
  )
  if (reason === null) return null
  const trimmedReason = reason.trim()
  if (!trimmedReason) {
    showError('删除账单必须填写原因')
    return null
  }
  if (!confirm(
    `最终确认（2/2）\n\n确定删除账单“${billNumber}”吗？\n删除原因：${trimmedReason}\n\n点击“确定”后移入垃圾桶；点击“取消”则不删除。`
  )) return null
  return trimmedReason
}
