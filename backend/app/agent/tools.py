"""Agent 工具系统（V2：可调用工具）。

预设四类工具，Agent 配置里勾选即可调用：
  - web_search  联网搜索（DuckDuckGo 免费 + Tavily/Serper 可配置 key）
  - http_call   通用 HTTP 接口调用（接任意第三方 API）
  - kb_search   知识库语义检索
  - fetch_url   网页抓取/阅读

搜索提供商配置存 app_kv（key=search_config），前端可改。
"""
from __future__ import annotations

import json
import re
from typing import Any, Awaitable, Callable
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from app import db

ToolFn = Callable[[dict[str, Any]], Awaitable[str]]


class ToolSpec:
    def __init__(self, id: str, name: str, description: str, params: list[dict[str, Any]], execute: ToolFn):
        self.id = id
        self.name = name
        self.description = description
        self.params = params
        self.execute = execute


# ---------------- 搜索配置 ----------------

async def search_config() -> dict[str, Any]:
    row = await db.fetchrow("SELECT value FROM app_kv WHERE key='search_config'")
    if row:
        try:
            return json.loads(row["value"])
        except Exception:
            pass
    return {"provider": "duckduckgo", "tavily_key": "", "serper_key": ""}


async def save_search_config(cfg: dict[str, Any]) -> None:
    await db.execute(
        """INSERT INTO app_kv (key, value, updated_at) VALUES ('search_config', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()""",
        json.dumps(cfg, ensure_ascii=False),
    )


# ---------------- 各工具执行 ----------------

def _decode_ddg_url(href: str) -> str:
    if "uddg=" in href:
        qs = parse_qs(urlparse(href).query)
        if qs.get("uddg"):
            return unquote(qs["uddg"][0])
    return href


async def _search_ddg(query: str, k: int) -> str:
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(20.0, connect=10.0),
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
        follow_redirects=True,
    ) as client:
        resp = await client.post("https://html.duckduckgo.com/html/", data={"q": query})
        if resp.status_code != 200:
            return f"搜索失败 HTTP {resp.status_code}"
        html = resp.text
    titles = re.findall(r'class="result__a"[^>]*>(.*?)</a>', html, re.S)
    hrefs = re.findall(r'class="result__a" href="([^"]+)"', html)
    snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', html, re.S)

    def _clean(s: str) -> str:
        s = re.sub(r"<[^>]+>", "", s)
        s = re.sub(r"&[a-zA-Z#0-9]+;", " ", s)
        return re.sub(r"\s+", " ", s).strip()

    lines: list[str] = []
    for i in range(min(k, len(titles))):
        title = _clean(titles[i])
        url = _decode_ddg_url(hrefs[i]) if i < len(hrefs) else ""
        snip = _clean(snippets[i]) if i < len(snippets) else ""
        lines.append(f"[{i + 1}] {title}\n    {url}\n    {snip}")
    if not lines:
        return f"未搜索到「{query}」的相关结果"
    return "搜索结果：\n" + "\n".join(lines)


async def _search_tavily(query: str, k: int, key: str) -> str:
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={"api_key": key, "query": query, "max_results": k},
        )
        if resp.status_code != 200:
            return f"Tavily 搜索失败 HTTP {resp.status_code}"
        data = resp.json()
    results = data.get("results", []) or []
    if not results:
        answer = data.get("answer")
        return answer or f"未搜索到「{query}」结果"
    lines = []
    for i, r in enumerate(results[:k]):
        lines.append(f"[{i + 1}] {r.get('title', '')}\n    {r.get('url', '')}\n    {(r.get('content') or '')[:200]}")
    return "搜索结果：\n" + "\n".join(lines)


async def _search_serper(query: str, k: int, key: str) -> str:
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        resp = await client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": key, "Content-Type": "application/json"},
            json={"q": query, "num": k},
        )
        if resp.status_code != 200:
            return f"Serper 搜索失败 HTTP {resp.status_code}"
        data = resp.json()
    organic = data.get("organic", []) or []
    if not organic:
        return f"未搜索到「{query}」结果"
    lines = []
    for i, r in enumerate(organic[:k]):
        lines.append(f"[{i + 1}] {r.get('title', '')}\n    {r.get('link', '')}\n    {(r.get('snippet') or '')[:200]}")
    return "搜索结果：\n" + "\n".join(lines)


