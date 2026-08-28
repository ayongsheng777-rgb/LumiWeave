import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { getSetup, login } from '../api'

interface LoginProps {
  onLogin: () => void
}

export default function Login({ onLogin }: LoginProps) {
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null)
  const [setupData, setSetupData] = useState<{ secret?: string; otpauth_uri?: string; qr_svg?: string }>({})
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    getSetup().then((res) => {
      if (res.status === 403) {
        setSetupOpen(false)
      } else if (res.ok) {
        setSetupOpen(true)
        setSetupData(res.data)
        if (res.data.otpauth_uri) {
          QRCode.toDataURL(res.data.otpauth_uri, { width: 220 }).then(setQrDataUrl)
        }
      } else {
        setSetupOpen(false)
      }
    })
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const res = await login(otp)
    if (res.ok) {
      onLogin()
    } else {
      setError(res.data.error || '登录失败')
    }
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden p-4">
      {/* 背景光斑（果冻氛围） */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-brand-500/20 blur-3xl dark:bg-brand-500/15" />
      <div className="pointer-events-none absolute -bottom-28 -right-24 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl dark:bg-cyan-500/10" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-300/10 blur-3xl dark:bg-violet-500/10" />

      <div className="lw-glass-strong relative w-full max-w-sm rounded-[24px] p-8 shadow-2xl">
        {/* Logo：限制尺寸，居中 */}
        <div className="flex flex-col items-center">
          <img src="/logo.jpg" alt="绵绣 LumiWeave" className="h-20 w-20 rounded-2xl object-cover shadow-lg shadow-brand-500/20" />
          <h1 className="mt-4 text-xl font-semibold text-ink">绵绣 LumiWeave</h1>
          <p className="mt-1 text-sm text-ink-3">OTP 安全登录</p>
        </div>

        {setupOpen === true && (
          <div className="jelly-inner mt-6 rounded-xl p-4 text-center">
            <h3 className="text-sm font-medium text-ink">首次绑定</h3>
            <p className="mt-1 text-xs text-ink-3">请使用验证器扫描下方二维码</p>
            {qrDataUrl && (
              <img src={qrDataUrl} alt="二维码" className="mx-auto mt-3 h-40 w-40 rounded-lg bg-white p-1" />
            )}
            <div className="mt-3 break-all rounded-lg bg-input px-3 py-2">
              <code className="text-xs text-ink-2">{setupData.secret}</code>
            </div>
            <p className="mt-2 text-xs text-ink-3">绑定后输入 6 位动态码登录</p>
          </div>
        )}

        {setupOpen === false && (
          <p className="mt-6 text-center text-sm text-ink-3">请输入验证器中的 6 位动态码</p>
        )}

        <form onSubmit={handleSubmit} className="mt-6">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            autoFocus
            className="w-full rounded-xl border border-[var(--lw-glass-edge)] bg-input px-4 py-3 text-center text-2xl font-semibold tracking-[0.5em] text-ink outline-none transition focus:border-brand-500 placeholder:text-ink-3"
          />
          {error && (
            <div className="mt-3 rounded-lg border border-status-failed/40 bg-status-failed/10 px-3 py-2 text-center text-sm text-red-400">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={otp.length !== 6}
            className="mt-4 w-full rounded-xl bg-brand-600 py-3 text-sm font-medium text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            登录
          </button>
        </form>
      </div>
    </div>
  )
}
