import React, { useEffect, useRef, useState } from 'react';
import { Bot, FileQuestion, Send, Sparkles, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader, Spinner, inputCls } from '../ui';
import type { AiSource, Lab, LabFile } from '../../types';

interface AiStatus { configured: boolean; enabled: boolean; optedIn: boolean; model: string | null; usedToday: number; dailyLimit: number }
interface Turn { role: 'user' | 'assistant'; content: string; sources?: AiSource[]; error?: boolean }

const StatusBanner: React.FC<{ s: AiStatus | null }> = ({ s }) => {
  const { navigate } = useApp();
  if (!s) return null;
  if (!s.enabled) return <Alert tone="warn">AI features are turned off by your administrator.</Alert>;
  if (!s.configured) return <Alert tone="warn">AI is not configured on this server yet (no Gemini API key). Chat summaries still work in a basic, rule-based form.</Alert>;
  if (!s.optedIn) return <Alert tone="info">AI assistance is off for your account. <button onClick={() => navigate('settings')} className="underline">Turn it on in Settings</button>.</Alert>;
  return <p className="text-xs text-slate-500">Model {s.model} · {s.usedToday}/{s.dailyLimit} requests used today. AI can make mistakes - check important answers.</p>;
};

const Sources: React.FC<{ sources?: AiSource[] }> = ({ sources }) => sources?.length ? (
  <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">{sources.map((s, i) => <Badge key={i} tone="blue">{s.name} · {s.section}</Badge>)}</div>
) : null;

