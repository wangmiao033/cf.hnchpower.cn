import React, { useEffect, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext.jsx'
import { getBillActorSummary } from '@/lib/api/operationLog.ts'
import { operationActorLabel } from '@/domain/reconciliation/operationLogPresentation.js'

export default function BillActorSummary({ billType, billId, revision = 0 }) {
  const { can } = useAuth()
  const allowed = can('audit.view')
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    if (!allowed || !billId) return undefined
    let cancelled = false
    setState({ loading: true })
    getBillActorSummary(billType, billId).then(data => {
      if (!cancelled) setState({ data })
    }).catch(error => {
      if (!cancelled) setState({ error: error?.message || '归属记录读取失败' })
    })
    return () => { cancelled = true }
  }, [allowed, billType, billId, revision])
  if (!allowed) return null
  return <section className="bill360-card" aria-label="账单操作人员">
    <h3>录入、核对与修改记录</h3>
    {state.loading ? <p>正在读取操作人员…</p> : state.error ? <p role="alert">{state.error}</p> : <dl>
      {[['entered', '录入人'], ['verified', '最近核对人'], ['modified', '最近修改人']].map(([key, label]) => {
        const log = state.data?.[key]
        return <div key={key}><dt>{label}</dt><dd>{log ? <>
          {operationActorLabel(log)}{log.actor_user_id ? <small> · 用户 ID：{log.actor_user_id}</small> : null}
          <br /><time>{new Date(log.created_at).toLocaleString('zh-CN', { hour12: false })}</time>
        </> : '无历史证据，未推定人员'}</dd></div>
      })}
    </dl>}
    <p>仅依据服务器原始日志。核对后退回或修改仍保留历次记录；共享账号的旧操作无法区分实际操作者。</p>
  </section>
}
