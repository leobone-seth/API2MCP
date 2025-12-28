
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
// Fixed: Changed APIEndpoint to APISpec as defined in types.ts
import { APISpec, ServerState, ServerStatus } from '../types';

interface DashboardProps {
  // Fixed: Changed APIEndpoint to APISpec
  endpoints: APISpec[];
  server: ServerState;
}

const Dashboard: React.FC<DashboardProps> = ({ endpoints, server }) => {
  const data = [
    { name: 'GET', count: endpoints.filter(e => e.method === 'GET').length },
    { name: 'POST', count: endpoints.filter(e => e.method === 'POST').length },
    { name: 'PUT', count: endpoints.filter(e => e.method === 'PUT').length },
    { name: 'DELETE', count: endpoints.filter(e => e.method === 'DELETE').length },
  ];

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-bold text-[#37352f] mb-1">Dashboard</h1>
        <p className="text-[#6b6a65]">Overview of your API to Model Context Protocol bridge.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-white border notion-border rounded-xl">
          <p className="text-sm font-medium text-[#6b6a65] mb-2">Server Status</p>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${server.status === ServerStatus.RUNNING ? 'bg-green-500' : 'bg-red-400'}`}></span>
            <span className="text-2xl font-bold uppercase">{server.status}</span>
          </div>
        </div>
        <div className="p-6 bg-white border notion-border rounded-xl">
          <p className="text-sm font-medium text-[#6b6a65] mb-2">Active Endpoints</p>
          <div className="text-2xl font-bold">{endpoints.length}</div>
        </div>
        <div className="p-6 bg-white border notion-border rounded-xl">
          <p className="text-sm font-medium text-[#6b6a65] mb-2">Total Requests (24h)</p>
          <div className="text-2xl font-bold">1,284</div>
        </div>
      </div>

      <div className="bg-white border notion-border rounded-xl p-8">
        <h2 className="text-lg font-semibold mb-6">Interface Distribution</h2>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1ef" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b6a65' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b6a65' }} />
              <Tooltip 
                cursor={{ fill: '#f7f6f3' }} 
                contentStyle={{ borderRadius: '8px', border: '1px solid rgba(55, 53, 47, 0.09)', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
