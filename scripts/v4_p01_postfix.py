from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 target in {path}, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# Remove the temporary raw-string continuation marker accidentally emitted into JSX.
replace_once(
    'src/components/reconciliation/Bill360DrawerBase.jsx',
    "\n\\\n      useEffect(() => {",
    "\n  useEffect(() => {",
    'remove emitted backslash'
)

# Keep contract result cache synchronized after child mutations and make the callback stable.
replace_once(
    'src/components/reconciliation/Bill360Drawer.jsx',
    "import { loadBill360Resource, peekBill360Resource } from '@/lib/api/bill360Performance.ts'\n",
    "import { loadBill360Resource, peekBill360Resource, primeBill360Resource } from '@/lib/api/bill360Performance.ts'\n",
    'import cache prime'
)
replace_once(
    'src/components/reconciliation/Bill360Drawer.jsx',
    "  const openContractCheck = () => {\n    setCheckOpen(true)\n    if (!checkData && !checkLoading) void loadContractCheck(false)\n  }\n\n  return (",
    "  const openContractCheck = () => {\n    setCheckOpen(true)\n    if (!checkData && !checkLoading) void loadContractCheck(false)\n  }\n\n  const handleContractDataChange = useCallback((result) => {\n    setCheckData(result || null)\n    setCheckSummary(result?.summary || null)\n    if (result) primeBill360Resource(`contract-check:${billType}:${billId}`, result, 60_000)\n  }, [billId, billType])\n\n  return (",
    'stable contract data callback'
)
old_panel = """              <BillContractCheckPanelV2
                key={`${billType}-${billId}-${checkVersion}`}
                billType={billType}
                billId={billId}
                initialData={checkData}
                onDataChange={(result) => {
                  setCheckData(result)
                  setCheckSummary(result?.summary || null)
                }}
              />"""
new_panel = """              {checkData ? (
                <BillContractCheckPanelV2
                  key={`${billType}-${billId}-${checkVersion}`}
                  billType={billType}
                  billId={billId}
                  initialData={checkData}
                  onDataChange={handleContractDataChange}
                />
              ) : (
                <div className="bill360-funding-state">
                  {checkLoading ? '正在读取合同核验结果…' : checkUnavailable ? '合同核验暂不可用，请稍后重试。' : '点击合同核验后加载详细条款。'}
                </div>
              )}"""
replace_once(
    'src/components/reconciliation/Bill360Drawer.jsx',
    old_panel,
    new_panel,
    'avoid duplicate nested contract request'
)
