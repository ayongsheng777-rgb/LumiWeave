// AI 大平台预设：选平台自动填好 base_url / 模型 / 名称，用户只需填 API Key
export interface PlatformPreset {
  key: string
  name: string
  provider: string
  baseUrl: string
  model: string
  models: string[]
  scenes?: string[]
  note?: string
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    key: 'deepseek',
    name: 'DeepSeek 深度求索',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    scenes: ['prompt', 'kb', 'skills'],
    note: '性价比之王，中文强',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    scenes: ['prompt', 'kb', 'skills'],
    note: '国际主流，多模态强',
  },
  {
    key: 'gemini',
    name: 'Google Gemini',
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-1.5-pro'],
    scenes: ['prompt', 'kb', 'skills'],
    note: '走 OpenAI 兼容端点，长上下文',
  },
  {
    key: 'grok',
    name: 'xAI Grok',
    provider: 'grok',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-2-latest',
    models: ['grok-2-latest', 'grok-2-1212', 'grok-beta'],
    scenes: ['prompt', 'kb', 'skills'],
    note: '实时信息强，语气直接',
  },
  {
    key: 'bailian',
    name: '阿里云百炼（通义千问）',
    provider: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    scenes: ['prompt', 'image', 'video', 'kb', 'skills'],
    note: '国产老牌，中文稳',
  },
  {
    key: 'moonshot',
    name: 'Moonshot Kimi',
    provider: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2'],
    scenes: ['prompt', 'kb', 'skills'],
    note: '长文本摘要强',
  },
  {
    key: 'zhipu',
    name: '智谱 GLM',
    provider: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-plus',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'],
    scenes: ['prompt', 'kb', 'skills'],
    note: '国产老牌，推理好',
  },
  {
    key: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    provider: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-7B-Instruct'],
    scenes: ['prompt', 'image', 'video', 'audio', 'kb', 'skills'],
    note: '一个 key 通吃几十种开源模型',
  },
  {
    key: 'minimax',
    name: 'MiniMax',
    provider: 'minimax',
    baseUrl: 'https://api.minimax.chat/v1',
    model: 'MiniMax-Text-01',
    models: ['MiniMax-Text-01', 'abab6.5s-chat'],
    scenes: ['prompt', 'image', 'video', 'audio', 'kb', 'skills'],
    note: '中文创作、多模态',
  },
  {
    key: 'hunyuan',
    name: '腾讯混元',
    provider: 'hunyuan',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-turbo',
    models: ['hunyuan-turbo', 'hunyuan-pro'],
    scenes: ['prompt', 'image', 'video', 'kb', 'skills'],
    note: '腾讯生态',
  },
]
