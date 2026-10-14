/** One decision table for an editor opened before a concurrent lifecycle write.
 * Never save financial fields while the server says a bill is locked.
 * Never silently overwrite an unsaved draft on a revision mismatch.
 */
import { normalizeBillStatus, billStatusLabel, isBillLockedStatus } from '@/domain/reconciliation/billLifecycle.js'

export function assessChannelSavePreflight(localRecord, serverRecord) {
  const status = normalizeBillStatus(serverRecord?.status)
  if (isBillLockedStatus(status)) {
    return {
      allowed: false,
      kind: 'locked',
      message: `服务器账单已经是「${billStatusLabel(status)}」，本次没有保存或覆盖任何金额。已为你重新读取真实状态；如需修改，先在账单详情记录修改原因。`
    }
  }
  const original = localRecord?.updatedAt || localRecord?.updated_at
  const latest = serverRecord?.updated_at || serverRecord?.updatedAt
  if (original && latest) {
    const a = new Date(original).getTime()
    const b = new Date(latest).getTime()
    if (!Number.isFinite(a) || !Number.isFinite(b) || a !== b) {
      return {
        allowed: false,
        kind: 'version',
        message: '服务器账单在当前页面打开后已发生变化，本次没有覆盖金额。已重新读取服务器版本；本机未提交的修改会保留以供核对。'
      }
    }
  }
  return { allowed: true, kind: 'editable', message: '' }
}
