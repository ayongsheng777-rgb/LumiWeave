import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { deletePricing, getPricing, getProjectUsage, getTokenSummary, getTokenToday, refreshOfficialPricing, upsertPricing } from '../api'

interface SummaryRow {
  day: string
  model: string
  provider: string
  prompt_tokens: number
  completion_tokens: number
  calls: number
  cost_yuan: string
}

interface PricingRow {
  id: number
  model: string
  provider: string
  input_per_million: string
  output_per_million: string
  source: string
  active: boolean
  note: string
}

export default function TokenPanel() {
  const [days, setDays] = useState(7)
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [today, setToday] = useState<Record<string, any>>({})
  const [usage, setUsage] = useState<Record<string, any>>({})
  const [pricing, setPricing] = useState<PricingRow[]>([])
  const [syncInfo, setSyncInfo] = useState<any>(null)
  const [message, setMessage] = useState('')
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  const load = async () => {
    const [sRes, tRes, pRes, uRes] = await Promise.all([
      getTokenSummary(days),
      getTokenToday(),
      getPricing(),
      getProjectUsage(days),
    ])
    if (sRes.ok) setSummary(sRes.data.data)
    if (tRes.ok) setToday(tRes.data)
    if (pRes.ok) {
      setPricing(pRes.data.pricing)
      setSyncInfo(pRes.data.sync)
    }
    if (uRes.ok) setUsage(uRes.data)
  }

  useEffect(() => {
    load()
  }, [days])

  useEffect(() => {
    if (!chartRef.current) return
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current)
    }
    const byDay: Record<string, number> = {}
    summary.forEach((row) => {
      const d = row.day.slice(0, 10)
      byDay[d] = (byDay[d] || 0) + Number(row.prompt_tokens || 0) + Number(row.completion_tokens || 0)
    })
    const daysArr = Object.keys(byDay).sort()
    chartInstance.current.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: daysArr },
      yAxis: { type: 'value', name: 'Token' },
      series: [
        {
          data: daysArr.map((d) => byDay[d]),
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.2 },
          itemStyle: { color: '#8b5cf6' },
        },
      ],
      grid: { left: 50, right: 20, top: 30, bottom: 30 },
    })
  }, [summary])

  const totalCost = summary.reduce((acc, row) => acc + Number(row.cost_yuan || 0), 0)
  const totalCalls = summary.reduce((acc, row) => acc + Number(row.calls || 0), 0)

  const handleRefreshOfficial = async () => {
    setMessage('')
    const res = await refreshOfficialPricing()
    if (res.ok) {
      setMessage(`已刷新 ${res.data.refreshed} 条官方价`)
      await load()
    } else {
      setMessage(res.data.error || '刷新失败')
    }
  }

  const handleAddPricing = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setMessage('')
    const fd = new FormData(e.currentTarget)
    const payload = {
      model: String(fd.get('model')),
      provider: String(fd.get('provider')),
      input_tokens_million: Number(fd.get('input_tokens_million')),
      input_price_yuan: Number(fd.get('input_price_yuan')),
      output_tokens_million: Number(fd.get('output_tokens_million')),
      output_price_yuan: Number(fd.get('output_price_yuan')),
      note: String(fd.get('note')),
    }
    const res = await upsertPricing(payload)
    if (res.ok) {
      setMessage('计费公式已保存')
      e.currentTarget.reset()
      await load()
    } else {
      setMessage(res.data.error || '保存失败')
    }
  }

  const handleDeletePricing = async (id: number) => {
    setMessage('')
    const res = await deletePricing(id)
    if (res.ok) {
      setMessage('已删除')
      await load()
    } else {
      setMessage(res.data.error || '删除失败')
    }
  }

  const sourceClass = (source: string, active: boolean) => {
    if (!active) return 'offline'
    if (source === 'official') return 'official'
    if (source === 'manual') return 'manual'
    return 'pending'
  }

  return (
    <div className="panel">
      <h2>项目用量 Project Usage</h2>
      {message && <div className="message">{message}</div>}

      <div className="stats-row">
        <div className="stat-card"><b>AI 调用</b><span>{usage.ai_calls ?? 0}</span></div>
        <div className="stat-card"><b>图片</b><span>{usage.images ?? 0}</span></div>
        <div className="stat-card"><b>视频</b><span>{usage.videos ?? 0}</span></div>
        <div className="stat-card"><b>任务</b><span>{usage.tasks ?? 0}</span></div>
        <div className="stat-card"><b>Token</b><span>{((usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)).toLocaleString()}</span></div>
        <div className="stat-card"><b>成本</b><span>¥{Number(usage.cost_yuan ?? 0).toFixed(4)}</span></div>
      </div>

      <div className="range-tabs">
        {[7, 30, 90].map((d) => (
          <button key={d} className={days === d ? 'active' : ''} onClick={() => setDays(d)}>
            近 {d} 天
          </button>
        ))}
      </div>

      <div className="usage-sub">
        近 {days} 天 Token 费用 <b>¥{totalCost.toFixed(4)}</b> · 调用 <b>{totalCalls}</b> 次 · 今日调用 {today.calls ?? 0} 次（失败 {today.fails ?? 0}）
      </div>

      <div ref={chartRef} className="chart" />

      <h3>模型费用排行</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>模型</th>
            <th>渠道</th>
            <th>调用</th>
            <th>输入</th>
            <th>输出</th>
            <th>费用</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((row, idx) => (
            <tr key={idx}>
              <td>{row.day.slice(0, 10)}</td>
              <td>{row.model}</td>
              <td>{row.provider || '-'}</td>
              <td>{row.calls}</td>
              <td>{row.prompt_tokens}</td>
              <td>{row.completion_tokens}</td>
              <td>¥{Number(row.cost_yuan || 0).toFixed(4)}</td>
            </tr>
          ))}
          {summary.length === 0 && <tr><td colSpan={7} className="empty">暂无数据</td></tr>}
        </tbody>
      </table>

      <h3>计费配置 {syncInfo && <span className="sync-hint">同步：+{syncInfo.added} 官方{syncInfo.official} 待填{syncInfo.pending}</span>}</h3>
      <div className="pricing-actions">
        <button onClick={handleRefreshOfficial}>重新获取官方订价</button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>模型</th>
            <th>渠道</th>
            <th>输入单价</th>
            <th>输出单价</th>
            <th>来源</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {pricing.map((row) => (
            <tr key={row.id} className={sourceClass(row.source, row.active)}>
              <td>{row.model}</td>
              <td>{row.provider || '*'}</td>
              <td>{Number(row.input_per_million).toFixed(4)}</td>
              <td>{Number(row.output_per_million).toFixed(4)}</td>
              <td>{row.source}{!row.active && '（已下线）'}</td>
              <td>{row.note}</td>
              <td>
                {row.source !== 'official' && (
                  <button onClick={() => handleDeletePricing(row.id)}>删除</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>新增计费公式</h4>
      <form onSubmit={handleAddPricing} className="pricing-form">
        <input name="model" placeholder="模型名" required />
        <input name="provider" placeholder="渠道" />
        <input name="input_tokens_million" type="number" placeholder="输入 Token(M)" defaultValue={100} required />
        <input name="input_price_yuan" type="number" step="0.0001" placeholder="输入价格(元)" required />
        <input name="output_tokens_million" type="number" placeholder="输出 Token(M)" defaultValue={100} required />
        <input name="output_price_yuan" type="number" step="0.0001" placeholder="输出价格(元)" required />
        <input name="note" placeholder="备注" />
        <button type="submit">保存</button>
      </form>
    </div>
  )
}
