import os
import json
import pymysql
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

def get_connection():
    """获取 MySQL 连接"""
    return pymysql.connect(
        host=os.getenv("MYSQL_HOST", "127.0.0.1"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", ""),
        database=os.getenv("MYSQL_DATABASE", "api2mcp"),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor
    )

def init_db():
    """初始化数据库表结构"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            # 创建 namespaces 表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS namespaces (
                    name VARCHAR(50) PRIMARY KEY COMMENT '命名空间名称',
                    version VARCHAR(20) DEFAULT '1.0.0' COMMENT '版本号',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)
            
            # 插入默认命名空间
            cursor.execute("INSERT IGNORE INTO namespaces (name, version) VALUES ('default', '1.0.0')")

            # 创建 api_specs 表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS api_specs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    namespace VARCHAR(50) DEFAULT 'default' COMMENT '命名空间',
                    tool_name VARCHAR(100) NOT NULL UNIQUE COMMENT 'MCP 工具名称',
                    description TEXT COMMENT '工具描述',
                    method VARCHAR(10) NOT NULL DEFAULT 'GET' COMMENT 'HTTP 方法',
                    url TEXT COMMENT '完整 URL',
                    base_url TEXT COMMENT '基础 URL',
                    path TEXT COMMENT '接口路径',
                    default_query JSON COMMENT '默认查询参数',
                    default_headers JSON COMMENT '默认请求头',
                    default_json JSON COMMENT '默认 Body (JSON) 参数',
                    default_data JSON COMMENT '默认 Body (Form) 参数',
                    enabled TINYINT(1) DEFAULT 1 COMMENT '是否启用',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    FOREIGN KEY (namespace) REFERENCES namespaces(name) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)
            # 创建 server_status 表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS server_status (
                    namespace VARCHAR(50) PRIMARY KEY COMMENT '命名空间',
                    status VARCHAR(20) DEFAULT 'stopped' COMMENT '状态: running, stopped',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)
        conn.commit()
        print("数据库初始化成功")
    finally:
        conn.close()

def ensure_namespace(namespace: str):
    """确保命名空间存在，如果不存在则创建"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("INSERT IGNORE INTO namespaces (name, version) VALUES (%s, '1.0.0')", (namespace,))
        conn.commit()
    finally:
        conn.close()

def bump_version(namespace: str):
    """自动升级命名空间版本号 (1.0.0 -> 1.0.1)"""
    ensure_namespace(namespace)
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT version FROM namespaces WHERE name = %s", (namespace,))
            row = cursor.fetchone()
            if not row:
                return
            
            v = row['version']
            # 假设格式是 x.y.z
            parts = v.split('.')
            if len(parts) == 3:
                try:
                    parts[2] = str(int(parts[2]) + 1)
                    new_v = '.'.join(parts)
                except ValueError:
                    new_v = v + ".1"
            else:
                new_v = v + ".1"
            
            cursor.execute("UPDATE namespaces SET version = %s WHERE name = %s", (new_v, namespace))
        conn.commit()
    finally:
        conn.close()

def load_api_specs_from_mysql(namespace: str = 'default') -> List[Dict[str, Any]]:
    """从 MySQL 加载所有 API 定义"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM api_specs WHERE namespace = %s", (namespace,))
            rows = cursor.fetchall()
            
            # 转换为 server.py 需要的格式
            specs = []
            for row in rows:
                spec = {
                    "id": row["id"],
                    "namespace": row["namespace"],
                    "name": row["tool_name"],
                    "description": row["description"],
                    "method": row["method"],
                    "enabled": row["enabled"]
                }
                if row["url"]: spec["url"] = row["url"]
                if row["base_url"]: spec["base_url"] = row["base_url"]
                if row["path"]: spec["path"] = row["path"]
                
                # 解析 JSON 字段
                for field in ["default_query", "default_headers", "default_json", "default_data"]:
                    val = row.get(field)
                    if val:
                        if isinstance(val, str):
                            try:
                                spec[field] = json.loads(val)
                            except json.JSONDecodeError:
                                spec[field] = {} # 或者保持原样，或者设置默认值
                        else:
                            spec[field] = val
                    else:
                        spec[field] = {}
                
                specs.append(spec)
            return specs
    finally:
        conn.close()

def load_all_enabled_api_specs() -> List[Dict[str, Any]]:
    """从 MySQL 加载所有已启用的 API 定义（跨命名空间）"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            # 只加载已启用的接口
            cursor.execute("SELECT * FROM api_specs WHERE enabled = 1")
            rows = cursor.fetchall()
            
            specs = []
            for row in rows:
                spec = {
                    "id": row["id"],
                    "namespace": row["namespace"],
                    "name": row["tool_name"],
                    "description": row["description"],
                    "method": row["method"],
                    "enabled": row["enabled"]
                }
                if row["url"]: spec["url"] = row["url"]
                if row["base_url"]: spec["base_url"] = row["base_url"]
                if row["path"]: spec["path"] = row["path"]
                
                for field in ["default_query", "default_headers", "default_json", "default_data"]:
                    val = row.get(field)
                    if val:
                        if isinstance(val, str):
                            try:
                                spec[field] = json.loads(val)
                            except json.JSONDecodeError:
                                spec[field] = {}
                        else:
                            spec[field] = val
                    else:
                        spec[field] = {}
                
                specs.append(spec)
            return specs
    finally:
        conn.close()

def update_server_status(namespace: str, status: str):
    """更新服务器运行状态到数据库"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                INSERT INTO server_status (namespace, status) 
                VALUES (%s, %s) 
                ON DUPLICATE KEY UPDATE status = %s
            """, (namespace, status, status))
        conn.commit()
    finally:
        conn.close()

def get_all_server_status() -> Dict[str, str]:
    """从数据库获取所有命名空间的运行状态"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT namespace, status FROM server_status")
            rows = cursor.fetchall()
            return {row['namespace']: row['status'] for row in rows}
    finally:
        conn.close()

def get_namespaces() -> List[str]:
    """获取所有命名空间列表"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT name FROM namespaces")
            rows = cursor.fetchall()
            return [row['name'] for row in rows]
    finally:
        conn.close()

if __name__ == "__main__":
    init_db()
