
import React, { useState, useCallback, useEffect } from 'react';
import { APISpec, ServerState, ServerStatus, NamespaceMeta } from './types';
import Sidebar from './components/Sidebar';
import EndpointList from './components/EndpointList';
import ServerStatusView from './components/ServerStatusView';
import { apiService } from './services/apiService';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('api2mcp_active_tab') || 'endpoints';
  });

  useEffect(() => {
    localStorage.setItem('api2mcp_active_tab', activeTab);
  }, [activeTab]);
  const [endpoints, setEndpoints] = useState<APISpec[]>([]);
  const [namespaces, setNamespaces] = useState<NamespaceMeta[]>([]);
  const [currentNamespace, setCurrentNamespace] = useState<string>(() => {
    return localStorage.getItem('api2mcp_current_namespace') || 'all';
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

  const renderContent = () => {
    switch (activeTab) {
      case 'endpoints':
        return (
          <div className="space-y-8">
            <div className="bg-[#f7f6f3] p-4 rounded-xl border notion-border flex items-center justify-between">
              <div className="flex gap-4 items-center overflow-x-auto pb-2 sm:pb-0">
                <button
                  onClick={() => setCurrentNamespace('all')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex flex-col items-start min-w-[120px] ${
                    currentNamespace === 'all'
                      ? 'bg-white shadow-sm border-blue-500/30 border text-blue-600'
                      : 'hover:bg-[#efefed] text-[#6b6a65]'
                  }`}
                >
                  <span className="text-xs opacity-70 font-bold uppercase tracking-wider">GLOBAL</span>
                  <div className="flex items-center justify-between w-full">
                    <span>全部接口</span>
                    <span className="text-[10px] bg-blue-50 px-1.5 rounded ml-2">ALL</span>
                  </div>
                </button>
                {namespaces.map(ns => (
                  <button
                    key={ns.name}
                    onClick={() => setCurrentNamespace(ns.name)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex flex-col items-start min-w-[120px] ${
                      currentNamespace === ns.name
                        ? 'bg-white shadow-sm border-blue-500/30 border text-blue-600'
                        : 'hover:bg-[#efefed] text-[#6b6a65]'
                    }`}
                  >
                    <span className="text-xs opacity-70 font-bold uppercase tracking-wider">NAMESPACE</span>
                    <div className="flex items-center justify-between w-full">
                      <span>{ns.name}</span>
                      <span className="text-[10px] bg-blue-50 px-1.5 rounded ml-2">V{ns.version}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <EndpointList 
              endpoints={endpoints} 
              namespaces={namespaces.map(n => n.name)}
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
      </main>
    </div>
  );
};

export default App;
