USE api2mcp;

-- 插入 httpbin_get 示例
INSERT INTO api_specs (
    namespace, 
    tool_name, 
    description, 
    method, 
    url, 
    default_query,
    enabled
) VALUES (
    'default',
    'httpbin_get',
    '调用 httpbin 的 GET 示例；通过 request.query 传入查询参数。',
    'GET',
    'https://httpbin.org/get',
    '{"from": "api2mcp_mysql"}',
    1
);

-- 插入 httpbin_post_json 示例
INSERT INTO api_specs (
    namespace, 
    tool_name, 
    description, 
    method, 
    url, 
    default_json,
    enabled
) VALUES (
    'default',
    'httpbin_post_json',
    '调用 httpbin 的 POST 示例；通过 request.json 传入 JSON body。',
    'POST',
    'https://httpbin.org/post',
    '{"hello": "world_from_mysql"}',
    1
);
