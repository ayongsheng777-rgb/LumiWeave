// 生成节点 —— 画布的「能力」（紧凑形态）
// 节点上只保留：连入素材条 / 提示词摘要 / 模型摘要 / 「编辑并生成」按钮。
// 提示词、模型、参数全部收进弹出式 Composer（对标 PixVerse 的 prompt 对话框），
// 点「编辑并生成」弹出 composer，改完确认才真正跑。
// 图生视频额外提供「首帧 / 尾帧」两个专用输入点（对标 PixVerse 的 firstFrame/lastFrame 连线）。
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Link2, Save, Sparkles, Wand2 } from 'lucide-react'
import { usePvStore } from '../store'
import { usePvDialogs } from '../dialogStore'
import { useNodeInputs } from '../useNodeInputs'
import type { PvNodeData } from '../types'
import { GEN_TYPE_META, nodeColor } from '../registry'
import { PvNodeShell, PvPreview } from './PvNodeShell'
import { PvMediaToolbar } from '../PvMediaToolbar'

/** @mention 芯片的配色（按素材形态分色，跟连线颜色一致） */
const MENTION_COLOR: Record<string, string> = {
  image: '#0ea5e9',
  video: '#ec4899',
  audio: '#14b8a6',
}

/** 已连入素材的缩略图芯片（@image1 指代关系一目了然） */
function RefChip({
  thumb,
  token,
  title,
  color,
  ring,
}: {
  thumb?: string
  token: string
  title: string
  color: string
  ring?: string
}) {
  return (
    <span
      className="flex items-center gap-1 rounded-md border border-edge bg-input py-0.5 pl-0.5 pr-1.5 text-[10px] text-ink-2"
      style={ring ? { borderColor: ring } : undefined}
      title={title}
    >
      {thumb ? (
        <img src={thumb} alt="" className="h-4 w-4 rounded object-cover" loading="lazy" />
      ) : (
        <span className="h-4 w-4 rounded" style={{ background: `${color}33` }} />
      )}
      <b style={{ color }}>{token}</b>
      <span className="max-w-[72px] truncate text-ink-3">{title}</span>
    </span>
  )
}

