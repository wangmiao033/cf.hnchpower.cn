import fs from 'node:fs'

function patchFile(target, patches, requiredMarkers, label) {
  let source = fs.readFileSync(target, 'utf8')
  let changes = 0

  for (const patch of patches) {
    const { before, after, name } = patch
    if (source.includes(after)) continue
    const first = source.indexOf(before)
    const last = source.lastIndexOf(before)
    if (first < 0) {
      throw new Error(`${label}: missing source marker: ${name}`)
    }
    if (first !== last) {
      throw new Error(`${label}: source marker is not unique: ${name}`)
    }
    source = source.replace(before, after)
    changes += 1
  }

  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) {
      throw new Error(`${label} failed verification: ${marker}`)
    }
  }

  if (changes > 0) {
    fs.writeFileSync(target, source)
    console.log(`Applied ${label} (${changes} changes).`)
  } else {
    console.log(`${label} already applied.`)
  }
}

patchFile(
  'src/components/reconciliation/ReconciliationLineItemsForm.jsx',
  [
    {
      name: 'request version ref',
      before: "  const gameSearchTimersRef = useRef({})\n",
      after: "  const gameSearchTimersRef = useRef({})\n  const gameFlowRequestVersionsRef = useRef({})\n"
    },
    {
      name: 'sync request version',
      before: "  const syncGameFlow = async (index, rawName, cycleOverride = '') => {\n    const line = lines[index]\n    if (!line) return\n    const lineId = line.id\n    const gameName = String(rawName || '').trim()\n",
      after: "  const syncGameFlow = async (index, rawName, cycleOverride = '') => {\n    const line = lines[index]\n    if (!line) return\n    const lineId = line.id\n    const requestVersion = (gameFlowRequestVersionsRef.current[lineId] || 0) + 1\n    gameFlowRequestVersionsRef.current[lineId] = requestVersion\n    const isCurrentRequest = () => gameFlowRequestVersionsRef.current[lineId] === requestVersion\n    const gameName = String(rawName || '').trim()\n"
    },
    {
      name: 'discard stale response',
      before: "      const result = await getQuickSdkGameFlow({\n        settlement_month: month,\n        game_name: gameName\n      })\n      const totalFlow = Number(result?.total_flow || 0)\n",
      after: "      const result = await getQuickSdkGameFlow({\n        settlement_month: month,\n        game_name: gameName\n      })\n      if (!isCurrentRequest()) return\n      const totalFlow = Number(result?.total_flow || 0)\n"
    },
    {
      name: 'preserve typed game name',
      before: "          rowIndex === index\n            ? {\n                ...row,\n                gameName: result.game_name || gameName,\n                revenue: flowInputValue(totalFlow),\n",
      after: "          rowIndex === index &&\n          row.id === lineId &&\n          String(row.gameName || '').trim() === gameName\n            ? {\n                ...row,\n                revenue: flowInputValue(totalFlow),\n"
    },
    {
      name: 'preset follows typed name',
      before: "      const preset = findGamePreset(result.game_name || gameName)\n",
      after: "      const preset = findGamePreset(gameName)\n"
    },
    {
      name: 'ignore stale error status',
      before: "    } catch (error) {\n      setFlowStatus(lineId, {\n",
      after: "    } catch (error) {\n      if (!isCurrentRequest()) return\n      setFlowStatus(lineId, {\n"
    },
    {
      name: 'invalidate lookup while typing',
      before: "                          onChange={(e) => {\n                            updateLine(index, 'gameName', e.target.value)\n",
      after: "                          onChange={(e) => {\n                            gameFlowRequestVersionsRef.current[line.id] =\n                              (gameFlowRequestVersionsRef.current[line.id] || 0) + 1\n                            updateLine(index, 'gameName', e.target.value)\n"
    },
    {
      name: 'protect manual revenue edits',
      before: "                        onChange={(e) => {\n                          updateLine(index, 'revenue', e.target.value)\n",
      after: "                        onChange={(e) => {\n                          gameFlowRequestVersionsRef.current[line.id] =\n                            (gameFlowRequestVersionsRef.current[line.id] || 0) + 1\n                          updateLine(index, 'revenue', e.target.value)\n"
    }
  ],
  [
    'const gameFlowRequestVersionsRef = useRef({})',
    'const isCurrentRequest = () => gameFlowRequestVersionsRef.current[lineId] === requestVersion',
    "String(row.gameName || '').trim() === gameName",
    'const preset = findGamePreset(gameName)'
  ],
  'RD game-flow race hotfix'
)

