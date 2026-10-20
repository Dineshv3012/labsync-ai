import React, { useState } from 'react';
import { CalendarCheck, History } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, PageHeader, Pagination, Spinner, TableWrap, Td, Th, attendanceTone, inputCls } from '../ui';
import { attendanceLabel, fmtDateTime, fmtDuration } from '../../lib/format';
import { CorrectionModal } from '../labs/SessionPanel';
import type { Attendance, Lab } from '../../types';

const History_: React.FC<{ rec: Attendance; onClose: () => void }> = ({ rec, onClose }) => {
  const { data, loading } = useAsync(() => api.get<{ corrections: { id: string; editor: string; reason: string; previous: any; next: any; createdAt: string }[] }>(`/attendance/${rec.id}/corrections`), [rec.id]);
  return (
    <Modal open onClose={onClose} title="Correction history">
      {loading ? <Spinner /> : !data?.corrections.length ? <p className="text-sm text-slate-500">This record has never been corrected.</p> : (
        <ul className="space-y-3 text-sm">{data.corrections.map((c) => (
          <li key={c.id} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800">
            <p className="font-medium text-slate-900 dark:text-white">{c.editor} · {fmtDateTime(c.createdAt)}</p><p className="text-slate-600 dark:text-slate-300">Reason: {c.reason}</p>
            <p className="text-xs text-slate-500 mt-1">Before: in {fmtDateTime(c.previous.checkInAt)}, out {fmtDateTime(c.previous.checkOutAt)} → After: in {fmtDateTime(c.next.checkInAt)}, out {fmtDateTime(c.next.checkOutAt)}</p>
          </li>))}
        </ul>
      )}
    </Modal>
  );
};

export const AttendanceView: React.FC = () => {
  const { user, dataVersion } = useApp();
  const isStaff = user?.role !== 'student';
  const [f, setF] = useState({ labId: '', status: '', verification: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [ver, setVer] = useState(0);
  const [hist, setHist] = useState<Attendance | null>(null);
  const [fix, setFix] = useState<Attendance | null>(null);
  const labs = useAsync(() => api.get<{ labs: Lab[] }>('/labs'), []);
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<{ records: Attendance[]; total: number }>(`/attendance${qs({ ...f, page, pageSize: 15 })}`), [f, page, ver, dataVersion]);
  const set = (k: keyof typeof f) => (v: string) => { setF((p) => ({ ...p, [k]: v })); setPage(1); };

  return (
    <>
      <PageHeader title={isStaff ? 'Attendance records' : 'My attendance'} subtitle={isStaff ? 'Review, verify and correct attendance for your laboratories.' : 'Your check-ins and check-outs, recorded with server time.'} />
      <Card className="p-4 mb-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <select aria-label="Laboratory" value={f.labId} onChange={(e) => set('labId')(e.target.value)} className={inputCls}><option value="">All laboratories</option>{labs.data?.labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <select aria-label="Status" value={f.status} onChange={(e) => set('status')(e.target.value)} className={inputCls}><option value="">Any status</option><option value="checked_in">Checked in</option><option value="checked_out">Checked out</option><option value="missing_checkout">Missing check-out</option></select>
        <select aria-label="Verification" value={f.verification} onChange={(e) => set('verification')(e.target.value)} className={inputCls}><option value="">Any verification</option><option value="pending">Pending</option><option value="verified">Verified</option><option value="corrected">Corrected</option></select>
        <input aria-label="From date" type="date" value={f.from} onChange={(e) => set('from')(e.target.value)} className={inputCls} />
        <input aria-label="To date" type="date" value={f.to} onChange={(e) => set('to')(e.target.value)} className={inputCls} />
      </Card>
      <Card className="p-0 overflow-hidden">
        {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={reloadWithSpinner} /> : !data?.records.length ? <EmptyState icon={<CalendarCheck className="w-6 h-6" />} title="No attendance records" hint="Records appear here after you check in to a live session." /> : (
          <div className="p-2">
            <TableWrap>
              <thead><tr>{isStaff && <Th>Student</Th>}<Th>Laboratory</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Duration</Th><Th>Status</Th><Th>Verification</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>{data.records.map((r) => (
                <tr key={r.id}>
                  {isStaff && <Td>{r.studentName}<span className="block text-xs text-slate-400">{r.studentNumber}</span></Td>}
                  <Td>{r.labName}</Td><Td>{fmtDateTime(r.checkInAt)}</Td><Td>{fmtDateTime(r.checkOutAt)}</Td><Td>{r.checkOutAt ? fmtDuration(r.durationMinutes) : '—'}</Td>
                  <Td><Badge tone={attendanceTone(r.status)}>{attendanceLabel(r.status)}</Badge></Td>
                  <Td><Badge tone={r.verificationStatus === 'verified' ? 'green' : r.verificationStatus === 'corrected' ? 'blue' : 'slate'}>{r.verificationStatus}</Badge></Td>
                  <Td className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" aria-label="Correction history" onClick={() => setHist(r)}><History className="w-4 h-4" aria-hidden /></Button>
                    {isStaff && r.status !== 'checked_in' && r.verificationStatus === 'pending' && r.status !== 'missing_checkout' && <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/attendance/${r.id}/verify`); setVer((v) => v + 1); }}>Verify</Button>}
                    {isStaff && <Button size="sm" variant="ghost" onClick={() => setFix(r)}>Correct</Button>}
                  </Td>
                </tr>))}
              </tbody>
            </TableWrap>
            <div className="px-2 pb-2"><Pagination page={page} pageSize={15} total={data.total} onPage={setPage} /></div>
          </div>
        )}
      </Card>
      {hist && <History_ rec={hist} onClose={() => setHist(null)} />}
      {fix && <CorrectionModal rec={fix} onClose={() => setFix(null)} onDone={() => setVer((v) => v + 1)} />}
    </>
  );
};
