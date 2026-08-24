from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from pathlib import Path
from urllib.parse import quote

import segno

from app.config import DATA_DIR, settings

_OTP_SECRET_FILE = DATA_DIR / "otp_secret"
_OTP_ENROLLED_FILE = DATA_DIR / "otp_enrolled"
_SESSION_SECRET_FILE = DATA_DIR / "session_secret"

OTP_ISSUER = settings.otp_issuer
OTP_ACCOUNT = settings.otp_account
SESSION_TTL = settings.session_ttl

VALID_TOKENS: set[str] = set()


def _read(path: Path) -> str:
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return ""


def _write(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def _b32_encode(data: bytes) -> str:
    return base64.b32encode(data).decode("ascii").rstrip("=")


def _b32_decode(secret: str) -> bytes:
    padding = (8 - len(secret) % 8) % 8
    return base64.b32decode(secret + "=" * padding)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def get_secret() -> str:
    env_secret = os.environ.get("OTP_SECRET", "").strip()
    if env_secret:
        return env_secret.upper().replace(" ", "")
    file_secret = _read(_OTP_SECRET_FILE)
    if file_secret:
        return file_secret
    new_secret = _b32_encode(secrets.token_bytes(20))
    _write(_OTP_SECRET_FILE, new_secret)
    return new_secret


def is_setup_open() -> bool:
    return not os.environ.get("OTP_SECRET") and not _OTP_ENROLLED_FILE.exists()


def mark_enrolled() -> None:
    _write(_OTP_ENROLLED_FILE, "1")


def _encode_label(text: str) -> str:
    return quote(text, safe="")


def otpauth_uri() -> str:
    secret = get_secret()
    return (
        f"otpauth://totp/{_encode_label(OTP_ISSUER)}:{_encode_label(OTP_ACCOUNT)}"
        f"?secret={secret}"
        f"&issuer={_encode_label(OTP_ISSUER)}"
        f"&algorithm=SHA1&digits=6&period=30"
    )


def qr_code_svg() -> str:
    qrcode = segno.make(otpauth_uri())
    return qrcode.svg_inline(scale=4)


def _hotp(secret: str, counter: int) -> str:
    key = _b32_decode(secret)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(code % 10**6).zfill(6)


def verify_otp(code: str, window: int = 1) -> bool:
    if len(code) != 6 or not code.isdigit():
        return False
    secret = get_secret()
    now = int(time.time())
    return any(
        _hotp(secret, (now + w * 30) // 30) == code
        for w in range(-window, window + 1)
    )


def _get_session_secret() -> bytes:
    env = os.environ.get("SESSION_SECRET", "").strip()
    if env:
        return env.encode("utf-8")
    file_secret = _read(_SESSION_SECRET_FILE)
    if file_secret:
        return file_secret.encode("utf-8")
    new_secret = secrets.token_hex(32)
    _write(_SESSION_SECRET_FILE, new_secret)
    return new_secret.encode("utf-8")


def generate_token() -> dict:
    issued = int(time.time())
    expiry = issued + SESSION_TTL
    body = _b64url(f"{issued}.{expiry}".encode("utf-8"))
    sig = hmac.new(_get_session_secret(), body.encode("utf-8"), hashlib.sha256).hexdigest()
    token = f"{body}.{sig}"
    VALID_TOKENS.add(token)
    return {"token": token, "expires": expiry, "ttl": SESSION_TTL}


def verify_token(token: str | None) -> bool:
    if not token:
        return False
    if token not in VALID_TOKENS:
        return False
    body, sep, sig = token.rpartition(".")
    if not sep:
        return False
    expected = hmac.new(_get_session_secret(), body.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return False
    try:
        payload = base64.urlsafe_b64decode(body + "=" * ((4 - len(body) % 4) % 4)).decode("utf-8")
        _, expiry = payload.split(".")
        if int(expiry) < int(time.time()):
            VALID_TOKENS.discard(token)
            return False
    except Exception:
        return False
    return True


def revoke_token(token: str | None) -> None:
    if token:
        VALID_TOKENS.discard(token)


def reset_otp() -> dict | None:
    if os.environ.get("OTP_SECRET"):
        return None
    _OTP_SECRET_FILE.unlink(missing_ok=True)
    _OTP_ENROLLED_FILE.unlink(missing_ok=True)
    VALID_TOKENS.clear()
    secret = get_secret()
    return {
        "secret": secret,
        "otpauth_uri": otpauth_uri(),
        "account": OTP_ACCOUNT,
        "issuer": OTP_ISSUER,
    }
