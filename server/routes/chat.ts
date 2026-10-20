import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../types';
import { reqUser } from '../types';
import { forbidden, notFound, parse, tooMany, wrap } from '../errors';
import { assertLabActive, isLabStaff, requireLabMember, requireLabStaff, accessibleLabIds, inClause } from '../permissions';
import { newId } from '../security';
import { audit, notifyLabMembers, notifyLabStaff } from '../services';
import { nowIso } from '../db';
import { userBurstLimiter } from '../middleware';

export const messageDto = (m: any) => ({
  id: m.id, labId: m.lab_id, senderId: m.sender_id, senderName: m.sender_name, senderRole: m.sender_role,
  content: m.deleted_at ? '' : m.content, kind: m.kind, replyTo: m.reply_to, clientId: m.client_id,
  attachment: m.file_id && !m.deleted_at && !m.file_deleted ? { id: m.file_id, name: m.file_name, size: m.file_size, contentType: m.file_type } : null,
  createdAt: m.created_at, editedAt: m.edited_at, deleted: !!m.deleted_at,
  replyPreview: m.reply_content ? { senderName: m.reply_sender, content: String(m.reply_content).slice(0, 120) } : null,
});

const MSG_SELECT = `SELECT m.*, u.display_name AS sender_name, u.role AS sender_role, f.id AS file_id, f.original_name AS file_name, f.size AS file_size, f.content_type AS file_type, f.deleted_at AS file_deleted,
  r.content AS reply_content, ru.display_name AS reply_sender
  FROM messages m JOIN users u ON u.id = m.sender_id LEFT JOIN files f ON f.id = m.attachment_file_id
  LEFT JOIN messages r ON r.id = m.reply_to AND r.deleted_at IS NULL LEFT JOIN users ru ON ru.id = r.sender_id`;

