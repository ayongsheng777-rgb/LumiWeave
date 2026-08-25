import { useState } from 'react'
import QRCode from 'qrcode'
import { clearToken, resetOtp } from '../api'

export default function OtpPanel() {
  const [otp, setOtp] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ secret?: string; otpauth_uri?: string; account?: string; issuer?: string } | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')

  const doReset = async () => {
    if (otp.length !== 6) {
      setMessage('请输入 6 位原动态码')
      return
    }
    setBusy(true)
    setMessage('')
    const res = await resetOtp(otp)
    setBusy(false)
    if (res.ok) {
      setResult(res.data)
      if (res.data.otpauth_uri) {
        QRCode.toDataURL(res.data.otpauth_uri, { width: 220 }).then(setQrDataUrl)
      }
      setMessage('已生成新密钥，请用验证器扫描下方二维码完成绑定')
    } else {
      setMessage(res.data.error || '原动态码无效')
    }
  }

  const goLogin = () => {
    // 重置后旧登录态已失效，清掉本地 token 回登录页，用新码登录
    clearToken()
    window.location.reload()
  }

  return (
    <div className="panel">
      <h2>更换 OTP（动态码密钥）</h2>
      <p className="muted">更换后，旧验证器里的码会立即失效，需要用新二维码重新绑定。</p>

      {!result ? (
        <div className="render-box" style={{ marginTop: 12 }}>
          <div className="provider-form">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="输入当前 6 位动态码"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              style={{ letterSpacing: '0.3em', fontSize: 16 }}
            />
            <button onClick={doReset} disabled={busy || otp.length !== 6}>
              {busy ? '验证中…' : '验证并生成新二维码'}
            </button>
          </div>
        </div>
      ) : (
        <div className="render-box" style={{ marginTop: 12, alignItems: 'center', textAlign: 'center' }}>
          <h3>扫描下方新二维码</h3>
          <p className="muted">在验证器里重新添加账户（{result.account}）</p>
          {qrDataUrl && (
            <img src={qrDataUrl} alt="新二维码" style={{ margin: '0 auto', borderRadius: 10, background: '#fff', padding: 6 }} />
          )}
          <div className="content-preview" style={{ maxWidth: '100%', wordBreak: 'break-all', marginTop: 10 }}>
            <code>{result.secret}</code>
          </div>
          <p className="muted">（二维码扫不了时，可手动输入上面的密钥）</p>
          <div className="skill-actions" style={{ justifyContent: 'center' }}>
            <button onClick={goLogin}>已完成绑定，去登录</button>
          </div>
        </div>
      )}

      {message && <div className="message" style={{ marginTop: 12 }}>{message}</div>}
    </div>
  )
}
