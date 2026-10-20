import React, { useState } from 'react';
import { Archive, Building2, KeyRound, LogIn, MapPin, Pencil, Plus, RotateCcw, Users } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Spinner, attendanceTone } from '../ui';
import { AccessCodeModal } from './LabModals';
import { attendanceLabel } from '../../lib/format';
import type { Lab } from '../../types';

export const LaboratoriesView: React.FC = () => {
  const { user, navigate, setModal, toast, dataVersion, bumpData } = useApp();
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [codesFor, setCodesFor] = useState<Lab | null>(null);
  const [confirm, setConfirm] = useState<{ lab: Lab; action: 'archive' | 'reactivate' } | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<{ labs: Lab[] }>(`/labs?status=${tab}`), [tab, dataVersion]);
  const isStaff = user?.role !== 'student';

  const doConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try { await api.post(`/labs/${confirm.lab.id}/${confirm.action}`); toast(`Laboratory ${confirm.action === 'archive' ? 'archived' : 'reactivated'}.`, 'success'); setConfirm(null); bumpData(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Failed.', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Laboratories" subtitle={isStaff ? 'Create and manage your lab rooms.' : 'Labs you have joined.'}
        actions={isStaff ? <Button onClick={() => setModal({ type: 'createLab' })}><Plus className="w-4 h-4" aria-hidden /> Create laboratory</Button> : <Button onClick={() => setModal({ type: 'join' })}><LogIn className="w-4 h-4" aria-hidden /> Join with code</Button>} />
      <div role="tablist" aria-label="Lab status" className="flex gap-1 mb-4">
        {(['active', 'archived'] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium rounded-lg ${tab === t ? 'bg-blue-900 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{t === 'active' ? 'Active' : 'Archived'}</button>)}
      </div>
      {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={reloadWithSpinner} /> : !data?.labs.length ? (
        <Card><EmptyState icon={<Building2 className="w-6 h-6" />} title={tab === 'active' ? 'No laboratories yet' : 'No archived laboratories'} hint={isStaff ? 'Create your first lab to generate access codes and start sessions.' : 'Ask your instructor for an access code, then join your first lab.'}
          action={tab === 'active' ? (isStaff ? <Button onClick={() => setModal({ type: 'createLab' })}>Create laboratory</Button> : <Button onClick={() => setModal({ type: 'join' })}>Join with code</Button>) : undefined} /></Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data.labs.map((lab) => (
            <Card key={lab.id} className="p-5 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h2 className="font-semibold text-slate-900 dark:text-white truncate">{lab.name}</h2><p className="text-xs text-slate-500">{lab.code}{lab.course && ` · ${lab.course}`}</p></div>
                {lab.activeSession ? <Badge tone="green">Session live</Badge> : lab.status === 'archived' ? <Badge>Archived</Badge> : <Badge>Idle</Badge>}
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
                <p className="flex items-center gap-2"><MapPin className="w-4 h-4 shrink-0" aria-hidden />{[lab.building, lab.roomNumber && `Room ${lab.roomNumber}`].filter(Boolean).join(', ') || 'Location not set'}</p>
                <p className="flex items-center gap-2"><Users className="w-4 h-4 shrink-0" aria-hidden />{lab.memberCount}/{lab.capacity} students{lab.activeSession && ` · ${lab.checkedInCount} checked in`}</p>
                {lab.schedule && <p className="text-xs">{lab.schedule}</p>}
                {lab.staff.length > 0 && <p className="text-xs">Staff: {lab.staff.map((s) => s.name).join(', ')}</p>}
                {!isStaff && lab.myAttendance && <Badge tone={attendanceTone(lab.myAttendance.status)}>{attendanceLabel(lab.myAttendance.status)}</Badge>}
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigate('lab_room', { lab: lab.id })}>Open room{lab.unread > 0 && <span className="ml-1 px-1.5 rounded-full bg-red-600 text-white text-[10px]">{lab.unread}</span>}</Button>
                {isStaff && lab.status === 'active' && <Button size="sm" variant="secondary" onClick={() => setCodesFor(lab)}><KeyRound className="w-3.5 h-3.5" aria-hidden /> Codes</Button>}
                {isStaff && <Button size="sm" variant="ghost" aria-label={`Edit ${lab.name}`} onClick={() => setModal({ type: 'editLab', labId: lab.id })}><Pencil className="w-3.5 h-3.5" aria-hidden /></Button>}
                {isStaff && (lab.status === 'active'
                  ? <Button size="sm" variant="ghost" aria-label={`Archive ${lab.name}`} onClick={() => setConfirm({ lab, action: 'archive' })}><Archive className="w-3.5 h-3.5" aria-hidden /></Button>
                  : <Button size="sm" variant="ghost" aria-label={`Reactivate ${lab.name}`} onClick={() => setConfirm({ lab, action: 'reactivate' })}><RotateCcw className="w-3.5 h-3.5" aria-hidden /></Button>)}
              </div>
            </Card>
          ))}
        </div>
      )}
      {codesFor && <AccessCodeModal lab={codesFor} onClose={() => setCodesFor(null)} />}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} loading={busy} danger={confirm?.action === 'archive'} onConfirm={doConfirm}
        title={confirm?.action === 'archive' ? 'Archive laboratory?' : 'Reactivate laboratory?'} confirmLabel={confirm?.action === 'archive' ? 'Archive' : 'Reactivate'}
        message={confirm?.action === 'archive' ? <>Archiving <strong>{confirm.lab.name}</strong> revokes all access codes and stops new sessions, chat and uploads. History is kept.</> : <>Reactivate <strong>{confirm?.lab.name}</strong>? You will need to generate a new access code.</>} />
    </>
  );
};
