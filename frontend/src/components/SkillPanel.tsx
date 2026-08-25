import { useEffect, useState } from 'react'
import { deleteSkill, executeSkill, getSkillDetail, getSkills, importSkillFromUrl, reloadSkills, setRiskySkills, upsertSkill } from '../api'

interface SkillParam {
  name: string
  label: string
  type: string
  default: string
  required?: boolean
}

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
  params: SkillParam[]
}

interface SkillDetail {
  manifest: Skill
  content_preview: string
}

const EMPTY_FORM = {
  id: '', name: '', version: '1.0.0', description: '', runtime: 'prompt',
  content: '', tags: '', params: [] as SkillParam[],
}

const RUNTIMES = ['prompt', 'tool', 'workflow']

export default function SkillPanel() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [risky, setRisky] = useState<string[]>([])
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailId, setDetailId] = useState('')
  const [message, setMessage] = useState('')
  const [execResult, setExecResult] = useState('')
  const [execLoading, setExecLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)

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
    // 用参数 schema 的默认值构造 args，便于实测
    const skill = skills.find((s) => s.id === id)
    const args: Record<string, string> = { message: '你好' }
    for (const p of skill?.params || []) {
      if (p.default !== undefined && p.default !== '') args[p.name] = p.default
    }
    const res = await executeSkill({ skill_id: id, args, context: {} })
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

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditing(false)
    setShowForm(true)
    setMessage('')
  }

  const openEdit = (s: Skill) => {
    setForm({
      id: s.id, name: s.name, version: s.version, description: s.description,
      runtime: s.runtime, content: '', tags: (s.tags || []).join(', '), params: s.params || [],
    })
    setEditing(true)
    setShowForm(true)
    setMessage('')
  }

  const handleImport = async () => {
    if (!importUrl.trim()) {
      setMessage('请输入技能 URL')
      return
    }
    setImporting(true)
    setMessage('')
    const res = await importSkillFromUrl(importUrl.trim())
    setImporting(false)
    if (res.ok) {
      setMessage(`导入成功：${res.data.name}${res.data.ai_used ? '（AI 自动识别配置）' : '（AI 不可用，已按原文启发式导入）'}`)
      setImportUrl('')
      await load()
    } else {
      setMessage(res.data.error || '导入失败')
    }
  }

  const save = async () => {
    setMessage('')
    if (!form.id.trim()) {
      setMessage('请填写 ID')
      return
    }
    const payload: Record<string, unknown> = {
      id: form.id.trim(),
      name: form.name.trim() || form.id.trim(),
      version: form.version.trim() || '1.0.0',
      description: form.description,
      runtime: form.runtime,
      content: form.content,
      tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      params: form.params.filter((p) => p.name.trim()),
      source: 'builtin',
    }
    const res = await upsertSkill(payload)
    if (res.ok) {
      setMessage(`已保存技能 ${form.id}`)
      setShowForm(false)
      await load()
    } else {
      setMessage(res.data.error || '保存失败')
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm(`删除技能「${id}」？`)) return
    const res = await deleteSkill(id)
    if (res.ok) {
      setMessage(`已删除 ${id}`)
      if (detailId === id) setDetail(null)
      await load()
    } else {
      setMessage(res.data.error || '删除失败')
    }
  }

  const setParam = (i: number, key: keyof SkillParam, value: string | boolean) => {
    setForm((f) => {
      const params = f.params.map((p, idx) => (idx === i ? { ...p, [key]: value } : p))
      return { ...f, params }
    })
  }

  const addParam = () => {
    setForm((f) => ({ ...f, params: [...f.params, { name: '', label: '', type: 'string', default: '', required: false }] }))
  }

  const removeParam = (i: number) => {
    setForm((f) => ({ ...f, params: f.params.filter((_, idx) => idx !== i) }))
  }

  const allPerms = Array.from(new Set(skills.flatMap((s) => s.permissions)))

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>技能库</h2>
        <div className="skill-actions">
          <button onClick={openCreate}>＋ 新增技能</button>
          <button onClick={handleReload}>重新加载</button>
        </div>
      </div>
      {message && <div className="message">{message}</div>}

      <div className="render-box" style={{ marginBottom: 14 }}>
        <div className="skill-actions" style={{ marginTop: 0 }}>
          <input
            type="text"
            placeholder="粘贴技能 URL，AI 自动识别并生成技能配置（如 SKILL.md 的网页地址）"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleImport()}
            style={{ flex: 1, minWidth: 260 }}
          />
          <button onClick={handleImport} disabled={importing}>
            {importing ? '识别中…' : '从 URL 导入'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="render-box">
          <h3>{editing ? `编辑技能 ${form.id}` : '新增技能'}</h3>
          <div className="provider-form">
            <input placeholder="ID（唯一，如 my-skill）" value={form.id} disabled={editing} onChange={(e) => setForm({ ...form, id: e.target.value })} />
            <input placeholder="名称（中文更好认）" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input placeholder="版本" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
            <select value={form.runtime} onChange={(e) => setForm({ ...form, runtime: e.target.value })}>
              {RUNTIMES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <input placeholder="标签（逗号分隔）" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            <textarea placeholder="描述（这个技能是干什么的）" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <textarea placeholder="技能内容（提示词规则，SKILL.md 正文）" rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </div>

          <div className="param-editor">
            <div className="param-editor-head">
              <b>参数配置</b>
              <span className="muted">（每个参数一行，执行时会作为入参传给技能）</span>
              <button className="ghost" onClick={addParam}>＋ 添加参数</button>
            </div>
            {form.params.length === 0 && <div className="empty-box">暂无参数，可选填</div>}
            {form.params.map((p, i) => (
              <div key={i} className="param-row">
                <input placeholder="参数名（英文，如 style）" value={p.name} onChange={(e) => setParam(i, 'name', e.target.value)} />
                <input placeholder="中文标签（如 风格）" value={p.label} onChange={(e) => setParam(i, 'label', e.target.value)} />
                <select value={p.type} onChange={(e) => setParam(i, 'type', e.target.value)}>
                  {['string', 'number', 'boolean', 'select'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input placeholder="默认值" value={p.default} onChange={(e) => setParam(i, 'default', e.target.value)} />
                <label className="checkbox-row" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={!!p.required} onChange={(e) => setParam(i, 'required', e.target.checked)} />
                  必填
                </label>
                <button className="ghost" onClick={() => removeParam(i)}>删除</button>
              </div>
            ))}
          </div>

          <div className="skill-actions" style={{ marginTop: 12 }}>
            <button onClick={save}>保存</button>
            <button className="ghost" onClick={() => setShowForm(false)}>取消</button>
          </div>
        </div>
      )}

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
                {(s.params || []).length > 0 && <span className="tag param">参数 {(s.params || []).length}</span>}
              </div>
              <div className="skill-actions" onClick={(e) => e.stopPropagation()}>
                <button className="ghost" onClick={() => openEdit(s)}>编辑</button>
                <button className="ghost" onClick={() => remove(s.id)}>删除</button>
              </div>
            </div>
          ))}
          {skills.length === 0 && <div className="empty-box">暂无技能，点右上角「新增技能」创建</div>}
        </div>

        <div className="skill-detail">
          {detail ? (
            <>
              <h3>{detail.manifest.name}</h3>
              <p className="muted">ID: {detail.manifest.id} · 版本 {detail.manifest.version} · 来源 {detail.manifest.source}</p>
              <p className="muted">入口: {detail.manifest.entry} · 运行时: {detail.manifest.runtime}</p>
              {(detail.manifest.params || []).length > 0 && (
                <div className="param-list">
                  <h4>参数</h4>
                  {(detail.manifest.params || []).map((p, i) => (
                    <div key={i} className="param-item">
                      <b>{p.label || p.name}</b>
                      <span className="muted"> {p.name} · {p.type}{p.default ? ` · 默认 ${p.default}` : ''}{p.required ? ' · 必填' : ''}</span>
                    </div>
                  ))}
                </div>
              )}
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
