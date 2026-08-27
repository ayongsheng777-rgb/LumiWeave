// 通用控件变体库（V2.8 Phase5）—— 全站表单统一入口，明暗双主题由令牌驱动
// 用法：直接引用类常量（className={uiInput}）或使用组件（<UiInput />）
// 约定：控件默认带 nodrag/nowheel（画布内可交互），统一圆角/边框/字号

/** 输入框 / 下拉 / 文本域：统一边框 + 输入底 + 聚焦品牌色 */
export const uiInput =
  'nodrag nowheel w-full rounded-md border border-edge bg-input px-2 py-1.5 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:border-brand-500'

/** 紧凑版输入（节点内工具行） */
export const uiInputSm =
  'nodrag nowheel w-full rounded-md border border-edge bg-input px-1.5 py-1 text-[11px] text-ink outline-none transition placeholder:text-ink-3 focus:border-brand-500'

/** 主按钮（品牌实底） */
export const uiBtnPrimary =
  'nodrag flex h-8 items-center justify-center gap-1.5 rounded-md bg-brand-500 px-3 text-sm text-white transition hover:bg-brand-600 disabled:opacity-40'

/** 次要按钮（浅底） */
export const uiBtnGhost =
  'nodrag flex h-8 items-center justify-center gap-1.5 rounded-md bg-soft px-2.5 text-sm text-ink-2 transition hover:bg-hover hover:text-ink disabled:opacity-40'

/** 危险按钮（删除等） */
export const uiBtnDanger =
  'nodrag flex h-8 items-center justify-center gap-1.5 rounded-md bg-soft px-2.5 text-sm text-ink-2 transition hover:text-red-400 disabled:opacity-40'

/** 复选框（品牌强调色） */
export const uiCheckbox = 'nodrag h-3.5 w-3.5 accent-brand-500'

/** 标签文字 */
export const uiLabel = 'mb-1 block text-[11px] text-ink-2'

export function UiInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${uiInput} ${props.className ?? ''}`} />
}

export function UiSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${uiInput} ${props.className ?? ''}`} />
}

export function UiTextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${uiInput} ${props.className ?? ''}`} />
}

export function UiButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const { variant = 'primary', className = '', ...rest } = props
  const cls = variant === 'primary' ? uiBtnPrimary : variant === 'danger' ? uiBtnDanger : uiBtnGhost
  return <button {...rest} className={`${cls} ${className}`} />
}

export function UiCheckbox(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" {...props} className={`${uiCheckbox} ${props.className ?? ''}`} />
}
