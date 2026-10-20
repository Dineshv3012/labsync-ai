import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../types';
import { reqUser } from '../types';
import { forbidden, notFound, parse, wrap } from '../errors';
import { requireRole } from '../middleware';
import { accessibleLabIds, inClause, isLabStaff, managedLabIds } from '../permissions';
import { newId } from '../security';
import { audit } from '../services';
import { nowIso } from '../db';

export function miscRoutes(ctx: Ctx) {
  const r = Router();

  // ---- notifications ----
  r.get('/notifications', wrap((req, res) => {
    const u = reqUser(req);
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), unread: z.enum(['1', '0']).optional() }), req.query);
    const where = q.unread === '1' ? 'AND read_at IS NULL' : '';
    const rows = ctx.db.prepare(`SELECT * FROM notifications WHERE user_id=? ${where} ORDER BY created_at DESC LIMIT 30 OFFSET ?`).all(u.id, (q.page - 1) * 30) as any[];
    const total = (ctx.db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id=? ${where}`).get(u.id) as any).c;
    const unreadCount = (ctx.db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL').get(u.id) as any).c;
    res.json({ notifications: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, message: n.message, link: n.link, readAt: n.read_at, createdAt: n.created_at })), total, unreadCount, page: q.page });
  }));

  r.post('/notifications/read', wrap((req, res) => {
    const u = reqUser(req);
    const b = parse(z.object({ ids: z.array(z.string()).max(100).optional(), all: z.boolean().optional() }).strict(), req.body ?? {});
    if (b.all) ctx.db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(nowIso(), u.id);
    else if (b.ids?.length) ctx.db.prepare(`UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL AND id IN (${inClause(b.ids)})`).run(nowIso(), u.id, ...b.ids);
    res.json({ unreadCount: (ctx.db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL').get(u.id) as any).c });
  }));

  // ---- global search (only inside labs the user can access) ----
  r.get('/search', wrap((req, res) => {
    const u = reqUser(req);
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(80) }), req.query);
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const ids = accessibleLabIds(ctx, u);
    if (!ids.length) return res.json({ labs: [], files: [], announcements: [] });
    const labs = ctx.db.prepare(`SELECT id, name, code, course FROM labs WHERE id IN (${inClause(ids)}) AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR course LIKE ? ESCAPE '\\') LIMIT 5`).all(...ids, like, like, like);
    const files = ctx.db.prepare(`SELECT f.id, f.original_name AS name, f.lab_id AS labId FROM files f WHERE f.lab_id IN (${inClause(ids)}) AND f.deleted_at IS NULL AND f.original_name LIKE ? ESCAPE '\\' LIMIT 5`).all(...ids, like);
    const announcements = ctx.db.prepare(`SELECT id, title, lab_id AS labId FROM announcements WHERE lab_id IN (${inClause(ids)}) AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 5`).all(...ids, like, like);
    res.json({ labs, files, announcements });
  }));

  // ---- alerts / incident review ----
  const alertDto = (a: any) => ({
    id: a.id, labId: a.lab_id, labName: a.lab_name, type: a.alert_type, detectionMethod: a.detection_method, severity: a.severity, title: a.title,
    evidence: JSON.parse(a.evidence_json || '{}'), status: a.status, createdAt: a.created_at,
    review: a.reviewer ? { reviewer: a.reviewer, decision: a.decision, notes: a.notes, reviewedAt: a.reviewed_at } : null,
  });
  const ALERT_SELECT = `SELECT a.*, l.name AS lab_name,
      (SELECT u.display_name FROM incident_reviews i JOIN users u ON u.id=i.reviewer_id WHERE i.alert_id=a.id ORDER BY i.reviewed_at DESC LIMIT 1) AS reviewer,
      (SELECT decision FROM incident_reviews WHERE alert_id=a.id ORDER BY reviewed_at DESC LIMIT 1) AS decision,
      (SELECT notes FROM incident_reviews WHERE alert_id=a.id ORDER BY reviewed_at DESC LIMIT 1) AS notes,
      (SELECT reviewed_at FROM incident_reviews WHERE alert_id=a.id ORDER BY reviewed_at DESC LIMIT 1) AS reviewed_at
    FROM alerts a LEFT JOIN labs l ON l.id = a.lab_id`;

  r.get('/alerts', requireRole('staff', 'admin'), wrap((req, res) => {
    const u = reqUser(req);
    const q = parse(z.object({
      labId: z.string().optional(), status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']).optional(),
      severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      page: z.coerce.number().int().min(1).default(1),
    }), req.query);
    const ids = managedLabIds(ctx, u);
    const where = [u.role === 'admin' ? '1=1' : `a.lab_id IN (${inClause(ids)})`];
    const params: unknown[] = u.role === 'admin' ? [] : [...ids];
    if (q.labId) { where.push('a.lab_id = ?'); params.push(q.labId); }
    if (q.status) { where.push('a.status = ?'); params.push(q.status); }
    if (q.severity) { where.push('a.severity = ?'); params.push(q.severity); }
    const total = (ctx.db.prepare(`SELECT COUNT(*) c FROM alerts a WHERE ${where.join(' AND ')}`).get(...params) as any).c;
    const rows = ctx.db.prepare(`${ALERT_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 20 OFFSET ?`).all(...params, (q.page - 1) * 20);
    res.json({ alerts: rows.map(alertDto), total, page: q.page });
  }));

  r.post('/alerts/:id/review', requireRole('staff', 'admin'), wrap((req, res) => {
    const u = reqUser(req);
    const a = ctx.db.prepare('SELECT * FROM alerts WHERE id=?').get(String(req.params.id)) as any;
    if (!a) throw notFound('Alert not found.');
    if (a.lab_id ? !isLabStaff(ctx, u, a.lab_id) : u.role !== 'admin') throw forbidden('You cannot review this alert.');
    const b = parse(z.object({ decision: z.enum(['reviewing', 'resolved', 'dismissed']), notes: z.string().trim().max(1000).default('') }).strict(), req.body);
    if (b.decision !== 'reviewing' && b.notes.length < 3) throw forbidden('Add resolution notes before closing an alert.', 'NOTES_REQUIRED');
    ctx.db.transaction(() => {
      ctx.db.prepare('INSERT INTO incident_reviews(id,alert_id,reviewer_id,decision,notes,reviewed_at) VALUES(?,?,?,?,?,?)').run(newId(), a.id, u.id, b.decision, b.notes, nowIso());
      ctx.db.prepare('UPDATE alerts SET status=? WHERE id=?').run(b.decision, a.id);
    })();
    audit(ctx, u, 'ALERT_REVIEW', 'alert', a.id, { decision: b.decision, labId: a.lab_id }, req);
    res.json({ alert: alertDto(ctx.db.prepare(`${ALERT_SELECT} WHERE a.id=?`).get(a.id)) });
  }));

  return r;
}
