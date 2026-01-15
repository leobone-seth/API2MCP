
import React, { useState, useCallback, useEffect } from 'react';
import { APISpec, ServerState, ServerStatus, NamespaceMeta } from './types';
import Sidebar from './components/Sidebar';
import EndpointList from './components/EndpointList';
import ServerStatusView from './components/ServerStatusView';
import { apiService } from './services/apiService';
import { ICONS } from './constants';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('api2mcp_active_tab') || 'endpoints';
  });

  useEffect(() => {
    localStorage.setItem('api2mcp_active_tab', activeTab);
  }, [activeTab]);
  const [endpoints, setEndpoints] = useState<APISpec[]>([]);
  const [namespaces, setNamespaces] = useState<NamespaceMeta[]>([]);
  const [namespaceModalOpen, setNamespaceModalOpen] = useState(false);
  const [editingNamespace, setEditingNamespace] = useState<NamespaceMeta | null>(null);
  const [namespaceName, setNamespaceName] = useState('');
  const [namespaceVersion, setNamespaceVersion] = useState('1.0.0');
  const [namespacePort, setNamespacePort] = useState('');
  const [namespaceError, setNamespaceError] = useState('');
  const [currentNamespace, setCurrentNamespace] = useState<string>(() => {
    return localStorage.getItem('api2mcp_current_namespace') || 'default';
  });

  useEffect(() => {
    localStorage.setItem('api2mcp_current_namespace', currentNamespace);
  }, [currentNamespace]);
  const [server, setServer] = useState<ServerState>({
    status: ServerStatus.STOPPED,
    lastStarted: null,
    uptime: 0
  });

  const activeNamespace = namespaces.find(n => n.name === currentNamespace) || { name: 'default', version: '1.0.0' };

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [apis, nsList, status] = await Promise.all([
          apiService.getApis(currentNamespace),
          apiService.getNamespaces(),
          apiService.getMcpStatus()
        ]);
        setEndpoints(apis);
        setNamespaces(nsList);
        setServer(prev => ({
          ...prev,
          status: status.running ? ServerStatus.RUNNING : ServerStatus.STOPPED
        }));
      } catch (err) {
        console.error('Failed to fetch data:', err);
      }
    };
    fetchData();
  }, [currentNamespace]);

  const refreshData = useCallback(async () => {
    try {
      const [apis, nsList] = await Promise.all([
        apiService.getApis(currentNamespace),
        apiService.getNamespaces()
      ]);
      setEndpoints(apis);
      setNamespaces(nsList);
    } catch (err) {
      console.error('Failed to refresh data:', err);
    }
  }, [currentNamespace]);

  const handleStartAll = useCallback(async () => {
    try {
      setServer(prev => ({ ...prev, status: ServerStatus.STARTING }));
      await apiService.startMcp(); // 不传 namespace 即为启动全部
      setServer(prev => ({ 
        ...prev, 
        status: ServerStatus.RUNNING, 
        lastStarted: Date.now() 
      }));
    } catch (error) {
      console.error('Failed to start all namespaces:', error);
      setServer(prev => ({ ...prev, status: ServerStatus.STOPPED }));
    }
  }, []);

  const handleStartNamespace = useCallback(async (ns: string) => {
    try {
      setServer(prev => ({ ...prev, status: ServerStatus.STARTING }));
      await apiService.startMcp(ns);
      setServer(prev => ({ 
        ...prev, 
        status: ServerStatus.RUNNING, 
        lastStarted: Date.now() 
      }));
    } catch (error) {
      console.error('Failed to start namespace:', error);
      setServer(prev => ({ ...prev, status: ServerStatus.STOPPED }));
    }
  }, []);

  const handleStopAll = useCallback(async () => {
    try {
      await apiService.stopMcp();
      setServer(prev => ({ ...prev, status: ServerStatus.STOPPED }));
    } catch (error) {
      console.error('Failed to stop all servers:', error);
    }
  }, []);

  const handleAddEndpoint = useCallback(async (spec: APISpec) => {
    try {
      await apiService.addApi(spec);
      if (spec.namespace && spec.namespace !== currentNamespace) {
        setCurrentNamespace(spec.namespace);
      }
      await refreshData();
    } catch (err) {
      console.error('Failed to add endpoint:', err);
    }
  }, [currentNamespace, refreshData]);

  const handleUpdateEndpoint = useCallback(async (spec: APISpec) => {
    try {
      await apiService.updateApi(spec.id, spec);
      if (spec.namespace && spec.namespace !== currentNamespace) {
        setCurrentNamespace(spec.namespace);
      }
      await refreshData();
    } catch (err) {
      console.error('Failed to update endpoint:', err);
    }
  }, [currentNamespace, refreshData]);

  const handleDeleteEndpoint = useCallback(async (id: string) => {
    try {
      await apiService.deleteApi(id);
      await refreshData();
    } catch (err) {
      console.error('Failed to delete endpoint:', err);
    }
  }, [refreshData]);

  const openCreateNamespace = () => {
    setEditingNamespace(null);
    setNamespaceName('');
    setNamespaceVersion('1.0.0');
    setNamespacePort('');
    setNamespaceError('');
    setNamespaceModalOpen(true);
  };

  const openEditNamespace = (ns: NamespaceMeta) => {
    setEditingNamespace(ns);
    setNamespaceName(ns.name);
    setNamespaceVersion(ns.version || '1.0.0');
    setNamespacePort(ns.prot != null ? String(ns.prot) : '');
    setNamespaceError('');
    setNamespaceModalOpen(true);
  };

  const handleSaveNamespace = async () => {
    const name = namespaceName.trim();
    const version = namespaceVersion.trim() || '1.0.0';
    const portValue = namespacePort.trim();
    let prot: number | undefined;
    if (portValue) {
      const p = parseInt(portValue, 10);
      if (!Number.isNaN(p) && p > 0) {
        prot = p;
      }
    }
    if (!name) return;
    setNamespaceError('');
    try {
      if (editingNamespace) {
        await apiService.updateNamespace(editingNamespace.name, { name, version, prot });
        if (currentNamespace === editingNamespace.name && name !== editingNamespace.name) {
          setCurrentNamespace(name);
        }
      } else {
        await apiService.createNamespace({ name, version, prot });
        setCurrentNamespace(name);
      }
      await refreshData();
      setNamespaceModalOpen(false);
    } catch (err) {
      console.error('Failed to save namespace:', err);
      if (err instanceof Error && err.message) {
        setNamespaceError(err.message);
      } else {
        setNamespaceError('保存命名空间失败');
      }
    }
  };

  const handleDeleteNamespace = async (ns: NamespaceMeta) => {
    try {
      await apiService.deleteNamespace(ns.name);
      if (currentNamespace === ns.name) {
        setCurrentNamespace('default');
      }
      await refreshData();
    } catch (err) {
      console.error('Failed to delete namespace:', err);
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'endpoints':
        return (
          <div className="space-y-8">
            <div className="bg-[#f7f6f3] p-4 rounded-xl border notion-border flex items-center justify-between">
              <div className="flex gap-4 items-center overflow-x-auto pb-2 sm:pb-0">
                {namespaces.map(ns => (
                  <div key={ns.name} className="relative group">
                    <button
                      onClick={() => setCurrentNamespace(ns.name)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex flex-col items-start min-w-[160px] ${
                        currentNamespace === ns.name
                          ? 'bg-white shadow-sm border-blue-500/40 border text-blue-700'
                          : 'hover:bg-[#efefed] text-[#4b4a45]'
                      }`}
                    >
                      <span className="text-[10px] opacity-70 font-bold uppercase tracking-wider">NAMESPACE</span>
                      <div className="mt-0.5 w-full space-y-1">
                        <div className="flex items-center justify-between w-full">
                          <span className="truncate">{ns.name}</span>
                          <span className="text-[10px] bg-blue-50 px-1.5 rounded ml-2 text-blue-600">
                            V{ns.version}
                          </span>
                        </div>
                        <div className="flex items-center justify-between w-full text-[11px] text-[#8f8e88]">
                          <span className="uppercase tracking-wide">Port</span>
                          <span className="font-mono">
                            {ns.prot != null && ns.prot > 0 ? ns.prot : '自动分配'}
                          </span>
                        </div>
                      </div>
                    </button>
                    <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEditNamespace(ns)}
                        className="p-1 rounded-full bg-white border notion-border text-slate-500 hover:text-blue-600 hover:border-blue-400"
                      >
                        <ICONS.Edit />
                      </button>
                      {ns.name !== 'default' && (
                        <button
                          onClick={() => handleDeleteNamespace(ns)}
                          className="p-1 rounded-full bg-white border notion-border text-slate-500 hover:text-red-600 hover:border-red-400"
                        >
                          <ICONS.Trash />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={openCreateNamespace}
                className="flex items-center gap-2 bg-[#37352f] text-white px-3 py-2 rounded-md hover:bg-[#4a4842] transition-colors shadow-sm whitespace-nowrap text-sm"
              >
                <ICONS.Plus />
                添加命名空间
              </button>
            </div>
            <EndpointList 
              endpoints={endpoints} 
              namespaces={namespaces.map(n => n.name)}
              currentNamespace={currentNamespace}
              onAdd={handleAddEndpoint} 
              onUpdate={handleUpdateEndpoint}
              onDelete={handleDeleteEndpoint} 
            />
          </div>
        );
      case 'status':
        return (
          <ServerStatusView 
            server={server} 
            currentNamespace={currentNamespace}
            onStart={() => handleStartNamespace(currentNamespace)}
            onStartAll={handleStartAll}
            onStopAll={handleStopAll}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex bg-white min-h-screen">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 ml-64 p-8 lg:p-12 max-w-7xl mx-auto w-full">
        {renderContent()}
        {namespaceModalOpen && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white notion-shadow rounded-2xl w-full max-w-md overflow-hidden flex flex-col">
              <div className="p-6 border-b notion-border flex justify-between items-center">
                <h2 className="text-xl font-bold text-[#37352f]">
                  {editingNamespace ? '编辑命名空间' : '新增命名空间'}
                </h2>
                <button
                  onClick={() => setNamespaceModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <ICONS.X />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <div className="text-xs font-bold text-[#6b6a65] uppercase mb-1">名称</div>
                  <input
                    className="w-full p-2 bg-white border notion-border rounded-md text-sm text-[#37352f] focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                    value={namespaceName}
                    onChange={e => setNamespaceName(e.target.value)}
                    placeholder="例如：default、internal、experimental"
                  />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#6b6a65] uppercase mb-1">版本</div>
                  <input
                    className="w-full p-2 bg-white border notion-border rounded-md text-sm text-[#37352f] focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                    value={namespaceVersion}
                    onChange={e => setNamespaceVersion(e.target.value)}
                    placeholder="1.0.0"
                  />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#6b6a65] uppercase mb-1">端口号</div>
                  <input
                    type="number"
                    className={`w-full p-2 bg-white border rounded-md text-sm text-[#37352f] focus:outline-none focus:ring-2 transition-all ${
                      namespaceError
                        ? 'border-red-300 focus:ring-red-300/50'
                        : 'notion-border focus:ring-blue-500/20'
                    }`}
                    value={namespacePort}
                    onChange={e => setNamespacePort(e.target.value)}
                    placeholder="例如：8020"
                  />
                </div>
                {namespaceError && (
                  <div className="mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 leading-relaxed">
                    {namespaceError}
                  </div>
                )}
              </div>
              <div className="p-6 border-t notion-border flex justify-end gap-2 bg-[#faf9f6]">
                <button
                  onClick={() => setNamespaceModalOpen(false)}
                  className="px-4 py-2 text-sm rounded-md border notion-border text-[#6b6a65] hover:bg-[#f1f0eb]"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveNamespace}
                  className="px-4 py-2 text-sm rounded-md bg-[#37352f] text-white hover:bg-[#4a4842] shadow-sm"
                  disabled={!namespaceName.trim()}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