patchFile(
  'src/pages/CoreRdBillFormPage.jsx',
  [
    {
      name: 'keep contract-smart draft stable while typing',
      before: "  const handleRdFormStateChange = useCallback((record) => {\n    safety.onFormStateChange(record)\n    setContractSmartRecord((current) => (current ? null : current))\n  }, [safety.onFormStateChange])\n",
      after: "  const handleRdFormStateChange = useCallback((record) => {\n    safety.onFormStateChange(record)\n  }, [safety.onFormStateChange])\n"
    },
    {
      name: 'prefer live form state for contract helper',
      before: "  const currentRdRecord = contractSmartRecord || safety.currentRecord || safety.draftRecord || stableEditRecord || {}\n",
      after: "  const currentRdRecord = safety.currentRecord || contractSmartRecord || safety.draftRecord || stableEditRecord || {}\n"
    },
    {
      name: 'refresh contract rules without remounting editor',
      before: "          key={`${mode}-${reconEditRecordId || 'new'}-${safety.resetVersion}-${contractSourceRevision}`}\n          formId={FORM_ID}\n",
      after: "          key={`${mode}-${reconEditRecordId || 'new'}-${safety.resetVersion}`}\n          contractSourceRevision={contractSourceRevision}\n          formId={FORM_ID}\n"
    }
  ],
  [
    'const currentRdRecord = safety.currentRecord || contractSmartRecord || safety.draftRecord || stableEditRecord || {}',
    "key={`${mode}-${reconEditRecordId || 'new'}-${safety.resetVersion}`}",
    'contractSourceRevision={contractSourceRevision}'
  ],
  'RD editor state-stability hotfix'
)

patchFile(
  'src/components/reconciliation/ContractDrivenRdEntry.jsx',
  [
    {
      name: 'receive contract source revision',
      before: "    existingRecords = [],\n    settlementNumberFormat,\n    ...rest\n",
      after: "    existingRecords = [],\n    settlementNumberFormat,\n    contractSourceRevision = 0,\n    ...rest\n"
    },
    {
      name: 'include contract source revision in recommendation signature',
      before: "    const signature = JSON.stringify({\n      partner,\n      lines: requestLines.map((line) => ({\n",
      after: "    const signature = JSON.stringify({\n      partner,\n      contractSourceRevision,\n      lines: requestLines.map((line) => ({\n"
    },
    {
      name: 'rerun recommendation when contract source changes',
      before: "    return () => window.clearTimeout(timer)\n  }, [formState, mode, editRecord?.id])\n",
      after: "    return () => window.clearTimeout(timer)\n  }, [formState, mode, editRecord?.id, contractSourceRevision])\n"
    }
  ],
  [
    'contractSourceRevision = 0',
    'contractSourceRevision,',
    '[formState, mode, editRecord?.id, contractSourceRevision]'
  ],
  'RD contract-refresh hotfix'
)