async def _web_search(args: dict[str, Any]) -> str:
    query = str(args.get("query") or "").strip()
    if not query:
        return "缺少 query 参数"
    k = max(1, min(int(args.get("k") or 5), 10))
    cfg = await search_config()
    provider = str(cfg.get("provider") or "duckduckgo")
    if provider == "tavily" and cfg.get("tavily_key"):
        return await _search_tavily(query, k, str(cfg["tavily_key"]))
    if provider == "serper" and cfg.get("serper_key"):
        return await _search_serper(query, k, str(cfg["serper_key"]))
    return await _search_ddg(query, k)


async def _http_call(args: dict[str, Any]) -> str:
    url = str(args.get("url") or "").strip()
    if not url:
        return "缺少 url 参数"
    method = str(args.get("method") or "GET").upper()
    headers: dict[str, str] = {}
    if args.get("headers"):
        try:
            headers = json.loads(str(args.get("headers"))) if isinstance(args.get("headers"), str) else dict(args.get("headers"))
        except Exception:
            headers = {}
    body = args.get("body")
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except Exception:
            pass
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
            resp = await client.request(method, url, headers=headers, json=body if method in ("POST", "PUT", "PATCH") else None, params=args.get("params") if method == "GET" else None)
        text = resp.text
        return f"HTTP {resp.status_code}\n{text[:3000]}"
    except Exception as exc:
        return f"请求失败: {exc}"


async def _kb_search(args: dict[str, Any]) -> str:
    query = str(args.get("query") or "").strip()
    if not query:
        return "缺少 query 参数"
    k = max(1, min(int(args.get("k") or 5), 10))
    try:
        from app.prompt_learning import retrieve_for
        hits = await retrieve_for(query, k)
    except Exception as exc:
        return f"知识库检索失败: {exc}"
    if not hits:
        return "知识库中没有相关内容"
    lines = []
    for i, h in enumerate(hits):
        lines.append(f"[{i + 1}] {h.get('title', '')}\n    {(h.get('content') or '')[:300]}")
    return "知识库检索结果：\n" + "\n".join(lines)


async def _fetch_url(args: dict[str, Any]) -> str:
    url = str(args.get("url") or "").strip()
    if not url:
        return "缺少 url 参数"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return f"抓取失败 HTTP {resp.status_code}"
            text = resp.text
    except Exception as exc:
        return f"抓取失败: {exc}"
    low = text.lower()
    if "<html" in low or "<body" in low or "<article" in low:
        text = re.sub(r"<script.*?</script>", "", text, flags=re.S)
        text = re.sub(r"<style.*?</style>", "", text, flags=re.S)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"&[a-zA-Z#0-9]+;", " ", text)
        text = re.sub(r"\s+", " ", text)
    return text.strip()[:5000] or "页面内容为空"


# ---------------- 工具注册表 ----------------

TOOL_SPECS: list[ToolSpec] = [
    ToolSpec(
        "web_search", "联网搜索", "搜索网络资料，返回标题+链接+摘要（支持 DuckDuckGo/Tavily/Serper）",
        [{"name": "query", "type": "string", "label": "搜索词", "required": True},
         {"name": "k", "type": "number", "label": "结果数", "required": False}],
        _web_search,
    ),
    ToolSpec(
        "http_call", "HTTP 接口调用", "调用任意第三方 API（填 URL + 方法 + 参数）",
        [{"name": "url", "type": "string", "label": "接口地址", "required": True},
         {"name": "method", "type": "string", "label": "方法 GET/POST", "required": False},
         {"name": "headers", "type": "string", "label": "请求头(JSON)", "required": False},
         {"name": "body", "type": "string", "label": "请求体", "required": False}],
        _http_call,
    ),
    ToolSpec(
        "kb_search", "知识库检索", "检索本项目已加载的知识库内容",
        [{"name": "query", "type": "string", "label": "查询", "required": True},
         {"name": "k", "type": "number", "label": "结果数", "required": False}],
        _kb_search,
    ),
    ToolSpec(
        "fetch_url", "网页抓取", "读取指定网页的正文内容",
        [{"name": "url", "type": "string", "label": "网页地址", "required": True}],
        _fetch_url,
    ),
]


def list_tools() -> list[dict[str, Any]]:
    return [
        {"id": t.id, "name": t.name, "description": t.description, "params": t.params}
        for t in TOOL_SPECS
    ]


def get_tool(tool_id: str) -> ToolSpec | None:
    return next((t for t in TOOL_SPECS if t.id == tool_id), None)


async def run_tool(tool_id: str, args: dict[str, Any]) -> str:
    t = get_tool(tool_id)
    if not t:
        return f"工具不存在: {tool_id}"
    try:
        return await t.execute(args or {})
    except Exception as exc:
        return f"工具执行失败: {exc}"
