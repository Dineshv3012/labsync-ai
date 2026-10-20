import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CornerUpLeft, Download, FileText, Flag, Megaphone, Pencil, Search, Send, Trash2, WifiOff } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { useApp } from '../../context/AppContext';
import { useDebounced } from '../../hooks/useAsync';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Modal, Spinner, cx, inputCls } from '../ui';
import { fmtBytes, fmtTime, fmtDate } from '../../lib/format';
import { UploadButton } from './UploadButton';
import type { Message } from '../../types';

export const ChatPanel: React.FC<{ labId: string; canModerate: boolean; archived: boolean }> = ({ labId, canModerate, archived }) => {
  const { user, toast } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [search, setSearch] = useState('');
  const dsearch = useDebounced(search, 350);
  const [connected, setConnected] = useState(getSocket()?.connected ?? false);
  const [del, setDel] = useState<Message | null>(null);
  const [report, setReport] = useState<Message | null>(null);
  const [reason, setReason] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ messages: Message[]; hasMore: boolean; nextBefore: string | null }>(`/labs/${labId}/messages${qs({ limit: 30, q: dsearch })}`);
      setMessages(r.messages); setHasMore(r.hasMore); setNextBefore(r.nextBefore); stick.current = true;
      if (!dsearch) void api.post(`/labs/${labId}/read`).catch(() => {});
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not load messages.', 'error'); }
    finally { setLoading(false); }
  }, [labId, dsearch, toast]);
  useEffect(() => { void load(); }, [load]);

  const older = async () => {
    if (!nextBefore) return;
    const el = scroller.current; const prev = el?.scrollHeight ?? 0;
    const r = await api.get<{ messages: Message[]; hasMore: boolean; nextBefore: string | null }>(`/labs/${labId}/messages${qs({ limit: 30, before: nextBefore, q: dsearch })}`);
    stick.current = false;
    setMessages((m) => [...r.messages, ...m]); setHasMore(r.hasMore); setNextBefore(r.nextBefore);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prev; });
  };

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const onNew = (m: Message) => {
      if (m.labId !== labId || dsearch) return;
      setMessages((p) => (p.some((x) => x.id === m.id) ? p : [...p.filter((x) => !(x.clientId && x.clientId === m.clientId && x.status)), m]));
      void api.post(`/labs/${labId}/read`).catch(() => {});
    };
    const onUpd = (m: Message) => setMessages((p) => p.map((x) => (x.id === m.id ? m : x)));
    const onDel = (d: { id: string }) => setMessages((p) => p.map((x) => (x.id === d.id ? { ...x, deleted: true, content: '', attachment: null } : x)));
    const onConn = () => { setConnected(true); s.emit('lab:join', labId); void load(); };
    const onDisc = () => setConnected(false);
    s.on('message:new', onNew); s.on('message:updated', onUpd); s.on('message:deleted', onDel); s.on('connect', onConn); s.on('disconnect', onDisc);
    setConnected(s.connected);
    return () => { s.off('message:new', onNew); s.off('message:updated', onUpd); s.off('message:deleted', onDel); s.off('connect', onConn); s.off('disconnect', onDisc); };
  }, [labId, dsearch, load]);

  useLayoutEffect(() => { if (stick.current) bottom.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const send = async (content: string, attachmentFileId?: string, existingClientId?: string) => {
    const clientId = existingClientId ?? crypto.randomUUID();
    const optimistic: Message = {
      id: `tmp-${clientId}`, labId, senderId: user!.id, senderName: user!.name, senderRole: user!.role, content, kind: attachmentFileId ? 'file' : 'text', replyTo: replyTo?.id ?? null,
      clientId, createdAt: new Date().toISOString(), editedAt: null, deleted: false, attachment: null, replyPreview: replyTo ? { senderName: replyTo.senderName, content: replyTo.content.slice(0, 120) } : null, status: 'sending',
    };
    stick.current = true;
    setMessages((p) => (existingClientId ? p.map((m) => (m.clientId === clientId ? { ...m, status: 'sending' } : m)) : [...p, optimistic]));
    try {
      const r = await api.post<{ message: Message }>(`/labs/${labId}/messages`, { content, clientId, replyTo: replyTo?.id, attachmentFileId });
      setMessages((p) => { const without = p.filter((m) => m.clientId !== clientId || !m.status); return without.some((m) => m.id === r.message.id) ? without : [...without, r.message]; });
    } catch (e) {
      setMessages((p) => p.map((m) => (m.clientId === clientId ? { ...m, status: 'failed' } : m)));
      toast(e instanceof ApiError ? e.message : 'Message failed to send.', 'error');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;
    if (editing) {
      try { await api.patch(`/messages/${editing.id}`, { content }); setEditing(null); setText(''); } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not edit.', 'error'); }
      return;
    }
    setText(''); const rt = replyTo; void send(content); if (rt) setReplyTo(null);
  };

  const doDelete = async () => {
    if (!del) return;
    try { await api.del(`/messages/${del.id}`); setDel(null); } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete.', 'error'); }
  };
  const doReport = async () => {
    if (!report) return;
    try { await api.post(`/messages/${report.id}/report`, { reason }); toast('Reported to lab staff.', 'success'); setReport(null); setReason(''); } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not report.', 'error'); }
  };

  let lastDay = '';
  return (
    <Card className="flex flex-col h-[70vh] min-h-[28rem]">
      <div className="flex items-center gap-2 p-3 border-b border-slate-100 dark:border-slate-800">
        <div className="relative flex-1"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden /><input aria-label="Search messages" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search this chat…" className={`${inputCls} pl-9 py-2`} /></div>
        {!connected && <Badge tone="amber" className="gap-1"><WifiOff className="w-3 h-3" aria-hidden /> Reconnecting…</Badge>}
      </div>
      <div ref={scroller} className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite" onScroll={(e) => { const t = e.currentTarget; stick.current = t.scrollHeight - t.scrollTop - t.clientHeight < 80; }}>
        {hasMore && <div className="text-center"><Button variant="secondary" size="sm" onClick={older}>Load older messages</Button></div>}
        {loading ? <Spinner /> : messages.length === 0 ? <EmptyState title={dsearch ? 'No messages match your search' : 'No messages yet'} hint={dsearch ? undefined : 'Say hello to start the conversation.'} /> : messages.map((m) => {
          const day = fmtDate(m.createdAt); const showDay = day !== lastDay; lastDay = day;
          const mine = m.senderId === user?.id;
          return (
            <React.Fragment key={m.id}>
              {showDay && <div className="text-center text-[11px] font-medium text-slate-400 uppercase tracking-wide">{day}</div>}
              <div className={cx('group flex gap-2', mine && 'flex-row-reverse')}>
                <div className={cx('max-w-[85%] sm:max-w-[70%]', mine && 'items-end')}>
                  <div className={cx('text-[11px] text-slate-500 mb-0.5 flex gap-1.5 items-center', mine && 'justify-end')}>
                    <span className="font-medium">{mine ? 'You' : m.senderName}</span>{m.senderRole !== 'student' && <Badge tone="blue">{m.senderRole}</Badge>}<span>{fmtTime(m.createdAt)}</span>{m.editedAt && <span>(edited)</span>}
                  </div>
                  {m.deleted ? <div className="px-3 py-2 rounded-xl text-sm italic text-slate-400 border border-dashed border-slate-300 dark:border-slate-700">Message deleted</div> : (
                    <div className={cx('px-3 py-2 rounded-xl text-sm break-words whitespace-pre-wrap', m.kind === 'announcement' ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-100' : mine ? 'bg-blue-900 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100', m.status === 'sending' && 'opacity-60')}>
                      {m.kind === 'announcement' && <div className="flex items-center gap-1 font-semibold text-xs mb-1"><Megaphone className="w-3.5 h-3.5" aria-hidden /> Announcement</div>}
                      {m.replyPreview && <div className="text-xs opacity-75 border-l-2 border-current pl-2 mb-1.5">{m.replyPreview.senderName}: {m.replyPreview.content}</div>}
                      {m.content}
                      {m.attachment && (
                        <a href={`/api/files/${m.attachment.id}/download`} className="mt-2 flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/90 dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 text-xs no-underline">
                          <FileText className="w-4 h-4 shrink-0" aria-hidden /><span className="truncate">{m.attachment.name}</span><span className="text-slate-400">{fmtBytes(m.attachment.size)}</span><Download className="w-3.5 h-3.5 ml-auto" aria-hidden />
                        </a>
                      )}
                    </div>
                  )}
                  {m.status === 'failed' && <button onClick={() => void send(m.content, undefined, m.clientId!)} className="text-xs text-red-600 mt-1 underline">Failed to send - tap to retry</button>}
                  {!m.deleted && !m.status && (
                    <div className={cx('flex gap-1 mt-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity', mine && 'justify-end')}>
                      <button aria-label="Reply" onClick={() => setReplyTo(m)} className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white"><CornerUpLeft className="w-3.5 h-3.5" /></button>
                      {mine && m.kind === 'text' && <button aria-label="Edit message" onClick={() => { setEditing(m); setText(m.content); }} className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white"><Pencil className="w-3.5 h-3.5" /></button>}
                      {(mine || canModerate) && <button aria-label="Delete message" onClick={() => setDel(m)} className="p-1 rounded text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}
                      {!mine && <button aria-label="Report message" onClick={() => setReport(m)} className="p-1 rounded text-slate-400 hover:text-amber-600"><Flag className="w-3.5 h-3.5" /></button>}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={bottom} />
      </div>
      {archived ? <p className="p-3 text-center text-sm text-slate-500 border-t border-slate-100 dark:border-slate-800">This laboratory is archived. Chat is read-only.</p> : (
        <form onSubmit={submit} className="border-t border-slate-100 dark:border-slate-800 p-3">
          {(replyTo || editing) && (
            <div className="flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-1.5 mb-2 text-slate-600 dark:text-slate-300">
              <span className="truncate">{editing ? 'Editing message' : `Replying to ${replyTo!.senderName}: ${replyTo!.content.slice(0, 60)}`}</span>
              <button type="button" onClick={() => { setReplyTo(null); setEditing(null); setText(''); }} className="underline ml-2">Cancel</button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <UploadButton compact labId={labId} onUploaded={(f) => void send(`Shared a file: ${f.name}`, f.id)} />
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} aria-label="Message" placeholder="Write a message…" maxLength={4000}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} className={`${inputCls} resize-none max-h-32`} />
            <Button type="submit" disabled={!text.trim()} aria-label={editing ? 'Save edit' : 'Send message'}><Send className="w-4 h-4" aria-hidden /></Button>
          </div>
        </form>
      )}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={doDelete} danger confirmLabel="Delete" title="Delete message?" message="This removes the message for everyone in the lab." />
      <Modal open={!!report} onClose={() => setReport(null)} title="Report message">
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">Lab staff will review this message. Tell them what is wrong.</p>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} aria-label="Reason" className={inputCls} />
        <div className="flex justify-end gap-2 mt-4"><Button variant="secondary" onClick={() => setReport(null)}>Cancel</Button><Button disabled={reason.trim().length < 3} onClick={doReport}>Send report</Button></div>
      </Modal>
    </Card>
  );
};
