import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { normalizeChannelDraft } from '../domain/drafts/billDrafts.js'
import { assessChannelSavePreflight } from '../domain/channel/channelSavePreflight.js'
const source = readFileSync(new URL('./CoreChannelBillFormPage.jsx', import.meta.url), 'utf8')
function pageFunction(name, endMarker, scope) {
  const start = source.indexOf(`  const ${name} = `) + `  const ${name} = `.length
  const text = source.slice(start, source.indexOf(endMarker, start)).trim()
  return Function(...Object.keys(scope), `return (${text})`)(...Object.values(scope))
}
// Execute the real page handlers with isolated dependencies. This is not browser QA.
function fixture() {
  const old = {id:'test', updatedAt:'2026-10-20T00:00:00Z', settlementAmount:100, remark:'old'}
  let server = {id:'test',updated_at:old.updatedAt,status:'pending',settlement_amount:100,remark:'old'}
  const scope = {
    normalizeChannelDraft, isEdit:true, channelEditRecordId:'test', reviewing:false,
    reviewInFlightRef:{current:false}, reviewGenerationRef:{current:0},
    stableRecord:old, smartRecord:null, previewAmount:100, auditReason:'',
    safety:{currentRecord:{...old,remark:'new'},dirty:true,clearAfterSubmit:vi.fn(),flushDraft:vi.fn()},
    reviewValidation:()=>'',normalizedAmount:Number,isZeroSettlement:()=>false,
    money:String,setReviewRequest:vi.fn(),setReviewing:vi.fn(),setReviewPhase:vi.fn(),setInlineIssue:vi.fn(),
    getChannelRecord:async()=>({...server}),assessChannelSavePreflight, retryLoad:vi.fn(),
    setSmartRecord:vi.fn(),invalidateEditRecord:vi.fn(),
    apiChannelRowToFrontend:r=>({...r,updatedAt:r.updated_at,settlementAmount:r.settlement_amount}),
    setRemoteRecord:r=>{scope.stableRecord=r},
    recon:{onChannelUpdateRecord:async(id,record,options)=>{
      server={...server,remark:record.remark,updated_at:'2026-10-21T00:00:00Z'}
      return options?.returnSavedRecord ? {...server} : true
    }},
    setAuditReason:vi.fn(),getRecentApiErrorMessage:()=>'',
    transitionBillLifecycle:vi.fn(async()=>{throw new Error('isolated review failure')}),
    ContractDifferenceBlockedError:class extends Error {},reportIssue:vi.fn(),showToast:vi.fn(),
    locateIssue:vi.fn(),window:{setTimeout:vi.fn()},setDifferenceSeedItems:vi.fn()
  }
  const run = async()=>{
    scope.handleChannelUpdateRecord=pageFunction('handleChannelUpdateRecord','\n  const handleAfterSubmit',scope)
    await pageFunction('confirmReview','\n  // One explicit finance approval',scope)({signature:JSON.stringify(scope.safety.currentRecord),billId:'test'})
  }
  return {scope,run,setServer:r=>{server={...server,...r}}}
}
describe('channel review persisted revision (real handlers, isolated IO)',()=>{
  it('acknowledges its own PUT revision before a failed-review retry',async()=>{
    const {scope,run}=fixture()
    await run()
    expect(scope.transitionBillLifecycle).toHaveBeenCalledTimes(1)
    expect(scope.stableRecord.updatedAt).toBe('2026-10-21T00:00:00Z')
    scope.safety.dirty=false
    await run()
    expect(scope.transitionBillLifecycle).toHaveBeenCalledTimes(2)
    expect(scope.retryLoad).not.toHaveBeenCalled()
  })
  it('still blocks a different server revision before retry',async()=>{
    const {scope,run,setServer}=fixture()
    await run()
    scope.safety.dirty=false
    setServer({updated_at:'2026-10-21T00:01:00Z'})
    await run()
    expect(scope.transitionBillLifecycle).toHaveBeenCalledTimes(1)
    expect(scope.retryLoad).toHaveBeenCalledOnce()
  })
})

