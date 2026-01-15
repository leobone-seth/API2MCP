
import React, { useState } from 'react';
import { APISpec, HTTPMethod } from '../types';
import { ICONS } from '../constants';

interface EndpointListProps {
  endpoints: APISpec[];
  namespaces: string[];
  currentNamespace: string;
  onAdd: (spec: APISpec) => void;
  onUpdate: (spec: APISpec) => void;
  onDelete: (id: string) => void;
}

const EndpointList: React.FC<EndpointListProps> = ({ endpoints, namespaces, currentNamespace, onAdd, onUpdate, onDelete }) => {
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editingItem, setEditingItem] = useState<Partial<APISpec> | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [headersError, setHeadersError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);

  const normalizeJsonLike = (input: string) => {
    const withoutComments = input
      .split('\n')
      .map(line => {
        const idx = line.indexOf('//');
        if (idx === -1) return line;
        return line.slice(0, idx);
      })
      .join('\n');

    const withQuotedKeys = withoutComments
      .split('\n')
      .map(line =>
        line.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/, '$1"$2":'),
      )
      .join('\n');

    const trimmed = withQuotedKeys.trim();
    if (!trimmed) {
      return '';
    }

    const parsed = JSON.parse(withQuotedKeys);
    return JSON.stringify(parsed, null, 2);
  };

  const handleFormatField = (field: 'default_headers' | 'default_json' | 'default_response') => {
    if (!editingItem) return;
    const raw = (editingItem as any)[field];
    if (typeof raw !== 'string' || !raw.trim()) return;
    try {
      const formatted = normalizeJsonLike(raw);
      setEditingItem(prev => ({
        ...prev!,
        [field]: formatted,
      }));
      if (field === 'default_headers') {
        setHeadersError(null);
      } else if (field === 'default_json') {
        setBodyError(null);
      } else if (field === 'default_response') {
        setResponseError(null);
      }
    } catch (e) {
      if (field === 'default_headers') {
        setHeadersError('默认请求头 不是合法的 JSON，请检查格式（键名需要使用双引号）');
      } else if (field === 'default_json') {
        setBodyError('默认请求体 不是合法的 JSON，请检查格式（键名需要使用双引号）');
      } else if (field === 'default_response') {
        setResponseError('默认响应体 不是合法的 JSON，请检查格式（键名需要使用双引号）');
      }
    }
  };

  const openAdd = () => {
    const initialNamespace =
      currentNamespace || (namespaces.length > 0 ? namespaces[0] : 'default');
    setEditingItem({
      method: HTTPMethod.GET,
      enabled: 1,
      timeout_s: 30,
      namespace: initialNamespace
    });
    setModalMode('add');
  };

  const openEdit = (spec: APISpec) => {
    setEditingItem({ 
      ...spec,
      namespace: spec.namespace || 'default',
      default_headers: spec.default_headers ? JSON.stringify(spec.default_headers, null, 2) : '',
      default_query: spec.default_query ? JSON.stringify(spec.default_query, null, 2) : '',
      default_json: spec.default_json ? JSON.stringify(spec.default_json, null, 2) : '',
      default_data: spec.default_data ? JSON.stringify(spec.default_data, null, 2) : '',
      default_response: spec.default_response ? JSON.stringify(spec.default_response, null, 2) : '',
    });
    setModalMode('edit');
  };

  const handleSave = () => {
    if (!editingItem?.name) {
      setNameError('工具名称不能为空');
      return;
    }

    const name = editingItem.name.trim();
    const namePattern = /^[A-Za-z0-9_.-]+$/;
    if (!namePattern.test(name)) {
      setNameError('工具名称仅支持字母、数字、下划线(_)、中划线(-)和点(.)');
      return;
    }

    const fullUrl = (editingItem.url || '').trim();
    if (fullUrl && !/^https?:\/\//i.test(fullUrl)) {
      setUrlError('完整 URL 必须以 http:// 或 https:// 开头');
      return;
    }
    
    const prepareSpec = (): APISpec => {
      const spec = { ...editingItem } as any;
      
      let hasError = false;

      const parseJsonField = (
        raw: any,
        setError?: (msg: string | null) => void,
        label?: string,
      ) => {
        if (typeof raw !== 'string' || !raw.trim()) {
          if (setError) setError(null);
          return {};
        }
        try {
          const obj = JSON.parse(raw);
          if (setError) setError(null);
          return obj;
        } catch (e) {
          console.error('Failed to parse JSON:', e);
          if (setError && label) {
            setError(`${label} 不是合法的 JSON，请检查格式（键名需要使用双引号）`);
          }
          hasError = true;
          return {};
        }
      };

      const headersObj = parseJsonField(spec.default_headers, setHeadersError, '默认请求头');
      const bodyObj = parseJsonField(spec.default_json, setBodyError, '默认请求体');
      const queryObj = parseJsonField(spec.default_query);
      const dataObj = parseJsonField(spec.default_data);
      const responseObj = parseJsonField(spec.default_response, setResponseError, '默认响应体');

      if (hasError) {
        throw new Error('JSON validation failed');
      }

      spec.default_headers = headersObj;
      spec.default_query = queryObj;
      spec.default_json = bodyObj;
      spec.default_data = dataObj;
      spec.default_response = responseObj;
      spec.enabled = spec.enabled ? 1 : 0;
      
      return spec as APISpec;
    };

    try {
      if (modalMode === 'add') {
        const newSpec = prepareSpec();
        newSpec.id = newSpec.name;
        onAdd(newSpec);
      } else if (modalMode === 'edit' && editingItem.id) {
        onUpdate(prepareSpec());
      }
    } catch {
      return;
    }
    setUrlError(null);
    setNameError(null);
    setHeadersError(null);
    setBodyError(null);
    setResponseError(null);
    setModalMode(null);
  };

  const handleParseUrl = () => {
    if (!editingItem?.url) return;
    const raw = editingItem.url.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) {
      setUrlError('完整 URL 必须以 http:// 或 https:// 开头');
      return;
    }
    try {
      const u = new URL(raw);
      const baseUrl = `${u.protocol}//${u.host}`;
      const path = u.pathname || '/';
      setEditingItem(p => ({
        ...p!,
        base_url: baseUrl,
        path,
      }));
      setUrlError(null);
    } catch {
      setUrlError('无法解析该 URL，请检查格式');
    }
  };

  const filtered = endpoints.filter(e => 
    (e.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (e.path && e.path.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (e.namespace && e.namespace.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const inputClasses = "w-full p-2 bg-white border notion-border rounded-md text-sm text-[#37352f] focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all";
  const namespaceOptions = Array.from(
    new Set(
      [
        ...namespaces,
        editingItem?.namespace &&
        !namespaces.includes(editingItem.namespace)
          ? editingItem.namespace
          : null,
      ].filter(Boolean) as string[],
    ),
  );
  const selectedNamespace =
    editingItem?.namespace ||
    currentNamespace ||
    (namespaceOptions.length > 0 ? namespaceOptions[0] : '');

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[#37352f] mb-1">接口列表</h1>
          <p className="text-[#6b6a65]">管理 MCP 工具的 API 规格定义。</p>
        </div>
        <button 
          onClick={openAdd}
          className="flex items-center gap-2 bg-[#37352f] text-white px-4 py-2 rounded-md hover:bg-[#4a4842] transition-colors shadow-sm"
        >
          <ICONS.Plus />
          添加接口
        </button>
      </div>

      <div className="relative">
        <input 
          type="text" 
          placeholder="搜索工具名称或路径..."
          className="w-full px-4 py-2 bg-white border notion-border rounded-lg text-[#37352f] focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-white border notion-border rounded-xl overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[#f7f6f3] border-b notion-border">
            <tr>
              <th className="px-6 py-3 text-xs font-semibold text-[#6b6a65] uppercase tracking-wider">方法</th>
              <th className="px-6 py-3 text-xs font-semibold text-[#6b6a65] uppercase tracking-wider">工具名称</th>
              <th className="px-6 py-3 text-xs font-semibold text-[#6b6a65] uppercase tracking-wider">命名空间</th>
              <th className="px-6 py-3 text-xs font-semibold text-[#6b6a65] uppercase tracking-wider">目标路径</th>
              <th className="px-6 py-3 text-xs font-semibold text-[#6b6a65] uppercase tracking-wider">状态</th>
              <th className="px-6 py-3 text-xs font-semibold text-[#6b6a65] uppercase tracking-wider text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y notion-border">
            {filtered.map((spec) => (
              <tr key={spec.id} className="hover:bg-[#fbfaf8] transition-colors group">
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    spec.method === HTTPMethod.GET ? 'bg-blue-100 text-blue-700' :
                    spec.method === HTTPMethod.POST ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {spec.method}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="font-medium text-[#37352f]">{spec.name}</div>
                  <div className="text-xs text-[#6b6a65] truncate max-w-[200px]">{spec.description}</div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs bg-[#f1f1ef] px-2 py-1 rounded text-[#6b6a65]">
                    {spec.namespace || 'default'}
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-[#37352f] opacity-80">
                  {spec.url || (spec.base_url ? `${spec.base_url}${spec.path}` : spec.path)}
                </td>
                <td className="px-6 py-4">
                  <span className={`w-2.5 h-2.5 rounded-full inline-block ${spec.enabled ? 'bg-green-500' : 'bg-gray-300'}`}></span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => openEdit(spec)}
                      className="p-2 text-slate-400 hover:text-blue-500 transition-colors"
                    >
                      <ICONS.Edit />
                    </button>
                    <button 
                      onClick={() => onDelete(spec.id)}
                      className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <ICONS.Trash />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalMode && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white notion-shadow rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b notion-border flex justify-between items-center">
              <h2 className="text-xl font-bold text-[#37352f]">{modalMode === 'add' ? '添加新接口' : '编辑接口'}</h2>
              <button onClick={() => setModalMode(null)} className="text-slate-400 hover:text-slate-600"><ICONS.X /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Form Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">工具名称 *</label>
                  <input 
                    className={inputClasses}
                    value={editingItem?.name || ''}
                    onChange={e => {
                      const value = e.target.value;
                      setEditingItem(p => ({...p!, name: value}));
                      if (!value.trim()) {
                        setNameError('工具名称不能为空');
                        return;
                      }
                      const pattern = /^[A-Za-z0-9_.-]+$/;
                      if (!pattern.test(value.trim())) {
                        setNameError('仅支持字母、数字、下划线(_)、中划线(-)和点(.)');
                      } else {
                        setNameError(null);
                      }
                    }}
                    placeholder="例如: get_weather"
                  />
                  {nameError && (
                    <div className="mt-1 text-xs text-red-500">
                      {nameError}
                    </div>
                  )}
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">命名空间</label>
                  <select
                    className={inputClasses}
                    value={selectedNamespace}
                    onChange={e =>
                      setEditingItem(p => ({
                        ...p!,
                        namespace: e.target.value || undefined,
                      }))
                    }
                  >
                    {namespaceOptions.map(ns => (
                      <option key={ns} value={ns}>
                        {ns}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">描述</label>
                  <textarea 
                    className={`${inputClasses} h-16 resize-none`}
                    value={editingItem?.description || ''}
                    onChange={e => setEditingItem(p => ({...p!, description: e.target.value}))}
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">请求方法</label>
                  <select 
                    className={inputClasses}
                    value={editingItem?.method}
                    onChange={e => setEditingItem(p => ({...p!, method: e.target.value as HTTPMethod}))}
                  >
                    {Object.values(HTTPMethod).map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">超时时间 (秒)</label>
                  <input 
                    type="number" step="0.1"
                    className={inputClasses}
                    value={editingItem?.timeout_s || 30}
                    onChange={e => setEditingItem(p => ({...p!, timeout_s: parseFloat(e.target.value)}))}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">完整 URL (优先级高于基础URL/路径)</label>
                  <div className="flex gap-2">
                    <input 
                      className={`${inputClasses} font-mono flex-1`}
                      value={editingItem?.url || ''}
                      onChange={e => {
                        const value = e.target.value;
                        setEditingItem(p => ({...p!, url: value}));
                        const trimmed = value.trim();
                        if (trimmed && !/^https?:\/\//i.test(trimmed)) {
                          setUrlError('完整 URL 必须以 http:// 或 https:// 开头');
                        } else {
                          setUrlError(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleParseUrl}
                      className="px-3 py-2 bg-[#f1f1ef] border notion-border rounded-md text-xs font-medium text-[#37352f] hover:bg-[#e5e4df] whitespace-nowrap"
                    >
                      解析
                    </button>
                  </div>
                  {urlError && (
                    <div className="mt-1 text-xs text-red-500">
                      {urlError}
                    </div>
                  )}
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">基础 URL (Base URL)</label>
                  <input 
                    className={inputClasses}
                    value={editingItem?.base_url || ''}
                    onChange={e => setEditingItem(p => ({...p!, base_url: e.target.value}))}
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">路径 (Path)</label>
                  <input 
                    className={`${inputClasses} font-mono`}
                    value={editingItem?.path || ''}
                    onChange={e => setEditingItem(p => ({...p!, path: e.target.value}))}
                  />
                </div>

                <div className="col-span-2 space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-[#6b6a65] uppercase">默认请求头 (JSON 格式)</label>
                      <button
                        type="button"
                        onClick={() => handleFormatField('default_headers')}
                        className="px-2 py-0.5 text-[11px] border notion-border rounded text-[#6b6a65] hover:bg-[#f1f0eb]"
                      >
                        格式化
                      </button>
                    </div>
                    <textarea
                      className={`${inputClasses} font-mono h-24 resize-none`}
                      value={editingItem?.default_headers || ''}
                      onChange={e => setEditingItem(p => ({ ...p!, default_headers: e.target.value }))}
                      placeholder="{}"
                    />
                    {headersError && (
                      <div className="mt-1 text-xs text-red-500">
                        {headersError}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-[#6b6a65] uppercase">默认请求体 (JSON 格式)</label>
                      <button
                        type="button"
                        onClick={() => handleFormatField('default_json')}
                        className="px-2 py-0.5 text-[11px] border notion-border rounded text-[#6b6a65] hover:bg-[#f1f0eb]"
                      >
                        格式化
                      </button>
                    </div>
                    <textarea
                      className={`${inputClasses} font-mono h-24 resize-none`}
                      value={editingItem?.default_json || ''}
                      onChange={e => setEditingItem(p => ({ ...p!, default_json: e.target.value }))}
                      placeholder="{}"
                    />
                    {bodyError && (
                      <div className="mt-1 text-xs text-red-500">
                        {bodyError}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-[#6b6a65] uppercase">默认响应体 (JSON 格式)</label>
                      <button
                        type="button"
                        onClick={() => handleFormatField('default_response')}
                        className="px-2 py-0.5 text-[11px] border notion-border rounded text-[#6b6a65] hover:bg-[#f1f0eb]"
                      >
                        格式化
                      </button>
                    </div>
                    <textarea
                      className={`${inputClasses} font-mono h-24 resize-none`}
                      value={editingItem?.default_response || ''}
                      onChange={e => setEditingItem(p => ({ ...p!, default_response: e.target.value }))}
                      placeholder="{}"
                    />
                    {responseError && (
                      <div className="mt-1 text-xs text-red-500">
                        {responseError}
                      </div>
                    )}
                  </div>
                </div>

                <div className="col-span-2 flex items-center gap-2">
                  <input 
                    type="checkbox" id="enabled"
                    checked={!!editingItem?.enabled}
                    onChange={e => setEditingItem(p => ({...p!, enabled: e.target.checked ? 1 : 0}))}
                    className="w-4 h-4 rounded border-gray-300 text-[#37352f] focus:ring-[#37352f]"
                  />
                  <label htmlFor="enabled" className="text-sm font-medium text-[#37352f]">启用此接口</label>
                </div>
              </div>
            </div>

            <div className="p-6 border-t notion-border bg-[#f7f6f3] flex justify-end gap-3">
              <button 
                onClick={() => setModalMode(null)}
                className="px-4 py-2 bg-white border notion-border rounded-md text-sm font-medium hover:bg-gray-50 transition-all text-[#37352f]"
              >
                取消
              </button>
              <button 
                onClick={handleSave}
                className="px-6 py-2 bg-[#37352f] text-white rounded-md text-sm font-medium hover:bg-[#4a4842] transition-all"
              >
                保存规格
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EndpointList;
