import React, { useState } from 'react';
import { Bot, ShieldAlert, Cpu } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, Spinner, inputCls, severityTone } from '../ui';
import { fmtDateTime } from '../../lib/format';
import type { Alert as AlertT } from '../../types';

const LABELS: Record<string, string> = {
  repeated_failed_codes: 'Repeated failed codes', missing_checkout: 'Missing check-out', unexpected_file_type: 'Rejected file', duplicate_upload: 'Duplicate upload',
  capacity_reached: 'Capacity reached', file_reported: 'File reported',
};

export const AlertsView: React.FC = () => {
  const { toast, navigate } = useApp();
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<AlertT | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const { data, loading, error, reloadWithSpinner, reload } = useAsync(() => api.get<{ alerts: AlertT[]; total: number }>(`/alerts${qs({ status, severity, page })}`), [status, severity, page]);
  const decide = async (decision: 'reviewing' | 'resolved' | 'dismissed') => {
    if (!sel) return;
    setBusy(decision); setErr('');
    try { await api.post(`/alerts/${sel.id}/review`, { decision, notes }); toast('Review saved.', 'success'); setSel(null); setNotes(''); void reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save.'); } finally { setBusy(''); }
  };
  return (
    <>
      <PageHeader title="Alerts & incident review" subtitle="Rule-based and AI-suggested signals for staff review. Alerts never change attendance or accounts automatically." />
      <Card className="p-4 mb-4 flex flex-wrap gap-3">
        <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} !w-auto`}><option value="">Any status</option><option value="open">Open</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select>
        <select aria-label="Severity" value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} className={`${inputCls} !w-auto`}><option value="">Any severity</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      </Card>
      {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={reloadWithSpinner} /> : !data?.alerts.length ? <Card><EmptyState icon={<ShieldAlert className="w-6 h-6" />} title="No alerts" hint="Nothing needs review with these filters." /></Card> : (
        <div className="space-y-3">
          {data.alerts.map((a) => (
            <Card key={a.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={severityTone(a.severity)}>{a.severity}</Badge><Badge tone={a.detectionMethod === 'ai' ? 'blue' : 'slate'} className="gap-1">{a.detectionMethod === 'ai' ? <Bot className="w-3 h-3" aria-hidden /> : <Cpu className="w-3 h-3" aria-hidden />}{a.detectionMethod === 'ai' ? 'AI-suggested' : 'Rule-based'}</Badge><Badge>{LABELS[a.type] ?? a.type}</Badge><Badge tone={a.status === 'open' ? 'amber' : a.status === 'resolved' ? 'green' : 'slate'}>{a.status}</Badge></div>
                <p className="font-medium text-slate-900 dark:text-white mt-2">{a.title}</p>
                <p className="text-xs text-slate-500">{a.labName ?? 'System'} · {fmtDateTime(a.createdAt)}</p>
                {a.review && <p className="text-xs text-slate-500 mt-1">Reviewed by {a.review.reviewer}: “{a.review.notes || a.review.decision}”</p>}
              </div>
              <div className="flex gap-2">{a.labId && <Button size="sm" variant="ghost" onClick={() => navigate('lab_room', { lab: a.labId! })}>Open lab</Button>}<Button size="sm" variant="secondary" onClick={() => { setSel(a); setNotes(''); setErr(''); }}>Review</Button></div>
            </Card>
          ))}
          <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
        </div>
      )}
      {sel && (
        <Modal open onClose={() => setSel(null)} title="Review alert" wide>
          <div className="space-y-4">
            {err && <Alert tone="error">{err}</Alert>}
            <div><Badge tone={severityTone(sel.severity)}>{sel.severity}</Badge><p className="font-medium text-slate-900 dark:text-white mt-2">{sel.title}</p></div>
            <div><p className="text-xs font-semibold uppercase text-slate-400 mb-1">Evidence</p><pre className="text-xs bg-slate-50 dark:bg-slate-800 rounded-lg p-3 overflow-auto max-h-48 text-slate-700 dark:text-slate-200">{JSON.stringify(sel.evidence, null, 2)}</pre></div>
            <Field label="Review notes" htmlFor="rn" hint="Required when resolving or dismissing."><textarea id="rn" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} /></Field>
            <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" loading={busy === 'reviewing'} onClick={() => decide('reviewing')}>Mark reviewing</Button><Button variant="secondary" loading={busy === 'dismissed'} disabled={notes.trim().length < 3} onClick={() => decide('dismissed')}>Dismiss (false alarm)</Button><Button loading={busy === 'resolved'} disabled={notes.trim().length < 3} onClick={() => decide('resolved')}>Resolve</Button></div>
          </div>
        </Modal>
      )}
    </>
  );
};
