import React, { useCallback, useEffect, useState } from 'react';
import { Bot, FileText, Megaphone, MessageSquare, Radio, Users, UserMinus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useApp } from '../../context/AppContext';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, PageHeader, Spinner, cx, inputCls } from '../ui';
import { ChatPanel } from './ChatPanel';
import { SessionPanel } from './SessionPanel';
import { FileBrowser } from '../views/FilesView';
import { AiPanel } from '../views/AIAssistantView';
import type { Lab } from '../../types';

type Tab = 'chat' | 'session' | 'files' | 'members' | 'ai' | 'announce';

const Members: React.FC<{ lab: Lab; canManage: boolean }> = ({ lab, canManage }) => {
  const { toast } = useApp();
  const [members, setMembers] = useState<{ id: string; name: string; role: string; online: boolean; department?: string; studentId?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [remove, setRemove] = useState<{ id: string; name: string } | null>(null);
  const load = useCallback(() => api.get<{ members: typeof members }>(`/labs/${lab.id}/members`).then((r) => setMembers(r.members)).finally(() => setLoading(false)), [lab.id]);
  useEffect(() => { void load(); const s = getSocket(); s?.on('presence:update', load); s?.on('member:joined', load); return () => { s?.off('presence:update', load); s?.off('member:joined', load); }; }, [load]);
  if (loading) return <Spinner />;
  return (
    <Card className="divide-y divide-slate-100 dark:divide-slate-800">
      {members.map((m) => (
        <div key={m.id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0"><p className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-2"><span className={cx('w-2 h-2 rounded-full', m.online ? 'bg-emerald-500' : 'bg-slate-300')} aria-label={m.online ? 'online' : 'offline'} />{m.name}{m.role === 'staff' && <Badge tone="blue">staff</Badge>}</p>
            {canManage && <p className="text-xs text-slate-500">{[m.studentId, m.department].filter(Boolean).join(' · ')}</p>}</div>
          {canManage && m.role === 'student' && <Button size="sm" variant="ghost" onClick={() => setRemove({ id: m.id, name: m.name })} aria-label={`Remove ${m.name}`}><UserMinus className="w-4 h-4" aria-hidden /></Button>}
        </div>
      ))}
      <ConfirmDialog open={!!remove} onClose={() => setRemove(null)} danger confirmLabel="Remove" title="Remove student?" message={<>Remove <strong>{remove?.name}</strong> from this laboratory? They will need a new access code to rejoin.</>}
        onConfirm={async () => { try { await api.del(`/labs/${lab.id}/members/${remove!.id}`); toast('Member removed.', 'success'); setRemove(null); void load(); } catch (e) { toast(e instanceof ApiError ? e.message : 'Failed.', 'error'); } }} />
    </Card>
  );
};

const Announce: React.FC<{ lab: Lab; canManage: boolean }> = ({ lab, canManage }) => {
  const { toast } = useApp();
  const [f, setF] = useState({ title: '', content: '', priority: 'normal' });
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<{ id: string; title: string; content: string; priority: string; author: string; createdAt: string }[]>([]);
  const load = useCallback(() => api.get<{ announcements: typeof items }>(`/announcements?labId=${lab.id}`).then((r) => setItems(r.announcements)), [lab.id]);
  useEffect(() => { void load(); }, [load]);
  const post = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api.post(`/labs/${lab.id}/announcements`, f); setF({ title: '', content: '', priority: 'normal' }); toast('Announcement posted.', 'success'); void load(); }
    catch (err) { toast(err instanceof ApiError ? err.message : 'Failed.', 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      {canManage && lab.status === 'active' && (
        <Card className="p-5"><form onSubmit={post} className="space-y-3">
          <Field label="Title" htmlFor="at"><input id="at" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} /></Field>
          <Field label="Message" htmlFor="am"><textarea id="am" required rows={3} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} className={inputCls} /></Field>
          <div className="flex items-center justify-between gap-3"><select aria-label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className={`${inputCls} !w-auto`}><option value="normal">Normal</option><option value="urgent">Urgent</option></select><Button type="submit" loading={busy} disabled={f.title.trim().length < 3 || f.content.trim().length < 3}>Post announcement</Button></div>
        </form></Card>
      )}
      {items.length === 0 ? <Card><EmptyState icon={<Megaphone className="w-6 h-6" />} title="No announcements yet" /></Card> : items.map((a) => (
        <Card key={a.id} className="p-4"><div className="flex items-center gap-2"><h3 className="font-semibold text-slate-900 dark:text-white">{a.title}</h3>{a.priority === 'urgent' && <Badge tone="red">Urgent</Badge>}</div><p className="text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{a.content}</p><p className="text-xs text-slate-400 mt-2">{a.author} · {new Date(a.createdAt).toLocaleString()}</p></Card>
      ))}
    </div>
  );
};

