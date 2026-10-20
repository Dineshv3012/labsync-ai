import React, { useEffect, useState } from 'react';
import { Copy, QrCode, Ban } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { Alert, Button, Field, Modal, Spinner, inputCls } from '../ui';
import { fmtDateTime } from '../../lib/format';
import type { Lab } from '../../types';

export const JoinLabModal: React.FC<{ code?: string }> = ({ code: initial }) => {
  const { setModal, toast, navigate, bumpData } = useApp();
  const [code, setCode] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api.post<{ labId: string; labName: string; alreadyMember?: boolean }>('/labs/join', { code });
      toast(r.alreadyMember ? `You are already a member of ${r.labName}.` : `Joined ${r.labName}.`, 'success');
      setModal(null); bumpData(); navigate('lab_room', { lab: r.labId });
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not join.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={() => setModal(null)} title="Join a laboratory">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Room access code" htmlFor="jcode" hint="Ask your instructor for the 8-character code or scan their QR.">
          <input id="jcode" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} autoComplete="off" placeholder="ABCD-EFGH" className={`${inputCls} font-mono tracking-widest text-center text-lg`} />
        </Field>
        <Button type="submit" loading={busy} disabled={code.replace(/[^A-Z0-9]/gi, '').length < 4} className="w-full">Join laboratory</Button>
      </form>
    </Modal>
  );
};

const emptyForm = { name: '', code: '', course: '', building: '', roomNumber: '', capacity: 30, schedule: '', description: '', startsOn: '', endsOn: '', assignedStaffIds: [] as string[] };

export const LabFormModal: React.FC<{ labId?: string }> = ({ labId }) => {
  const { user, setModal, toast, bumpData } = useApp();
  const [f, setF] = useState(emptyForm);
  const [loading, setLoading] = useState(!!labId);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (user?.role === 'admin') api.get<{ staff: { id: string; name: string }[] }>('/admin/staff').then((r) => setStaff(r.staff)).catch(() => {});
    if (labId) {
      api.get<{ lab: Lab }>(`/labs/${labId}`).then(({ lab }) => {
        setF({ name: lab.name, code: lab.code, course: lab.course, building: lab.building, roomNumber: lab.roomNumber, capacity: lab.capacity, schedule: lab.schedule, description: lab.description, startsOn: lab.startsOn ?? '', endsOn: lab.endsOn ?? '', assignedStaffIds: lab.staff.map((s) => s.id) });
      }).catch((e) => setError(e.message)).finally(() => setLoading(false));
    }
  }, [labId, user?.role]);
  const set = (k: keyof typeof emptyForm, v: string | number | string[]) => setF((p) => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    const body: Record<string, unknown> = { ...f, capacity: Number(f.capacity), startsOn: f.startsOn || null, endsOn: f.endsOn || null };
    if (user?.role !== 'admin') delete body.assignedStaffIds;
    try {
      if (labId) await api.patch(`/labs/${labId}`, body); else await api.post('/labs', body);
      toast(labId ? 'Laboratory updated.' : 'Laboratory created.', 'success');
      setModal(null); bumpData();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={() => setModal(null)} title={labId ? 'Edit laboratory' : 'Create laboratory'} wide>
      {loading ? <Spinner /> : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Name" htmlFor="ln"><input id="ln" required value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} /></Field>
            <Field label="Lab code" htmlFor="lc" hint="Short unique id, e.g. CS-LAB-01"><input id="lc" required value={f.code} onChange={(e) => set('code', e.target.value)} className={inputCls} /></Field>
            <Field label="Course" htmlFor="lcourse"><input id="lcourse" value={f.course} onChange={(e) => set('course', e.target.value)} className={inputCls} /></Field>
            <Field label="Capacity" htmlFor="lcap"><input id="lcap" type="number" min={1} max={500} required value={f.capacity} onChange={(e) => set('capacity', e.target.value)} className={inputCls} /></Field>
            <Field label="Building" htmlFor="lb"><input id="lb" value={f.building} onChange={(e) => set('building', e.target.value)} className={inputCls} /></Field>
            <Field label="Room number" htmlFor="lr"><input id="lr" value={f.roomNumber} onChange={(e) => set('roomNumber', e.target.value)} className={inputCls} /></Field>
            <Field label="Starts on" htmlFor="ls"><input id="ls" type="date" value={f.startsOn} onChange={(e) => set('startsOn', e.target.value)} className={inputCls} /></Field>
            <Field label="Ends on" htmlFor="le"><input id="le" type="date" value={f.endsOn} onChange={(e) => set('endsOn', e.target.value)} className={inputCls} /></Field>
          </div>
          <Field label="Schedule" htmlFor="lsch"><input id="lsch" placeholder="Mon & Wed, 10:00–12:00" value={f.schedule} onChange={(e) => set('schedule', e.target.value)} className={inputCls} /></Field>
          <Field label="Description" htmlFor="ld"><textarea id="ld" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} className={inputCls} /></Field>
          {user?.role === 'admin' && (
            <Field label="Assigned staff" htmlFor="lstaff" hint="Hold Ctrl/Cmd to select several.">
              <select id="lstaff" multiple value={f.assignedStaffIds} onChange={(e) => set('assignedStaffIds', Array.from(e.target.selectedOptions, (o) => o.value))} className={`${inputCls} h-28`}>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" loading={busy}>{labId ? 'Save changes' : 'Create laboratory'}</Button></div>
        </form>
      )}
    </Modal>
  );
};

