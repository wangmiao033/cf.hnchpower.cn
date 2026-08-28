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
