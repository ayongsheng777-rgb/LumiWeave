# 认证与安全（Phase 6 / 03 guide）

## OTP / TOTP（`app/auth.py`）
- 纯标准库实现 RFC 6238 TOTP：HMAC-SHA1，30 秒周期，6 位数字，窗口 ±1。
- 密钥生命周期：`OTP_SECRET` 环境变量 > `data/otp_secret` 文件 > 首次自动生成（base32）。
- 首次绑定：`GET /api/auth/setup` 返回 secret + otpauth URI + 内联 SVG 二维码（segno）。

## 会话 token
- HMAC-SHA256 无状态签名 token（`issued.expiry.sig`），存于内存 `VALID_TOKENS` 集合。
- 校验：集合成员 + 签名 + 过期时间三重校验；退出即 `revoke_token` 移除。

## 重置安全门（`POST /api/auth/otp-reset`）
- 必须先提供**有效会话 token**，再提供**当前有效动态码**才允许重置；固定密钥模式（`OTP_SECRET` 环境变量）禁止在线重置。

## 中间件
`app/main.py` 的 `auth_guard`：白名单 `{/api/health}` + `/api/auth/*` 前缀放行，其余要求 `Authorization: Bearer <token>`，否则 401。

## 验收（spec #70）
```
正确 OTP → 登录成功   ✅（本会话实测 200 + token）
错误 OTP → 拒绝
重复失败 → 限速（预留）
退出 → Session 失效
```

## 安全要点
- API Key 不出浏览器（rule #4）：`/api/ai/profiles` 返回 `mask_key` 后的值。
- `app_kv` 存 AI 覆盖配置时不落敏感 key。