interface CodeRow { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; usageLimit: number | null; usageCount: number; createdBy: string }

/** Create / list / revoke access codes. The plaintext code exists only in this component's state right after creation. */
export const AccessCodeModal: React.FC<{ lab: Lab; onClose: () => void }> = ({ lab, onClose }) => {
  const { toast } = useApp();
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [fresh, setFresh] = useState<{ code: string; expiresAt: string; qrDataUrl: string; joinUrl: string } | null>(null);
  const [minutes, setMinutes] = useState(180);
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get<{ codes: CodeRow[] }>(`/labs/${lab.id}/codes`).then((r) => setCodes(r.codes)).catch(() => {});
  useEffect(() => { void load(); }, [lab.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ code: string; expiresAt: string; qrDataUrl: string; joinUrl: string }>(`/labs/${lab.id}/codes`, { expiresInMinutes: Number(minutes), usageLimit: limit ? Number(limit) : null });
      setFresh(r); void load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not create code.', 'error'); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => { try { await api.post(`/labs/${lab.id}/codes/${id}/revoke`); toast('Code revoked.', 'success'); void load(); } catch (e) { toast((e as Error).message, 'error'); } };
  const revokeAll = async () => { try { const r = await api.post<{ revoked: number }>(`/labs/${lab.id}/codes-revoke-all`); setFresh(null); toast(`${r.revoked} code(s) revoked.`, 'success'); void load(); } catch (e) { toast((e as Error).message, 'error'); } };
  const active = codes.filter((c) => !c.revokedAt && c.expiresAt > new Date().toISOString());
  return (
    <Modal open onClose={onClose} title={`Access codes - ${lab.name}`} wide>
      <div className="space-y-5">
        {fresh && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-center">
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">New code - shown only once. Share it with students now.</p>
            <p className="font-mono text-3xl font-bold tracking-[0.25em] text-slate-900 dark:text-white my-2" aria-label={`Access code ${fresh.code.split('').join(' ')}`}>{fresh.code}</p>
            <img src={fresh.qrDataUrl} alt="QR code that opens the join dialog with this code" className="mx-auto w-40 h-40 bg-white p-2 rounded-lg" />
            <p className="text-xs text-slate-500 mt-2">Expires {fmtDateTime(fresh.expiresAt)}</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => { void navigator.clipboard.writeText(fresh.code); toast('Code copied.', 'success'); }}><Copy className="w-3.5 h-3.5" aria-hidden /> Copy code</Button>
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <Field label="Valid for" htmlFor="cm"><select id="cm" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={inputCls}>{[[30, '30 minutes'], [60, '1 hour'], [180, '3 hours'], [1440, '1 day'], [10080, '7 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Max uses (optional)" htmlFor="cl"><input id="cl" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} className={inputCls} placeholder="Unlimited" /></Field>
          <Button onClick={create} loading={busy}><QrCode className="w-4 h-4" aria-hidden /> Generate code</Button>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-semibold text-slate-900 dark:text-white">Recent codes ({active.length} active)</h3>{active.length > 0 && <Button variant="danger" size="sm" onClick={revokeAll}><Ban className="w-3.5 h-3.5" aria-hidden /> Revoke all</Button>}</div>
          <p className="text-xs text-slate-500 mb-2">For security, only a hash of each code is stored, so past codes cannot be shown again.</p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {codes.length === 0 && <li className="py-3 text-slate-500">No codes yet.</li>}
            {codes.map((c) => {
              const state = c.revokedAt ? 'Revoked' : c.expiresAt < new Date().toISOString() ? 'Expired' : 'Active';
              return (
                <li key={c.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="text-slate-800 dark:text-slate-100">{state} · used {c.usageCount}{c.usageLimit ? `/${c.usageLimit}` : ''}</p><p className="text-xs text-slate-500">By {c.createdBy} · expires {fmtDateTime(c.expiresAt)}</p></div>
                  {state === 'Active' && <Button variant="secondary" size="sm" onClick={() => revoke(c.id)}>Revoke</Button>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Modal>
  );
};