export const LiveLabRoom: React.FC = () => {
  const { params, navigate, dataVersion, bumpData, user } = useApp();
  const labId = params.lab;
  const [lab, setLab] = useState<Lab | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(params.tab === 'session' ? 'session' : 'chat');
  const [online, setOnline] = useState(0);

  const load = useCallback(async () => {
    if (!labId) { setError('No laboratory selected.'); setLoading(false); return; }
    try { const r = await api.get<{ lab: Lab; canManage: boolean }>(`/labs/${labId}`); setLab(r.lab); setCanManage(r.canManage); setError(''); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load this laboratory.'); }
    finally { setLoading(false); }
  }, [labId]);
  useEffect(() => { setLoading(true); void load(); }, [load, dataVersion]);

  useEffect(() => {
    if (!labId) return;
    const s = getSocket();
    if (!s) return;
    const join = () => s.emit('lab:join', labId);
    if (s.connected) join();
    s.on('connect', join);
    const onSession = (e: { labId: string }) => { if (e.labId === labId) void load(); };
    const onPresence = (p: { labId: string; online: unknown[] }) => { if (p.labId === labId) setOnline(p.online.length); };
    s.on('session:update', onSession); s.on('presence:update', onPresence);
    return () => { s.emit('lab:leave', labId); s.off('connect', join); s.off('session:update', onSession); s.off('presence:update', onPresence); };
  }, [labId, load]);

  if (loading) return <Spinner />;
  if (error || !lab) return <><ErrorState message={error || 'Laboratory not found.'} /><div className="text-center"><Button variant="secondary" onClick={() => navigate('labs')}>Back to laboratories</Button></div></>;

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'chat', label: 'Chat', icon: MessageSquare }, { id: 'session', label: user?.role === 'student' ? 'Attendance' : 'Session', icon: Radio },
    { id: 'files', label: 'Files', icon: FileText }, { id: 'announce', label: 'Announcements', icon: Megaphone },
    { id: 'members', label: 'Members', icon: Users }, { id: 'ai', label: 'AI', icon: Bot },
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: 'Laboratories', onClick: () => navigate('labs') }, { label: lab.name }]} title={lab.name}
        subtitle={[lab.course, lab.building, lab.roomNumber && `Room ${lab.roomNumber}`, lab.schedule].filter(Boolean).join(' · ')}
        actions={<>{lab.activeSession ? <Badge tone="green">Session live · {lab.checkedInCount} in</Badge> : <Badge>No active session</Badge>}<Badge tone="blue">{online} online</Badge></>} />
      {lab.status === 'archived' && <div className="mb-4"><Alert tone="warn">This laboratory is archived. Content is read-only.</Alert></div>}
      <div role="tablist" aria-label="Lab sections" className="flex gap-1 overflow-x-auto mb-4 pb-1">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cx('flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap', tab === t.id ? 'bg-blue-900 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800')}>
            <t.icon className="w-4 h-4" aria-hidden /> {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'chat' && <ChatPanel labId={lab.id} canModerate={canManage} archived={lab.status === 'archived'} />}
        {tab === 'session' && <SessionPanel lab={lab} canManage={canManage} onChanged={() => { void load(); bumpData(); }} />}
        {tab === 'files' && <FileBrowser fixedLabId={lab.id} archived={lab.status === 'archived'} />}
        {tab === 'announce' && <Announce lab={lab} canManage={canManage} />}
        {tab === 'members' && <Members lab={lab} canManage={canManage} />}
        {tab === 'ai' && <AiPanel lab={lab} canManage={canManage} />}
      </div>
    </>
  );
};
