
export enum HTTPMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS'
}

export enum ServerStatus {
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  STARTING = 'STARTING'
}

export interface NamespaceMeta {
  name: string;
  version: string;
  created_at?: string;
  updated_at?: string;
}

export interface APISpec {
  id: string;
  name: string;
  description: string;
  method: HTTPMethod;
  url?: string;
  base_url?: string;
  path?: string;
  default_headers?: any;
  default_query?: any;
  default_json?: any;
  default_data?: any;
  timeout_s?: number;
  enabled?: number;
  namespace?: string;
  created_at?: number;
  updated_at?: number;
}

export interface ServerState {
  status: ServerStatus;
  lastStarted: number | null;
  uptime: number;
}

export interface McpInfo {
  running: boolean;
  namespace?: string;
  url?: string;
  tools?: string[];
}