export function chatRoutes(ctx: Ctx) {
  const r = Router();
  const burst = userBurstLimiter(ctx.config.rateLimitEnabled ? 20 : 1000, 10_000);

  r.get('/labs/:id/messages', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabMember(ctx, u, String(req.params.id));
    const q = parse(z.object({ before: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(30), q: z.string().trim().max(100).optional() }), req.query);
    const where = ['m.lab_id = ?'];
    const params: unknown[] = [lab.id];
    if (q.before) {
      const ref = ctx.db.prepare('SELECT created_at FROM messages WHERE id = ? AND lab_id = ?').get(q.before, lab.id) as any;
      if (ref) { where.push('(m.created_at < ? OR (m.created_at = ? AND m.id < ?))'); params.push(ref.created_at, ref.created_at, q.before); }
    }
    if (q.q) { where.push("m.deleted_at IS NULL AND m.content LIKE ? ESCAPE '\\'"); params.push(`%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`); }
    const rows = ctx.db.prepare(`${MSG_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`).all(...params, q.limit + 1) as any[];
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit).reverse();
    res.json({ messages: page.map(messageDto), hasMore, nextBefore: hasMore ? page[0]?.id : null });
  }));

  r.post('/labs/:id/messages', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabMember(ctx, u, String(req.params.id));
    assertLabActive(lab);
    if (!burst(u.id)) throw tooMany('You are sending messages too quickly. Slow down for a few seconds.', 'CHAT_RATE_LIMITED');
    const max = ctx.settings.get('chat.maxMessageChars');
    const b = parse(z.object({
      content: z.string().trim().min(1, 'Message cannot be empty.').max(max, `Message is too long (max ${max} characters).`),
      clientId: z.string().max(64).optional(), replyTo: z.string().optional(), attachmentFileId: z.string().optional(),
    }).strict(), req.body);
    if (b.clientId) {
      const dup = ctx.db.prepare(`${MSG_SELECT} WHERE m.sender_id = ? AND m.client_id = ?`).get(u.id, b.clientId);
      if (dup) return res.json({ message: messageDto(dup), duplicate: true });
    }
    if (b.replyTo && !ctx.db.prepare('SELECT 1 FROM messages WHERE id=? AND lab_id=?').get(b.replyTo, lab.id)) throw notFound('The message you are replying to no longer exists.');
    if (b.attachmentFileId && !ctx.db.prepare('SELECT 1 FROM files WHERE id=? AND lab_id=? AND deleted_at IS NULL').get(b.attachmentFileId, lab.id)) throw notFound('Attachment not found in this laboratory.');
    const id = newId();
    ctx.db.prepare('INSERT INTO messages(id,lab_id,sender_id,client_id,content,kind,reply_to,attachment_file_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, lab.id, u.id, b.clientId ?? null, b.content, b.attachmentFileId ? 'file' : 'text', b.replyTo ?? null, b.attachmentFileId ?? null, nowIso());
    const dto = messageDto(ctx.db.prepare(`${MSG_SELECT} WHERE m.id = ?`).get(id));
    ctx.rt.emitToLab(lab.id, 'message:new', dto);
    notifyLabMembers(ctx, lab.id, u.id, 'message', `New message in ${lab.name}`, `${u.name}: ${b.content.slice(0, 80)}`, `/lab_room?lab=${lab.id}`);
    res.status(201).json({ message: dto });
  }));

  r.patch('/messages/:id', wrap((req, res) => {
    const u = reqUser(req);
    const m = ctx.db.prepare('SELECT * FROM messages WHERE id = ?').get(String(req.params.id)) as any;
    if (!m || m.deleted_at) throw notFound('Message not found.');
    requireLabMember(ctx, u, m.lab_id);
    if (m.sender_id !== u.id) throw forbidden('You can only edit your own messages.');
    const win = ctx.settings.get('chat.editWindowMinutes') * 60_000;
    if (Date.now() - new Date(m.created_at).getTime() > win) throw forbidden(`Messages can only be edited within ${ctx.settings.get('chat.editWindowMinutes')} minutes.`, 'EDIT_WINDOW_CLOSED');
    const { content } = parse(z.object({ content: z.string().trim().min(1).max(ctx.settings.get('chat.maxMessageChars')) }).strict(), req.body);
    ctx.db.prepare('UPDATE messages SET content=?, edited_at=? WHERE id=?').run(content, nowIso(), m.id);
    const dto = messageDto(ctx.db.prepare(`${MSG_SELECT} WHERE m.id = ?`).get(m.id));
    ctx.rt.emitToLab(m.lab_id, 'message:updated', dto);
    res.json({ message: dto });
  }));

  r.delete('/messages/:id', wrap((req, res) => {
    const u = reqUser(req);
    const m = ctx.db.prepare('SELECT * FROM messages WHERE id = ?').get(String(req.params.id)) as any;
    if (!m || m.deleted_at) throw notFound('Message not found.');
    requireLabMember(ctx, u, m.lab_id);
    if (m.sender_id !== u.id && !isLabStaff(ctx, u, m.lab_id)) throw forbidden('You can only delete your own messages.');
    ctx.db.prepare('UPDATE messages SET deleted_at=? WHERE id=?').run(nowIso(), m.id);
    if (m.sender_id !== u.id) audit(ctx, u, 'MESSAGE_MODERATE_DELETE', 'message', m.id, { labId: m.lab_id }, req);
    ctx.rt.emitToLab(m.lab_id, 'message:deleted', { id: m.id, labId: m.lab_id });
    res.json({ ok: true });
  }));

  r.post('/messages/:id/report', wrap((req, res) => {
    const u = reqUser(req);
    const m = ctx.db.prepare('SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL').get(String(req.params.id)) as any;
    if (!m) throw notFound('Message not found.');
    const lab = requireLabMember(ctx, u, m.lab_id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }).strict(), req.body);
    ctx.db.prepare('INSERT OR IGNORE INTO message_reports(id,message_id,reporter_id,reason,created_at) VALUES(?,?,?,?,?)').run(newId(), m.id, u.id, reason, nowIso());
    audit(ctx, u, 'MESSAGE_REPORT', 'message', m.id, { labId: lab.id }, req);
    notifyLabStaff(ctx, lab.id, 'security', 'Message reported', `A message in ${lab.name} was reported: "${reason.slice(0, 80)}"`, { link: `/lab_room?lab=${lab.id}`, dedupeKey: `rep:${m.id}` });
    res.json({ ok: true });
  }));

  // ---- announcements ----
  r.get('/announcements', wrap((req, res) => {
    const u = reqUser(req);
    const ids = accessibleLabIds(ctx, u);
    const labId = typeof req.query.labId === 'string' ? req.query.labId : null;
    if (labId && !ids.includes(labId)) throw forbidden('You do not have access to this laboratory.');
    const scope = labId ? [labId] : ids;
    const page = Math.max(1, Number(req.query.page) || 1);
    const rows = scope.length ? ctx.db.prepare(
      `SELECT a.*, u.display_name AS author, l.name AS lab_name FROM announcements a JOIN users u ON u.id=a.author_id JOIN labs l ON l.id=a.lab_id
       WHERE a.lab_id IN (${inClause(scope)}) ORDER BY a.created_at DESC LIMIT 20 OFFSET ?`).all(...scope, (page - 1) * 20) as any[] : [];
    const total = scope.length ? (ctx.db.prepare(`SELECT COUNT(*) c FROM announcements WHERE lab_id IN (${inClause(scope)})`).get(...scope) as any).c : 0;
    res.json({ announcements: rows.map((a) => ({ id: a.id, labId: a.lab_id, labName: a.lab_name, author: a.author, title: a.title, content: a.content, priority: a.priority, createdAt: a.created_at })), total, page });
  }));

  r.post('/labs/:id/announcements', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    assertLabActive(lab);
    const b = parse(z.object({ title: z.string().trim().min(3).max(120), content: z.string().trim().min(3).max(2000), priority: z.enum(['normal', 'urgent']).default('normal') }).strict(), req.body);
    const id = newId();
    const t = nowIso();
    ctx.db.transaction(() => {
      ctx.db.prepare('INSERT INTO announcements(id,lab_id,author_id,title,content,priority,created_at) VALUES(?,?,?,?,?,?,?)').run(id, lab.id, u.id, b.title, b.content, b.priority, t);
      ctx.db.prepare("INSERT INTO messages(id,lab_id,sender_id,content,kind,created_at) VALUES(?,?,?,?, 'announcement', ?)").run(newId(), lab.id, u.id, `${b.title}\n${b.content}`, t);
    })();
    audit(ctx, u, 'ANNOUNCEMENT_CREATE', 'announcement', id, { labId: lab.id }, req);
    ctx.rt.emitToLab(lab.id, 'announcement:new', { id, labId: lab.id, title: b.title, priority: b.priority });
    notifyLabMembers(ctx, lab.id, u.id, 'announcement', b.priority === 'urgent' ? `Urgent: ${b.title}` : b.title, b.content.slice(0, 120), `/lab_room?lab=${lab.id}`);
    res.status(201).json({ id });
  }));

  return r;
}