export function GenerateNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as PvNodeData
  const addReferenceNode = usePvStore((s) => s.addReferenceNode)
  const openComposer = usePvDialogs((s) => s.openComposer)
  const inputs = useNodeInputs(id)

  const params = d.params
  const genType = params?.gen_type
  const meta = genType ? GEN_TYPE_META[genType] : undefined
  const color = nodeColor(d)
  const isI2V = genType === 'image_to_video'
  const hasOutput = Boolean(d.url) && d.status === 'completed'

  // 底部摘要统计连入总数（含首尾帧）
  const totalImages = inputs.chips.filter((c) => c.ctype === 'image').length
  const totalVideos = inputs.chips.filter((c) => c.ctype === 'video').length
  const totalAudios = inputs.chips.filter((c) => c.ctype === 'audio').length
  const totalInputs = totalImages + totalVideos + totalAudios

  const onSaveAsAsset = () => {
    addReferenceNode(id)
  }

  return (
    <div className="relative h-full w-full">
      {/* 选中且有产物：媒体操作工具栏浮在卡片上方（对标 PixVerse 悬浮工具栏） */}
      {selected && hasOutput && (
        <div className="absolute -top-10 left-0 z-20">
          <PvMediaToolbar nodeId={id} />
        </div>
      )}
      <PvNodeShell
        id={id}
        data={d}
        selected={selected}
        color={color}
        icon={<Sparkles size={14} />}
        preview={d.url ? <PvPreview data={d} /> : undefined}
        // 图生视频：首帧/尾帧两个专用输入点 + 一个普通参考图点（对标 PixVerse firstFrame/lastFrame + 多参考图）
        customTargetHandles={
          isI2V ? (
            <>
              <Handle
                id="ff"
                type="target"
                position={Position.Left}
                className="!z-10 !h-3.5 !w-3.5 !border-2"
                style={{ top: '24%', borderColor: '#22c55e', background: '#22c55e' }}
                isConnectableStart={false}
              />
              <Handle
                id="lf"
                type="target"
                position={Position.Left}
                className="!z-10 !h-3.5 !w-3.5 !border-2"
                style={{ top: '78%', borderColor: '#fb7185', background: '#fb7185' }}
                isConnectableStart={false}
              />
              {/* 普通参考图输入点（id="ref" = manual 语义，连进来的图进 reference_images 列表）
                  注意：同类型多 handle 时 id 必须显式且唯一，否则 React Flow 无法注册连线 */}
              <Handle
                id="ref"
                type="target"
                position={Position.Left}
                className="!z-10 !h-3.5 !w-3.5 !border-2 !bg-white"
                style={{ top: '51%', borderColor: color, background: color }}
                isConnectableStart={false}
              />
              <span
                className="pointer-events-none absolute -left-9 z-10 rounded px-1 py-px text-[9px] text-white"
                style={{ top: '24%', transform: 'translateY(-50%)', background: '#16a34a' }}
              >
                首帧
              </span>
              <span
                className="pointer-events-none absolute -left-9 z-10 rounded px-1 py-px text-[9px] text-white"
                style={{ top: '78%', transform: 'translateY(-50%)', background: '#e11d48' }}
              >
                尾帧
              </span>
              <span
                className="pointer-events-none absolute -left-9 z-10 rounded px-1 py-px text-[9px] text-white"
                style={{ top: '51%', transform: 'translateY(-50%)', background: '#64748b' }}
              >
                参考图
              </span>
            </>
          ) : undefined
        }
        footer={
          <div className="flex items-center gap-2 text-[10px] text-ink-3">
            <span className="truncate">{d.model || '未选模型'}</span>
            {totalInputs > 0 && (
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <Link2 size={10} />
                {totalImages > 0 && `${totalImages}图`}
                {totalVideos > 0 && `${totalVideos}视频`}
                {totalAudios > 0 && `${totalAudios}音频`}
              </span>
            )}
          </div>
        }
      >
        {/* ── 已连入素材缩略图条（@ 指代关系可视化）────────────────── */}
        {inputs.chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {inputs.chips.map((c) => (
              <RefChip
                key={c.key}
                thumb={c.thumb}
                token={c.token}
                title={c.title}
                color={
                  c.conn === 'firstFrame' ? '#22c55e' : c.conn === 'lastFrame' ? '#fb7185' : MENTION_COLOR[c.ctype]
                }
                ring={c.conn === 'firstFrame' ? '#22c55e88' : c.conn === 'lastFrame' ? '#fb718588' : undefined}
              />
            ))}
          </div>
        )}

        {/* ── 提示词摘要（点击进 composer 编辑）───────────────────── */}
        <button
          className="nodrag block w-full rounded-md border border-edge bg-input px-2 py-1.5 text-left text-xs text-ink-2 transition hover:border-brand-500"
          onClick={() => openComposer(id)}
          title="点击打开提示词编辑器"
        >
          <span className="mb-0.5 flex items-center gap-1 text-[10px] text-ink-3">
            <Wand2 size={10} /> 提示词
          </span>
          {params?.prompt ? (
            <span className="line-clamp-3 break-words">{params.prompt}</span>
          ) : (
            <span className="text-ink-3">{meta?.hint || '点这里写提示词…'}</span>
          )}
        </button>

        {/* ── 编辑并生成（弹出 composer，确认后才跑）────────────── */}
        <button
          className="nodrag flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
          onClick={() => openComposer(id)}
          disabled={d.status === 'running'}
        >
          <Sparkles size={13} />
          {d.status === 'running' ? '生成中…' : hasOutput ? '修改并重新生成' : '编辑并生成'}
        </button>

        {/* ── 产物另存为引用素材（参考站 action_type=reference）─────── */}
        {hasOutput && (
          <button
            className="nodrag flex w-full items-center justify-center gap-1.5 rounded-lg border border-edge bg-soft px-3 py-1.5 text-[11px] text-ink-2 transition hover:bg-hover hover:text-ink"
            onClick={onSaveAsAsset}
            title="把这次产物变成一个独立的素材节点，可以继续连给别的生成节点"
          >
            <Save size={12} />
            另存为引用素材
          </button>
        )}
      </PvNodeShell>
    </div>
  )
}
