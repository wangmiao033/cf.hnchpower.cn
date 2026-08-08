import { API_BASE_URL, parseResponse } from '@/lib/api/client.ts'

export type SmartFieldMap = Record<string, string>
export type SmartConfidenceMap = Record<string, number>

export type SmartContractAccessItem = {
  values: SmartFieldMap
  confidence: SmartConfidenceMap
  evidence: SmartFieldMap
}

export type SmartScanProgress = {
  phase: 'preparing' | 'scanning' | 'merging'
  current: number
  total: number
  message: string
}

export type SmartContractScanResult = {
  contract: SmartFieldMap
  confidence: SmartConfidenceMap
  evidence: SmartFieldMap
  parties: {
    party_a: string
    party_b: string
    our_party: string
  }
  access_items: SmartContractAccessItem[]
  summary: string
  warnings: string[]
  file: {
    name: string
    size_bytes: number
    content_type: string
  }
  model: string
  scan_parts?: number
  archive_mode?: 'original' | 'split' | 'compressed'
  archive_files?: File[]
}

const PATH = '/api/contracts/smart-scan'
const SMART_SCAN_TIMEOUT_MS = 150_000
const DIRECT_SCAN_MAX_BYTES = Math.floor(3.2 * 1024 * 1024)
export const CONTRACT_SMART_SCAN_MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_PDF_PAGES = 120
const PDF_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
const PDF_LIB_INTEGRITY = 'sha512-z8IYLHO8bTgFqj+yrPyIJnzBDf7DDhWwiEsk4sY+Oe6J2M+WQequeGS7qioI5vT6rXgVRb4K1UVQC5ER7MKzKQ=='

let pdfLibPromise: Promise<any> | null = null

function emitProgress(
  callback: ((progress: SmartScanProgress) => void) | undefined,
  progress: SmartScanProgress
) {
  callback?.(progress)
}

function basenameWithoutExtension(name: string) {
  return String(name || '合同').replace(/\.[^.]+$/, '') || '合同'
}

function normalizeKey(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/\s+/g, '')
}

async function loadPdfLib() {
  const existing = (window as any).PDFLib
  if (existing?.PDFDocument) return existing
  if (pdfLibPromise) return pdfLibPromise

  pdfLibPromise = new Promise((resolve, reject) => {
    const current = document.querySelector<HTMLScriptElement>('script[data-contract-pdf-lib="1"]')
    const finish = () => {
      const lib = (window as any).PDFLib
      if (lib?.PDFDocument) resolve(lib)
      else reject(new Error('PDF 分页组件加载失败，请检查网络后重试。'))
    }
    if (current) {
      if ((window as any).PDFLib?.PDFDocument) finish()
      else {
        current.addEventListener('load', finish, { once: true })
        current.addEventListener('error', () => reject(new Error('PDF 分页组件加载失败，请稍后重试。')), { once: true })
      }
      return
    }

    const script = document.createElement('script')
    script.src = PDF_LIB_URL
    script.async = true
    script.crossOrigin = 'anonymous'
    script.referrerPolicy = 'no-referrer'
    script.integrity = PDF_LIB_INTEGRITY
    script.dataset.contractPdfLib = '1'
    script.addEventListener('load', finish, { once: true })
    script.addEventListener('error', () => reject(new Error('PDF 分页组件加载失败，请稍后重试。')), { once: true })
    document.head.appendChild(script)
  }).catch((error) => {
    pdfLibPromise = null
    throw error
  })

  return pdfLibPromise
}

async function buildPdfChunk(sourceDocument: any, indexes: number[], originalName: string) {
  const { PDFDocument } = await loadPdfLib()
  const target = await PDFDocument.create()
  const pages = await target.copyPages(sourceDocument, indexes)
  pages.forEach((page: any) => target.addPage(page))
  const bytes = await target.save({ useObjectStreams: true })
  const firstPage = indexes[0] + 1
  const lastPage = indexes[indexes.length - 1] + 1
  const name = `${basenameWithoutExtension(originalName)}_第${firstPage}-${lastPage}页.pdf`
  return new File([bytes], name, { type: 'application/pdf' })
}

