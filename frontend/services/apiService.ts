
import { APISpec, NamespaceMeta, McpInfo } from '../types';

const API_BASE = ''; // Use relative path since frontend is served by FastAPI or proxied

export const apiService = {
  async getApis(namespace: string = 'default'): Promise<APISpec[]> {
    const resp = await fetch(`${API_BASE}/api/apis?namespace=${namespace}`);
    if (!resp.ok) throw new Error('Failed to fetch APIs');
    return resp.json();
  },

  async getNamespaces(): Promise<NamespaceMeta[]> {
    const resp = await fetch(`${API_BASE}/api/namespaces`);
    if (!resp.ok) throw new Error('Failed to fetch namespaces');
    return resp.json();
  },

  async createNamespace(data: { name: string; version: string; prot?: number | null }): Promise<void> {
    const resp = await fetch(`${API_BASE}/api/namespaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      let message = 'Failed to create namespace';
      try {
        const errData = await resp.json();
        if (errData && typeof errData.detail === 'string') {
          message = errData.detail;
        }
      } catch {
      }
      throw new Error(message);
    }
  },

  async updateNamespace(name: string, data: { name: string; version: string; prot?: number | null }): Promise<void> {
    const resp = await fetch(`${API_BASE}/api/namespaces/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      let message = 'Failed to update namespace';
      try {
        const errData = await resp.json();
        if (errData && typeof errData.detail === 'string') {
          message = errData.detail;
        }
      } catch {
      }
      throw new Error(message);
    }
  },

  async deleteNamespace(name: string): Promise<void> {
    const resp = await fetch(`${API_BASE}/api/namespaces/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!resp.ok) throw new Error('Failed to delete namespace');
  },

  async addApi(api: APISpec): Promise<void> {
    const resp = await fetch(`${API_BASE}/api/apis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(api),
    });
    if (!resp.ok) throw new Error('Failed to add API');
  },

  async updateApi(id: string, api: APISpec): Promise<void> {
    const resp = await fetch(`${API_BASE}/api/apis/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(api),
    });
    if (!resp.ok) throw new Error('Failed to update API');
  },

  async deleteApi(id: string): Promise<void> {
    const resp = await fetch(`${API_BASE}/api/apis/${id}`, {
      method: 'DELETE',
    });
    if (!resp.ok) throw new Error('Failed to delete API');
  },

  async startMcp(namespace?: string): Promise<{ status: string }> {
    const url = namespace 
      ? `${API_BASE}/api/start?namespace=${encodeURIComponent(namespace)}` 
      : `${API_BASE}/api/start`;
    const resp = await fetch(url, {
      method: 'POST',
    });
    if (!resp.ok) throw new Error('Failed to start MCP server');
    return resp.json();
  },

  async getMcpLogs(): Promise<string[]> {
    const resp = await fetch(`${API_BASE}/api/logs`);
    if (!resp.ok) throw new Error('Failed to fetch logs');
    const data = await resp.json();
    return data.logs;
  },

  async getMcpInfo(): Promise<McpInfo[]> {
    const resp = await fetch(`${API_BASE}/api/mcp_info`);
    if (!resp.ok) throw new Error('Failed to fetch MCP info');
    return resp.json();
  },

  async stopMcp(namespace?: string): Promise<{ ok: boolean }> {
    const url = namespace 
      ? `${API_BASE}/api/stop?namespace=${encodeURIComponent(namespace)}` 
      : `${API_BASE}/api/stop`;
    const resp = await fetch(url, {
      method: 'POST',
    });
    if (!resp.ok) throw new Error('Failed to stop MCP server');
    return resp.json();
  },

  async getMcpStatus(): Promise<{ running: boolean, pid: number | null }> {
    const resp = await fetch(`${API_BASE}/api/status`);
    if (!resp.ok) throw new Error('Failed to fetch MCP status');
    return resp.json();
  }
};
