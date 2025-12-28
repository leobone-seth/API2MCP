# api2mcp（FastMCP 动态工具服务器）

启动时读取当前目录的 `apis.json`，把里面定义的 HTTP 接口动态封装为 MCP Tools，供支持 MCP 的客户端（如 Trae、Cherry Studio）调用。

## 目录结构

- `server.py`：FastMCP 服务器入口（读取 `apis.json` 并注册 tools）
- `apis.json`：接口清单（你可以按需增删/修改）
- `requirements.txt`：依赖列表

## 环境准备

建议使用 Python 3.10+。

安装依赖：

```bash
pip install -r requirements.txt
```

## 快速开始

1) 编辑 `apis.json`，写入你的接口定义（示例已内置）。

2) 校验是否能正确加载并生成 tool 列表：

```bash
python server.py --validate
```

3) 启动 MCP Server（默认 HTTP，端口固定为 `8020`）：

```bash
python server.py
```

本地通过 Trae/Cherry Studio 以“子进程 STDIO”方式接入时，用：

```bash
python server.py --transport stdio
```

如果你想部署到服务器，推荐用 SSE（用户用 URL 连接，更像“远程服务”）：

```bash
python server.py --transport sse --host 0.0.0.0
```

也可以用 HTTP 方式启动（同样是远程 URL 连接）：

```bash
python server.py --transport http --host 0.0.0.0
```

默认 URL（端口固定 `8020`）：

- SSE：`http://<服务器IP>:8020/sse`
- HTTP：`http://<服务器IP>:8020/mcp`

## apis.json 格式说明

`apis.json` 支持两种顶层结构：

- 顶层是对象：`{"apis": [ ... ]}`（当前示例）
- 顶层是数组：`[ ... ]`

每个 API 支持字段（常用）：

- `name`：tool 名称（必须，且唯一）
- `description`：tool 描述（可选）
- `method`：HTTP 方法（必须，例如 GET/POST）
- `url`：完整 URL（与 `base_url + path` 二选一）
- `base_url` + `path`：拼出最终 URL（可选，用于复用域名）
- `default_headers` / `default_query` / `default_json` / `default_data`：默认请求参数（可选）
- `timeout_s`：默认超时秒数（可选）

说明字段：

- 你可以添加 `_comment` 字段写中文说明；服务端会忽略它，不影响调用。

## Tool 入参约定

每个动态生成的 tool 统一接收一个参数 `request`（可选对象）：

- `path_params`：用于替换 URL 模板中的 `{var}`（例如 `/users/{id}`）
- `query`：查询参数对象
- `headers`：请求头对象
- `json`：JSON 请求体
- `data`：表单/原始请求体
- `timeout_s`：本次请求超时（秒），优先级高于默认值

返回结构：

- 成功时返回：`{ ok, status_code, url, headers, body }`
- 失败时返回：`{ ok: false, error }`

## 在 Trae 中使用（STDIO，本地）

目标：让 Trae 以子进程方式启动本项目的 `server.py`，并自动发现 tools。

1) 打开 Trae 的 MCP 管理/设置页面，选择“手动添加/手动配置”。

2) 使用 MCP JSON 配置添加一个 STDIO server（Windows 路径示例）：

```json
{
  "mcpServers": {
    "api2mcp-remote": {
      "url": "http://127.0.0.1:8020/mcp",
      "headers": {}
    }
  }
}
```

3) 保存后重启/重新加载 MCP（不同版本入口名称略有差异）。

4) 在对话里尝试调用：

- `httpbin_get`：可传 `request.query`
- `httpbin_post_json`：可传 `request.json`

提示：

- 建议在 `args` 里显式传 `--apis` 的绝对路径，避免客户端启动时工作目录不一致导致找不到 `apis.json`。

## 在 Trae 中使用（远程 SSE/HTTP）

目标：把服务部署到服务器后，让用户在 Trae 里通过 URL 使用（不要求用户本地安装 Python）。

1) 服务器上启动：

- SSE：`python server.py --transport sse --host 0.0.0.0`
- HTTP：`python server.py --transport http --host 0.0.0.0`

2) 在 Trae 的 MCP 设置里新增“远程”类型的 MCP Server：

- SSE URL：`http://<服务器IP>:8020/sse`
- HTTP URL：`http://<服务器IP>:8020/mcp`

## 在 Cherry Studio 中使用（STDIO，本地）

目标：让 Cherry Studio 以 STDIO 类型启动本项目，并启用对应 MCP Server。

1) 打开 Cherry Studio 设置，找到 MCP/MCP Server 配置页面，新增一个 Server。

2) 选择类型为 STDIO，并填写：

- `Command`：`python`
- `Args`：填入 `server.py` 与 `--apis apis.json` 的绝对路径，例如：

```text
C:\Users\larryli\Documents\api2mcp\server.py --transport stdio --apis C:\Users\larryli\Documents\api2mcp\apis.json
```

3) 保存并启用该 MCP Server，Cherry Studio 会自动加载 tools。

## 在 Cherry Studio 中使用（远程 SSE/HTTP）

目标：把服务部署到服务器后，让用户在 Cherry Studio 里通过 URL 使用（不要求用户本地安装 Python）。

1) 服务器上启动：

- SSE：`python server.py --transport sse --host 0.0.0.0`
- HTTP：`python server.py --transport http --host 0.0.0.0`

2) Cherry Studio 新增 MCP Server：

- 类型选择 `SSE`，URL 填：`http://<服务器IP>:8020/sse`
- 或类型选择 `HTTP`，URL 填：`http://<服务器IP>:8020/mcp`

## 常见问题

### 1) 客户端显示启动失败/红灯

- 优先确认 `python` 命令在客户端环境可用（必要时把 `command` 改成 Python 解释器绝对路径）。
- 确认 `--apis` 指向的文件存在且 JSON 合法。

### 2) tool 调用没有响应或超时

- 在 `apis.json` 中为某些接口设置 `timeout_s`，或在调用时通过 `request.timeout_s` 覆盖。
- 检查目标接口是否需要鉴权/额外请求头（用 `default_headers` 或 `request.headers` 传入）。

### 3) 远程部署的安全建议

- 不要把服务直接裸奔在公网：至少限制访问 IP，或放到反向代理后加 HTTPS 与鉴权。
- `apis.json` 里定义的是“可被用户触发的出网请求”，请只暴露你允许被调用的接口。 

