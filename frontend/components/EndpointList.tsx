
import React, { useState } from 'react';
import { APISpec, HTTPMethod } from '../types';
import { ICONS } from '../constants';

interface EndpointListProps {
  endpoints: APISpec[];
  namespaces: string[];
  onAdd: (spec: APISpec) => void;
  onUpdate: (spec: APISpec) => void;
  onDelete: (id: string) => void;
}

const EndpointList: React.FC<EndpointListProps> = ({ endpoints, namespaces, onAdd, onUpdate, onDelete }) => {
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editingItem, setEditingItem] = useState<Partial<APISpec> | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const openAdd = () => {
    setEditingItem({
      method: HTTPMethod.GET,
      enabled: 1,
      timeout_s: 30,
      namespace: 'default'
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
    });
    setModalMode('edit');
  };

  const handleSave = () => {
    if (!editingItem?.name) return;
    
    const prepareSpec = (): APISpec => {
      const spec = { ...editingItem } as any;
      
      const parseJson = (val: any) => {
        if (typeof val !== 'string' || !val.trim()) return {};
        try {
          return JSON.parse(val);
        } catch (e) {
          console.error('Failed to parse JSON:', e);
          return {};
        }
      };

      spec.default_headers = parseJson(spec.default_headers);
      spec.default_query = parseJson(spec.default_query);
      spec.default_json = parseJson(spec.default_json);
      spec.default_data = parseJson(spec.default_data);
      spec.enabled = spec.enabled ? 1 : 0;
      
      return spec as APISpec;
    };

    if (modalMode === 'add') {
      const newSpec = prepareSpec();
      newSpec.id = newSpec.name;
      onAdd(newSpec);
    } else if (modalMode === 'edit' && editingItem.id) {
      onUpdate(prepareSpec());
    }
    setModalMode(null);
  };

  const filtered = endpoints.filter(e => 
    (e.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (e.path && e.path.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (e.namespace && e.namespace.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const inputClasses = "w-full p-2 bg-white border notion-border rounded-md text-sm text-[#37352f] focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all";

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
                    onChange={e => setEditingItem(p => ({...p!, name: e.target.value}))}
                    placeholder="例如: get_weather"
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">命名空间</label>
                  <div className="relative">
                    <input 
                      className={inputClasses}
                      value={editingItem?.namespace || ''}
                      onChange={e => setEditingItem(p => ({...p!, namespace: e.target.value}))}
                      placeholder="例如: default"
                      list="namespace-options"
                    />
                    <datalist id="namespace-options">
                      {namespaces.map(ns => (
                        <option key={ns} value={ns} />
                      ))}
                    </datalist>
                  </div>
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
                  <input 
                    className={`${inputClasses} font-mono`}
                    value={editingItem?.url || ''}
                    onChange={e => setEditingItem(p => ({...p!, url: e.target.value}))}
                  />
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
                    <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">默认请求头 (JSON 格式)</label>
                    <textarea 
                      className={`${inputClasses} font-mono h-24 resize-none`}
                      value={editingItem?.default_headers || ''}
                      onChange={e => setEditingItem(p => ({...p!, default_headers: e.target.value}))}
                      placeholder="{}"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#6b6a65] uppercase mb-1">默认请求体 (JSON 格式)</label>
                    <textarea 
                      className={`${inputClasses} font-mono h-24 resize-none`}
                      value={editingItem?.default_json || ''}
                      onChange={e => setEditingItem(p => ({...p!, default_json: e.target.value}))}
                      placeholder="{}"
                    />
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
