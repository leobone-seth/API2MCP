
import React, { useState, useEffect } from 'react';
import { ServerState, ServerStatus, McpInfo } from '../types';
import { ICONS } from '../constants';
import { apiService } from '../services/apiService';

interface ServerStatusViewProps {
  server: ServerState;
  currentNamespace: string;
  onStart: () => void;
  onStartAll: () => void;
  onStopAll: () => void;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ServerStatusView: React.FC<ServerStatusViewProps> = ({ server, currentNamespace, onStart, onStartAll, onStopAll }) => {
  const [mcpInfos, setMcpInfos] = useState<McpInfo[]>([]);
  const [loadingNamespace, setLoadingNamespace] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<'restart' | 'stop' | null>(null);

  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const infos = await apiService.getMcpInfo();
        setMcpInfos(infos);
      } catch (error) {
        console.error('Failed to fetch MCP info:', error);
      }
    };

    fetchInfo();
  }, [server.status]); // 仅在服务器状态变化（如启动/停止）时获取一次

  const handleStopNamespace = async (ns: string) => {
    try {
      setLoadingNamespace(ns);
      setLoadingAction('stop');
      await apiService.stopMcp(ns);
      const infos = await apiService.getMcpInfo();
      setMcpInfos(infos);
    } catch (error) {
      console.error('Failed to stop namespace:', error);
    } finally {
      setLoadingNamespace(null);
      setLoadingAction(null);
    }
  };

  const handleRestartNamespace = async (ns: string) => {
    try {
      setLoadingNamespace(ns);
      setLoadingAction('restart');
      await apiService.stopMcp(ns);
      await apiService.startMcp(ns);
      await sleep(600);
      const infos = await apiService.getMcpInfo();
      setMcpInfos(infos);
    } catch (error) {
      console.error('Failed to restart namespace:', error);
    } finally {
      setLoadingNamespace(null);
      setLoadingAction(null);
    }
  };

  const isAnyRunning = mcpInfos.length > 0;
  const isCurrentRunning = mcpInfos.some(info => info.namespace === currentNamespace);

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      <div className="bg-white border notion-border rounded-2xl p-8 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-blue-500/10"></div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className={`p-4 rounded-2xl ${
              isAnyRunning 
                ? 'bg-green-50 text-green-600' 
                : 'bg-[#f7f6f3] text-[#6b6a65]'
            }`}>
              <ICONS.Activity className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#37352f]">MCP 服务器状态</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-2 h-2 rounded-full ${
                  isAnyRunning ? 'bg-green-500 animate-pulse' : 'bg-[#6b6a65]'
                }`}></span>
                <span className="text-[#6b6a65] font-medium">
                  {isAnyRunning ? `正在运行 (${mcpInfos.length} 个实例)` : '已停止'}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex gap-3">
            {!isAnyRunning && (
              <button
                onClick={onStartAll}
                disabled={server.status === ServerStatus.STARTING}
                className="px-6 py-3 rounded-xl font-bold bg-[#37352f] text-white hover:bg-[#2c2a26] disabled:opacity-50 transition-all shadow-sm flex items-center gap-2"
              >
                <ICONS.Plus className="w-5 h-5" /> 一键启动全部
              </button>
            )}
            {!isCurrentRunning && currentNamespace !== 'all' && isAnyRunning && (
              <button
                onClick={onStart}
                disabled={server.status === ServerStatus.STARTING}
                className="px-6 py-3 rounded-xl font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition-all shadow-sm flex items-center gap-2"
              >
                <ICONS.Plus className="w-5 h-5" /> 启动 {currentNamespace}
              </button>
            )}
            {isAnyRunning && (
              <button
                onClick={onStopAll}
                className="px-6 py-3 rounded-xl font-bold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-all shadow-sm flex items-center gap-2"
              >
                <ICONS.Trash className="w-5 h-5" /> 停止全部
              </button>
            )}
          </div>
        </div>
      </div>

      {isAnyRunning ? (
        <div className="space-y-6">
          {mcpInfos.map((info, idx) => {
            const isLoadingThis = loadingNamespace === info.namespace;
            const isRestarting = isLoadingThis && loadingAction === 'restart';
            const isStopping = isLoadingThis && loadingAction === 'stop';
            return (
              <div key={info.namespace || idx} className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-white border notion-border rounded-xl p-6 space-y-4 shadow-sm relative group">
                  <div className="flex items-center justify-between border-b notion-border pb-2">
                    <h3 className="text-lg font-bold text-[#37352f] flex items-center gap-2">
                      <ICONS.Activity className="w-5 h-5" /> 运行实例 - {info.namespace}
                      {isLoadingThis && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 ml-2">
                          <span className="inline-block w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                          {isRestarting ? '重启中...' : '处理中...'}
                        </span>
                      )}
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRestartNamespace(info.namespace!)}
                        disabled={isRestarting || isStopping}
                        className={`text-xs font-medium px-3 py-1 rounded-full border shadow-sm transition-colors ${
                          isRestarting || isStopping
                            ? 'bg-blue-100 text-blue-400 border-blue-100 cursor-not-allowed'
                            : 'bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 border-blue-100'
                        }`}
                      >
                        {isRestarting && (
                          <span className="inline-block w-3 h-3 mr-1 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        )}
                        重启实例
                      </button>
                      <button 
                        onClick={() => handleStopNamespace(info.namespace!)}
                        disabled={isRestarting || isStopping}
                        className={`text-xs font-medium px-3 py-1 rounded-full border shadow-sm transition-colors ${
                          isRestarting || isStopping
                            ? 'bg-red-100 text-red-300 border-red-100 cursor-not-allowed'
                            : 'bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 border-red-100'
                        }`}
                      >
                        {isStopping && (
                          <span className="inline-block w-3 h-3 mr-1 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                        )}
                        停止此实例
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs font-bold text-[#6b6a65] uppercase">当前命名空间</label>
                      <div className="text-sm font-medium text-[#37352f] bg-[#f1f1ef] px-2 py-1 rounded inline-block mt-1">
                        {info.namespace}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#6b6a65] uppercase">MCP 服务地址</label>
                      <div className="text-sm font-mono text-blue-600 bg-blue-50 px-2 py-1 rounded mt-1 break-all">
                        {info.url}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#6b6a65] uppercase">启动状态</label>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        <span className="text-sm text-green-700 font-medium">服务已就绪</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white border notion-border rounded-xl p-6 space-y-4 shadow-sm flex flex-col">
                  <h3 className="text-lg font-bold text-[#37352f] flex items-center gap-2 border-b notion-border pb-2">
                    <ICONS.Terminal className="w-5 h-5" /> 已加载的工具清单 ({info.tools?.length || 0})
                    {isRestarting && (
                      <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin ml-2" />
                    )}
                  </h3>
                  <div className={`flex-1 overflow-y-auto max-h-[250px] custom-scrollbar ${isRestarting ? 'opacity-60 animate-pulse' : ''}`}>
                    {info.tools && info.tools.length > 0 ? (
                      <div className="grid grid-cols-1 gap-2">
                        {info.tools.map((tool, tIdx) => (
                          <div key={tIdx} className="text-sm text-[#37352f] bg-[#f7f6f3] px-3 py-2 rounded-lg flex items-center gap-2">
                            <span className="text-[#6b6a65] text-xs">{tIdx + 1}.</span>
                            <span className="font-mono">{tool}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[#6b6a65] italic text-sm py-4 text-center">
                        暂无启用的工具
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : server.status === ServerStatus.STARTING ? (
        <div className="text-center py-12 bg-[#f7f6f3] rounded-2xl border-2 border-dashed notion-border">
          <div className="text-[#6b6a65] mb-2">正在初始化服务信息...</div>
          <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : null}
    </div>
  );
};

export default ServerStatusView;
