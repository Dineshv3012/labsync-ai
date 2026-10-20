import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, LogIn, LogOut, Play, Square, QrCode } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useApp } from '../../context/AppContext';
import { Alert, Badge, Button, Card, ConfirmDialog, Field, Modal, Spinner, TableWrap, Td, Th, attendanceTone, inputCls } from '../ui';
import { attendanceLabel, fmtDateTime, fmtDuration, fmtTime } from '../../lib/format';
import type { Attendance, Lab } from '../../types';

interface Member { id: string; name: string; role: string; online: boolean; studentId?: string }
interface SessionRow { id: string; title: string; status: 'scheduled' | 'active' | 'ended'; scheduledStart: string | null; scheduledEnd: string | null; startAt: string | null; endAt: string | null }

export const CorrectionModal: React.FC<{ rec: Attendance; onClose: () => void; onDone: () => void }> = ({ rec, onClose, onDone }) => {
  const { toast } = useApp();
  const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const [inAt, setInAt] = useState(toLocal(rec.checkInAt));
  const [outAt, setOutAt] = useState(toLocal(rec.checkOutAt));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.post(`/attendance/${rec.id}/correct`, { reason, checkInAt: new Date(inAt).toISOString(), checkOutAt: outAt ? new Date(outAt).toISOString() : null });
      toast('Correction saved and the student was notified.', 'success'); onDone(); onClose();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Correct attendance - ${rec.studentName}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Alert tone="info">Corrections are recorded with your name, the reason and the previous values. The student is notified.</Alert>
        <Field label="Check-in" htmlFor="ci"><input id="ci" type="datetime-local" value={inAt} onChange={(e) => setInAt(e.target.value)} className={inputCls} /></Field>
        <Field label="Check-out" htmlFor="co"><input id="co" type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} className={inputCls} /></Field>
        <Field label="Reason (required)" htmlFor="cr"><textarea id="cr" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy} disabled={reason.trim().length < 5}>Save correction</Button></div>
      </form>
    </Modal>
  );
};

