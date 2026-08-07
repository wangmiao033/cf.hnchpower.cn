import { API_BASE_URL, parseResponse } from '@/lib/api/client.ts'

export type SmartFieldMap = Record<string, string>
export type SmartConfidenceMap = Record<string, number>

export type SmartContractAccessItem = {
  values: SmartFieldMap
  confidence: SmartConfidenceMap
  evidence: SmartFieldMap
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
}

const PATH = '/api/contracts/smart-scan'
const SMART_SCAN_TIMEOUT_MS = 150_000

export async function scanContractFile(file: File): Promise<SmartContractScanResult> {
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
