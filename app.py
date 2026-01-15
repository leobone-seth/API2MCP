import os
import json
import subprocess
import threading
from typing import Optional, List, Dict, Any
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, StreamingResponse
import httpx
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

app = FastAPI(title="API2MCP Admin - Hybrid Mode")

# --- 全局配置与变量 ---
mcp_processes = {}  # {namespace: {"process": Popen, "port": int, "output": []}}
APIS_JSON_PATH = Path("apis.json").resolve()


# --- 辅助工具函数 ---

def _load_config() -> Dict[str, Any]:
    if not APIS_JSON_PATH.exists():
        return {"namespaces": [], "apis": []}
    try:
        with open(APIS_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading local JSON: {e}")
        return {"namespaces": [], "apis": []}

    if isinstance(data, list):
        return {"namespaces": [], "apis": data}
    if isinstance(data, dict):
        namespaces = data.get("namespaces") or []
        apis = data.get("apis") or []
        return {"namespaces": namespaces, "apis": apis}
    return {"namespaces": [], "apis": []}


def _save_config(config: Dict[str, Any]):
    try:
        with open(APIS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving local JSON: {e}")


def _load_local_apis() -> List[Dict]:
    """从本地 JSON 加载 API 列表"""
    cfg = _load_config()
    apis = cfg.get("apis") or []
    if isinstance(apis, list):
        return apis
    return []


def _save_local_apis(apis: List[Dict]):
    """保存 API 列表到本地 JSON（保留 namespaces 区域）"""
    cfg = _load_config()
    cfg["apis"] = apis
    _save_config(cfg)


def _load_namespaces_from_json() -> List[Dict[str, Any]]:
    """从本地 JSON 加载命名空间元数据"""
    cfg = _load_config()
    namespaces = cfg.get("namespaces") or []
    if isinstance(namespaces, list):
        return namespaces
    return []


def _save_namespaces_to_json(namespaces: List[Dict[str, Any]]):
    """保存命名空间元数据到本地 JSON（保留 apis 区域）"""
    cfg = _load_config()
    cfg["namespaces"] = namespaces
    _save_config(cfg)


def enqueue_output(out, queue, log_file_path):
    with open(log_file_path, 'a', encoding='utf-8') as f:
        for line in iter(out.readline, ''):
            stripped = line.strip()
            if stripped:
                queue.append(stripped)
            f.write(line)
    out.close()


# --- 数据模型 ---
class ApiSpec(BaseModel):
    name: str
    method: str
    url: Optional[str] = None
    base_url: Optional[str] = None
    path: Optional[str] = None
    description: Optional[str] = None
    default_query: Optional[Dict[str, Any]] = {}
    default_headers: Optional[Dict[str, str]] = {}
    default_json: Optional[Dict[str, Any]] = {}
    default_data: Optional[Dict[str, Any]] = {}
    default_response: Optional[Dict[str, Any]] = {}
    enabled: Optional[int] = 1
    timeout_s: Optional[float] = None
    namespace: Optional[str] = 'default'


class Namespace(BaseModel):
    name: str
    version: Optional[str] = "1.0.0"
    prot: Optional[int] = None


# --- 核心代理逻辑 ---
@app.api_route("/mcp_{namespace}", methods=["GET", "POST", "PUT", "DELETE"])
@app.api_route("/mcp_{namespace}/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def mcp_proxy(namespace: str, request: Request, path: str = ""):
    global mcp_processes
    if namespace not in mcp_processes:
        raise HTTPException(status_code=404, detail=f"Namespace '{namespace}' is not running")

    info = mcp_processes[namespace]
    port = info["port"]
    transport = str(info.get("transport") or "").lower() or "sse"

    accept = (request.headers.get("accept") or "").lower()
    wants_sse = (not path) and (request.method.upper() == "GET") and ("text/event-stream" in accept)

    target_path = path if path else ("sse" if (transport == "sse" and wants_sse) else "mcp")
    target_url = f"http://127.0.0.1:{port}/{target_path}"
    if request.query_params:
        target_url += f"?{request.query_params}"

    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("content-length", None)
    headers.pop("connection", None)
    headers["x-forwarded-host"] = request.headers.get("host", f"localhost:5000")
    headers["x-forwarded-proto"] = request.url.scheme
    headers["x-forwarded-prefix"] = f"/mcp_{namespace}"

    body = await request.body()

    if target_path == "sse":
        async def body_iterator():
            async with httpx.AsyncClient() as client:
                async with client.stream(request.method, target_url, headers=headers, content=body,
                                         timeout=None) as resp:
                    async for chunk in resp.aiter_bytes():
                        yield chunk

        return StreamingResponse(body_iterator(), media_type="text/event-stream")

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.request(request.method, target_url, headers=headers, content=body, timeout=60.0)
            return StreamingResponse((chunk for chunk in [resp.content]), status_code=resp.status_code,
                                     headers=dict(resp.headers))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Proxy error: {e}")


# --- API 接口管理 (混合模式) ---

@app.get("/api/namespaces")
async def get_namespaces():
    namespace_info: Dict[str, Dict[str, Any]] = {}
    namespaces = _load_namespaces_from_json()
    for ns in namespaces:
        name = (ns.get("name") or "").strip()
        if not name:
            continue
        version = (ns.get("version") or "1.0.0").strip() or "1.0.0"
        prot = ns.get("prot")
        namespace_info[name] = {"name": name, "version": version, "prot": prot}

    if "default" not in namespace_info:
        namespace_info["default"] = {"name": "default", "version": "1.0.0", "prot": None}

    local_data = _load_local_apis()
    for item in local_data:
        name = item.get("namespace", "default")
        if name not in namespace_info:
            namespace_info[name] = {"name": name, "version": "1.0.0", "prot": None}

    return list(namespace_info.values())


@app.post("/api/namespaces")
async def create_namespace(ns: Namespace):
    name = ns.name.strip()
    version = (ns.version or "1.0.0").strip() or "1.0.0"
    prot = ns.prot
    if prot is not None:
        try:
            prot = int(prot)
        except:
            prot = None
        if prot <= 0:
            prot = None
    if not name:
        raise HTTPException(status_code=400, detail="Namespace name is required")

    namespaces = _load_namespaces_from_json()
    for item in namespaces:
        existing_name = item.get("name")
        if existing_name == name:
            raise HTTPException(status_code=400, detail="Namespace already exists")
        if prot is not None and item.get("prot") == prot:
            raise HTTPException(
                status_code=400,
                detail=f"端口号 {prot} 已被命名空间 {existing_name} 使用",
            )

    namespaces.append({"name": name, "version": version, "prot": prot})
    _save_namespaces_to_json(namespaces)
    return {"ok": True}


@app.put("/api/namespaces/{name}")
async def update_namespace(name: str, ns: Namespace):
    new_name = ns.name.strip()
    version = (ns.version or "1.0.0").strip() or "1.0.0"
    prot = ns.prot
    if prot is not None:
        try:
            prot = int(prot)
        except:
            prot = None
        if prot <= 0:
            prot = None
    if not new_name:
        raise HTTPException(status_code=400, detail="Namespace name is required")
    global mcp_processes

    cfg = _load_config()
    namespaces = cfg.get("namespaces") or []
    apis = cfg.get("apis") or []

    target = None
    for item in namespaces:
        if item.get("name") == name:
            target = item
            break
    if target is None:
        raise HTTPException(status_code=404, detail="Namespace not found")

    for item in namespaces:
        existing_name = item.get("name")
        if existing_name == name:
            continue
        if prot is not None and item.get("prot") == prot:
            raise HTTPException(
                status_code=400,
                detail=f"端口号 {prot} 已被命名空间 {existing_name} 使用",
            )

    target["version"] = version
    target["prot"] = prot

    if new_name != name:
        target["name"] = new_name
        for api in apis:
            if api.get("namespace", "default") == name:
                api["namespace"] = new_name
        if name in mcp_processes:
            mcp_processes[new_name] = mcp_processes.pop(name)

    cfg["namespaces"] = namespaces
    cfg["apis"] = apis
    _save_config(cfg)
    return {"ok": True}


@app.delete("/api/namespaces/{name}")
async def delete_namespace(name: str):
    global mcp_processes
    if name in mcp_processes:
        process = mcp_processes[name]["process"]
        process.terminate()
        del mcp_processes[name]

    cfg = _load_config()
    namespaces = cfg.get("namespaces") or []
    apis = cfg.get("apis") or []

    namespaces = [ns for ns in namespaces if ns.get("name") != name]
    apis = [item for item in apis if item.get("namespace", "default") != name]

    cfg["namespaces"] = namespaces
    cfg["apis"] = apis
    _save_config(cfg)
    return {"ok": True}


@app.get("/api/apis")
async def get_apis(namespace: str = 'default'):
    apis = _load_local_apis()
    if namespace != 'all':
        apis = [a for a in apis if a.get('namespace', 'default') == namespace]

    for a in apis:
        if 'id' not in a:
            a['id'] = a.get('name')
    return apis


@app.post("/api/apis")
async def add_api(api: ApiSpec):
    new_api = api.model_dump()
    local_data = _load_local_apis()
    local_data.append(new_api)
    _save_local_apis(local_data)
    return {"ok": True}


@app.put("/api/apis/{api_id}")
async def update_api(api_id: str, api: ApiSpec):
    updated_fields = api.model_dump()
    local_data = _load_local_apis()
    found = False
    for i, a in enumerate(local_data):
        if a.get('name') == api_id:
            local_data[i].update(updated_fields)
            found = True
            break
    if found:
        _save_local_apis(local_data)
    return {"ok": True}


@app.delete("/api/apis/{api_id}")
async def delete_api(api_id: str):
    local_data = _load_local_apis()
    new_local_data = [a for a in local_data if a.get('name') != api_id]
    _save_local_apis(new_local_data)

    return {"ok": True}


# --- MCP 服务控制 ---

@app.post("/api/start")
async def start_mcp(request: Request = None, namespace: str = None):
    # 如果没指定 namespace，自动扫描所有可用的
    if namespace is None:
        all_ns = set()
        for a in _load_local_apis():
            if a.get('enabled', 1):
                all_ns.add(a.get('namespace', 'default'))
        for ns_meta in _load_namespaces_from_json():
            name = ns_meta.get("name")
            if name:
                all_ns.add(name)
        if not all_ns:
            all_ns.add("default")

        results = []
        for ns in all_ns:
            results.append(await start_single_mcp(ns))
        return {"status": "batch_started", "results": results}

    return await start_single_mcp(namespace)


async def start_single_mcp(namespace: str):
    global mcp_processes
    if namespace in mcp_processes and mcp_processes[namespace]["process"].poll() is None:
        return {"status": "already running", "namespace": namespace}

    try:
        explicit_port = None
        for ns_meta in _load_namespaces_from_json():
            if ns_meta.get("name") == namespace and ns_meta.get("prot"):
                try:
                    explicit_port = int(ns_meta["prot"])
                except Exception:
                    explicit_port = None
                break

        base_port = 8020
        used_ports = [info["port"] for info in mcp_processes.values() if info["process"].poll() is None]
        if explicit_port and explicit_port > 0:
            port = explicit_port
            while port in used_ports:
                port += 1
        else:
            port = base_port
            while port in used_ports:
                port += 1

        import sys
        env = {
            **os.environ,
            "PYTHONPATH": os.getcwd(),
            "MCP_NAMESPACE": namespace,
            "STORAGE_MODE": "local",
        }
        transport = os.environ.get("MCP_TRANSPORT", "streamable-http")
        cmd = [sys.executable, "server.py", "--port", str(port), "--transport", transport]

        process = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, encoding='utf-8', errors='replace', bufsize=1)

        log_file_path = f'log/mcp_{namespace}.log'
        os.makedirs('log', exist_ok=True)
        output = []
        mcp_processes[namespace] = {"process": process, "port": port, "output": output, "transport": transport}

        threading.Thread(target=enqueue_output, args=(process.stdout, output, log_file_path), daemon=True).start()

        return {"status": "started", "namespace": namespace, "port": port}
    except Exception as e:
        return {"status": "error", "namespace": namespace, "error": str(e)}


@app.post("/api/stop")
async def stop_mcp(namespace: str = None):
    global mcp_processes
    targets = [namespace] if namespace else list(mcp_processes.keys())
    for ns in targets:
        if ns in mcp_processes:
            p = mcp_processes[ns]["process"]
            p.terminate()
            del mcp_processes[ns]
    return {"ok": True}


# --- 其他辅助接口 ---


@app.get("/api/mcp_info")
async def get_mcp_info():
    global mcp_processes
    infos = []
    for ns, info in mcp_processes.items():
        process = info.get("process")
        if not process or process.poll() is not None:
            continue
        port = info.get("port")
        transport = str(info.get("transport") or "").lower() or "streamable-http"
        if transport == "sse":
            url = f"http://127.0.0.1:{port}/sse"
        else:
            url = f"http://127.0.0.1:{port}/mcp"

        tools = []
        try:
            for item in _load_local_apis():
                if item.get("enabled", 1) and item.get("namespace", "default") == ns:
                    name = item.get("name")
                    if name and name not in tools:
                        tools.append(name)
        except Exception:
            pass

        infos.append(
            {
                "running": True,
                "namespace": ns,
                "url": url,
                "tools": tools,
            }
        )
    return infos


@app.get("/api/status")
async def get_status():
    running_count = sum(1 for ns in mcp_processes if mcp_processes[ns]["process"].poll() is None)
    return {"running": running_count > 0, "count": running_count}


@app.get("/api/logs")
async def get_logs(namespace: str = 'default'):
    return {"logs": mcp_processes.get(namespace, {}).get("output", [])}


@app.get("/", response_class=HTMLResponse)
async def read_index():
    index_path = Path("frontend/dist/index.html")
    if index_path.exists(): return index_path.read_text(encoding="utf-8")
    return "Frontend not found. Run 'npm run build'."


if os.path.exists("frontend/dist"):
    app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

if __name__ == '__main__':
    import uvicorn
    print("API2MCP 管理界面启动在: http://localhost:5000")
    uvicorn.run(app, host='0.0.0.0', port=5000)
