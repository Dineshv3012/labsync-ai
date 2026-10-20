import React, { useEffect, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync, useDebounced } from '../../hooks/useAsync';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, Spinner, TableWrap, Td, Th, inputCls } from '../ui';
import { fmtBytes, fmtDateTime } from '../../lib/format';

interface AdminUser { id: string; name: string; email: string; role: 'student' | 'staff' | 'admin'; requestedRole: string | null; department: string; studentOrStaffId: string; status: 'active' | 'pending' | 'suspended'; emailVerified: boolean; createdAt: string; lastLoginAt: string | null }

export const AdminUsers: React.FC = () => {
  const { user, toast } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [ver, setVer] = useState(0);
  const [change, setChange] = useState<{ u: AdminUser; role: string } | null>(null);
  const [suspend, setSuspend] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<{ users: AdminUser[]; total: number }>(`/admin/users${qs({ q: dq, role, status, page, pageSize: 15 })}`), [dq, role, status, page, ver]);
  const run = async (fn: () => Promise<unknown>, ok: string, done: () => void) => {
    setBusy(true);
    try { await fn(); toast(ok, 'success'); done(); setVer((v) => v + 1); } catch (e) { toast(e instanceof ApiError ? e.message : 'Failed.', 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Users & roles" subtitle="Approve accounts and manage roles. Every change is written to the audit log." />
      <Card className="p-4 mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-52"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden /><input aria-label="Search users" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, email or ID…" className={`${inputCls} pl-9`} /></div>
        <select aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className={`${inputCls} !w-auto`}><option value="">All roles</option><option value="student">Student</option><option value="staff">Staff</option><option value="admin">Admin</option></select>
        <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} !w-auto`}><option value="">All statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
      </Card>
      <Card className="p-0 overflow-hidden">
        {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={reloadWithSpinner} /> : !data?.users.length ? <EmptyState title="No users match" /> : (
          <div className="p-2"><TableWrap>
            <thead><tr><Th>User</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>{data.users.map((u) => (
              <tr key={u.id}>
                <Td><p className="font-medium text-slate-900 dark:text-white">{u.name}</p><p className="text-xs text-slate-500">{u.email} · {u.studentOrStaffId} · {u.department}</p></Td>
                <Td><Badge tone={u.role === 'admin' ? 'red' : u.role === 'staff' ? 'blue' : 'slate'}>{u.role}</Badge>{u.requestedRole && <p className="text-[11px] text-amber-600 mt-1">requested {u.requestedRole}</p>}</Td>
                <Td><Badge tone={u.status === 'active' ? 'green' : u.status === 'pending' ? 'amber' : 'red'}>{u.status}</Badge>{!u.emailVerified && <p className="text-[11px] text-slate-400 mt-1">e-mail unverified</p>}</Td>
                <Td>{fmtDateTime(u.lastLoginAt)}</Td>
                <Td className="text-right whitespace-nowrap">
                  {u.status === 'pending' && <Button size="sm" loading={busy} onClick={() => run(() => api.post(`/admin/users/${u.id}/approve`, {}), `${u.name} approved as ${u.requestedRole ?? 'student'}.`, () => {})}><Check className="w-3.5 h-3.5" aria-hidden /> Approve</Button>}
                  {u.status !== 'pending' && u.id !== user!.id && <>
                    <select aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => e.target.value !== u.role && setChange({ u, role: e.target.value })} className="text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 mr-1"><option value="student">student</option><option value="staff">staff</option><option value="admin">admin</option></select>
                    {u.status === 'active' ? <Button size="sm" variant="ghost" onClick={() => setSuspend(u)}>Suspend</Button> : <Button size="sm" variant="secondary" onClick={() => run(() => api.patch(`/admin/users/${u.id}`, { status: 'active' }), 'Account reactivated.', () => {})}>Reactivate</Button>}
                  </>}
                </Td>
              </tr>))}
            </tbody></TableWrap><div className="px-2 pb-2"><Pagination page={page} pageSize={15} total={data.total} onPage={setPage} /></div></div>
        )}
      </Card>
      <ConfirmDialog open={!!change} onClose={() => setChange(null)} loading={busy} confirmLabel="Change role" title="Change role?" danger={change?.role === 'admin'}
        message={<>Change <strong>{change?.u.name}</strong> from <strong>{change?.u.role}</strong> to <strong>{change?.role}</strong>? {change?.role === 'admin' && 'Administrators can manage every account and setting.'} They will be signed out of existing sessions.</>}
        onConfirm={() => run(() => api.patch(`/admin/users/${change!.u.id}`, { role: change!.role }), 'Role updated.', () => setChange(null))} />
      <ConfirmDialog open={!!suspend} onClose={() => setSuspend(null)} loading={busy} danger confirmLabel="Suspend" title="Suspend account?"
        message={<><strong>{suspend?.name}</strong> will be signed out immediately and unable to sign in until reactivated.</>}
        onConfirm={() => run(() => api.patch(`/admin/users/${suspend!.id}`, { status: 'suspended' }), 'Account suspended.', () => setSuspend(null))} />
    </>
  );
};

export const AuditLogs: React.FC = () => {
  const [f, setF] = useState({ q: '', action: '', actor: '', from: '', to: '' });
  const dq = useDebounced(f.q);
  const dactor = useDebounced(f.actor);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<any>(null);
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<{ logs: { id: string; actor: string; actorRole: string; action: string; resourceType: string; resourceId: string; metadata: Record<string, unknown>; ip: string; createdAt: string }[]; total: number }>(`/admin/audit${qs({ ...f, q: dq, actor: dactor, page })}`), [dq, dactor, f.action, f.from, f.to, page]);
  const set = (k: keyof typeof f) => (v: string) => { setF((p) => ({ ...p, [k]: v })); setPage(1); };
  return (
    <>
      <PageHeader title="Audit logs" subtitle="Append-only. Entries are written by the server and cannot be edited or deleted from the app." />
      <Card className="p-4 mb-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <input aria-label="Search" placeholder="Search…" value={f.q} onChange={(e) => set('q')(e.target.value)} className={inputCls} />
        <input aria-label="Actor" placeholder="Actor name" value={f.actor} onChange={(e) => set('actor')(e.target.value)} className={inputCls} />
        <input aria-label="Action" placeholder="Action e.g. USER_LOGIN" value={f.action} onChange={(e) => set('action')(e.target.value.toUpperCase())} className={inputCls} />
        <input aria-label="From" type="date" value={f.from} onChange={(e) => set('from')(e.target.value)} className={inputCls} />
        <input aria-label="To" type="date" value={f.to} onChange={(e) => set('to')(e.target.value)} className={inputCls} />
      </Card>
      <Card className="p-0 overflow-hidden">
        {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={reloadWithSpinner} /> : !data?.logs.length ? <EmptyState title="No log entries match" /> : (
          <div className="p-2"><TableWrap><thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Resource</Th><Th>IP</Th><Th /></tr></thead>
            <tbody>{data.logs.map((l) => (<tr key={l.id}><Td className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</Td><Td>{l.actor} <span className="text-xs text-slate-400">({l.actorRole})</span></Td><Td><code className="text-xs">{l.action}</code></Td><Td>{l.resourceType}</Td><Td className="text-xs">{l.ip || '—'}</Td><Td><Button size="sm" variant="ghost" onClick={() => setOpen(l)}>Details</Button></Td></tr>))}</tbody></TableWrap>
            <div className="px-2 pb-2"><Pagination page={page} pageSize={25} total={data.total} onPage={setPage} /></div></div>
        )}
      </Card>
      {open && <Modal open onClose={() => setOpen(null)} title={open.action} wide><dl className="text-sm space-y-1 mb-3"><div><dt className="inline text-slate-500">Actor: </dt><dd className="inline">{open.actor} ({open.actorRole})</dd></div><div><dt className="inline text-slate-500">Resource: </dt><dd className="inline break-all">{open.resourceType} {open.resourceId}</dd></div><div><dt className="inline text-slate-500">Time: </dt><dd className="inline">{fmtDateTime(open.createdAt)}</dd></div></dl><pre className="text-xs bg-slate-50 dark:bg-slate-800 rounded-lg p-3 overflow-auto max-h-80 text-slate-800 dark:text-slate-100">{JSON.stringify(open.metadata, null, 2)}</pre></Modal>}
    </>
  );
};

export const SystemHealth: React.FC = () => {
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<any>('/dashboard/health'), []);
  const [msg, setMsg] = useState('');
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorState message={error ?? 'Failed.'} onRetry={reloadWithSpinner} />;
  const rows: [string, React.ReactNode][] = [
    ['Status', <Badge tone="green">{data.status}</Badge>], ['Environment', data.environment], ['Node.js', data.node], ['Uptime', `${Math.floor(data.uptimeSeconds / 3600)}h ${Math.floor((data.uptimeSeconds % 3600) / 60)}m`],
    ['Memory (RSS)', `${data.memoryMB} MB`], ['Database size', fmtBytes(data.databaseBytes)], ['Uploads on disk', fmtBytes(data.uploadsBytes)], ['Live socket connections', data.realtimeConnections],
    ['Gemini AI', data.ai.configured ? <Badge tone="green">configured · {data.ai.model}</Badge> : <Badge tone="amber">not configured</Badge>],
    ['E-mail (SMTP)', data.email.configured ? <Badge tone="green">configured</Badge> : <Badge tone="amber">not configured - links are shown in the UI / server log</Badge>],
    ['Require e-mail verification', data.requireEmailVerification ? 'yes' : 'no'], ['Last retention run', fmtDateTime(data.lastRetentionRun)],
  ];
  return (
    <>
      <PageHeader title="System health" actions={<Button variant="secondary" onClick={() => reloadWithSpinner()}>Refresh</Button>} />
      <Card className="p-0 mb-5"><dl className="divide-y divide-slate-100 dark:divide-slate-800">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4 px-5 py-3 text-sm"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900 dark:text-white text-right">{v}</dd></div>)}</dl></Card>
      <Card className="p-5"><h2 className="font-semibold text-slate-900 dark:text-white mb-2">Data retention</h2><p className="text-sm text-slate-500 mb-3">Deletes chat messages and notifications older than the windows set in System Settings. Audit logs are never deleted.</p>
        {msg && <div className="mb-3"><Alert tone="success">{msg}</Alert></div>}
        <Button variant="secondary" onClick={async () => { const r = await api.post<{ messagesDeleted: number; notificationsDeleted: number }>('/admin/retention/run'); setMsg(`Removed ${r.messagesDeleted} message(s) and ${r.notificationsDeleted} notification(s).`); reloadWithSpinner(); }}>Run retention now</Button></Card>
    </>
  );
};

export const AdminSettings: React.FC = () => {
  const { toast } = useApp();
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<{ settings: Record<string, any> }>('/admin/settings'), []);
  const [s, setS] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setS({ ...data.settings, 'files.allowedExtensions': (data.settings['files.allowedExtensions'] as string[]).join(', ') }); }, [data]);
  if (loading || !s) return error ? <ErrorState message={error} onRetry={reloadWithSpinner} /> : <Spinner />;
  const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });
  const bool = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.checked });
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...s, 'files.allowedExtensions': String(s['files.allowedExtensions']).split(',').map((x) => x.trim().toLowerCase().replace(/^\./, '')).filter(Boolean) };
      await api.put('/admin/settings', body); toast('Settings saved and recorded in the audit log.', 'success'); reloadWithSpinner();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings.', 'error'); } finally { setBusy(false); }
  };
  const Num: React.FC<{ k: string; label: string; hint?: string }> = ({ k, label, hint }) => <Field label={label} htmlFor={k} hint={hint}><input id={k} type="number" value={s[k]} onChange={num(k)} className={inputCls} /></Field>;
  const Chk: React.FC<{ k: string; label: string }> = ({ k, label }) => <label className="flex items-center gap-3 text-sm text-slate-800 dark:text-slate-100 py-1"><input type="checkbox" checked={!!s[k]} onChange={bool(k)} className="w-4 h-4 accent-blue-900" />{label}</label>;
  return (
    <>
      <PageHeader title="System settings" subtitle="Changes apply immediately and are audit-logged. API keys are configured in the server .env file, never here." actions={<Button loading={busy} onClick={save}>Save settings</Button>} />
      <div className="grid lg:grid-cols-2 gap-5">
        <Card className="p-5 space-y-4"><h2 className="font-semibold text-slate-900 dark:text-white">File sharing</h2>
          <Num k="files.maxSizeMB" label="Max file size (MB)" /><Num k="files.labQuotaMB" label="Storage quota per laboratory (MB)" />
          <Field label="Allowed extensions" htmlFor="ext" hint="Comma-separated. Executables should stay blocked."><textarea id="ext" rows={3} value={s['files.allowedExtensions']} onChange={(e) => setS({ ...s, 'files.allowedExtensions': e.target.value })} className={inputCls} /></Field></Card>
        <Card className="p-5 space-y-4"><h2 className="font-semibold text-slate-900 dark:text-white">AI</h2>
          <Chk k="ai.enabled" label="Enable AI features for everyone" />
          <Field label="Model override" htmlFor="aim" hint="Leave blank to use GEMINI_MODEL from .env."><input id="aim" value={s['ai.model']} onChange={(e) => setS({ ...s, 'ai.model': e.target.value })} className={inputCls} /></Field>
          <Num k="ai.maxRequestsPerUserPerDay" label="Requests per user per day" /><Num k="ai.maxInputChars" label="Max input characters" /><Num k="ai.maxOutputTokens" label="Max output tokens" /></Card>
        <Card className="p-5 space-y-4"><h2 className="font-semibold text-slate-900 dark:text-white">Attendance</h2>
          <Chk k="attendance.requireQrCheckin" label="Require scanning the session QR to check in" /><Chk k="attendance.allowConcurrentLabs" label="Allow checking in to several labs at once" />
          <Num k="attendance.maxSessionMinutes" label="Flag missing check-out after (minutes)" /></Card>
        <Card className="p-5 space-y-4"><h2 className="font-semibold text-slate-900 dark:text-white">Chat & retention</h2>
          <Num k="chat.maxMessageChars" label="Max message length" /><Num k="chat.editWindowMinutes" label="Edit window (minutes)" />
          <Num k="retention.messagesDays" label="Keep chat messages (days)" /><Num k="retention.notificationsDays" label="Keep notifications (days)" /></Card>
      </div>
    </>
  );
};
