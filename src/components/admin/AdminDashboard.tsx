import React from 'react';
import { Activity, AlertTriangle, Building2, HardDrive, ShieldAlert, UserCheck, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { Card, ErrorState, PageHeader, Spinner, StatCard } from '../ui';
import { fmtBytes, fmtDateTime } from '../../lib/format';

interface Data {
  totals: Record<string, number>; attendanceOverTime: { date: string; records: number }[]; labUtilization: { lab: string; records: number }[];
  userActivity: { date: string; logins: number }[]; fileActivity: { date: string; uploads: number }[]; alertStatus: { status: string; count: number }[];
  recentAdminActivity: { id: string; actor: string; action: string; resourceType: string; createdAt: string }[];
}
const COLORS = ['#1e3a8a', '#0891b2', '#f59e0b', '#64748b'];
const Chart: React.FC<{ title: string; label: string; children: React.ReactElement }> = ({ title, label, children }) => (
  <Card className="p-4"><h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">{title}</h2><div className="h-56" role="img" aria-label={label}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div></Card>
);

export const AdminDashboard: React.FC = () => {
  const { navigate, dataVersion } = useApp();
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<Data>('/dashboard/admin'), [dataVersion]);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load the dashboard.'} onRetry={reloadWithSpinner} />;
  const t = data.totals;
  return (
    <>
      <PageHeader title="Administration" subtitle="System-wide overview (last 30 days for charts)." />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="Users" value={t.users} hint={`${t.students} students · ${t.staff} staff · ${t.admins} admins`} icon={<Users className="w-4 h-4" />} onClick={() => navigate('admin_users')} />
        <StatCard label="Pending approvals" value={t.pendingApprovals} icon={<UserCheck className="w-4 h-4" />} onClick={() => navigate('admin_users')} />
        <StatCard label="Active labs" value={t.activeLabs} hint={`${t.activeSessions} live session(s)`} icon={<Building2 className="w-4 h-4" />} onClick={() => navigate('labs')} />
        <StatCard label="Open alerts" value={t.openAlerts} icon={<ShieldAlert className="w-4 h-4" />} onClick={() => navigate('alerts')} />
        <StatCard label="Attendance records" value={t.attendanceRecords} icon={<Activity className="w-4 h-4" />} onClick={() => navigate('reports')} />
        <StatCard label="File storage used" value={fmtBytes(t.storageBytes)} icon={<HardDrive className="w-4 h-4" />} />
        <StatCard label="System health" value="Details" icon={<AlertTriangle className="w-4 h-4" />} onClick={() => navigate('system_health')} />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Chart title="Attendance over time" label="Line chart of daily attendance records"><LineChart data={data.attendanceOverTime}><CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="records" stroke="#1e3a8a" strokeWidth={2} dot={false} /></LineChart></Chart>
        <Chart title="Lab utilisation" label="Bar chart of attendance per laboratory"><BarChart data={data.labUtilization}><CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" /><XAxis dataKey="lab" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="records" fill="#0891b2" radius={[4, 4, 0, 0]} /></BarChart></Chart>
        <Chart title="Sign-ins per day" label="Line chart of daily sign-ins"><LineChart data={data.userActivity}><CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Line type="monotone" dataKey="logins" stroke="#0891b2" strokeWidth={2} dot={false} /></LineChart></Chart>
        <Chart title="Alert status" label="Pie chart of alerts by status"><PieChart><Pie data={data.alertStatus} dataKey="count" nameKey="status" outerRadius={80} label>{data.alertStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart></Chart>
      </div>
      <Card className="p-5 mt-5"><div className="flex justify-between mb-3"><h2 className="font-semibold text-slate-900 dark:text-white">Recent administrator activity</h2><button onClick={() => navigate('audit_logs')} className="text-xs text-blue-700 dark:text-cyan-400 hover:underline">Open audit logs</button></div>
        {data.recentAdminActivity.length === 0 ? <p className="text-sm text-slate-500">No administrator actions recorded yet.</p> : data.recentAdminActivity.map((a) => <p key={a.id} className="text-sm py-1.5 text-slate-700 dark:text-slate-200"><span className="font-medium">{a.actor}</span> · {a.action.replace(/_/g, ' ').toLowerCase()} <span className="text-slate-400">· {fmtDateTime(a.createdAt)}</span></p>)}
      </Card>
    </>
  );
};
