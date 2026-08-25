from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"patch anchor not found in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"patch anchor is not unique in {path}: {text.count(old)} matches")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


page = "src/pages/CoreChannelBillFormPage.jsx"

replace_once(
    page,
    "import ChannelBillingForm from '@/components/channel/ChannelBillingForm.jsx'\nimport ChannelCumulativeSettlementCard from '@/components/channel/ChannelCumulativeSettlementCard.jsx'",
    "import ChannelBillingForm from '@/components/channel/ChannelBillingForm.jsx'\nimport ChannelCumulativeSettlementCard from '@/components/channel/ChannelCumulativeSettlementCard.jsx'\nimport ContractDifferenceActionPanel from '@/components/reconciliation/ContractDifferenceActionPanel.jsx'",
)

replace_once(
    page,
    "  const [reviewing, setReviewing] = useState(false)\n  const [smartRecord, setSmartRecord] = useState(null)",
    "  const [reviewing, setReviewing] = useState(false)\n  const [inlineIssue, setInlineIssue] = useState(null)\n  const [differenceRevision, setDifferenceRevision] = useState(0)\n  const [smartRecord, setSmartRecord] = useState(null)",
)

replace_once(
    page,
    "    setSmartRecord(null)\n    setSmartRevision(0)\n    setRuleAuthority({ status: 'idle', total: 0, matched: 0, unmatched: 0, needsConfirmation: 0 })\n  }, [mode, channelEditRecordId])",
    "    setSmartRecord(null)\n    setSmartRevision(0)\n    setInlineIssue(null)\n    setDifferenceRevision(0)\n    setRuleAuthority({ status: 'idle', total: 0, matched: 0, unmatched: 0, needsConfirmation: 0 })\n  }, [mode, channelEditRecordId])",
)

replace_once(
    page,
    "  const retryLoad = () => {\n    if (!channelEditRecordId) return\n    invalidateEditRecord('channel', String(channelEditRecordId))\n    setLoadAttempt((value) => value + 1)\n  }\n\n  const handleAfterSubmit = (intent) => {",
    """  const retryLoad = () => {
    if (!channelEditRecordId) return
    invalidateEditRecord('channel', String(channelEditRecordId))
    setLoadAttempt((value) => value + 1)
  }

  const focusProblemTarget = (element) => {
    if (!element) return false
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element.classList.remove('core-bill-problem-target')
    void element.offsetWidth
    element.classList.add('core-bill-problem-target')
    window.setTimeout(() => element.classList.remove('core-bill-problem-target'), 2600)
    const focusable = element.matches?.('input,select,textarea,button')
      ? element
      : element.querySelector?.('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')
    focusable?.focus?.({ preventScroll: true })
    return true
  }

  const openContractDifferenceWorkbench = () => {
    if (!isEdit) return
    setDifferenceRevision((value) => value + 1)
    window.setTimeout(() => {
      focusProblemTarget(document.getElementById('channel-contract-difference-workbench'))
    }, 90)
  }

  const locateIssue = (issue = inlineIssue) => {
    if (!issue) return
    if (issue.kind === 'contract') {
      openContractDifferenceWorkbench()
      return
    }

    const message = String(issue.message || '')
    const form = document.getElementById(FORM_ID)
    let target = null
    const lineMatch = message.match(/第\\s*(\\d+)\\s*行/)
    if (lineMatch) {
      const rowIndex = Math.max(1, Number(lineMatch[1]) || 1)
      target = form?.querySelector(`.channel-line-items-table tbody tr:nth-child(${rowIndex})`)
    }
    if (!target && /合作方|客户库/.test(message)) {
      target = form?.querySelector('.channel-bill-meta-grid__partner')
    }
    if (!target && /调整原因|结算调整|冲抵|补差/.test(message)) {
      target = Array.from(form?.querySelectorAll('.channel-form-section') || [])
        .find((section) => String(section.textContent || '').includes('结算调整（通用）'))
    }
    if (!target && /合同|分成|税率|通道费|匹配/.test(message)) {
      target = form?.querySelector('.channel-rule-panel')
    }
    if (!target && /结算月份|账单月份|游戏明细/.test(message)) {
      target = form?.querySelector('.channel-line-items-table tbody tr:first-child')
    }
    focusProblemTarget(target || form)
  }

  const reportIssue = (
    message,
    { kind = 'form', title = '账单暂时无法保存', saved = false, toast = true, autoLocate = true } = {}
  ) => {
    const issue = {
      kind,
      title,
      message: String(message || '发生未知错误，请检查当前账单后重试。'),
      saved
    }
    setInlineIssue(issue)
    if (toast) showToast(issue.message, 'error')
    if (autoLocate) window.setTimeout(() => locateIssue(issue), 70)
    return issue
  }

  const handleChannelUpdateRecord = async (recordId, record) => {
    try {
      const result = await recon.onChannelUpdateRecord?.(recordId, record)
      if (result === false) {
        reportIssue('服务器没有接受本次保存。请按当前页提示定位问题，修正后再次保存。', {
          kind: 'save',
          title: '账单未保存'
        })
        return false
      }
      setInlineIssue(null)
      return result
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : '账单保存失败，请根据当前页提示修正后重试。'
      reportIssue(message, { kind: 'save', title: '账单未保存' })
      throw error
    }
  }

  const handleAfterSubmit = (intent) => {""",
)