patchFile(
  'src/components/reconciliation/RdContractSmartEntry.jsx',
  [
    {
      name: 'import stable identity API',
      before: "import { upsertContractAccessTerms } from '@/lib/api/contractTerms.ts'\n",
      after: "import { upsertContractAccessTerms } from '@/lib/api/contractTerms.ts'\nimport { mapGameAlias, resolveGameIdentities } from '@/lib/api/gameRegistry.ts'\n"
    },
    {
      name: 'mapping state',
      before: "  const [mapAccessId, setMapAccessId] = useState('')\n",
      after: "  const [mapAccessId, setMapAccessId] = useState('')\n  const [mapSaving, setMapSaving] = useState(false)\n  const [identityState, setIdentityState] = useState({ items: [], loading: false })\n"
    },
    {
      name: 'load persistent identities',
      before: "  const lineMatches = useMemo(() => lines.map((line) => {\n",
      after: "  const identityNames = useMemo(() => [...new Set([\n    ...lines.map((line) => text(line.gameName)),\n    ...contractGames.map(({ accessItem }) => text(accessItem.product_name))\n  ].filter(Boolean))], [contractGames, lines])\n\n  const refreshIdentities = useCallback(async () => {\n    if (!identityNames.length) {\n      setIdentityState({ items: [], loading: false })\n      return []\n    }\n    setIdentityState((current) => ({ ...current, loading: true }))\n    try {\n      const result = await resolveGameIdentities(identityNames)\n      setIdentityState({ items: result.items || [], loading: false })\n      return result.items || []\n    } catch {\n      setIdentityState((current) => ({ ...current, loading: false }))\n      return []\n    }\n  }, [identityNames.join('\\u0001')])\n\n  useEffect(() => {\n    void refreshIdentities()\n  }, [refreshIdentities])\n\n  const identityMap = useMemo(\n    () => new Map((identityState.items || []).map((item) => [text(item.input_name), item])),\n    [identityState.items]\n  )\n\n  const lineMatches = useMemo(() => lines.map((line) => {\n    const lineIdentity = identityMap.get(text(line.gameName))\n    if (lineIdentity?.game_id) {\n      const identityMatches = contractGames.filter(({ accessItem }) => (\n        identityMap.get(text(accessItem.product_name))?.game_id === lineIdentity.game_id\n      ))\n      if (identityMatches.length === 1) return { line, pair: identityMatches[0], mode: 'identity', identity: lineIdentity }\n      if (identityMatches.length > 1) return { line, pair: identityMatches[0], mode: 'identity-multiple', identity: lineIdentity }\n    }\n"
    },
    {
      name: 'identity-aware memo deps',
      before: "  }), [contractGames, lines])\n\n  const missingGames = lineMatches.filter((item) => !item.pair).map((item) => text(item.line.gameName))\n",
      after: "  }), [contractGames, lines, identityMap])\n\n  const missingGames = lineMatches.filter((item) => !item.pair).map((item) => text(item.line.gameName))\n"
    },
    {
      name: 'persist alias instead of rewriting bill',
      before: "  const applyMap = () => {\n    const pair = contractGames.find(({ accessItem }) => String(accessItem.id) === String(mapAccessId))\n    if (!pair || !mapGame) return\n    const currentItems = Array.isArray(record?.items) ? record.items : []\n    const nextItems = currentItems.map((line) => (\n      text(line?.gameName) === mapGame\n        ? { ...line, gameName: text(pair.accessItem.product_name) }\n        : line\n    ))\n    setMapOpen(false)\n    onApply?.(\n      { ...(record || {}), items: nextItems },\n      `已按研发合同标准游戏名匹配：${mapGame} → ${pair.accessItem.product_name}`,\n      'success'\n    )\n  }\n",
      after: "  const applyMap = async () => {\n    const pair = contractGames.find(({ accessItem }) => String(accessItem.id) === String(mapAccessId))\n    if (!pair || !mapGame || mapSaving) return\n    const targetName = text(pair.accessItem.product_name)\n    const targetIdentity = identityMap.get(targetName)\n    setMapSaving(true)\n    try {\n      const result = await mapGameAlias({\n        alias_name: mapGame,\n        target_name: targetName,\n        target_game_id: targetIdentity?.game_id || undefined,\n        access_item_id: String(pair.accessItem.id || '')\n      })\n      await refreshIdentities()\n      setMapOpen(false)\n      onSourceChanged?.()\n      onNotice?.(`已记住名称映射：${mapGame} → ${result.canonical_name}。当前账单名称保持不变。`, 'success')\n    } catch (error) {\n      onNotice?.(error instanceof Error ? error.message : '游戏名称映射保存失败', 'error')\n    } finally {\n      setMapSaving(false)\n    }\n  }\n"
    },
    {
      name: 'mapping action label',
      before: "<button type=\"button\" disabled={!contractGames.length} onClick={() => openMap(gameName)}>按合同名称匹配</button>",
      after: "<button type=\"button\" disabled={!contractGames.length || identityState.loading} onClick={() => openMap(gameName)}>映射到标准游戏</button>"
    },
    {
      name: 'mapping dialog copy',
      before: "<div><span>CONTRACT GAME MAP</span><h3>按研发合同标准名匹配</h3><p>只修改当前账单的游戏名称，不改后台流水。</p></div>",
      after: "<div><span>GAME IDENTITY MAP</span><h3>建立游戏名称映射</h3><p>只记录“这个名称属于哪个游戏”，不会修改当前账单里的游戏名称。</p></div>"
    },
    {
      name: 'mapping target label',
      before: "<label className=\"is-wide\"><span>研发合同合作游戏</span><select value={mapAccessId}",
      after: "<label className=\"is-wide\"><span>映射到标准游戏</span><select value={mapAccessId}"
    },
    {
      name: 'mapping footer',
      before: "<footer><span>匹配后，下方会立即重新按该合同游戏进行规则核验。</span><div><button type=\"button\" onClick={() => setMapOpen(false)}>取消</button><button type=\"button\" className=\"is-primary\" disabled={!mapAccessId} onClick={applyMap}>应用合同名称</button></div></footer>",
      after: "<footer><span>保存一次后，未来出现同名账单会自动识别；账单显示名称保持原样。</span><div><button type=\"button\" disabled={mapSaving} onClick={() => setMapOpen(false)}>取消</button><button type=\"button\" className=\"is-primary\" disabled={!mapAccessId || mapSaving} onClick={() => void applyMap()}>{mapSaving ? '正在保存…' : '保存映射'}</button></div></footer>"
    }
  ],
  [
    "import { mapGameAlias, resolveGameIdentities } from '@/lib/api/gameRegistry.ts'",
    'const [identityState, setIdentityState]',
    "mode: 'identity'",
    'await mapGameAlias({',
    '当前账单名称保持不变',
    '映射到标准游戏',
    '保存映射'
  ],
  'RD persistent game-alias mapping'
)
