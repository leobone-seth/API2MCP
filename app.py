import os
import json
import subprocess
from typing import Optional, List, Dict, Any
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, StreamingResponse
import httpx
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

import db

# 加载环境变量
load_dotenv()

app = FastAPI(title="API2MCP Admin")

@app.api_route("/mcp_{namespace}", methods=["GET", "POST", "PUT", "DELETE"])
@app.api_route("/mcp_{namespace}/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def mcp_proxy(namespace: str, request: Request, path: str = ""):
    """
    代理 MCP 请求到对应的命名空间进程。
    支持 SSE 和普通 HTTP 请求。
    """
    global mcp_processes
    
    # 查找命名空间对应的端口
    if namespace not in mcp_processes:
        # 如果不在内存中，尝试从数据库恢复（这里简单处理，假设已经启动）
        raise HTTPException(status_code=404, detail=f"Namespace '{namespace}' is not running")
    
    info = mcp_processes[namespace]
    port = info["port"]
    
    transport = str(info.get("transport") or "").lower()
    if not transport:
        transport = "sse"

    accept = (request.headers.get("accept") or "").lower()
    wants_sse = (not path) and (request.method.upper() == "GET") and ("text/event-stream" in accept)

    if path:
        target_path = path
    else:
        target_path = "sse" if (transport == "sse" and wants_sse) else "mcp"
    target_url = f"http://127.0.0.1:{port}/{target_path}"
    if request.query_params:
        target_url += f"?{request.query_params}"
    
    # 准备代理请求头
    headers = dict(request.headers)
    # 移除会导致协议冲突的头信息，让 httpx 自动处理
    headers.pop("host", None)
    headers.pop("content-length", None)
    headers.pop("connection", None)
    
    # 重要：告诉后端它当前暴露出来的外部前缀
    # 如果访问的是 /mcp_default，前缀就是 /mcp_default
    headers["x-forwarded-host"] = request.headers.get("host", f"localhost:5000")
    headers["x-forwarded-proto"] = request.url.scheme
    headers["x-forwarded-prefix"] = f"/mcp_{namespace}"
    
    # 获取请求体
    body = await request.body()

    if target_path == "sse":
        async def body_iterator():
            async with httpx.AsyncClient() as client:
                async with client.stream(
                    request.method,
                    target_url,
                    headers=headers,
                    content=body,
                    timeout=None,
                ) as resp:
                    async for chunk in resp.aiter_bytes():
                        yield chunk

        return StreamingResponse(
            body_iterator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.request(
                request.method,
                target_url,
                headers=headers,
                content=body,
                timeout=60.0,
            )
        except Exception as e:
            print(f"Proxy error for {namespace}: {e}")
            raise HTTPException(status_code=502, detail=f"Error proxying to namespace service: {e}")

    resp_headers = dict(resp.headers)
    resp_headers.pop("content-length", None)
    resp_headers.pop("transfer-encoding", None)
    resp_headers.pop("connection", None)

    return StreamingResponse(
        (chunk for chunk in [resp.content]),
        status_code=resp.status_code,
        headers=resp_headers,
    )

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局变量记录 MCP 进程和输出
mcp_processes = {} # {namespace: {"process": Popen, "port": int, "output": []}}
APIS_JSON_PATH = Path("apis.json").resolve()

import threading

def enqueue_output(out, queue, log_file_path):
    with open(log_file_path, 'a', encoding='utf-8') as f:
        for line in iter(out.readline, ''):
            stripped = line.strip()
            if stripped:
                queue.append(stripped)
            f.write(line)
    out.close()

# 数据模型
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
    enabled: Optional[int] = 1
    timeout_s: Optional[float] = None
    namespace: Optional[str] = 'default'

class NamespaceSpec(BaseModel):
    name: str
    version: Optional[str] = '1.0.0'

def _get_storage_mode():
    return os.environ.get("STORAGE_MODE", "local").lower()

# --- 静态文件服务 ---
@app.get("/", response_class=HTMLResponse)
async def read_index():
    index_path = Path("frontend/dist/index.html")
    if index_path.exists():
        return index_path.read_text(encoding="utf-8")
    return "Frontend dist not found. Please run 'npm run build' in frontend directory."

# 挂载静态资源
if os.path.exists("frontend/dist"):
    app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")

# --- 命名空间 CRUD ---
@app.get("/api/namespaces")
async def get_namespaces():
    mode = _get_storage_mode()
    if mode == 'mysql':
        try:
            conn = db.get_connection()
            with conn.cursor() as cursor:
                # 只获取那些在 api_specs 中存在的命名空间
                cursor.execute("""
                    SELECT n.name, n.version 
                    FROM namespaces n
                    WHERE n.name IN (SELECT DISTINCT namespace FROM api_specs)
                    OR n.name = 'default'
                """)
                return cursor.fetchall()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        return [{"name": "default", "version": "1.0.0"}]

# --- 接口 CRUD ---
@app.get("/api/apis")
async def get_apis(namespace: str = 'default'):
    mode = _get_storage_mode()
    if mode == 'mysql':
        try:
            specs = db.load_api_specs_from_mysql(namespace)
            for s in specs:
                if 'id' not in s: s['id'] = s['name']
            return specs
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        if not APIS_JSON_PATH.exists():
            return []
        try:
            with open(APIS_JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                apis = data if isinstance(data, list) else data.get("apis", [])
                
                # Filter by namespace if not 'all'
                if namespace != 'all':
                    apis = [a for a in apis if a.get('namespace', 'default') == namespace]
                
                for a in apis: 
                    if 'id' not in a: a['id'] = a.get('name')
                return apis
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/apis")
async def add_api(api: ApiSpec):
    new_api = api.model_dump()
    mode = _get_storage_mode()
    
    if mode == 'mysql':
        try:
            ns = new_api.get('namespace', 'default')
            db.ensure_namespace(ns)
            
            conn = db.get_connection()
            with conn.cursor() as cursor:
                sql = """
                    INSERT INTO api_specs 
                    (namespace, tool_name, description, method, url, base_url, path, 
                     default_query, default_headers, default_json, default_data, enabled)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """
                cursor.execute(sql, (
                    ns, new_api['name'], new_api.get('description'), 
                    new_api['method'], new_api.get('url'), new_api.get('base_url'), 
                    new_api.get('path'), 
                    json.dumps(new_api.get('default_query', {})),
                    json.dumps(new_api.get('default_headers', {})),
                    json.dumps(new_api.get('default_json', {})),
                    json.dumps(new_api.get('default_data', {})),
                    new_api.get('enabled', 1)
                ))
            conn.commit()
            conn.close()
            # 自动升级版本号
            db.bump_version(ns)
            return {"ok": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        try:
            data = []
            if APIS_JSON_PATH.exists():
                with open(APIS_JSON_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            
            if isinstance(data, list):
                data.append(new_api)
            else:
                data.setdefault("apis", []).append(new_api)
                
            with open(APIS_JSON_PATH, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            return {"ok": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/apis/{api_id}")
async def update_api(api_id: str, api: ApiSpec):
    # exclude_unset=True 防止把未传的字段覆盖为 None (但前端传了所有字段，所以这里更多是防守)
    # 实际上，我们需要保留 apis.json 里那些 ApiSpec 模型未定义的字段（如 _comment）
    updated_fields = api.model_dump(exclude_unset=True)
    mode = _get_storage_mode()
    
    if mode == 'mysql':
        try:
            ns = updated_fields.get('namespace', 'default')
            db.ensure_namespace(ns)
            
            conn = db.get_connection()
            with conn.cursor() as cursor:
                # 判断 api_id 是否为纯数字，以决定是否在 WHERE 子句中使用 id 字段
                is_numeric_id = str(api_id).isdigit()
                
                if is_numeric_id:
                    sql = """
                        UPDATE api_specs SET 
                        tool_name=%s, description=%s, method=%s, url=%s, base_url=%s, 
                        path=%s, default_query=%s, default_headers=%s, default_json=%s, 
                        default_data=%s, enabled=%s, namespace=%s
                        WHERE id=%s OR tool_name=%s
                    """
                    params = (
                        updated_fields['name'], updated_fields.get('description'), 
                        updated_fields['method'], updated_fields.get('url'), updated_fields.get('base_url'), 
                        updated_fields.get('path'), 
                        json.dumps(updated_fields.get('default_query', {})),
                        json.dumps(updated_fields.get('default_headers', {})),
                        json.dumps(updated_fields.get('default_json', {})),
                        json.dumps(updated_fields.get('default_data', {})),
                        updated_fields.get('enabled', 1),
                        ns,
                        api_id, api_id
                    )
                else:
                    sql = """
                        UPDATE api_specs SET 
                        tool_name=%s, description=%s, method=%s, url=%s, base_url=%s, 
                        path=%s, default_query=%s, default_headers=%s, default_json=%s, 
                        default_data=%s, enabled=%s, namespace=%s
                        WHERE tool_name=%s
                    """
                    params = (
                        updated_fields['name'], updated_fields.get('description'), 
                        updated_fields['method'], updated_fields.get('url'), updated_fields.get('base_url'), 
                        updated_fields.get('path'), 
                        json.dumps(updated_fields.get('default_query', {})),
                        json.dumps(updated_fields.get('default_headers', {})),
                        json.dumps(updated_fields.get('default_json', {})),
                        json.dumps(updated_fields.get('default_data', {})),
                        updated_fields.get('enabled', 1),
                        ns,
                        api_id
                    )
                
                cursor.execute(sql, params)
            conn.commit()
            conn.close()
            # 自动升级版本号
            db.bump_version(ns)
            return {"ok": True}
        except Exception as e:
            print(f"Error updating API in MySQL: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    else:
        try:
            with open(APIS_JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            target_list = None
            if isinstance(data, list):
                target_list = data
            else:
                target_list = data.get("apis", [])

            found = False
            for i, a in enumerate(target_list):
                if a.get('name') == api_id:
                    # 使用 update 而不是替换，保留 _comment 等额外字段
                    # 注意：如果修改了 name，这里 updated_fields['name'] 会是新名字
                    target_list[i].update(updated_fields)
                    found = True
                    break
            
            if not found:
                raise HTTPException(status_code=404, detail=f"API '{api_id}' not found")

            if isinstance(data, dict):
                data["apis"] = target_list
                
            with open(APIS_JSON_PATH, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            return {"ok": True}
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@app.delete("/api/apis/{api_id}")
async def delete_api(api_id: str):
    mode = _get_storage_mode()
    if mode == 'mysql':
        try:
            conn = db.get_connection()
            with conn.cursor() as cursor:
                # 判断 api_id 是否为纯数字，以决定是否在 WHERE 子句中使用 id 字段
                is_numeric_id = str(api_id).isdigit()
                
                # 首先获取要删除的接口所属的命名空间，以便后续升级版本
                cursor.execute("SELECT namespace FROM api_specs WHERE id = %s OR tool_name = %s", (api_id, api_id))
                row = cursor.fetchone()
                namespace = row['namespace'] if row else 'default'

                if is_numeric_id:
                    sql = "DELETE FROM api_specs WHERE id = %s OR tool_name = %s"
                    params = (api_id, api_id)
                else:
                    sql = "DELETE FROM api_specs WHERE tool_name = %s"
                    params = (api_id,)
                
                cursor.execute(sql, params)
            conn.commit()
            conn.close()
            # 自动升级版本号
            db.bump_version(namespace)
            return {"ok": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        try:
            with open(APIS_JSON_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                new_data = [a for a in data if a.get('name') != api_id]
            else:
                data["apis"] = [a for a in data.get("apis", []) if a.get('name') != api_id]
                new_data = data
            with open(APIS_JSON_PATH, 'w', encoding='utf-8') as f:
                json.dump(new_data, f, indent=2, ensure_ascii=False)
            return {"ok": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

# --- MCP 服务控制 ---
@app.get("/api/status")
async def get_status():
    global mcp_processes
    # 只要有一个在运行就算运行中
    running_count = sum(1 for ns in mcp_processes if mcp_processes[ns]["process"].poll() is None)
    return {
        "running": running_count > 0,
        "count": running_count
    }

@app.post("/api/start")
async def start_mcp(request: Request = None, namespace: str = None):
    # 如果 namespace 在 query 中没有，尝试从 JSON body 获取
    if namespace is None and request is not None:
        try:
            body = await request.json()
            namespace = body.get('namespace')
        except:
            # 如果没有 body 或是 query 传参，FastAPI 会把 query 的 namespace 给到参数
            # 这里的 namespace = None 是正常的，表示“启动全部”
            pass
            
    global mcp_processes
    
    # 如果 namespace 为 None，启动所有已存在的命名空间
    if namespace is None:
        mode = _get_storage_mode()
        namespaces_to_start = []
        
        if mode == 'mysql':
            try:
                conn = db.get_connection()
                with conn.cursor() as cursor:
                    # 获取所有有接口定义的命名空间
                    cursor.execute("SELECT DISTINCT namespace FROM api_specs WHERE enabled = 1")
                    namespaces_to_start = [row['namespace'] for row in cursor.fetchall()]
                conn.close()
            except Exception as e:
                print(f"Error fetching namespaces from mysql: {e}")
                namespaces_to_start = ['default']
            
            # 如果没有特别定义的命名空间，确保至少有 default
            if not namespaces_to_start:
                namespaces_to_start = ['default']
        else:
            # 文件模式下，尝试从 apis.json 获取所有命名空间
            try:
                if APIS_JSON_PATH.exists():
                    with open(APIS_JSON_PATH, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        apis = data if isinstance(data, list) else data.get("apis", [])
                        namespaces_to_start = list(set([a.get('namespace', 'default') for a in apis if a.get('enabled', 1)]))
            except:
                pass
                
            if not namespaces_to_start:
                namespaces_to_start = ['default']
            
        results = []
        for ns in namespaces_to_start:
            try:
                res = await start_single_mcp(ns)
                results.append(res)
            except Exception as e:
                results.append({"namespace": ns, "status": "error", "error": str(e)})
        return {"status": "batch_started", "results": results}

    return await start_single_mcp(namespace)

async def start_single_mcp(namespace: str):
    global mcp_processes
    if namespace in mcp_processes and mcp_processes[namespace]["process"].poll() is None:
        return {"status": "already running", "namespace": namespace}
    
    try:
        # 分配端口：默认 8020。其他按顺序分配
        base_port = 8020
        used_ports = [info["port"] for info in mcp_processes.values() if info["process"].poll() is None]
        
        port = base_port
        if namespace != 'default':
            port = base_port + 1
            while port in used_ports:
                port += 1
        
        # 启动 server.py
        import sys
        env = {**os.environ, "PYTHONPATH": os.getcwd(), "MCP_NAMESPACE": namespace}
        
        transport = os.environ.get("MCP_TRANSPORT", "streamable-http")
        cmd = [sys.executable, "server.py", "--port", str(port), "--transport", transport]
        
        process = subprocess.Popen(
            cmd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1
        )
        
        log_dir = 'log'
        os.makedirs(log_dir, exist_ok=True)
        log_file_path = os.path.join(log_dir, f'mcp_{namespace}.log')
        output = []
        mcp_processes[namespace] = {
            "process": process,
            "port": port,
            "output": output,
            "transport": transport,
        }
        
        # 启动线程读取输出
        t = threading.Thread(target=enqueue_output, args=(process.stdout, output, log_file_path))
        t.daemon = True
        t.start()
        
        # 更新数据库状态
        if _get_storage_mode() == 'mysql':
            db.update_server_status(namespace, 'running')
        
        return {"status": "started", "namespace": namespace, "port": port}
    except Exception as e:
        print(f"Error starting namespace {namespace}: {e}")
        return {"status": "error", "namespace": namespace, "error": str(e)}

@app.get("/api/logs")
async def get_logs(namespace: str = 'default'):
    global mcp_processes
    if namespace in mcp_processes:
        return {"logs": mcp_processes[namespace]["output"]}
    return {"logs": []}

@app.get("/api/mcp_info")
async def get_mcp_info(request: Request):
    global mcp_processes
    results = []
    
    mode = _get_storage_mode()
    
    for ns, info in list(mcp_processes.items()):
        if info["process"].poll() is not None:
            continue
            
        # 获取该命名空间的工具清单
        tools = []
        if mode == 'mysql':
            specs = db.load_api_specs_from_mysql(ns)
            specs = [s for s in specs if s.get('enabled')]
            tools = [s['name'] for s in specs]
        else:
            if APIS_JSON_PATH.exists():
                with open(APIS_JSON_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    apis = data if isinstance(data, list) else data.get("apis", [])
                    # 在文件模式下也要按命名空间过滤工具
                    tools = [a['name'] for a in apis if a.get('enabled', 1) and a.get('namespace', 'default') == ns]
        
        # 获取安全的命名空间路径
        safe_ns = "".join([c for c in ns if c.isalnum() or c in ('_', '-')])
        # 使用当前请求的 host，这样无论是在本地还是远程访问，URL 都是正确的
        host = request.headers.get("host", "127.0.0.1:5000")
        results.append({
            "running": True,
            "namespace": ns,
            "url": f"http://{host}/mcp_{safe_ns}",
            "tools": tools
        })
    
    return results

@app.post("/api/stop")
async def stop_mcp(namespace: str = None):
    global mcp_processes
    if namespace:
        if namespace in mcp_processes:
            p = mcp_processes[namespace]["process"]
            if p.poll() is None:
                p.terminate()
                try: p.wait(timeout=5)
                except: p.kill()
            del mcp_processes[namespace]
            # 更新数据库状态
            if _get_storage_mode() == 'mysql':
                db.update_server_status(namespace, 'stopped')
            return {"ok": True}
        return {"ok": False, "error": f"命名空间 {namespace} 未运行"}
    else:
        # 停止所有
        mode = _get_storage_mode()
        for ns in list(mcp_processes.keys()):
            p = mcp_processes[ns]["process"]
            if p.poll() is None:
                p.terminate()
                try: p.wait(timeout=5)
                except: p.kill()
            del mcp_processes[ns]
            if mode == 'mysql':
                db.update_server_status(ns, 'stopped')
        return {"ok": True}

async def restore_mcp_services():
    """从数据库恢复之前运行的服务"""
    if _get_storage_mode() != 'mysql':
        return
    
    try:
        statuses = db.get_all_server_status()
        for ns, status in statuses.items():
            if status == 'running':
                print(f"正在自动恢复命名空间服务: {ns}")
                try:
                    await start_mcp(namespace=ns)
                except Exception as e:
                    print(f"恢复服务 {ns} 失败: {e}")
                    db.update_server_status(ns, 'stopped')
    except Exception as e:
        print(f"获取服务器状态失败: {e}")

if __name__ == '__main__':
    import uvicorn
    import asyncio
    
    # 初始化数据库
    if _get_storage_mode() == 'mysql':
        db.init_db()
    
    # 启动时恢复服务
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(restore_mcp_services())
    
    print("API2MCP 管理界面启动在: http://localhost:5000")
    uvicorn.run(app, host='0.0.0.0', port=5000)
