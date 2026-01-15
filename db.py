import os
import json
import pymysql
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    """获取 Doris (MySQL 协议兼容) 连接"""
    return pymysql.connect(
        host=os.getenv("MYSQL_HOST", "47.107.151.172"),
        port=int(os.getenv("MYSQL_PORT", 9030)),  # Doris FE 默认查询端口是 9030
        user=os.getenv("MYSQL_USER", "yihang"),
        password=os.getenv("MYSQL_PASSWORD", "@yihang888"),
        database=os.getenv("MYSQL_DATABASE", "ai_db"),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor
    )


def init_db():
    """初始化 Doris 数据库表结构"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            # 1. 创建命名空间表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS api_namespaces_app_v1 (
                    name VARCHAR(50) COMMENT '命名空间名称',
                    version VARCHAR(20) DEFAULT '1.0.0' COMMENT '版本号',
                    prot INT DEFAULT NULL COMMENT '端口号',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=OLAP
                UNIQUE KEY(name)
                DISTRIBUTED BY HASH(name) BUCKETS 1
                PROPERTIES ("replication_num" = "1");
            """)

            # 2. 创建接口定义表
            # 注意：Doris 2.1+ 支持 BIGINT AUTO_INCREMENT
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS api_specs_app_v1 (
                    id BIGINT AUTO_INCREMENT COMMENT '自增ID',
                    namespace VARCHAR(50) DEFAULT 'default' COMMENT '命名空间',
                    tool_name VARCHAR(100) NOT NULL COMMENT 'MCP 工具名称',
                    description TEXT COMMENT '工具描述',
                    method VARCHAR(10) DEFAULT 'GET' COMMENT 'HTTP 方法',
                    url TEXT COMMENT '完整 URL',
                    base_url TEXT COMMENT '基础 URL',
                    path TEXT COMMENT '接口路径',
                    default_query JSON COMMENT '默认查询参数',
                    default_headers JSON COMMENT '默认请求头',
                    default_json JSON COMMENT '默认 Body (JSON) 参数',
                    default_data JSON COMMENT '默认 Body (Form) 参数',
                    enabled TINYINT DEFAULT 1 COMMENT '是否启用',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=OLAP
                UNIQUE KEY(id)
                DISTRIBUTED BY HASH(id) BUCKETS 1
                PROPERTIES ("replication_num" = "1");
            """)
            # 3. 创建服务状态表
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS api_server_status_app_v1 (
                    namespace VARCHAR(50) COMMENT '命名空间',
                    status VARCHAR(20) DEFAULT 'stopped' COMMENT '状态: running, stopped',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=OLAP
                UNIQUE KEY(namespace)
                DISTRIBUTED BY HASH(namespace) BUCKETS 1
                PROPERTIES ("replication_num" = "1");
            """)
        conn.commit()
        print("Doris 数据库初始化成功")
    finally:
        conn.close()


def ensure_namespace(namespace: str):
    """确保命名空间存在"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT 1 FROM api_namespaces_app_v1 WHERE name = %s",
                (namespace,),
            )
            row = cursor.fetchone()
            if not row:
                cursor.execute(
                    "INSERT INTO api_namespaces_app_v1 (name, version) VALUES (%s, '1.0.0')",
                    (namespace,),
                )
        conn.commit()
    finally:
        conn.close()


def bump_version(namespace: str):
    """自动升级命名空间版本号"""
    ensure_namespace(namespace)
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT version FROM api_namespaces_app_v1 WHERE name = %s", (namespace,))
            row = cursor.fetchone()
            if not row:
                return

            v = row['version']
            parts = v.split('.')
            if len(parts) == 3:
                try:
                    parts[2] = str(int(parts[2]) + 1)
                    new_v = '.'.join(parts)
                except ValueError:
                    new_v = v + ".1"
            else:
                new_v = v + ".1"

            # 显式更新 updated_at
            cursor.execute("""
                UPDATE api_namespaces_app_v1 
                SET version = %s, updated_at = CURRENT_TIMESTAMP 
                WHERE name = %s
            """, (new_v, namespace))
        conn.commit()
    finally:
        conn.close()


def load_api_specs_from_mysql(namespace: str = 'default') -> List[Dict[str, Any]]:
    """从 Doris 加载 API 定义"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            if namespace == 'all':
                cursor.execute("SELECT * FROM api_specs_app_v1")
            else:
                cursor.execute("SELECT * FROM api_specs_app_v1 WHERE namespace = %s", (namespace,))
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


def load_all_enabled_api_specs() -> List[Dict[str, Any]]:
    """加载所有启用的 API"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM api_specs_app_v1 WHERE enabled = 1")
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
    """更新服务器运行状态"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE api_server_status_app_v1
                SET status = %s, updated_at = CURRENT_TIMESTAMP
                WHERE namespace = %s
                """,
                (status, namespace),
            )
            if cursor.rowcount == 0:
                cursor.execute(
                    """
                    INSERT INTO api_server_status_app_v1 (namespace, status, updated_at)
                    VALUES (%s, %s, CURRENT_TIMESTAMP)
                    """,
                    (namespace, status),
                )
        conn.commit()
    finally:
        conn.close()


def get_all_server_status() -> Dict[str, str]:
    """获取所有状态"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT namespace, status FROM api_server_status_app_v1")
            rows = cursor.fetchall()
            return {row['namespace']: row['status'] for row in rows}
    finally:
        conn.close()


def get_namespaces() -> List[str]:
    """获取命名空间列表"""
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT name FROM api_namespaces_app_v1")
            rows = cursor.fetchall()
            return [row['name'] for row in rows]
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