export const AiPanel: React.FC<{ lab: Lab; canManage: boolean }> = ({ lab, canManage }) => {
  const { toast } = useApp();
  const status = useAsync(() => api.get<AiStatus>('/ai/status'), []);
  const files = useAsync(() => api.get<{ files: LabFile[] }>(`/files?labId=${lab.id}&pageSize=100`), [lab.id]);
  const [question, setQuestion] = useState('');
  const [fileId, setFileId] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; sources: AiSource[]; grounded: boolean } | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [insights, setInsights] = useState<string | null>(null);
  const [qs_, setQs] = useState<{ question: string; answer: string }[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setErr(''); try { await fn(); status.reload(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'AI request failed.'); } finally { setBusy(''); } };
  const indexed = files.data?.files.filter((f) => f.indexed) ?? [];

  return (
    <div className="space-y-4">
      <StatusBanner s={status.data} />
      {err && <Alert tone="error">{err}</Alert>}
      <Card className="p-5">
        <h3 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2"><FileQuestion className="w-4 h-4" aria-hidden /> Ask about lab documents</h3>
        <p className="text-xs text-slate-500 mb-3">Answers use only documents you can open in this lab ({indexed.length} readable).</p>
        <div className="grid sm:grid-cols-[1fr_14rem_auto] gap-3 items-end">
          <Field label="Question" htmlFor="aq"><input id="aq" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What is the base case in the recursion notes?" className={inputCls} /></Field>
          <Field label="Document" htmlFor="af"><select id="af" value={fileId} onChange={(e) => setFileId(e.target.value)} className={inputCls}><option value="">All readable documents</option>{indexed.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
          <Button loading={busy === 'q'} disabled={question.trim().length < 3} onClick={() => run('q', async () => setAnswer(await api.post('/ai/document-question', { labId: lab.id, question, fileId: fileId || undefined })))}>Ask</Button>
        </div>
        {answer && (
          <div className="mt-4 p-4 rounded-lg bg-slate-50 dark:bg-slate-800 text-sm whitespace-pre-wrap text-slate-800 dark:text-slate-100">
            <Badge tone={answer.grounded ? 'blue' : 'amber'}>{answer.grounded ? 'AI-generated from documents' : 'No supporting documents'}</Badge>
            <p className="mt-2">{answer.answer}</p><Sources sources={answer.sources} />
          </div>
        )}
        {fileId && <Button variant="secondary" size="sm" className="mt-3" loading={busy === 'sq'} onClick={() => run('sq', async () => setQs((await api.post<{ questions: { question: string; answer: string }[] }>('/ai/study-questions', { labId: lab.id, fileId })).questions))}><Sparkles className="w-3.5 h-3.5" aria-hidden /> Generate study questions</Button>}
        {qs_.length > 0 && <ol className="mt-3 space-y-2 text-sm list-decimal pl-5">{qs_.map((x, i) => <li key={i}><strong>{x.question}</strong><details><summary className="text-xs text-blue-700 dark:text-cyan-400 cursor-pointer">Show answer</summary><p className="mt-1">{x.answer}</p></details></li>)}</ol>}
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-900 dark:text-white">Summarise recent chat</h3><Button variant="secondary" loading={busy === 's'} onClick={() => run('s', async () => setSummary((await api.post<{ summary: any }>('/ai/summarize', { labId: lab.id, hours: 24 })).summary))}>Summarise last 24 hours</Button></div>
        {summary && (
          <div className="mt-3 text-sm space-y-2 text-slate-700 dark:text-slate-200">
            <Badge tone={summary.generatedBy === 'gemini' ? 'blue' : 'amber'}>{summary.generatedBy === 'gemini' ? 'AI-generated' : 'Rule-based (no AI)'}</Badge>
            <p className="font-medium">{summary.title}</p><p>{summary.overview}</p>
            {[['Key questions', summary.keyQuestions], ['Action items', summary.actionItems], ['Unanswered questions', summary.unansweredQuestions]].map(([t, l]) => (l as string[])?.length ? <div key={t as string}><p className="text-xs font-semibold uppercase text-slate-400">{t as string}</p><ul className="list-disc pl-5">{(l as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null)}
          </div>
        )}
      </Card>

      {canManage && (
        <Card className="p-5 space-y-3">
          <h3 className="font-semibold text-slate-900 dark:text-white">Staff tools</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy === 'r'} disabled={!lab.activeSession && false} onClick={() => run('r', async () => {
              const s = await api.get<{ sessions: { id: string }[] }>(`/labs/${lab.id}/sessions`);
              if (!s.sessions.length) throw new ApiError(0, 'NONE', 'Start or finish a session first.');
              setReport((await api.post<{ report: any }>('/ai/generate-report', { labId: lab.id, sessionId: lab.activeSession?.id ?? s.sessions[0].id })).report);
            })}>Draft session report</Button>
            <Button variant="secondary" loading={busy === 'i'} onClick={() => run('i', async () => setInsights((await api.post<{ insights: string }>('/ai/lab-insights', { labId: lab.id })).insights))}>AI lab insights</Button>
          </div>
          {report && <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800 text-sm"><Badge tone={report.generatedBy === 'gemini' ? 'blue' : 'amber'}>{report.generatedBy === 'gemini' ? 'AI-drafted from session data' : 'Template from session data'}</Badge><p className="mt-2 whitespace-pre-wrap">{report.narrative}</p><Button size="sm" variant="ghost" className="mt-2" onClick={() => { void navigator.clipboard.writeText(report.narrative); toast('Copied.', 'success'); }}>Copy</Button></div>}
          {insights && <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800 text-sm whitespace-pre-wrap"><Badge tone="blue">AI suggestions - not confirmed events</Badge><p className="mt-2">{insights}</p></div>}
        </Card>
      )}
    </div>
  );
};

export const AIAssistantView: React.FC = () => {
  const { params, toast } = useApp();
  const status = useAsync(() => api.get<AiStatus>('/ai/status'), []);
  const labs = useAsync(() => api.get<{ labs: Lab[] }>('/labs'), []);
  const [labId, setLabId] = useState(params.lab ?? '');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api.get<{ messages: { role: 'user' | 'assistant'; content: string; sources: AiSource[] }[] }>(`/ai/history${labId ? `?labId=${labId}` : ''}`).then((r) => setTurns(r.messages.map((m) => ({ role: m.role, content: m.content, sources: m.sources })))).catch(() => {});
  }, [labId]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = text.trim(); if (!message) return;
    setText(''); setBusy(true); setTurns((t) => [...t, { role: 'user', content: message }]);
    try {
      const r = await api.post<{ answer: string; sources: AiSource[] }>('/ai/chat', { message, labId: labId || undefined });
      setTurns((t) => [...t, { role: 'assistant', content: r.answer, sources: r.sources }]); status.reload();
    } catch (err) { setTurns((t) => [...t, { role: 'assistant', content: err instanceof ApiError ? err.message : 'The assistant is unavailable.', error: true }]); }
    finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="AI Assistant" subtitle="Ask coding and course questions. Pick a lab to ground answers in its documents." actions={<Button variant="secondary" size="sm" onClick={async () => { await api.del('/ai/history'); setTurns([]); toast('Conversation history cleared.', 'success'); }}><Trash2 className="w-3.5 h-3.5" aria-hidden /> Clear history</Button>} />
      <div className="mb-3"><StatusBanner s={status.data} /></div>
      <Card className="flex flex-col h-[65vh] min-h-[26rem]">
        <div className="p-3 border-b border-slate-100 dark:border-slate-800"><select aria-label="Ground answers in laboratory documents" value={labId} onChange={(e) => setLabId(e.target.value)} className={`${inputCls} !w-auto`}><option value="">General assistant (no documents)</option>{labs.data?.labs.map((l) => <option key={l.id} value={l.id}>{l.name} documents</option>)}</select></div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
          {turns.length === 0 && <EmptyState icon={<Bot className="w-6 h-6" />} title="Ask me anything about your coursework" hint="For example: “Explain pointers in C with a small example.”" />}
          {turns.map((t, i) => (
            <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : ''}`}>
              <div className={`max-w-[85%] px-3.5 py-2.5 rounded-xl text-sm whitespace-pre-wrap break-words ${t.role === 'user' ? 'bg-blue-900 text-white' : t.error ? 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-900' : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'}`}>
                {t.content}{t.role === 'assistant' && !t.error && <Sources sources={t.sources} />}
              </div>
            </div>
          ))}
          {busy && <div className="text-sm text-slate-500" role="status">Thinking…</div>}
          <div ref={end} />
        </div>
        <form onSubmit={send} className="p-3 border-t border-slate-100 dark:border-slate-800 flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Message to the assistant" maxLength={2000} placeholder="Type your question…" className={inputCls} />
          <Button type="submit" disabled={busy || !text.trim()} aria-label="Send"><Send className="w-4 h-4" aria-hidden /></Button>
        </form>
      </Card>
    </>
  );
};