export const SessionPanel: React.FC<{ lab: Lab; canManage: boolean; onChanged: () => void }> = ({ lab, canManage, onChanged }) => {
  const { user, toast, deepLink, clearDeepLink } = useApp();
  const [members, setMembers] = useState<Member[]>([]);
  const [roster, setRoster] = useState<Attendance[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [qr, setQr] = useState<{ dataUrl: string; url: string } | null>(null);
  const [title, setTitle] = useState('');
  const [sched, setSched] = useState({ title: '', start: '', end: '' });
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [correct, setCorrect] = useState<Attendance | null>(null);
  const active = lab.activeSession;

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api.get<{ sessions: SessionRow[] }>(`/labs/${lab.id}/sessions`), api.get<{ members: Member[] }>(`/labs/${lab.id}/members`)]);
      setSessions(s.sessions); setMembers(m.members);
      if (active) {
        const a = await api.get<{ records: Attendance[] }>(`/attendance${qs({ labId: lab.id, sessionId: active.id, pageSize: 100 })}`);
        setRoster(a.records);
      } else setRoster([]);
    } catch { /* surfaced by empty state */ } finally { setLoading(false); }
  }, [lab.id, active?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const h = () => { void load(); };
    s.on('attendance:update', h); s.on('member:joined', h); s.on('presence:update', h);
    return () => { s.off('attendance:update', h); s.off('member:joined', h); s.off('presence:update', h); };
  }, [load]);

  const mine = roster.find((r) => r.studentId === user?.id) ?? null;
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok, 'success'); onChanged(); await load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Action failed.', 'error'); }
    finally { setBusy(''); }
  };

  // QR check-in deep link: /?checkin=<labId>.<token>
  useEffect(() => {
    if (!deepLink.checkin || user?.role !== 'student') return;
    const [labId, token] = deepLink.checkin.split('.');
    if (labId !== lab.id) return;
    clearDeepLink();
    void act('in', () => api.post('/attendance/check-in', { labId: lab.id, qrToken: token }), 'Checked in with QR.');
  }, [deepLink.checkin, lab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner />;
  const rosterByStudent = new Map(roster.map((r) => [r.studentId, r]));
  const students = members.filter((m) => m.role === 'student');
  const scheduled = sessions.filter((s) => s.status === 'scheduled');

  return (
    <div className="space-y-5">
      {user?.role === 'student' && (
        <Card className="p-5">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Your attendance</h3>
          {!active ? <p className="text-sm text-slate-500">No session is running right now. You can check in once your instructor starts one.</p> : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Badge tone={attendanceTone(mine?.status)}>{attendanceLabel(mine?.status)}</Badge>
                <p className="text-sm text-slate-500 mt-2">{mine ? `Checked in ${fmtTime(mine.checkInAt)}${mine.checkOutAt ? ` · out ${fmtTime(mine.checkOutAt)} (${fmtDuration(mine.durationMinutes)})` : ''}` : `Session started ${fmtTime(active.startAt)}.`}</p>
                {mine?.status === 'missing_checkout' && <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">Your check-out is missing. Ask staff to verify your attendance.</p>}
              </div>
              {!mine && <Button loading={busy === 'in'} onClick={() => act('in', () => api.post('/attendance/check-in', { labId: lab.id }), 'Checked in.')}><LogIn className="w-4 h-4" aria-hidden /> Check in</Button>}
              {mine?.status === 'checked_in' && <Button variant="secondary" loading={busy === 'out'} onClick={() => act('out', () => api.post('/attendance/check-out', { labId: lab.id }), 'Checked out.')}><LogOut className="w-4 h-4" aria-hidden /> Check out</Button>}
              {mine && mine.status !== 'checked_in' && <span className="flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="w-4 h-4" aria-hidden /> Recorded</span>}
            </div>
          )}
        </Card>
      )}

      {canManage && (
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="font-semibold text-slate-900 dark:text-white">Session control</h3><p className="text-sm text-slate-500">{active ? `Live since ${fmtDateTime(active.startAt)}${active.title ? ` · ${active.title}` : ''}` : 'No active session.'}</p></div>
            {active && <Button variant="danger" onClick={() => setConfirmEnd(true)}><Square className="w-4 h-4" aria-hidden /> End session</Button>}
          </div>
          {!active && lab.status === 'active' && (
            <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
              <Field label="Session title (optional)" htmlFor="st"><input id="st" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Week 5 - Linked lists" className={inputCls} /></Field>
              <Button loading={busy === 'start'} onClick={() => act('start', async () => { const r = await api.post<{ qrDataUrl: string; checkinUrl: string }>(`/labs/${lab.id}/sessions/start`, { title }); setQr({ dataUrl: r.qrDataUrl, url: r.checkinUrl }); setTitle(''); }, 'Session started. Students were notified.')}><Play className="w-4 h-4" aria-hidden /> Start session</Button>
            </div>
          )}
          {active && qr && (
            <div className="flex items-center gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
              <img src={qr.dataUrl} alt="QR code for session check-in" className="w-28 h-28 bg-white p-1.5 rounded" />
              <div className="text-sm text-slate-600 dark:text-slate-300"><p className="font-medium flex items-center gap-1"><QrCode className="w-4 h-4" aria-hidden /> Session check-in QR</p><p className="text-xs mt-1">Show this on the projector. It is valid only while this session is active and is displayed once, at start.</p></div>
            </div>
          )}
          {lab.status === 'active' && (
            <details className="text-sm"><summary className="cursor-pointer font-medium text-blue-800 dark:text-cyan-400 flex items-center gap-1"><CalendarClock className="w-4 h-4 inline" aria-hidden /> Schedule a future session</summary>
              <div className="grid sm:grid-cols-4 gap-3 items-end mt-3">
                <Field label="Title" htmlFor="sct"><input id="sct" value={sched.title} onChange={(e) => setSched({ ...sched, title: e.target.value })} className={inputCls} /></Field>
                <Field label="Starts" htmlFor="scs"><input id="scs" type="datetime-local" value={sched.start} onChange={(e) => setSched({ ...sched, start: e.target.value })} className={inputCls} /></Field>
                <Field label="Ends" htmlFor="sce"><input id="sce" type="datetime-local" value={sched.end} onChange={(e) => setSched({ ...sched, end: e.target.value })} className={inputCls} /></Field>
                <Button disabled={!sched.start || !sched.end} loading={busy === 'sched'} onClick={() => act('sched', () => api.post(`/labs/${lab.id}/sessions/schedule`, { title: sched.title, scheduledStart: new Date(sched.start).toISOString(), scheduledEnd: new Date(sched.end).toISOString() }), 'Session scheduled.')}>Schedule</Button>
              </div>
            </details>
          )}
          {scheduled.length > 0 && !active && (
            <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-800">{scheduled.map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between gap-2"><span>{s.title || 'Session'} · {fmtDateTime(s.scheduledStart)}</span>
                <Button size="sm" variant="secondary" onClick={() => act('go' + s.id, async () => { const r = await api.post<{ qrDataUrl: string; checkinUrl: string }>(`/labs/${lab.id}/sessions/start`, { sessionId: s.id }); setQr({ dataUrl: r.qrDataUrl, url: r.checkinUrl }); }, 'Session started.')}>Start now</Button></li>))}
            </ul>
          )}
        </Card>
      )}

      {canManage && active && (
        <Card className="p-0 overflow-hidden">
          <div className="p-4 flex items-center justify-between"><h3 className="font-semibold text-slate-900 dark:text-white">Live roster</h3><span className="text-xs text-slate-500">{roster.length} recorded of {students.length} students</span></div>
          <TableWrap>
            <thead><tr><Th>Student</Th><Th>Status</Th><Th>In</Th><Th>Out</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {students.length === 0 && <tr><Td colSpan={5} className="text-center text-slate-500">No students have joined yet. Share an access code from the Laboratories page.</Td></tr>}
              {students.map((s) => {
                const r = rosterByStudent.get(s.id);
                return (
                  <tr key={s.id}>
                    <Td><span className={`inline-block w-2 h-2 rounded-full mr-2 ${s.online ? 'bg-emerald-500' : 'bg-slate-300'}`} title={s.online ? 'Online in room' : 'Offline'} />{s.name}<span className="block text-xs text-slate-400">{s.studentId}</span></Td>
                    <Td><Badge tone={attendanceTone(r?.status)}>{attendanceLabel(r?.status)}</Badge>{r && r.verificationStatus !== 'verified' && <span className="block text-[11px] text-slate-400 mt-0.5">{r.verificationStatus === 'corrected' ? 'Corrected' : 'Unverified'}</span>}</Td>
                    <Td>{r ? fmtTime(r.checkInAt) : '—'}</Td><Td>{r?.checkOutAt ? fmtTime(r.checkOutAt) : '—'}</Td>
                    <Td className="text-right whitespace-nowrap">
                      {!r && <Button size="sm" variant="secondary" onClick={() => act('s' + s.id, () => api.post('/attendance/staff-record', { labId: lab.id, studentId: s.id, action: 'check_in' }), `${s.name} checked in.`)}>Check in</Button>}
                      {r?.status === 'checked_in' && <Button size="sm" variant="secondary" onClick={() => act('s' + s.id, () => api.post('/attendance/staff-record', { labId: lab.id, studentId: s.id, action: 'check_out' }), `${s.name} checked out.`)}>Check out</Button>}
                      {r && r.status !== 'checked_in' && r.verificationStatus === 'pending' && r.status !== 'missing_checkout' && <Button size="sm" variant="ghost" onClick={() => act('v' + r.id, () => api.post(`/attendance/${r.id}/verify`), 'Verified.')}>Verify</Button>}
                      {r && <Button size="sm" variant="ghost" onClick={() => setCorrect(r)}>Correct</Button>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}
      <ConfirmDialog open={confirmEnd} onClose={() => setConfirmEnd(false)} danger confirmLabel="End session" title="End this session?" loading={busy === 'end'}
        message="Students who have not checked out will be flagged as ‘missing check-out’ for you to verify. No check-out time is invented."
        onConfirm={() => act('end', () => api.post(`/labs/${lab.id}/sessions/${active!.id}/end`), 'Session ended.').then(() => setConfirmEnd(false))} />
      {correct && <CorrectionModal rec={correct} onClose={() => setCorrect(null)} onDone={() => void load()} />}
    </div>
  );
};
