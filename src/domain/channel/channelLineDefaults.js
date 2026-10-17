/**
 * Derive settlement-driving defaults (mainly commercial discount) from game names.
 * Mirrors contract_terms/v19_main canonical 折-token parsing; 3折 → 0.3, 0.05折 → 0.005.
 */

const VARIANT_RE = /(?<!\d)(\d+(?:\.\d+)?)\s*折/gu

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase()
}

/** @returns {string} canonical label such as `0.05折` or empty */
export function canonicalCommercialDiscountLabel(gameName) {
  const text = normalizeText(gameName)
  const match = VARIANT_RE.exec(text)
  VARIANT_RE.lastIndex = 0
  if (!match) return ''
  let token = match[1]
  if (!token.includes('.') && token.length > 1 && token.startsWith('0')) {
    token = `0.${token.slice(1)}`
  }
  const number = Number(token)
  if (!Number.isFinite(number) || number <= 0) return ''
  return `${number}折`
}

/** @returns {number|null} discount_factor in (0, 1] */
export function commercialDiscountFactorFromGameName(gameName) {
  const label = canonicalCommercialDiscountLabel(gameName)
  if (!label) return null
  const number = Number(label.slice(0, -1))
  if (!Number.isFinite(number) || number <= 0) return null
  const factor = number / 10
  return factor > 1 ? 1 : factor
}

export function shouldInferDiscountFactorFromGameName(row) {
  const current = Number(row?.discountFactor)
  if (!Number.isFinite(current) || current <= 0) return true
  return current === 1 && !String(row?.discountFactor ?? '').includes('.')
}

export function applyCommercialDiscountFromGameName(row, { force = false } = {}) {
  const inferred = commercialDiscountFactorFromGameName(row?.gameName)
  if (inferred == null) return row
  if (!force && !shouldInferDiscountFactorFromGameName(row)) return row
  return { ...row, discountFactor: String(inferred) }
}
