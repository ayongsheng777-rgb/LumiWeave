import { useEffect, useState } from 'react'
import { executeSkill, getSkillDetail, getSkills, reloadSkills, setRiskySkills } from '../api'

interface Skill {
  id: string
  name: string
  version: string
  description: string
  runtime: string
  entry: string
  permissions: string[]
  tags: string[]
  source: string
}

interface SkillDetail {
  manifest: Skill
  content_preview: string
}

export default function SkillPanel() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [risky, setRisky] = useState<string[]>([])
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailId, setDetailId] = useState('')
  const [message, setMessage] = useState('')
  const [execResult, setExecResult] = useState('')
  const [execLoading, setExecLoading] = useState(false)

  const load = async () => {
    const res = await getSkills()
    if (res.ok) {
      setSkills(res.data.skills || [])
      setRisky(res.data.risky_enabled || [])
    }
  }

  useEffect(() => {
    load()
  }, [])

  const openDetail = async (id: string) => {
    setDetailId(id)
    const res = await getSkillDetail(id)
    if (res.ok) {
      setDetail(res.data)
    } else {
      setDetail(null)
    }
  }

  const handleReload = async () => {
    setMessage('')
    const res = await reloadSkills()
    if (res.ok) {
      setMessage(`已热加载，当前 ${res.data.count} 个技能`)
      await load()
    } else {
      setMessage('重载失败')
    }
  }

  const handleExecute = async (id: string) => {
    setExecLoading(true)
    setExecResult('')
    const res = await executeSkill({ skill_id: id, args: { message: '你好' }, context: {} })
    setExecLoading(false)
    if (res.ok) {
      setExecResult(
        res.data.ok
          ? `✅ 执行成功\n\n${typeof res.data.result === 'string' ? res.data.result : JSON.stringify(res.data.result, null, 2)}`
          : `❌ 执行被拒绝\n\n${res.data.error || '未知原因'}`,
      )
    } else {
      setExecResult(`❌ 请求失败\n\n${res.data.error || '未知'}`)
    }
  }

  const toggleRisky = async (perm: string) => {
    const next = risky.includes(perm) ? risky.filter((p) => p !== perm) : [...risky, perm]
    setRisky(next)
    const res = await setRiskySkills(next)
    if (res.ok) setRisky(res.data.enabled || [])
  }

  const allPerms = Array.from(new Set(skills.flatMap((s) => s.permissions)))

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>技能库</h2>
        <button onClick={handleReload}>重新加载</button>
      </div>
      {message && <div className="message">{message}</div>}

      <div className="skill-layout">
        <div className="skill-list">
          {skills.map((s) => (
            <div
              key={s.id}
              className={`skill-card ${detailId === s.id ? 'active' : ''}`}
              onClick={() => openDetail(s.id)}
            >
              <div className="skill-title">
                <b>{s.name}</b>
                <span className="badge">{s.runtime}</span>
              </div>
              <p className="skill-desc">{s.description || '（无描述）'}</p>
              <div className="tags">
                {s.tags.map((t) => (
                  <span key={t} className="tag">{t}</span>
                ))}
                {s.permissions.map((p) => (
                  <span key={p} className="tag warn">{p}</span>
                ))}
              </div>
            </div>
          ))}
          {skills.length === 0 && <div className="empty-box">暂无技能</div>}
        </div>

        <div className="skill-detail">
          {detail ? (
            <>
              <h3>{detail.manifest.name}</h3>
              <p className="muted">ID: {detail.manifest.id} · 版本 {detail.manifest.version} · 来源 {detail.manifest.source}</p>
              <p className="muted">入口: {detail.manifest.entry} · 运行时: {detail.manifest.runtime}</p>
              <div className="skill-actions">
                <button onClick={() => handleExecute(detail.manifest.id)} disabled={execLoading}>
                  {execLoading ? '执行中…' : '测试执行'}
                </button>
              </div>
              {execResult && <pre className="exec-result">{execResult}</pre>}
              <h4>内容预览</h4>
              <pre className="content-preview">{detail.content_preview}</pre>
            </>
          ) : (
            <div className="empty-box">点击左侧技能查看详情</div>
          )}
        </div>
      </div>

      {allPerms.length > 0 && (
        <div className="risky-box">
          <h4>高风险权限开关</h4>
          <p className="muted">勾选后，需要这些权限的技能才允许执行（默认全部关闭）。</p>
          <div className="risky-list">
            {allPerms.map((p) => (
              <label key={p} className="checkbox-row">
                <input type="checkbox" checked={risky.includes(p)} onChange={() => toggleRisky(p)} />
                {p}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
