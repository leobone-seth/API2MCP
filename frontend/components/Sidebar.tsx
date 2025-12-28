
import React from 'react';
import { ICONS } from '../constants';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const menuItems = [
    { id: 'endpoints', name: '接口列表', icon: <ICONS.Terminal /> },
    { id: 'status', name: '服务器状态', icon: <ICONS.Activity /> },
  ];

  return (
    <div className="w-64 h-screen bg-[#f7f6f3] border-r notion-border flex flex-col p-4 fixed left-0 top-0">
      <div className="flex items-center gap-2 mb-8 px-2">
        <div className="w-8 h-8 bg-black rounded flex items-center justify-center text-white font-bold text-xs">
          MCP
        </div>
        <h1 className="font-semibold text-slate-800">API2MCP Admin</h1>
      </div>

      <nav className="flex-1 space-y-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors duration-150 ${
              activeTab === item.id
                ? 'bg-[#efefed] text-[#37352f] font-medium'
                : 'text-[#6b6a65] hover:bg-[#efefed]'
            }`}
          >
            <span className="opacity-70">{item.icon}</span>
            {item.name}
          </button>
        ))}
      </nav>
    </div>
  );
};

export default Sidebar;
