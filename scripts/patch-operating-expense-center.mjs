import fs from 'node:fs'

function read(path) { return fs.readFileSync(path, 'utf8') }
function write(path, content) { fs.writeFileSync(path, content, 'utf8') }

function replaceRequired(source, needle, replacement, label) {
  if (!source.includes(needle)) throw new Error(`[operating-expense-center] missing patch anchor: ${label}`)
  return source.replace(needle, replacement)
}

function patchRoutes() {
  const path = 'src/app/routes.js'
  let source = read(path)
  if (source.includes("OPERATING_EXPENSES: 'operating-expenses'")) return

  source = replaceRequired(
    source,
    "  PROFIT_ANALYSIS: 'profit-analysis',\n",
    "  PROFIT_ANALYSIS: 'profit-analysis',\n  OPERATING_EXPENSES: 'operating-expenses',\n  OFFICE_RENT: 'office-rent',\n  SOFTWARE_EXPENSES: 'software-expenses',\n  PAYROLL_EXPENSES: 'payroll-expenses',\n  DEPOSITS: 'operating-deposits',\n  OTHER_EXPENSES: 'other-expenses',\n",
    'VIEWS'
  )

  source = replaceRequired(
    source,
    "      { view: VIEWS.PROFIT_ANALYSIS, label: '利润分析' },\n      { view: VIEWS.SERVER_COSTS, label: '服务器成本' }\n",
    "      { view: VIEWS.PROFIT_ANALYSIS, label: '利润分析' }\n",
    'analysis group server move'
  )

  const operatingGroup = `  {\n    id: 'operating',\n    label: '运营费用',\n    items: [\n      { view: VIEWS.OPERATING_EXPENSES, label: '费用总览' },\n      { view: VIEWS.OFFICE_RENT, label: '办公室租金' },\n      { view: VIEWS.SERVER_COSTS, label: '服务器 / 云服务' },\n      { view: VIEWS.SOFTWARE_EXPENSES, label: '软件订阅' },\n      { view: VIEWS.PAYROLL_EXPENSES, label: '人工费用' },\n      { view: VIEWS.DEPOSITS, label: '押金 / 保证金' },\n      { view: VIEWS.OTHER_EXPENSES, label: '其他费用' }\n    ]\n  },\n`
  source = replaceRequired(source, "  {\n    id: 'funds',\n", `${operatingGroup}  {\n    id: 'funds',\n`, 'operating sidebar group')

  source = replaceRequired(
    source,
    "  [VIEWS.PROFIT_ANALYSIS]: '利润分析',\n",
    "  [VIEWS.PROFIT_ANALYSIS]: '利润分析',\n  [VIEWS.OPERATING_EXPENSES]: '运营费用',\n  [VIEWS.OFFICE_RENT]: '办公室租金',\n  [VIEWS.SOFTWARE_EXPENSES]: '软件订阅',\n  [VIEWS.PAYROLL_EXPENSES]: '人工费用',\n  [VIEWS.DEPOSITS]: '押金 / 保证金',\n  [VIEWS.OTHER_EXPENSES]: '其他费用',\n",
    'page titles'
  )

  source = replaceRequired(
    source,
    "  [VIEWS.PROFIT_ANALYSIS]: '按管理口径分析经营利润、费用结构和产品可归属利润，并维护月度经营费用台账。',\n",
    "  [VIEWS.PROFIT_ANALYSIS]: '按管理口径分析经营利润、费用结构和产品可归属利润；费用维护统一进入运营费用中心。',\n  [VIEWS.OPERATING_EXPENSES]: '统一查看办公室、云服务、软件、人工及其他经营成本，并区分费用与押金资产。',\n  [VIEWS.OFFICE_RENT]: '维护办公室租金的费用月份、应付日、支付状态、发票和凭证。',\n  [VIEWS.SOFTWARE_EXPENSES]: '维护软件订阅、SaaS、邮箱、工具等持续性经营费用。',\n  [VIEWS.PAYROLL_EXPENSES]: '维护工资、劳务、社保及其他人工相关经营支出。',\n  [VIEWS.DEPOSITS]: '独立维护押金和保证金；资产性往来不进入经营利润。',\n  [VIEWS.OTHER_EXPENSES]: '维护无法归入租金、服务器、软件或人工的其他经营费用。',\n",
    'page descriptions'
  )

  source = replaceRequired(
    source,
    "  [VIEWS.PROFIT_ANALYSIS]: '利',\n",
    "  [VIEWS.PROFIT_ANALYSIS]: '利',\n  [VIEWS.OPERATING_EXPENSES]: '费',\n  [VIEWS.OFFICE_RENT]: '租',\n  [VIEWS.SOFTWARE_EXPENSES]: '软',\n  [VIEWS.PAYROLL_EXPENSES]: '人',\n  [VIEWS.DEPOSITS]: '押',\n  [VIEWS.OTHER_EXPENSES]: '其',\n",
    'view icons'
  )

  write(path, source)
}

