from __future__ import annotations

"""
一个根据同目录 `apis.json` 动态生成 MCP Tools 的 FastMCP 服务器。

核心思路：
- 启动时读取 `apis.json`，其中每条 API 描述会注册为一个同名 Tool。
- Tool 的入参统一为 `request`（可选），用于提供路径参数、query、headers、body 等。
- Tool 会发起真实 HTTP 请求，并返回结构化结果（状态码/响应头/响应体等）。

运行：
- `python server.py`：默认 HTTP（`127.0.0.1:8020`）
- `python server.py --transport stdio`：STDIO（适合 Trae/Cherry Studio 本地子进程方式）
- `python server.py --transport sse`：SSE（默认 `127.0.0.1:8020`）
- `python server.py --validate`：仅校验/打印会生成的 tool 列表
"""

import argparse
import json
import os
from pathlib import Path
from typing import Any, TypedDict
from urllib.parse import urljoin

import httpx
from dotenv import load_dotenv
from fastmcp import FastMCP

import db

# 加载环境变量
load_dotenv()

class ApiSpec(TypedDict, total=False):
    # 说明字段（不会参与逻辑，只用于给 JSON 写中文说明）
    _comment: str

    name: str
    description: str
    method: str
    url: str
    base_url: str
    path: str
    default_headers: dict[str, str]
    default_query: dict[str, Any]
    default_json: Any
    default_data: Any
    timeout_s: float


class ToolRequest(TypedDict, total=False):
    # 调用 Tool 时的请求参数约定：
    # - path_params：用于替换 URL 模板中的 `{var}`（例如 `/users/{id}`）
    # - query：查询参数
    # - headers：请求头
    # - json/data：请求体（两者按 httpx 规则发送）
    # - timeout_s：单次请求超时（秒）
    path_params: dict[str, Any]
    query: dict[str, Any]
    headers: dict[str, str]
    json: Any
    data: Any
    timeout_s: float


mcp = FastMCP("api2mcp")

DEFAULT_TRANSPORT = "streamable-http"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8020


def _load_apis_json(file_path: Path) -> list[ApiSpec]:
    # 支持两种结构：
    # 1) 顶层是数组：[{...}, {...}]
    # 2) 顶层是对象：{"apis": [{...}, {...}]}
    if not file_path.exists():
        raise FileNotFoundError(f"Missing {file_path.name} in {file_path.parent}")

    raw = json.loads(file_path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        specs: list[ApiSpec] = raw
    elif isinstance(raw, dict) and isinstance(raw.get("apis"), list):
        specs = raw["apis"]
    else:
        raise ValueError("apis.json must be a list or an object with an 'apis' list")

    normalized: list[ApiSpec] = []
    for idx, spec in enumerate(specs):
        if not isinstance(spec, dict):
            raise ValueError(f"apis.json[{idx}] must be an object")
        name = spec.get("name")
        method = spec.get("method")
        url = spec.get("url")
        base_url = spec.get("base_url")
        path = spec.get("path")
        if not isinstance(name, str) or not name:
            raise ValueError(f"apis.json[{idx}].name must be a non-empty string")
        if not isinstance(method, str) or not method:
            raise ValueError(f"apis.json[{idx}].method must be a non-empty string")
        if not (isinstance(url, str) and url) and not (
            isinstance(base_url, str)
            and base_url
            and isinstance(path, str)
            and path
        ):
            raise ValueError(
                f"apis.json[{idx}] must define either 'url' or ('base_url' + 'path')"
            )
        
        # Check enabled status (default to True/1 if missing)
        enabled = spec.get("enabled")
        if enabled is not None and not enabled:
            continue
            
        normalized.append(spec)  # type: ignore[typeddict-item]

    return normalized


def _build_url(spec: ApiSpec, path_params: dict[str, Any] | None) -> str:
    # 组装最终 URL：
    # - 优先用 `url`（完整 URL）
    # - 否则用 `base_url + path`
    # - 若提供 `path_params`，会对 URL 做 Python format 替换（`{key}` -> 值）
    if isinstance(spec.get("url"), str) and spec["url"]:
        url = spec["url"]
    else:
        base_url = str(spec["base_url"])
        path = str(spec["path"])
        url = urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))

    if path_params:
        try:
            url = url.format(**path_params)
        except KeyError as e:
            raise ValueError(f"Missing path param: {e.args[0]}") from e
    return url


def _merge_dict(base: dict[str, Any] | None, override: dict[str, Any] | None) -> dict[str, Any]:
    # 合并两个字典：override 覆盖 base，用于默认参数 + 调用时参数的叠加
    merged: dict[str, Any] = {}
    if base:
        merged.update(base)
    if override:
        merged.update(override)
    return merged


