/**
 * 大熊游戏：浏览器本机草稿（非财务入账、非服务器备份）。
 *
 * - 用户明确点击「保存本机草稿」后才存储；不会静默持久化导入订单。
 * - IndexedDB 以当前登录账号 ID 隔离，保存核对后的规范化订单，
 *   不保存原始文件二进制；可在同浏览器刷新后恢复。
 * - 清理站点数据 / 无痕模式 / 换设备可能丢失；不得当作生产账本。
 */
const DB_NAME = 'cf-daxiong-device-drafts-v1'
const DB_VERSION = 1
const STORE_NAME = 'drafts'
const DRAFT_VERSION = 1
const MAX_ROWS = 30000
const MAX_SERIALIZED_BYTES = 7_000_000

function scopeForUser(userId) {
  const scope = String(userId ?? '').trim()
  if (!scope || scope.length > 200) {
    throw new Error('没有有效登录账号，无法读取或保存本机草稿')
  }
  return 'user:' + scope
}

function withStore(mode, op) {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前浏览器不支持本机草稿；请保留原始 CSV 文件'))
  }

  return new Promise((resolve, reject) => {
    let request
    try { request = indexedDB.open(DB_NAME, DB_VERSION) }
    catch (error) { reject(error); return }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'scope' })
    }
    request.onerror = () => reject(request.error || new Error('本机数据存储无法打开'))
    request.onsuccess = () => {
      const db = request.result
      let transaction
      try { transaction = db.transaction(STORE_NAME, mode) }
      catch (error) { db.close(); reject(error); return }

      let result
      transaction.oncomplete = () => { db.close(); resolve(result) }
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error('本机草稿操作已中止')) }
      transaction.onerror = () => { /* onabort returns the specific failure */ }
      try {
        const operation = op(transaction.objectStore(STORE_NAME))
        operation.onsuccess = () => { result = operation.result }
      } catch (error) {
        transaction.abort()
        db.close()
        reject(error)
      }
    }
  })
}

const cents = (rows, kind) => rows
  .filter(row => row.disposition === 'ready' && row.kind === kind)
  .reduce((sum, row) => sum + row.amountCents, 0)

export function assertValidLocalPreview(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('没有有效订单预览，不能保存')
  if (!Array.isArray(payload.records) || !payload.records.length || payload.records.length > MAX_ROWS) {
    throw new Error('本机草稿的订单记录数量无效')
  }
  if (!payload.summary || typeof payload.summary !== 'object') throw new Error('缺少订单汇总')
  if (typeof payload.fileName !== 'string' || !payload.fileName.trim() || payload.fileName.length > 255) {
    throw new Error('源文件名称不符合要求')
  }
  if (typeof payload.draftId !== 'string' || !payload.draftId.trim()) {
    throw new Error('缺少本次导入的草稿标识')
  }
  if (!Array.isArray(payload.months) || !payload.months.length) {
    throw new Error('没有可查看的结算月份')
  }
  const validMonths = new Set()
  for (const row of payload.records) {
    if (!row || typeof row !== 'object') throw new Error('订单行结构不正确')
    if (!['ready','excluded','duplicate','conflict','invalid','review'].includes(row.disposition)) {
      throw new Error('订单校验状态无效')
    }
    if (!Number.isSafeInteger(row.amountCents) && row.amountCents !== null) {
      throw new Error('订单金额必须为整数分')
    }
    if (row.disposition === 'ready') {
      if (!['game','coin'].includes(row.kind) || !/^\d{4}-\d{2}$/.test(row.month || '')) {
        throw new Error('有效订单存在不确定的业务归类或账期')
      }
      if (!row.orderId || typeof row.orderId !== 'string') throw new Error('缺少有效订单编号')
      if (row.amountCents <= 0) throw new Error('有效订单金额必须大于零')
      validMonths.add(row.month)
    }
  }

  const expectedGameCents = cents(payload.records, 'game')
  const expectedCoinCents = cents(payload.records, 'coin')
  if (!Number.isSafeInteger(expectedGameCents) || !Number.isSafeInteger(expectedCoinCents)) {
    throw new Error('订单金额超出安全计算范围')
  }
  if (expectedGameCents !== payload.summary.gameCents ||
      expectedCoinCents !== payload.summary.coinCents) {
    throw new Error('订单汇总与明细金额不一致，请重新导入原始文件')
  }
  const actualMonths = [...validMonths].sort().reverse()
  if (actualMonths.join('|') !== [...payload.months].sort().reverse().join('|')) {
    throw new Error('订单账期和明细不一致')
  }
  if (!validMonths.size) throw new Error('没有可核对的现金订单')
  return true
}

export function makeLocalDraftPayload(imported) {
  const payload = {
    draftId: imported?.draftId,
    fileName: imported?.fileName,
    sheetName: imported?.sheetName || '',
    months: Array.isArray(imported?.months) ? [...imported.months] : [],
    summary: imported?.summary ? { ...imported.summary } : null,
    records: Array.isArray(imported?.records) ? imported.records.map(row => ({
      line: row.line,
      orderId: row.orderId,
      gameName: row.gameName,
      gameId: row.gameId,
      amountCents: row.amountCents,
      paidDate: row.paidDate,
      month: row.month,
      kind: row.kind,
      payment: row.payment,
      disposition: row.disposition,
      reason: row.reason
    })) : [],
    assumptions: Array.isArray(imported?.assumptions) ? [...imported.assumptions] : []
  }
  assertValidLocalPreview(payload)
  if (JSON.stringify(payload).length > MAX_SERIALIZED_BYTES) {
    throw new Error('本次订单数量太多，请按账期拆成多份；单个本机草稿最大约7MB')
  }
  return payload
}

export async function loadLocalDraft(userId) {
  const scope = scopeForUser(userId)
  const row = await withStore('readonly', store => store.get(scope))
  if (!row) return null
  if (row.schemaVersion !== DRAFT_VERSION || !row.payload) {
    throw new Error('检测到不兼容的旧版本机草稿，请保留原始 CSV 文件')
  }
  assertValidLocalPreview(row.payload)
  return { savedAt: row.savedAt, payload: row.payload }
}

export async function saveLocalDraft(userId, imported) {
  const scope = scopeForUser(userId)
  const payload = makeLocalDraftPayload(imported)
  const savedAt = new Date().toISOString()
  await withStore('readwrite', store => store.put({
    scope, schemaVersion: DRAFT_VERSION, savedAt, payload
  }))
  return { savedAt, payload }
}

export async function deleteLocalDraft(userId) {
  const scope = scopeForUser(userId)
  await withStore('readwrite', store => store.delete(scope))
}
