from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"expected block not found in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"expected block is not unique in {path}: {text.count(old)} matches")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Keep the already-fetched difference cases on the lifecycle error so the
# edit page can render them immediately instead of issuing another blocking GET.
replace_once(
    "src/lib/api/billLifecycle.ts",
    "import { listContractDifferenceCases } from '@/lib/api/contractDifferences.ts'\n",
    "import { listContractDifferenceCases } from '@/lib/api/contractDifferences.ts'\n"
    "import type { ContractDifferenceCase } from '@/lib/api/contractDifferences.ts'\n",
)

replace_once(
    "src/lib/api/billLifecycle.ts",
    '''async function hasApprovedContractDifferenceOverride(
  billType: 'rd' | 'channel',
  billId: string,
  failCount: number
): Promise<boolean> {
  if (failCount <= 0) return true
  try {
    const result = await listContractDifferenceCases({ billType, billId, limit: 200 })
    const items = result.items || []
    const unresolved = items.filter((item) => item.status !== 'resolved')
    const accepted = items.filter(
      (item) => item.status === 'resolved' && item.handling_type === 'accept_difference'
    )
    return unresolved.length === 0 && accepted.length >= failCount
  } catch (error) {
    console.warn('Contract difference approval lookup unavailable', error)
    return false
  }
}
''',
    '''type ContractDifferenceApproval = {
  approved: boolean
  items: ContractDifferenceCase[]
}

export class ContractDifferenceBlockedError extends Error {
  contractDifferences: ContractDifferenceCase[]
  failCount: number

  constructor(message: string, contractDifferences: ContractDifferenceCase[] = [], failCount = 0) {
    super(message)
    this.name = 'ContractDifferenceBlockedError'
    this.contractDifferences = contractDifferences
    this.failCount = failCount
  }
}

async function getContractDifferenceApproval(
  billType: 'rd' | 'channel',
  billId: string,
  failCount: number
): Promise<ContractDifferenceApproval> {
  if (failCount <= 0) return { approved: true, items: [] }
  try {
    const result = await listContractDifferenceCases({ billType, billId, limit: 200 })
    const items = result.items || []
    const unresolved = items.filter((item) => item.status !== 'resolved')
    const accepted = items.filter(
      (item) => item.status === 'resolved' && item.handling_type === 'accept_difference'
    )
    return {
      approved: unresolved.length === 0 && accepted.length >= failCount,
      items
    }
  } catch (error) {
    console.warn('Contract difference approval lookup unavailable', error)
    return { approved: false, items: [] }
  }
}
''',
)

replace_once(
    "src/lib/api/billLifecycle.ts",
    '''      const approvedOverride = await hasApprovedContractDifferenceOverride(
        billType,
        billId,
        failCount
      )
      if (!approvedOverride) {
        throw new Error(
          `合同核验发现 ${failCount} 条明确差异，暂不能确认核对。可在当前页面“合同差异处理”中选择“特殊结算确认”并留痕，或前往“账单360 → 合同核验”修正合同匹配/账单数据。`
        )
      }
''',
    '''      const approval = await getContractDifferenceApproval(
        billType,
        billId,
        failCount
      )
      if (!approval.approved) {
        const unresolved = approval.items.filter((item) => item.status !== 'resolved')
        throw new ContractDifferenceBlockedError(
          `合同核验发现 ${failCount} 条明确差异，暂不能确认核对。可在当前页面“合同差异处理”中选择“特殊结算确认”并留痕，或前往“账单360 → 合同核验”修正合同匹配/账单数据。`,
          unresolved.length ? unresolved : approval.items,
          failCount
        )
      }
''',
)

# 2) Preserve preloaded cases inside the action panel. If the lifecycle check
# just fetched them, show buttons immediately and skip a redundant first reload.
replace_once(
    "src/components/reconciliation/ContractDifferenceActionPanel.jsx",
    '''export default function ContractDifferenceActionPanel({
  billType,
  billId,
  onEditBill,
  onChanged
}) {
  const [items, setItems] = useState([])
''',
    '''export default function ContractDifferenceActionPanel({
  billType,
  billId,
  initialItems,
  onEditBill,
  onChanged
}) {
  const [items, setItems] = useState(() => Array.isArray(initialItems) ? initialItems : [])
''',
)

replace_once(
    "src/components/reconciliation/ContractDifferenceActionPanel.jsx",
    '''  useEffect(() => {
    setItems([])
    setSummary(null)
    setExpandedId('')
    setDetail(null)
    setEditor(null)
    setForm(emptyForm())
    setMessage('')
    void load()
  }, [load])
''',
    '''  useEffect(() => {
    const seededItems = Array.isArray(initialItems) ? initialItems : []
    setItems(seededItems)
    setSummary(null)
    setExpandedId('')
    setDetail(null)
    setEditor(null)
    setForm(emptyForm())
    setMessage('')
    if (seededItems.length) {
      setLoading(false)
      return
    }
    void load()
  }, [load, initialItems])
''',
)

