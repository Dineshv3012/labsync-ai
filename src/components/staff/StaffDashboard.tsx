import React from 'react';
import { Building2, CalendarCheck, FileText, MessageSquare, Plus, Radio, ShieldAlert, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, ErrorState, PageHeader, Spinner, StatCard, attendanceTone } from '../ui';
import { attendanceLabel, fmtBytes, fmtDateTime, fmtTime } from '../../lib/format';
import type { Attendance, LabFile } from '../../types';

interface Data {
  totalLabs: number; activeSessions: number; checkedInNow: number; pendingVerification: number; openAlerts: number; recentUploads: number; unreadMessages: number;
  upcoming: { id: string; title: string; start: string; labName: string; labId: string }[]; recentFiles: LabFile[]; recentAttendance: Attendance[];
}

export const StaffDashboard: React.FC = () => {
  const { user, navigate, setModal, dataVersion } = useApp();
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<Data>('/dashboard/staff'), [dataVersion]);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load the dashboard.'} onRetry={reloadWithSpinner} />;
  return (
    <>
      <PageHeader title={`Welcome, ${user!.name.split(' ')[0]}`} subtitle="Your laboratories at a glance." actions={<Button onClick={() => setModal({ type: 'createLab' })}><Plus className="w-4 h-4" aria-hidden /> Create laboratory</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="My laboratories" value={data.totalLabs} icon={<Building2 className="w-4 h-4" />} onClick={() => navigate('labs')} />
        <StatCard label="Active sessions" value={data.activeSessions} icon={<Radio className="w-4 h-4" />} onClick={() => navigate('labs')} />
        <StatCard label="Checked in now" value={data.checkedInNow} icon={<Users className="w-4 h-4" />} />
        <StatCard label="Needs verification" value={data.pendingVerification} icon={<CalendarCheck className="w-4 h-4" />} onClick={() => navigate('attendance')} />
        <StatCard label="Open alerts" value={data.openAlerts} icon={<ShieldAlert className="w-4 h-4" />} onClick={() => navigate('alerts')} />
        <StatCard label="Uploads this week" value={data.recentUploads} icon={<FileText className="w-4 h-4" />} onClick={() => navigate('files')} />
        <StatCard label="Unread messages" value={data.unreadMessages} icon={<MessageSquare className="w-4 h-4" />} onClick={() => navigate('labs')} />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Card className="p-5"><h2 className="font-semibold text-slate-900 dark:text-white mb-3">Recent attendance</h2>
          {data.recentAttendance.length === 0 ? <p className="text-sm text-slate-500">No attendance recorded yet.</p> : data.recentAttendance.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 py-2 border-t first:border-0 border-slate-100 dark:border-slate-800"><div className="min-w-0"><p className="text-sm font-medium text-slate-900 dark:text-white truncate">{r.studentName}</p><p className="text-xs text-slate-500">{r.labName} · {fmtTime(r.checkInAt)}</p></div><Badge tone={attendanceTone(r.status)}>{attendanceLabel(r.status)}</Badge></div>
          ))}
        </Card>
        <div className="space-y-5">
          <Card className="p-5"><h2 className="font-semibold text-slate-900 dark:text-white mb-3">Upcoming sessions</h2>
            {data.upcoming.length === 0 ? <p className="text-sm text-slate-500">No scheduled sessions. Schedule one from a lab’s Session tab.</p> : data.upcoming.map((s) => <button key={s.id} onClick={() => navigate('lab_room', { lab: s.labId, tab: 'session' })} className="block w-full text-left text-sm py-1.5 text-slate-700 dark:text-slate-200 hover:text-blue-800">{fmtDateTime(s.start)} · {s.title || 'Session'} <span className="text-slate-400">({s.labName})</span></button>)}
          </Card>
          <Card className="p-5"><h2 className="font-semibold text-slate-900 dark:text-white mb-3">Recent files</h2>
            {data.recentFiles.length === 0 ? <p className="text-sm text-slate-500">No files yet.</p> : data.recentFiles.map((f) => <a key={f.id} href={`/api/files/${f.id}/download`} className="flex items-center gap-2 py-1.5 text-sm text-slate-700 dark:text-slate-200"><FileText className="w-4 h-4 shrink-0" aria-hidden /><span className="truncate flex-1">{f.name}</span><span className="text-xs text-slate-400">{fmtBytes(f.size)}</span></a>)}
          </Card>
        </div>
      </div>
    </>
  );
};