async def _call_http(spec: ApiSpec, req: ToolRequest | None) -> dict[str, Any]:
    # 执行 HTTP 请求，并尽可能解析 JSON 响应；返回统一的结构化结果
    req = req or {}
    method = str(spec["method"]).upper()
    url = _build_url(spec, req.get("path_params"))

    headers = _merge_dict(spec.get("default_headers"), req.get("headers"))
    query = _merge_dict(spec.get("default_query"), req.get("query"))

    timeout_s = float(req.get("timeout_s") or spec.get("timeout_s") or 30.0)
    json_body = req.get("json", spec.get("default_json"))
    data_body = req.get("data", spec.get("default_data"))

    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout_s) as client:
        resp = await client.request(
            method=method,
            url=url,
            params=query if query else None,
            headers=headers if headers else None,
            json=json_body,
            data=data_body,
        )

    content_type = resp.headers.get("content-type", "")
    parsed_body: Any
    if "application/json" in content_type.lower():
        try:
            parsed_body = resp.json()
        except Exception:
            parsed_body = resp.text
    else:
        parsed_body = resp.text

    return {
        "ok": resp.is_success,
        "status_code": resp.status_code,
        "url": str(resp.url),
        "headers": dict(resp.headers),
        "body": parsed_body,
    }


def _register_api_tools(specs: list[ApiSpec]) -> None:
    # 将 apis.json 中的每条 API 动态注册为一个 MCP tool
    for spec in specs:
        tool_name = spec["name"]
        tool_desc = spec.get("description") or f"{spec['method'].upper()} {spec.get('url') or spec.get('path')}"

        async def _tool(request: ToolRequest | None = None, _spec: ApiSpec = spec) -> dict[str, Any]:
            # 注意：用默认参数 `_spec=spec` 固定住循环变量，避免闭包捕获导致全部指向最后一个 spec
            try:
                return await _call_http(_spec, request)
            except Exception as e:
                return {
                    "ok": False,
                    "error": str(e),
                }

        _tool.__name__ = tool_name
        mcp.tool(name=tool_name, description=tool_desc)(_tool)


def _parse_args() -> argparse.Namespace:
    # 运行时参数：兼容 STDIO / SSE / HTTP 三种 transport
    parser = argparse.ArgumentParser(prog="api2mcp")
    parser.add_argument("--apis", default="apis.json")
    parser.add_argument("--transport", default=DEFAULT_TRANSPORT)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--validate", action="store_true")
    return parser.parse_args()


def main() -> None:
    # 启动入口：加载配置 -> 注册 tools -> 启动 FastMCP
    args = _parse_args()
    
    # 依据 .env 配置决定是从 mysql 读取还是从本地 json 读取
    storage_mode = os.environ.get("STORAGE_MODE", "local").lower()
    
    if storage_mode == "mysql":
        # 获取当前指定的命名空间（通过环境变量传递）
        target_namespace = os.environ.get("MCP_NAMESPACE", "default")
        
        # 获取所有正在使用的命名空间（仅用于控制台展示，或者根据 target_namespace 过滤）
        conn = db.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT DISTINCT namespace FROM api_specs WHERE enabled = 1")
                all_namespaces = [row['namespace'] for row in cursor.fetchall()]
        finally:
            conn.close()

        if target_namespace not in all_namespaces and target_namespace != "all":
            # 如果指定的命名空间没有启用的接口，则退回 default
            specs = db.load_api_specs_from_mysql(target_namespace)
            enabled_specs = [s for s in specs if s.get('enabled')]
            if not enabled_specs:
                print(f"Warning: Namespace '{target_namespace}' has no enabled APIs.")
        
        print(f"\n{'='*50}")
        print(f"Starting MCP Server for namespace: {target_namespace}")
        
        # 加载目标命名空间的接口
        if target_namespace == "all":
            # 如果是 all，加载所有已启用的
            enabled_specs = db.load_all_enabled_api_specs()
        else:
            specs = db.load_api_specs_from_mysql(target_namespace)
            enabled_specs = [s for s in specs if s.get('enabled')]

        if enabled_specs:
            print(f"\n加载接口 (数量: {len(enabled_specs)}):")
            for s in enabled_specs:
                print(f" - {s['name']} ({s.get('namespace', 'default')})")
            
            print(f"URL 地址：{args.host}:{args.port}/mcp")
            _register_api_tools(enabled_specs)
        else:
            print("No enabled API specs found.")
            
        print(f"{'='*50}\n")
    else:
        # 默认模式：本地文件
        specs = _load_apis_json(Path(args.apis).resolve())
        _register_api_tools(specs)

    if args.validate:
        print(json.dumps({"tools": [s["name"] for s in specs]}, ensure_ascii=False, indent=2))
        return

    transport = str(args.transport).lower()
    if transport in ("http", "streamable-http"):
        mcp.run(transport="streamable-http", host=args.host, port=args.port, path="/mcp")
    elif transport == "sse":
        mcp.run(transport="sse", host=args.host, port=args.port, path="/sse")
    elif transport == "stdio":
        mcp.run(transport="stdio")
    else:
        raise ValueError(f"Unsupported transport: {transport}")


if __name__ == "__main__":
    main()
