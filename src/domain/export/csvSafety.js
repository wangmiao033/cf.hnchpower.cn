/**
 * Encode a CSV cell for Excel/WPS without allowing untrusted business text
 * to become a spreadsheet formula. Keep plain signed numeric amounts intact.
 */
export function csvCell(value) {
  const raw = value == null ? '' : String(value)
  const trimmed = raw.trim()
  const plainNumber = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)
  const formulaPrefix = /^[\u0000-\u0020\uFEFF]*[=+\-@]/.test(raw)
  const safe = formulaPrefix && !plainNumber ? "'" + raw : raw
  return '"' + safe.replace(/"/g, '""') + '"'
}

export function csvRow(cells) {
  return (cells || []).map(csvCell).join(',')
}