function loadFixture(fail = false) {
  const issue = {kind:'stale-status', title:'服务器版本已变化'}
  let currentIssue = issue
  const scope = {
    cancelled:false, recordId:'test',setRemoteRecord:vi.fn(),setLoading:vi.fn(),setLoadError:vi.fn(),
    loadEditRecord:async()=>{if(fail) throw new Error('isolated read failure'); return {id:'test'}},
    getChannelRecord:vi.fn(),apiChannelRowToFrontend:r=>r,showToast:vi.fn(),
    setInlineIssue:update=>{currentIssue=update(currentIssue)}
  }
  const start=source.indexOf('    async function loadRecord()')
  const end=source.indexOf('\n    loadRecord()',start)
  const run=Function(...Object.keys(scope),`return (${source.slice(start,end).trim()})`)(...Object.values(scope))
  return {run,scope,issue:()=>currentIssue,original:issue}
}
describe('revision alert after authoritative reload (real loader, isolated IO)',()=>{
  it('clears the obsolete conflict only after successful reload',async()=>{
    const test=loadFixture(); await test.run()
    expect(test.scope.setRemoteRecord).toHaveBeenLastCalledWith({id:'test'})
    expect(test.issue()).toBe(null)
  })
  it('does not clear the conflict on a failed reload',async()=>{
    const test=loadFixture(true); await test.run()
    expect(test.issue()).toBe(test.original)
    expect(test.scope.setLoadError).toHaveBeenLastCalledWith('isolated read failure')
  })
})


describe('unverified save results cannot advance to confirmation',()=>{
  for (const result of [true, undefined, {id:'other',updated_at:'2026-10-21T00:00:00Z'}, {id:'test',updated_at:'bad'}]) {
    it(`fails closed for ${JSON.stringify(result)}`,async()=>{
      const {scope,run}=fixture()
      scope.recon.onChannelUpdateRecord=async()=>result
      await run()
      expect(scope.transitionBillLifecycle).not.toHaveBeenCalled()
      expect(scope.safety.clearAfterSubmit).not.toHaveBeenCalled()
      expect(scope.safety.flushDraft).toHaveBeenCalledOnce()
      expect(scope.stableRecord.updatedAt).toBe('2026-10-20T00:00:00Z')
    })
  }
  it('blocks a concurrent write between own PUT and verification GET',async()=>{
    const {scope,run,setServer}=fixture()
    const save=scope.recon.onChannelUpdateRecord
    scope.recon.onChannelUpdateRecord=async(...args)=>{
      const result=await save(...args)
      setServer({updated_at:'2026-10-21T00:01:00Z'})
      return result
    }
    await run()
    expect(scope.transitionBillLifecycle).not.toHaveBeenCalled()
    expect(scope.reportIssue).toHaveBeenLastCalledWith(expect.stringContaining('其他操作更新'),expect.anything())
  })
})

const storeSource=readFileSync(new URL('../store/useReconciliationStore.js',import.meta.url),'utf8')
function storeFixture({enabled=true, failRefresh=false}={}) {
  const saved={id:'test',updated_at:'2026-10-21T00:00:00Z'}
  const scope={channelApiEnabled:enabled,frontendChannelRecordToPayload:r=>({...r}),
    updateChannelRecord:vi.fn(async()=>saved),
    refetchChannelFromApi:vi.fn(async()=>{if(failRefresh)throw new Error('isolated list failure')}),
    showToast:vi.fn(),setChannelRecords:vi.fn(),console:{error:vi.fn()}}
  const body=storeSource.match(/const onChannelUpdateRecord = useCallback\(\s*(async \(id, record[\s\S]*?)\n    \[showToast/)[1].trim().replace(/,$/,'')
  const save=Function(...Object.keys(scope),`return (${body})`)(...Object.values(scope))
  return {scope,save,saved}
}
describe('store authoritative-save mode',()=>{
  it('returns the acknowledged PUT snapshot even if list refresh fails',async()=>{
    const {scope,save,saved}=storeFixture({failRefresh:true})
    expect(await save('test',{updatedAt:'old'},{returnSavedRecord:true})).toBe(saved)
    expect(scope.updateChannelRecord).toHaveBeenCalledWith('test',expect.objectContaining({expected_updated_at:'old'}))
    expect(scope.showToast).toHaveBeenCalledWith(expect.stringContaining('账单已保存，但列表刷新失败'),'error')
  })
  it('refuses local fallback for authoritative-save callers',async()=>{
    const {scope,save}=storeFixture({enabled:false})
    expect(await save('test',{}, {returnSavedRecord:true})).toBe(false)
    expect(scope.setChannelRecords).not.toHaveBeenCalled()
    expect(scope.updateChannelRecord).not.toHaveBeenCalled()
  })
  it('keeps the default boolean success contract for existing callers',async()=>{
    const {save}=storeFixture()
    expect(await save('test',{})).toBe(true)
  })
})


it('refuses a PUT response whose content changed before its returned snapshot',async()=>{
  const {scope,run}=fixture()
  const save=scope.recon.onChannelUpdateRecord
  scope.recon.onChannelUpdateRecord=async(...args)=>({...await save(...args),settlement_amount:101})
  await run()
  expect(scope.transitionBillLifecycle).not.toHaveBeenCalled()
  expect(scope.safety.clearAfterSubmit).not.toHaveBeenCalled()
  expect(scope.stableRecord.updatedAt).toBe('2026-10-20T00:00:00Z')
})