async function splitPdfForScan(
  file: File,
  onProgress?: (progress: SmartScanProgress) => void
): Promise<File[]> {
  emitProgress(onProgress, {
    phase: 'preparing',
    current: 0,
    total: 0,
    message: '文件较大，正在按页自动拆分…'
  })

  const { PDFDocument } = await loadPdfLib()
  let source: any
  try {
    source = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true })
  } catch (error) {
    console.error(error)
    throw new Error('PDF 无法读取或已加密，请先解除密码后再识别。')
  }

  const pageCount = source.getPageCount()
  if (!pageCount) throw new Error('PDF 中没有可识别页面。')
  if (pageCount > MAX_PDF_PAGES) {
    throw new Error(`合同页数过多（${pageCount} 页），单次智能识别最多支持 ${MAX_PDF_PAGES} 页。`)
  }

  const chunks: File[] = []
  let currentIndexes: number[] = []
  let currentFile: File | null = null

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    emitProgress(onProgress, {
      phase: 'preparing',
      current: pageIndex + 1,
      total: pageCount,
      message: `正在整理 PDF 第 ${pageIndex + 1}/${pageCount} 页…`
    })

    const candidateIndexes = [...currentIndexes, pageIndex]
    const candidate = await buildPdfChunk(source, candidateIndexes, file.name)
    if (candidate.size <= DIRECT_SCAN_MAX_BYTES) {
      currentIndexes = candidateIndexes
      currentFile = candidate
      continue
    }

    if (currentIndexes.length && currentFile) {
      chunks.push(currentFile)
      currentIndexes = [pageIndex]
      currentFile = await buildPdfChunk(source, currentIndexes, file.name)
    } else {
      currentIndexes = [pageIndex]
      currentFile = candidate
    }

    if (currentFile.size > DIRECT_SCAN_MAX_BYTES) {
      throw new Error(`PDF 第 ${pageIndex + 1} 页单页超过识别上限，请先降低该页扫描分辨率后再试。`)
    }
  }

  if (currentFile) chunks.push(currentFile)
  return chunks
}

async function compressImageForScan(file: File): Promise<File> {
  const image = await createImageBitmap(file)
  try {
    let scale = Math.min(1, 2400 / Math.max(image.width, image.height))
    let quality = 0.88
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器无法创建图片压缩画布。')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (!blob) throw new Error('图片压缩失败。')
      if (blob.size <= DIRECT_SCAN_MAX_BYTES) {
        return new File([blob], `${basenameWithoutExtension(file.name)}_识别副本.jpg`, { type: 'image/jpeg' })
      }
      if (quality > 0.56) quality -= 0.1
      else scale *= 0.78
    }
  } finally {
    image.close()
  }
  throw new Error('图片仍然过大，请降低图片分辨率后再试。')
}

async function scanSingleFile(file: File): Promise<SmartContractScanResult> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), SMART_SCAN_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${PATH}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name)
      },
      body: file,
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('合同智能识别超时，请稍后重试。')
    }
    throw new Error('合同智能识别连接失败，请检查网络后重试。')
  } finally {
    window.clearTimeout(timer)
  }
  return parseResponse<SmartContractScanResult>(response)
}

function pickBestField(results: SmartContractScanResult[], field: string) {
  let best = { value: '', confidence: -1, evidence: '' }
  results.forEach((result) => {
    const value = String(result.contract?.[field] || '').trim()
    const confidence = Number(result.confidence?.[field] || 0)
    if (!value) return
    if (confidence > best.confidence || (confidence === best.confidence && value.length > best.value.length)) {
      best = {
        value,
        confidence,
        evidence: String(result.evidence?.[field] || '').trim()
      }
    }
  })
  return best
}

function mostFrequent(values: string[]) {
  const counts = new Map<string, { value: string; count: number }>()
  values.forEach((raw) => {
    const value = String(raw || '').trim()
    if (!value) return
    const key = normalizeKey(value)
    const existing = counts.get(key)
    if (existing) existing.count += 1
    else counts.set(key, { value, count: 1 })
  })
  return [...counts.values()].sort((left, right) => right.count - left.count || right.value.length - left.value.length)[0]?.value || ''
}

