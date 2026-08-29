"""出网 URL 安全校验（防 SSRF）。

凡服务端根据用户/AI 输入主动发起的 HTTP 请求，先过 is_safe_remote_url：
- 仅允许 http/https
- 拒绝回环、私网、链路本地（含云元数据 169.254.169.254）、保留地址
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


def _ip_blocked(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def is_safe_remote_url(url: str) -> tuple[bool, str]:
    """返回 (是否安全, 原因)。安全时原因为空串。"""
    url = (url or "").strip()
    try:
        u = urlparse(url)
    except Exception:
        return False, "URL 无法解析"
    if u.scheme not in ("http", "https"):
        return False, "仅支持 http/https 地址"
    host = u.hostname or ""
    if not host:
        return False, "URL 缺少主机名"
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False, f"域名无法解析：{host}"
    for info in infos:
        ip = info[4][0]
        if _ip_blocked(ip):
            return False, "目标地址指向内网/保留地址，已拦截"
    return True, ""
