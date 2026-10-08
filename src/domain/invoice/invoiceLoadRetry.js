/**
 * First-load GETs may be affected by a temporarily waking server. Never retry
 * authorization/validation failures, and never issue invoice mutations here.
 */
export function isRetryableInvoiceReadError(error) {
  const status = Number(error?.status || 0)
  return status === 0 || status === 408 || status === 429 || status >= 500
}

export async function readInvoiceWithRetry(read, {
  delays = [350, 900],
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read()
    } catch (error) {
      if (attempt >= delays.length || !isRetryableInvoiceReadError(error)) throw error
      await wait(delays[attempt])
    }
  }
}