replace_once(
    "src/components/reconciliation/ContractDifferenceActionPanel.jsx",
    "      setMessage('差异处置记录读取失败，请稍后重试。')\n",
    "      setMessage(items.length ? '已显示本次核验差异；最新状态刷新失败，可先处理当前差异。' : '差异处置记录读取失败，请稍后重试。')\n",
)

# The load callback needs the current item count only for its fallback message.
replace_once(
    "src/components/reconciliation/ContractDifferenceActionPanel.jsx",
    "  }, [billId, billType])\n\n  useEffect(() => {\n",
    "  }, [billId, billType, items.length])\n\n  useEffect(() => {\n",
)

# Avoid a fetch-effect loop caused by load depending on items.length: when the
# initial list is empty the callback identity would otherwise change after load.
# Use a ref-free functional state check in the error path instead.
replace_once(
    "src/components/reconciliation/ContractDifferenceActionPanel.jsx",
    "      setMessage(items.length ? '已显示本次核验差异；最新状态刷新失败，可先处理当前差异。' : '差异处置记录读取失败，请稍后重试。')\n",
    "      setMessage((current) => current || '差异处置记录读取失败，请稍后重试。')\n",
)
replace_once(
    "src/components/reconciliation/ContractDifferenceActionPanel.jsx",
    "  }, [billId, billType, items.length])\n\n  useEffect(() => {\n",
    "  }, [billId, billType])\n\n  useEffect(() => {\n",
)

# 3) Feed the cases captured by the lifecycle check into the current edit page.
replace_once(
    "src/pages/CoreChannelBillFormPage.jsx",
    "import { transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'\n",
    "import { ContractDifferenceBlockedError, transitionBillLifecycle } from '@/lib/api/billLifecycle.ts'\n",
)

replace_once(
    "src/pages/CoreChannelBillFormPage.jsx",
    "  const [inlineIssue, setInlineIssue] = useState(null)\n  const [differenceRevision, setDifferenceRevision] = useState(0)\n",
    "  const [inlineIssue, setInlineIssue] = useState(null)\n  const [differenceSeedItems, setDifferenceSeedItems] = useState([])\n",
)

replace_once(
    "src/pages/CoreChannelBillFormPage.jsx",
    "    setInlineIssue(null)\n    setDifferenceRevision(0)\n",
    "    setInlineIssue(null)\n    setDifferenceSeedItems([])\n",
)

replace_once(
    "src/pages/CoreChannelBillFormPage.jsx",
    '''  const openContractDifferenceWorkbench = () => {
    if (!isEdit) return
    setDifferenceRevision((value) => value + 1)
    window.setTimeout(() => {
      focusProblemTarget(document.getElementById('channel-contract-difference-workbench'))
    }, 90)
  }
''',
    '''  const openContractDifferenceWorkbench = () => {
    if (!isEdit) return
    window.setTimeout(() => {
      focusProblemTarget(document.getElementById('channel-contract-difference-workbench'))
    }, 30)
  }
''',
)

replace_once(
    "src/pages/CoreChannelBillFormPage.jsx",
    "      setInlineIssue(null)\n      showToast(\n",
    "      setInlineIssue(null)\n      setDifferenceSeedItems([])\n      showToast(\n",
)

replace_once(
    "src/pages/CoreChannelBillFormPage.jsx",
    '''      const contractRelated = /合同|差异|核验|特殊结算|匹配/.test(message)
      const issue = reportIssue(message, {
''',
    '''      const contractRelated = /合同|差异|核验|特殊结算|匹配/.test(message)
      const contractDifferences = error instanceof ContractDifferenceBlockedError
        ? error.contractDifferences || []
        : []
      if (contractDifferences.length) setDifferenceSeedItems(contractDifferences)
      const issue = reportIssue(message, {
''',
)

replace_once(
    "src/pages/CoreChannelBillFormPage.jsx",
    '''          <ContractDifferenceActionPanel
            key={`channel-difference-${stableRecord?.id || channelEditRecordId || ''}-${differenceRevision}`}
            billType="channel"
            billId={String(stableRecord?.id || channelEditRecordId || '')}
''',
    '''          <ContractDifferenceActionPanel
            billType="channel"
            billId={String(stableRecord?.id || channelEditRecordId || '')}
            initialItems={differenceSeedItems}
''',
)

print('channel difference instant workbench patch applied')