replace_once(
    page,
    "    if (validationMessage) {\n      showToast(validationMessage, 'error')\n      return\n    }",
    "    if (validationMessage) {\n      reportIssue(validationMessage, { kind: 'form', title: '还不能确认核对' })\n      return\n    }",
)

replace_once(
    page,
    "    setReviewing(true)\n    const billId = String(channelEditRecordId)\n    try {\n      const saved = await recon.onChannelUpdateRecord(billId, {",
    "    setReviewing(true)\n    setInlineIssue(null)\n    const billId = String(channelEditRecordId)\n    let savedSuccessfully = false\n    try {\n      const saved = await handleChannelUpdateRecord(billId, {",
)

replace_once(
    page,
    "      if (saved === false) return\n      safety.clearAfterSubmit()",
    "      if (saved === false) return\n      savedSuccessfully = true\n      safety.clearAfterSubmit()",
)

replace_once(
    page,
    "      showToast(\n        zeroSettlement\n          ? '零结算账单已核对并结清'\n          : deferred\n            ? '核对完成，账单已锁定并进入累计结算池'\n            : '核对完成，账单已锁定',\n        'success'\n      )\n      goList()\n    } catch (error) {\n      showToast(error instanceof Error ? error.message : '账单已保存，但确认核对失败，请稍后重试。', 'error')\n    } finally {",
    """      setInlineIssue(null)
      showToast(
        zeroSettlement
          ? '零结算账单已核对并结清'
          : deferred
            ? '核对完成，账单已锁定并进入累计结算池'
            : '核对完成，账单已锁定',
        'success'
      )
      goList()
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : savedSuccessfully
          ? '账单修改已保存，但确认核对失败，请在当前页处理后重试。'
          : '保存并确认核对失败，请在当前页处理后重试。'
      const contractRelated = /合同|差异|核验|特殊结算|匹配/.test(message)
      const issue = reportIssue(message, {
        kind: contractRelated ? 'contract' : 'review',
        title: savedSuccessfully ? '修改已保存，但核对未完成' : '保存 / 核对未完成',
        saved: savedSuccessfully,
        toast: false,
        autoLocate: false
      })
      showToast(savedSuccessfully ? `修改已保存；${message}` : message, 'error')
      if (contractRelated) openContractDifferenceWorkbench()
      else window.setTimeout(() => locateIssue(issue), 70)
    } finally {""",
)

replace_once(
    page,
    "      {!isEdit ? (\n        <ChannelSmartEntryBar",
    """      {inlineIssue ? (
        <section className={`core-bill-inline-issue ${inlineIssue.saved ? 'is-saved' : 'is-error'}`} role="alert">
          <div className="core-bill-inline-issue__body">
            <span>{inlineIssue.saved ? '修改已保存' : '需要处理'}</span>
            <strong>{inlineIssue.title}</strong>
            <p>{inlineIssue.message}</p>
            <small>
              {inlineIssue.saved
                ? '刚才的账单修改已经写入服务器，不需要重新录入。处理下面的核对问题后，再重新确认即可。'
                : '点击“定位问题”会直接跳到对应明细行、合同规则区或调整区，不需要自己逐项查找。'}
            </small>
          </div>
          <div className="core-bill-inline-issue__actions">
            <button type="button" onClick={() => locateIssue()}>定位问题</button>
            {inlineIssue.kind === 'contract' && isEdit ? (
              <button type="button" className="is-primary" onClick={openContractDifferenceWorkbench}>打开合同差异处理</button>
            ) : null}
            {isEdit && inlineIssue.saved ? (
              <button type="button" disabled={reviewing} onClick={() => void confirmReview()}>修正后重新确认</button>
            ) : null}
            <button type="button" className="is-quiet" onClick={() => setInlineIssue(null)}>关闭提示</button>
          </div>
        </section>
      ) : null}

      {!isEdit ? (
        <ChannelSmartEntryBar""",
)