function mergeAccessItems(results: SmartContractScanResult[]) {
  const merged = new Map<string, SmartContractAccessItem>()
  let fallbackSequence = 0

  for (const result of results) {
    for (const item of result.access_items || []) {
      const product = normalizeKey(item.values?.product_name)
      const channel = normalizeKey(item.values?.channel_name)
      const key = product || channel ? `${product}::${channel}` : `fallback-${fallbackSequence++}`
      const current = merged.get(key)
      if (!current) {
        merged.set(key, {
          values: { ...(item.values || {}) },
          confidence: { ...(item.confidence || {}) },
          evidence: { ...(item.evidence || {}) }
        })
        continue
      }
      const fields = new Set([
        ...Object.keys(current.values || {}),
        ...Object.keys(item.values || {})
      ])
      fields.forEach((field) => {
        const nextValue = String(item.values?.[field] || '').trim()
        const nextConfidence = Number(item.confidence?.[field] || 0)
        const currentValue = String(current.values?.[field] || '').trim()
        const currentConfidence = Number(current.confidence?.[field] || 0)
        if (nextValue && (!currentValue || nextConfidence > currentConfidence)) {
          current.values[field] = nextValue
          current.confidence[field] = nextConfidence
          current.evidence[field] = String(item.evidence?.[field] || '').trim()
        }
      })
    }
  }
  return [...merged.values()]
}

export function mergeContractScanResults(
  results: SmartContractScanResult[],
  originalFile: Pick<File, 'name' | 'size' | 'type'>
): SmartContractScanResult {
  if (!results.length) throw new Error('没有可合并的合同识别结果。')
  if (results.length === 1) {
    return {
      ...results[0],
      file: {
        name: originalFile.name,
        size_bytes: originalFile.size,
        content_type: originalFile.type || results[0].file?.content_type || 'application/octet-stream'
      },
      scan_parts: 1
    }
  }

  const contractKeys = new Set<string>()
  results.forEach((result) => Object.keys(result.contract || {}).forEach((key) => contractKeys.add(key)))
  const contract: SmartFieldMap = {}
  const confidence: SmartConfidenceMap = {}
  const evidence: SmartFieldMap = {}
  contractKeys.forEach((field) => {
    const best = pickBestField(results, field)
    contract[field] = best.value
    confidence[field] = best.confidence < 0 ? 0 : best.confidence
    evidence[field] = best.evidence
  })

  const summaries = [...new Set(results.map((result) => String(result.summary || '').trim()).filter(Boolean))]
  const warnings = [...new Set(results.flatMap((result) => result.warnings || []).map((item) => String(item || '').trim()).filter(Boolean))]

  return {
    contract,
    confidence,
    evidence,
    parties: {
      party_a: mostFrequent(results.map((result) => result.parties?.party_a || '')),
      party_b: mostFrequent(results.map((result) => result.parties?.party_b || '')),
      our_party: mostFrequent(results.map((result) => result.parties?.our_party || ''))
    },
    access_items: mergeAccessItems(results),
    summary: summaries[0] || `已合并 ${results.length} 个合同分段的识别结果`,
    warnings,
    file: {
      name: originalFile.name,
      size_bytes: originalFile.size,
      content_type: originalFile.type || 'application/octet-stream'
    },
    model: results[0].model,
    scan_parts: results.length
  }
}

export async function scanContractFile(
  file: File,
  onProgress?: (progress: SmartScanProgress) => void
): Promise<SmartContractScanResult> {
  if (file.size > CONTRACT_SMART_SCAN_MAX_FILE_BYTES) {
    throw new Error('智能识别单个合同最大支持 50MB。')
  }

  let scanFiles: File[] = [file]
  let archiveMode: SmartContractScanResult['archive_mode'] = 'original'

  if (file.size > DIRECT_SCAN_MAX_BYTES) {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      scanFiles = await splitPdfForScan(file, onProgress)
      archiveMode = 'split'
    } else if (/^image\//.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)) {
      emitProgress(onProgress, {
        phase: 'preparing',
        current: 0,
        total: 1,
        message: '图片较大，正在生成识别副本…'
      })
      scanFiles = [await compressImageForScan(file)]
      archiveMode = 'compressed'
    }
  }

  const results: SmartContractScanResult[] = []
  for (let index = 0; index < scanFiles.length; index += 1) {
    emitProgress(onProgress, {
      phase: 'scanning',
      current: index + 1,
      total: scanFiles.length,
      message: scanFiles.length > 1
        ? `正在识别第 ${index + 1}/${scanFiles.length} 段合同…`
        : '正在扫描合同…'
    })
    results.push(await scanSingleFile(scanFiles[index]))
  }

  emitProgress(onProgress, {
    phase: 'merging',
    current: scanFiles.length,
    total: scanFiles.length,
    message: scanFiles.length > 1 ? '正在合并各页识别结果…' : '正在整理识别结果…'
  })

  return {
    ...mergeContractScanResults(results, file),
    scan_parts: scanFiles.length,
    archive_mode: archiveMode,
    archive_files: archiveMode === 'original' ? [file] : scanFiles
  }
}
