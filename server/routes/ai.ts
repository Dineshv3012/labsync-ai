import { Router } from 'express';
import { z } from 'zod';
import type { Ctx, AuthUser } from '../types';
import { reqUser } from '../types';
import { HttpError, forbidden, notFound, parse, tooMany, wrap } from '../errors';
import { limiter } from '../middleware';
import { accessibleLabIds, isLabStaff, requireLabMember, requireLabStaff } from '../permissions';
import { newId } from '../security';
import { audit } from '../services';
import { nowIso } from '../db';
import { AiProviderError } from '../ai/provider';
import { SYSTEM_BASE, clean, retrieve, type Retrieved } from '../ai/rag';

export function aiRoutes(ctx: Ctx) {
  const r = Router();
  r.use(limiter(ctx, 60_000, 20, 'Too many AI requests. Please wait a moment.'));

  const model = () => ctx.settings.get('ai.model') || ctx.ai.provider.model || ctx.config.geminiModel;
  const usedToday = (userId: string) => (ctx.db.prepare('SELECT COUNT(*) c FROM ai_usage WHERE user_id=? AND created_at >= ?').get(userId, new Date().toISOString().slice(0, 10)) as any).c as number;

  /** Enforces admin switch, per-user opt-in and daily quota. Rule-based fallbacks skip this. */
  function guard(u: AuthUser) {
    if (!ctx.settings.get('ai.enabled')) throw new HttpError(403, 'AI_DISABLED', 'AI features are turned off by your administrator.');
    if (!u.prefs.aiAssistance) throw new HttpError(403, 'AI_OPTED_OUT', 'You turned AI assistance off in Settings.');
    if (!ctx.ai.provider.configured) throw new HttpError(503, 'AI_NOT_CONFIGURED', 'AI is not configured on this server yet. An administrator must set GEMINI_API_KEY.');
    const limit = ctx.settings.get('ai.maxRequestsPerUserPerDay');
    if (usedToday(u.id) >= limit) throw tooMany(`You reached today's AI limit (${limit} requests). It resets at midnight UTC.`, 'AI_QUOTA');
  }

  async function run(u: AuthUser, kind: string, system: string, prompt: string, json = false) {
    ctx.db.prepare('INSERT INTO ai_usage(id,user_id,kind,created_at) VALUES(?,?,?,?)').run(newId(), u.id, kind, nowIso());
    try {
      return await ctx.ai.provider.generate({ system, prompt: clean(prompt, ctx.settings.get('ai.maxInputChars') * 2), json, model: model(), maxOutputTokens: ctx.settings.get('ai.maxOutputTokens') });
    } catch (e) {
      if (e instanceof AiProviderError) throw new HttpError(e.kind === 'timeout' ? 504 : 502, e.kind === 'timeout' ? 'AI_TIMEOUT' : 'AI_UPSTREAM', `${e.message} You can retry in a moment.`);
      throw e;
    }
  }
  const parseJson = <T,>(text: string, fallback: T): T => {
    try { return JSON.parse(text.replace(/^```json\s*|```$/g, '').trim()) as T; } catch { return fallback; }
  };

  const sources = (chunks: Retrieved[]) => chunks.map((c) => ({ fileId: c.fileId, name: c.fileName, section: c.section || `Part ${c.ordinal + 1}` }));
  const docBlock = (chunks: Retrieved[]) => chunks.map((c, i) => `<document id="${i + 1}" name="${c.fileName.replace(/"/g, "'")}" section="${(c.section || '').replace(/"/g, "'")}">\n${clean(c.text, 1200)}\n</document>`).join('\n');
  const save = (u: AuthUser, labId: string | null, role: 'user' | 'assistant', content: string, src: unknown[] = []) =>
    ctx.db.prepare('INSERT INTO ai_chat(id,user_id,lab_id,role,content,sources_json,created_at) VALUES(?,?,?,?,?,?,?)').run(newId(), u.id, labId, role, content, JSON.stringify(src), nowIso());

  r.get('/status', wrap((req, res) => {
    const u = reqUser(req);
    res.json({ configured: ctx.ai.provider.configured, enabled: ctx.settings.get('ai.enabled'), optedIn: u.prefs.aiAssistance, model: ctx.ai.provider.configured ? model() : null, usedToday: usedToday(u.id), dailyLimit: ctx.settings.get('ai.maxRequestsPerUserPerDay') });
  }));

  r.get('/history', wrap((req, res) => {
    const u = reqUser(req);
    const labId = typeof req.query.labId === 'string' ? req.query.labId : null;
    const rows = ctx.db.prepare(`SELECT * FROM ai_chat WHERE user_id=? AND ${labId ? 'lab_id = ?' : 'lab_id IS NULL'} ORDER BY created_at DESC LIMIT 40`).all(u.id, ...(labId ? [labId] : [])) as any[];
    res.json({ messages: rows.reverse().map((m) => ({ id: m.id, role: m.role, content: m.content, sources: JSON.parse(m.sources_json), createdAt: m.created_at })) });
  }));

  r.delete('/history', wrap((req, res) => {
    const u = reqUser(req);
    ctx.db.prepare('DELETE FROM ai_chat WHERE user_id=?').run(u.id);
    res.json({ ok: true });
  }));

  // Conversational assistant. With a labId it is grounded in that lab's documents the caller may read.
  r.post('/chat', wrap(async (req, res) => {
    const u = reqUser(req);
    const b = parse(z.object({ message: z.string().trim().min(1).max(2000), labId: z.string().optional() }).strict(), req.body);
    if (b.labId) requireLabMember(ctx, u, b.labId);
    guard(u);
    const chunks = b.labId ? retrieve(ctx, [b.labId], b.message, { limit: 4 }) : [];
    const history = (ctx.db.prepare(`SELECT role, content FROM ai_chat WHERE user_id=? AND ${b.labId ? 'lab_id = ?' : 'lab_id IS NULL'} ORDER BY created_at DESC LIMIT 6`).all(u.id, ...(b.labId ? [b.labId] : [])) as any[]).reverse();
    const prompt = `${chunks.length ? `Reference material:\n${docBlock(chunks)}\n\n` : ''}Conversation so far:\n${history.map((h) => `${h.role.toUpperCase()}: ${clean(h.content, 600)}`).join('\n')}\n\nSTUDENT QUESTION: ${clean(b.message, 2000)}\n\n` +
      (chunks.length ? 'Prefer the reference material and mention which document you used. If it does not cover the question, say so and then answer from general knowledge, labelled as such.' : 'Answer helpfully in simple English. Use markdown for code.');
    const answer = await run(u, 'chat', SYSTEM_BASE, prompt);
    save(u, b.labId ?? null, 'user', b.message);
    save(u, b.labId ?? null, 'assistant', answer, sources(chunks));
    res.json({ answer, sources: sources(chunks), grounded: chunks.length > 0 });
  }));

  r.post('/document-question', wrap(async (req, res) => {
    const u = reqUser(req);
    const b = parse(z.object({ labId: z.string(), question: z.string().trim().min(3).max(1000), fileId: z.string().optional() }).strict(), req.body);
    requireLabMember(ctx, u, b.labId);
    guard(u);
    const chunks = retrieve(ctx, [b.labId], b.question, { fileId: b.fileId, limit: 5 });
    if (!chunks.length) {
      return res.json({ answer: 'The documents you can access in this laboratory do not contain enough information to answer that question.', sources: [], grounded: false });
    }
    const prompt = `<data>\n${docBlock(chunks)}\n</data>\n\nQUESTION: ${clean(b.question, 1000)}\n\nAnswer ONLY from the documents above and cite them like [1]. If they do not contain the answer, reply exactly: "The available documents do not contain enough information."`;
    const answer = await run(u, 'document-question', SYSTEM_BASE, prompt);
    audit(ctx, u, 'AI_DOCUMENT_QUESTION', 'lab', b.labId, { fileIds: [...new Set(chunks.map((c) => c.fileId))] }, req);
    res.json({ answer, sources: sources(chunks), grounded: true });
  }));

  const recentChat = (labId: string, hours: number, limit: number) =>
    ctx.db.prepare(`SELECT u.display_name AS name, u.role, m.content, m.created_at FROM messages m JOIN users u ON u.id=m.sender_id
      WHERE m.lab_id=? AND m.deleted_at IS NULL AND m.created_at > ? ORDER BY m.created_at DESC LIMIT ?`).all(labId, new Date(Date.now() - hours * 3600_000).toISOString(), limit).reverse() as { name: string; role: string; content: string; created_at: string }[];

  /** Deterministic extractive summary used when the AI provider is unavailable. Clearly labelled as rule-based. */
  function ruleSummary(msgs: ReturnType<typeof recentChat>) {
    const questions = msgs.filter((m) => m.content.includes('?')).map((m) => `${m.name}: ${m.content.slice(0, 140)}`).slice(0, 8);
    const staffLines = msgs.filter((m) => m.role !== 'student').map((m) => `${m.name}: ${m.content.slice(0, 140)}`).slice(0, 6);
    const participants = [...new Set(msgs.map((m) => m.name))];
    return { title: 'Chat digest (rule-based)', overview: `${msgs.length} message(s) from ${participants.length} participant(s): ${participants.slice(0, 6).join(', ')}.`, keyQuestions: questions, actionItems: staffLines, unansweredQuestions: [], generatedBy: 'rule-based' as const };
  }

  r.post('/summarize', wrap(async (req, res) => {
    const u = reqUser(req);
    const b = parse(z.object({ labId: z.string(), hours: z.number().int().min(1).max(168).default(24), fileId: z.string().optional() }).strict(), req.body);
    const lab = requireLabMember(ctx, u, b.labId);
    let summary: Record<string, unknown>;
    let sourceType = 'chat';
    let sourceIds: string[] = [];
    if (b.fileId) {
      sourceType = 'file'; sourceIds = [b.fileId];
      const f = ctx.db.prepare('SELECT id FROM files WHERE id=? AND lab_id=? AND deleted_at IS NULL').get(b.fileId, lab.id);
      if (!f) throw notFound('File not found in this laboratory.');
      const chunks = ctx.db.prepare('SELECT text FROM doc_chunks WHERE file_id=? ORDER BY ordinal LIMIT 12').all(b.fileId) as { text: string }[];
      if (!chunks.length) throw new HttpError(422, 'NOT_INDEXED', 'This file has no readable text to summarise (unsupported type or still processing).');
      guard(u);
      const out = await run(u, 'summarize-file', SYSTEM_BASE, `<document>\n${chunks.map((c) => c.text).join('\n\n')}\n</document>\nSummarise these lecture notes in simple English. Return JSON: {"title":string,"overview":string,"keyQuestions":string[],"actionItems":string[],"unansweredQuestions":string[]}. keyQuestions are study questions.`, true);
      summary = { ...parseJson(out, { title: 'Summary', overview: out, keyQuestions: [], actionItems: [], unansweredQuestions: [] }), generatedBy: 'gemini' };
    } else {
      const msgs = recentChat(lab.id, b.hours, 150);
      if (!msgs.length) throw new HttpError(422, 'NO_MESSAGES', 'There are no messages in that time range to summarise.');
      sourceIds = [lab.id];
      if (ctx.ai.provider.configured && ctx.settings.get('ai.enabled') && u.prefs.aiAssistance) {
        guard(u);
        const transcript = msgs.map((m) => `[${m.role.toUpperCase()}] ${m.name}: ${clean(m.content, 400)}`).join('\n');
        const out = await run(u, 'summarize-chat', SYSTEM_BASE, `<chat>\n${transcript}\n</chat>\nSummarise this lab chat. Return JSON: {"title":string,"overview":string,"keyQuestions":string[],"actionItems":string[],"unansweredQuestions":string[]}.`, true);
        summary = { ...parseJson(out, { title: 'Chat summary', overview: out, keyQuestions: [], actionItems: [], unansweredQuestions: [] }), generatedBy: 'gemini' };
      } else summary = ruleSummary(msgs);
    }
    const id = newId();
    ctx.db.prepare('INSERT INTO ai_summaries(id,lab_id,source_type,source_ids,content_json,generated_by,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, lab.id, sourceType, JSON.stringify(sourceIds), JSON.stringify(summary), String(summary.generatedBy), u.id, nowIso());
    res.json({ id, summary });
  }));

  r.post('/generate-report', wrap(async (req, res) => {
    const u = reqUser(req);
    const b = parse(z.object({ labId: z.string(), sessionId: z.string() }).strict(), req.body);
    const lab = requireLabStaff(ctx, u, b.labId);
    const s = ctx.db.prepare('SELECT * FROM lab_sessions WHERE id=? AND lab_id=?').get(b.sessionId, lab.id) as any;
    if (!s) throw notFound('Session not found.');
    const att = ctx.db.prepare("SELECT COUNT(*) total, SUM(status='checked_out') done, SUM(status='missing_checkout') missing, ROUND(AVG(NULLIF(duration_minutes,0)),1) avg FROM attendance_records WHERE session_id=?").get(s.id) as any;
    const members = (ctx.db.prepare("SELECT COUNT(*) c FROM lab_members WHERE lab_id=? AND status='active' AND membership_role='student'").get(lab.id) as any).c;
    const msgCount = (ctx.db.prepare('SELECT COUNT(*) c FROM messages WHERE lab_id=? AND created_at BETWEEN ? AND ? AND deleted_at IS NULL').get(lab.id, s.start_at ?? s.created_at, s.end_at ?? nowIso()) as any).c;
    const facts = {
      laboratory: lab.name, course: lab.course, room: `${lab.building} ${lab.room_number}`.trim(), sessionTitle: s.title || 'Lab session', status: s.status, startedAt: s.start_at, endedAt: s.end_at,
      enrolledStudents: members, attended: att.total, completedCheckout: att.done ?? 0, missingCheckout: att.missing ?? 0, averageMinutes: att.avg ?? 0, chatMessages: msgCount,
    };
    let narrative: string;
    let generatedBy: 'gemini' | 'template' = 'template';
    if (ctx.ai.provider.configured && ctx.settings.get('ai.enabled') && u.prefs.aiAssistance) {
      guard(u);
      narrative = await run(u, 'report', SYSTEM_BASE, `<data>${JSON.stringify(facts)}</data>\nDraft a concise (120-180 words) formal laboratory session report using ONLY these facts. Do not invent topics, names or incidents. End with one neutral follow-up suggestion.`);
      generatedBy = 'gemini';
    } else {
      narrative = `${facts.sessionTitle} for ${facts.laboratory}${facts.course ? ` (${facts.course})` : ''} ran ${facts.startedAt ? `from ${facts.startedAt}` : 'as scheduled'}${facts.endedAt ? ` to ${facts.endedAt}` : ''}. ` +
        `${facts.attended} of ${facts.enrolledStudents} enrolled students were recorded; ${facts.completedCheckout} checked out and ${facts.missingCheckout} still need a check-out verified. ` +
        `Average attendance duration was ${facts.averageMinutes} minutes and ${facts.chatMessages} chat messages were exchanged. (Template report - configure Gemini for a written narrative.)`;
    }
    const report = { facts, narrative, generatedBy, generatedAt: nowIso() };
    ctx.db.prepare('INSERT INTO ai_summaries(id,lab_id,source_type,source_ids,content_json,generated_by,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(newId(), lab.id, 'session_report', JSON.stringify([s.id]), JSON.stringify(report), generatedBy, u.id, nowIso());
    audit(ctx, u, 'AI_REPORT_GENERATED', 'session', s.id, { labId: lab.id, generatedBy }, req);
    res.json({ report });
  }));

  r.post('/study-questions', wrap(async (req, res) => {
    const u = reqUser(req);
    const b = parse(z.object({ labId: z.string(), fileId: z.string() }).strict(), req.body);
    requireLabMember(ctx, u, b.labId);
    guard(u);
    const chunks = ctx.db.prepare('SELECT c.text FROM doc_chunks c JOIN files f ON f.id=c.file_id WHERE c.file_id=? AND c.lab_id=? AND f.deleted_at IS NULL ORDER BY c.ordinal LIMIT 10').all(b.fileId, b.labId) as { text: string }[];
    if (!chunks.length) throw new HttpError(422, 'NOT_INDEXED', 'That file has no readable text to build questions from.');
    const out = await run(u, 'study-questions', SYSTEM_BASE, `<document>\n${chunks.map((c) => c.text).join('\n\n')}\n</document>\nWrite 5 study questions with short model answers from this material. Return JSON: {"questions":[{"question":string,"answer":string}]}.`, true);
    res.json(parseJson(out, { questions: [] }));
  }));

  r.post('/lab-insights', wrap(async (req, res) => {
    const u = reqUser(req);
    const b = parse(z.object({ labId: z.string() }).strict(), req.body);
    const lab = requireLabStaff(ctx, u, b.labId);
    const alerts = ctx.db.prepare("SELECT alert_type AS type, severity, title, status, created_at AS at FROM alerts WHERE lab_id=? ORDER BY created_at DESC LIMIT 20").all(lab.id);
    const att = ctx.db.prepare("SELECT status, verification_status AS v, COUNT(*) c FROM attendance_records WHERE lab_id=? AND check_in_at > ? GROUP BY status, v").all(lab.id, new Date(Date.now() - 14 * 86400000).toISOString());
    guard(u);
    const text = await run(u, 'lab-insights', SYSTEM_BASE, `<data>${JSON.stringify({ lab: lab.name, alerts, attendanceLast14Days: att })}</data>\nGive staff 3-5 short, neutral observations and suggested review actions. Never accuse individuals or recommend punishment; these are suggestions for human review only.`);
    res.json({ insights: text, generatedBy: 'gemini', note: 'AI-generated suggestions. They are not confirmed events.' });
  }));

  return r;
}