replace_once(
    page,
    "          onAddRecord={recon.onChannelAddRecord}\n          onUpdateRecord={recon.onChannelUpdateRecord}",
    "          onAddRecord={recon.onChannelAddRecord}\n          onUpdateRecord={handleChannelUpdateRecord}",
)

replace_once(
    page,
    "          onFormStateChange={safety.onFormStateChange}\n          onError={(msg) => showToast(msg, 'error')}",
    "          onFormStateChange={safety.onFormStateChange}\n          onError={(msg) => reportIssue(msg, { kind: 'form', title: '账单暂时无法保存' })}",
)

replace_once(
    page,
    "      </section>\n\n      <ChannelCumulativeSettlementCard",
    """      </section>

      {isEdit ? (
        <div id="channel-contract-difference-workbench" className="core-bill-contract-difference-workbench">
          <ContractDifferenceActionPanel
            key={`channel-difference-${stableRecord?.id || channelEditRecordId || ''}-${differenceRevision}`}
            billType="channel"
            billId={String(stableRecord?.id || channelEditRecordId || '')}
            onEditBill={() => {
              const issue = {
                kind: 'form',
                title: '请直接修改当前账单',
                message: '合同差异已标记为“修改当前账单”。当前页面就是编辑页，已为你定位到账单内容。',
                saved: true
              }
              setInlineIssue(issue)
              window.setTimeout(() => focusProblemTarget(document.getElementById(FORM_ID)), 70)
            }}
            onChanged={async () => {
              setInlineIssue({
                kind: 'review',
                title: '合同差异状态已更新',
                message: '处理结果已保存。请核对当前账单内容，然后重新点击“保存并确认核对”进行复核。',
                saved: true
              })
              await recon.refetchChannelFromApi?.()
            }}
          />
        </div>
      ) : null}

      <ChannelCumulativeSettlementCard""",
)

css_path = ROOT / "src/pages/CoreBillFormPages.css"
css = css_path.read_text(encoding="utf-8")
marker = "/* Channel bill inline diagnostics */"
if marker not in css:
    css += r'''

/* Channel bill inline diagnostics */
.core-bill-inline-issue {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 13px 15px;
  border: 1px solid #fecaca;
  border-left: 4px solid #dc2626;
  border-radius: 8px;
  background: #fff7f7;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
}

.core-bill-inline-issue.is-saved {
  border-color: #fde68a;
  border-left-color: #d97706;
  background: #fffbeb;
}

.core-bill-inline-issue__body {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.core-bill-inline-issue__body > span {
  width: fit-content;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(220, 38, 38, 0.09);
  color: #b91c1c;
  font-size: 11px;
  font-weight: 700;
}

.core-bill-inline-issue.is-saved .core-bill-inline-issue__body > span {
  background: rgba(217, 119, 6, 0.11);
  color: #92400e;
}

.core-bill-inline-issue__body > strong {
  color: var(--admin-text-main);
  font-size: 14px;
}

.core-bill-inline-issue__body p,
.core-bill-inline-issue__body small {
  margin: 0;
  line-height: 1.55;
}

.core-bill-inline-issue__body p {
  color: #7f1d1d;
  font-size: 12px;
  font-weight: 600;
}

.core-bill-inline-issue.is-saved .core-bill-inline-issue__body p {
  color: #78350f;
}

.core-bill-inline-issue__body small {
  color: var(--admin-text-sub);
  font-size: 11px;
}

.core-bill-inline-issue__actions {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}

.core-bill-inline-issue__actions button {
  min-height: 31px;
  padding: 0 10px;
  border: 1px solid var(--admin-border);
  border-radius: 6px;
  background: #fff;
  color: var(--admin-text-main);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.core-bill-inline-issue__actions button.is-primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}

.core-bill-inline-issue__actions button.is-quiet {
  color: var(--admin-text-sub);
}

.core-bill-inline-issue__actions button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.core-bill-contract-difference-workbench {
  scroll-margin-top: 110px;
}

.core-bill-problem-target {
  position: relative;
  z-index: 1;
  scroll-margin-top: 120px;
  outline: 3px solid rgba(220, 38, 38, 0.24);
  outline-offset: 3px;
  animation: core-bill-problem-pulse 0.9s ease-in-out 2;
}

@keyframes core-bill-problem-pulse {
  0%, 100% { outline-color: rgba(220, 38, 38, 0.18); }
  50% { outline-color: rgba(220, 38, 38, 0.55); }
}

@media (max-width: 900px) {
  .core-bill-inline-issue {
    flex-direction: column;
  }

  .core-bill-inline-issue__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
'''
    css_path.write_text(css, encoding="utf-8")

print("channel bill inline diagnostics patched successfully")