function patchPermissions() {
  const path = 'src/app/viewPermissions.js'
  let source = read(path)
  if (source.includes('[VIEWS.OPERATING_EXPENSES]')) return
  source = replaceRequired(
    source,
    "  [VIEWS.SERVER_COSTS]: 'analytics.view',\n",
    "  [VIEWS.SERVER_COSTS]: 'analytics.view',\n  [VIEWS.OPERATING_EXPENSES]: 'analytics.view',\n  [VIEWS.OFFICE_RENT]: 'analytics.view',\n  [VIEWS.SOFTWARE_EXPENSES]: 'analytics.view',\n  [VIEWS.PAYROLL_EXPENSES]: 'analytics.view',\n  [VIEWS.DEPOSITS]: 'analytics.view',\n  [VIEWS.OTHER_EXPENSES]: 'analytics.view',\n",
    'view permissions'
  )
  write(path, source)
}

function patchApp() {
  const path = 'src/App.jsx'
  let source = read(path)
  if (source.includes('OperatingExpenseCenterPage')) return
  source = replaceRequired(
    source,
    "  profitAnalysis: () => import('./pages/ProfitAnalysisPage.jsx'),\n",
    "  profitAnalysis: () => import('./pages/ProfitAnalysisPage.jsx'),\n  operatingExpenses: () => import('./pages/OperatingExpenseCenterPage.jsx'),\n",
    'page loader'
  )
  source = replaceRequired(
    source,
    "const ProfitAnalysisPage = lazy(PAGE_LOADERS.profitAnalysis)\n",
    "const ProfitAnalysisPage = lazy(PAGE_LOADERS.profitAnalysis)\nconst OperatingExpenseCenterPage = lazy(PAGE_LOADERS.operatingExpenses)\n",
    'lazy page'
  )
  source = replaceRequired(
    source,
    "      case VIEWS.PROFIT_ANALYSIS: return <ProfitAnalysisPage />\n",
    "      case VIEWS.PROFIT_ANALYSIS: return <ProfitAnalysisPage />\n      case VIEWS.OPERATING_EXPENSES:\n      case VIEWS.OFFICE_RENT:\n      case VIEWS.SOFTWARE_EXPENSES:\n      case VIEWS.PAYROLL_EXPENSES:\n      case VIEWS.DEPOSITS:\n      case VIEWS.OTHER_EXPENSES: return <OperatingExpenseCenterPage />\n",
    'render switch'
  )
  write(path, source)
}

function patchProfitAnalysis() {
  const path = 'src/pages/ProfitAnalysisPage.jsx'
  let source = read(path)
  const oldButton = '<button type="button" onClick={openCreate}>+ 录入费用</button>'
  const newButton = '<button type="button" onClick={() => setActiveView(VIEWS.OPERATING_EXPENSES)}>去运营费用 →</button>'
  if (source.includes(newButton)) return
  source = replaceRequired(source, oldButton, newButton, 'profit expense entry')
  write(path, source)
}

patchRoutes()
patchPermissions()
patchApp()
patchProfitAnalysis()
console.log('[operating-expense-center] frontend routes patched')
