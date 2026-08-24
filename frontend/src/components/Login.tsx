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
          QRCode.toDataURL(res.data.otpauth_uri, { width: 240 }).then(setQrDataUrl)
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
    <div className="login-page">
      <div className="login-card">
        <img src="/logo.jpg" alt="绵绣 LumiWeave" className="login-logo" />
        <h1>绵绣 LumiWeave</h1>
        <p className="subtitle">OTP 安全登录</p>

        {setupOpen === true && (
          <div className="setup-box">
            <h3>首次绑定</h3>
            <p>请使用验证器扫描下方二维码</p>
            {qrDataUrl && <img src={qrDataUrl} alt="二维码" className="qr-img" />}
            <div className="secret-box">
              <code>{setupData.secret}</code>
            </div>
            <p className="hint">绑定后输入 6 位动态码登录</p>
          </div>
        )}

        {setupOpen === false && (
          <p className="hint">请输入验证器中的 6 位动态码</p>
        )}

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          {error && <div className="error">{error}</div>}
          <button type="submit" disabled={otp.length !== 6}>
            登录
          </button>
        </form>
      </div>
    </div>
  )
}
