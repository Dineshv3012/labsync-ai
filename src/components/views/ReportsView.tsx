import React, { useState } from 'react';
import { BarChart3, Download, Printer } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, TableWrap, Td, Th, inputCls } from '../ui';
import type { Lab } from '../../types';

const TYPES: [string, string][] = [
  ['attendance-daily', 'Attendance - daily'], ['attendance-weekly', 'Attendance - weekly'], ['attendance-monthly', 'Attendance - monthly'], ['attendance-semester', 'Attendance - semester'],
  ['lab-usage', 'Laboratory usage'], ['session-duration', 'Session duration'], ['room-occupancy', 'Room occupancy'], ['file-activity', 'File-sharing activity'],
  ['security-events', 'Security events'], ['alert-reviews', 'Alert reviews'],
];
interface Rep { title: string; columns: string[]; rows: Record<string, unknown>[]; chart?: { x: string; y: string }; generatedAt: string }

export const ReportsView: React.FC = () => {
  const { toast } = useApp();
  const [type, setType] = useState('attendance-daily');
  const [labId, setLabId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const labs = useAsync(() => api.get<{ labs: Lab[] }>('/labs'), []);
  const query = { labId, from, to, status: type.startsWith('attendance') ? status : '' };
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<Rep>(`/reports/${type}${qs(query)}`), [type, labId, from, to, status]);

  const csv = async () => {
    const res = await fetch(`/api/reports/${type}${qs({ ...query, format: 'csv' })}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'LabSync' } });
    if (!res.ok) { toast('Could not export the report.', 'error'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `labsync-${type}.csv` }).click();
    URL.revokeObjectURL(url);
  };
  const chartRows = data?.chart ? [...data.rows].slice(0, 30).reverse().map((r) => ({ x: String(r[data.chart!.x] ?? '').slice(0, 16), y: Number(r[data.chart!.y] ?? 0) })) : [];

  return (
    <>
      <PageHeader title="Reports" subtitle="Scoped to the laboratories you manage. Defaults to the last 30 days." actions={<><Button variant="secondary" onClick={() => window.print()}><Printer className="w-4 h-4" aria-hidden /> Print</Button><Button onClick={csv}><Download className="w-4 h-4" aria-hidden /> Export CSV</Button></>} />
      <Card className="p-4 mb-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3 no-print">
        <select aria-label="Report type" value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select aria-label="Laboratory" value={labId} onChange={(e) => setLabId(e.target.value)} className={inputCls}><option value="">All my laboratories</option>{labs.data?.labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        <input aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        <select aria-label="Attendance status" value={status} disabled={!type.startsWith('attendance')} onChange={(e) => setStatus(e.target.value)} className={inputCls}><option value="">Any status</option><option value="checked_out">Checked out</option><option value="missing_checkout">Missing check-out</option><option value="checked_in">Checked in</option></select>
      </Card>
      {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={reloadWithSpinner} /> : !data?.rows.length ? <Card><EmptyState icon={<BarChart3 className="w-6 h-6" />} title="No data for these filters" hint="Try a wider date range or a different laboratory." /></Card> : (
        <div className="space-y-4">
          {data.chart && chartRows.length > 1 && (
            <Card className="p-4"><h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 capitalize">{data.title}</h2>
              <div className="h-64" role="img" aria-label={`Bar chart of ${data.chart.y} by ${data.chart.x}`}><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows}><CartesianGrid strokeDasharray="3 3" stroke="#94a3b833" /><XAxis dataKey="x" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Bar dataKey="y" name={data.chart.y} fill="#1e3a8a" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
            </Card>
          )}
          <Card className="p-2"><TableWrap><thead><tr>{data.columns.map((c) => <Th key={c}>{c.replace(/([A-Z])/g, ' $1')}</Th>)}</tr></thead>
            <tbody>{data.rows.slice(0, 200).map((r, i) => <tr key={i}>{data.columns.map((c) => <Td key={c} className="max-w-64 truncate">{String(r[c] ?? '—')}</Td>)}</tr>)}</tbody></TableWrap>
            <p className="px-3 py-2 text-xs text-slate-500">{data.rows.length} row(s){data.rows.length > 200 ? ' (first 200 shown - export CSV for all)' : ''} · generated {new Date(data.generatedAt).toLocaleString()}</p></Card>
        </div>
      )}
    </>
  );
};
