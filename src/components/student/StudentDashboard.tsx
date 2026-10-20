import React from 'react';
import { Bell, CalendarCheck, Clock, FileText, LogIn, MessageSquare, Timer } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard, attendanceTone } from '../ui';
import { attendanceLabel, fmtBytes, fmtDateTime, fmtTime, timeAgo } from '../../lib/format';
import type { Attendance, LabFile, Message } from '../../types';

interface Data {
  attendanceToday: Attendance | null; attendanceSummary: { sessions: number; hours: number; missingCheckouts: number; pendingVerification: number };
  currentLabs: { id: string; name: string; code: string; roomNumber: string; startAt: string }[]; unreadMessages: number; sharedFiles: number;
  recentMessages: Message[]; recentFiles: LabFile[]; announcements: { id: string; title: string; content: string; priority: string; createdAt: string; labName: string; labId: string }[];
  upcoming: { id: string; title: string; start: string; labName: string; labId: string }[]; todaysSchedule: { id: string; title: string; start: string; status: string; labName: string }[];
}

export const StudentDashboard: React.FC = () => {
  const { user, navigate, setModal, dataVersion, unreadCount } = useApp();
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<Data>('/dashboard/student'), [dataVersion]);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load your dashboard.'} onRetry={reloadWithSpinner} />;
  const a = data.attendanceToday;
  return (
    <>
      <PageHeader title={`Hello, ${user!.name.split(' ')[0]}`} subtitle="Here’s what’s happening in your laboratories." actions={<Button onClick={() => setModal({ type: 'join' })}><LogIn className="w-4 h-4" aria-hidden /> Join with code</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="Today’s attendance" value={<Badge tone={attendanceTone(a?.status)} className="text-sm">{attendanceLabel(a?.status)}</Badge>} hint={a ? `${a.labName} · ${fmtTime(a.checkInAt)}` : 'Not checked in'} icon={<CalendarCheck className="w-4 h-4" />} onClick={() => navigate('attendance')} />
        <StatCard label="Sessions attended" value={data.attendanceSummary.sessions} hint={`${data.attendanceSummary.hours} hours total`} icon={<Timer className="w-4 h-4" />} onClick={() => navigate('attendance')} />
        <StatCard label="Unread messages" value={data.unreadMessages} icon={<MessageSquare className="w-4 h-4" />} onClick={() => navigate('labs')} />
        <StatCard label="Shared files" value={data.sharedFiles} icon={<FileText className="w-4 h-4" />} onClick={() => navigate('files')} />
      </div>
      {(data.attendanceSummary.missingCheckouts > 0 || data.attendanceSummary.pendingVerification > 0) && (
        <div className="mb-5 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-sm text-amber-900 dark:text-amber-200">
          {data.attendanceSummary.missingCheckouts > 0 && <>You have {data.attendanceSummary.missingCheckouts} session(s) with a missing check-out. </>}{data.attendanceSummary.pendingVerification > 0 && <>{data.attendanceSummary.pendingVerification} record(s) await staff verification. </>}
          <button onClick={() => navigate('attendance')} className="underline font-medium">View attendance</button>
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 dark:text-white mb-3">Live sessions now</h2>
            {data.currentLabs.length === 0 ? <p className="text-sm text-slate-500">No session is running in your labs right now.</p> : data.currentLabs.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 py-2"><div><p className="text-sm font-medium text-slate-900 dark:text-white">{l.name}</p><p className="text-xs text-slate-500">Since {fmtTime(l.startAt)}{l.roomNumber && ` · Room ${l.roomNumber}`}</p></div><Button size="sm" onClick={() => navigate('lab_room', { lab: l.id, tab: 'session' })}>Open & check in</Button></div>
            ))}
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-slate-900 dark:text-white">Announcements</h2><button onClick={() => navigate('announcements')} className="text-xs text-blue-700 dark:text-cyan-400 hover:underline">View all</button></div>
            {data.announcements.length === 0 ? <EmptyState title="No announcements" /> : data.announcements.map((n) => (
              <div key={n.id} className="py-2.5 border-t first:border-0 border-slate-100 dark:border-slate-800"><p className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2">{n.title}{n.priority === 'urgent' && <Badge tone="red">Urgent</Badge>}</p><p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{n.content}</p><p className="text-xs text-slate-400">{n.labName} · {timeAgo(n.createdAt)}</p></div>
            ))}
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 dark:text-white mb-3">Recent chat</h2>
            {data.recentMessages.length === 0 ? <p className="text-sm text-slate-500">No recent messages.</p> : data.recentMessages.map((m) => (
              <button key={m.id} onClick={() => navigate('lab_room', { lab: m.labId })} className="w-full text-left py-2 border-t first:border-0 border-slate-100 dark:border-slate-800"><span className="text-sm font-medium text-slate-900 dark:text-white">{m.senderName}</span> <span className="text-xs text-slate-400">{timeAgo(m.createdAt)}</span><span className="block text-sm text-slate-600 dark:text-slate-300 truncate">{m.content}</span></button>
            ))}
          </Card>
        </div>
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2"><Clock className="w-4 h-4" aria-hidden /> Today’s schedule</h2>
            {data.todaysSchedule.length === 0 ? <p className="text-sm text-slate-500">Nothing scheduled today.</p> : data.todaysSchedule.map((s) => <p key={s.id} className="text-sm py-1 text-slate-700 dark:text-slate-200">{fmtTime(s.start)} · {s.title || 'Session'} <span className="text-slate-400">({s.labName})</span></p>)}
            <h3 className="text-xs font-semibold uppercase text-slate-400 mt-4 mb-1">Upcoming</h3>
            {data.upcoming.length === 0 ? <p className="text-sm text-slate-500">No upcoming sessions.</p> : data.upcoming.map((s) => <p key={s.id} className="text-sm py-1 text-slate-700 dark:text-slate-200">{fmtDateTime(s.start)} · {s.title || 'Session'}</p>)}
          </Card>
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 dark:text-white mb-3">Recent files</h2>
            {data.recentFiles.length === 0 ? <p className="text-sm text-slate-500">No files shared yet.</p> : data.recentFiles.map((f) => (
              <a key={f.id} href={`/api/files/${f.id}/download`} className="flex items-center gap-2 py-2 text-sm text-slate-700 dark:text-slate-200 hover:text-blue-800 dark:hover:text-cyan-400"><FileText className="w-4 h-4 shrink-0" aria-hidden /><span className="truncate flex-1">{f.name}</span><span className="text-xs text-slate-400">{fmtBytes(f.size)}</span></a>
            ))}
          </Card>
          <Card className="p-5 flex items-center gap-3"><Bell className="w-5 h-5 text-blue-900 dark:text-cyan-400" aria-hidden /><div className="flex-1"><p className="text-sm font-medium text-slate-900 dark:text-white">{unreadCount} unread notification(s)</p></div><Button size="sm" variant="secondary" onClick={() => navigate('notifications')}>Open</Button></Card>
        </div>
      </div>
    </>
  );
};
