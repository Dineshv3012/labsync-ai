import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../types';
import { reqUser } from '../types';
import { badRequest, conflict, notFound, parse, wrap } from '../errors';
import { requireRole } from '../middleware';
import { audit, notify } from '../services';
import { DEFAULT_SETTINGS } from '../settings';
import { nowIso } from '../db';
import { runRetention } from '../jobs';

export function adminRoutes(ctx: Ctx) {
  const r = Router();
  r.use(requireRole('admin'));

  const userDto = (u: any) => ({
    id: u.id, name: u.display_name, email: u.email, role: u.role, requestedRole: u.requested_role, department: u.department,
    studentOrStaffId: u.student_or_staff_id, status: u.status, emailVerified: !!u.email_verified, createdAt: u.created_at, lastLoginAt: u.last_login_at,
  });

  r.get('/users', wrap((req, res) => {
    const q = parse(z.object({
      q: z.string().trim().max(80).optional(), role: z.enum(['student', 'staff', 'admin']).optional(), status: z.enum(['active', 'pending', 'suspended']).optional(),
      page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }), req.query);
    const where = ['1=1'];
    const p: unknown[] = [];
    if (q.q) { where.push("(display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR student_or_staff_id LIKE ? ESCAPE '\\')"); const l = `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`; p.push(l, l, l); }
    if (q.role) { where.push('role = ?'); p.push(q.role); }
    if (q.status) { where.push('status = ?'); p.push(q.status); }
    const total = (ctx.db.prepare(`SELECT COUNT(*) c FROM users WHERE ${where.join(' AND ')}`).get(...p) as any).c;
    const rows = ctx.db.prepare(`SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY (status='pending') DESC, created_at DESC LIMIT ? OFFSET ?`).all(...p, q.pageSize, (q.page - 1) * q.pageSize);
    res.json({ users: rows.map(userDto), total, page: q.page, pageSize: q.pageSize });
  }));

  r.get('/staff', wrap((_req, res) => {
    const rows = ctx.db.prepare("SELECT id, display_name AS name, email FROM users WHERE role='staff' AND status='active' ORDER BY display_name").all();
    res.json({ staff: rows });
  }));

  const adminCount = () => (ctx.db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin' AND status='active'").get() as any).c as number;

  r.post('/users/:id/approve', wrap((req, res) => {
    const a = reqUser(req);
    const u = ctx.db.prepare('SELECT * FROM users WHERE id=?').get(String(req.params.id)) as any;
    if (!u) throw notFound('User not found.');
    if (u.status !== 'pending') throw conflict('This account is not waiting for approval.');
    const { role } = parse(z.object({ role: z.enum(['student', 'staff']).optional() }).strict(), req.body ?? {});
    const newRole = role ?? (u.requested_role === 'staff' ? 'staff' : 'student');
    ctx.db.prepare("UPDATE users SET status='active', role=?, requested_role=NULL, updated_at=? WHERE id=?").run(newRole, nowIso(), u.id);
    audit(ctx, a, 'USER_APPROVE', 'user', u.id, { before: { role: u.role, status: u.status }, after: { role: newRole, status: 'active' } }, req);
    notify(ctx, u.id, 'system', 'Account approved', `Your account is active as ${newRole}.`);
    res.json({ user: userDto(ctx.db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
  }));

  r.patch('/users/:id', wrap((req, res) => {
    const a = reqUser(req);
    const u = ctx.db.prepare('SELECT * FROM users WHERE id=?').get(String(req.params.id)) as any;
    if (!u) throw notFound('User not found.');
    const b = parse(z.object({ role: z.enum(['student', 'staff', 'admin']).optional(), status: z.enum(['active', 'suspended']).optional() }).strict(), req.body);
    const nextRole = b.role ?? u.role;
    const nextStatus = b.status ?? u.status;
    if (u.id === a.id && (nextRole !== 'admin' || nextStatus !== 'active')) throw badRequest('You cannot demote or suspend your own account.', 'SELF_CHANGE');
    if (u.role === 'admin' && u.status === 'active' && (nextRole !== 'admin' || nextStatus !== 'active') && adminCount() <= 1) throw badRequest('At least one active administrator is required.', 'LAST_ADMIN');
    ctx.db.prepare('UPDATE users SET role=?, status=?, token_version = token_version + ?, updated_at=? WHERE id=?')
      .run(nextRole, nextStatus, nextRole !== u.role || nextStatus !== u.status ? 1 : 0, nowIso(), u.id);
    audit(ctx, a, b.role && b.role !== u.role ? 'USER_ROLE_CHANGE' : 'USER_STATUS_CHANGE', 'user', u.id, { before: { role: u.role, status: u.status }, after: { role: nextRole, status: nextStatus } }, req);
    res.json({ user: userDto(ctx.db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
  }));

  r.get('/labs', wrap((_req, res) => {
    const rows = ctx.db.prepare(`SELECT l.id, l.name, l.code, l.status, l.capacity, l.course,
      (SELECT COUNT(*) FROM lab_members m WHERE m.lab_id=l.id AND m.status='active') AS members,
      (SELECT group_concat(u.display_name, ', ') FROM lab_staff s JOIN users u ON u.id=s.user_id WHERE s.lab_id=l.id) AS staff FROM labs l ORDER BY l.name`).all();
    res.json({ labs: rows });
  }));

  r.get('/audit', wrap((req, res) => {
    const q = parse(z.object({
      q: z.string().trim().max(80).optional(), action: z.string().max(60).optional(), actor: z.string().max(80).optional(), resource: z.string().max(40).optional(),
      from: z.string().optional(), to: z.string().optional(), page: z.coerce.number().int().min(1).default(1),
    }), req.query);
    const where = ['1=1'];
    const p: unknown[] = [];
    if (q.action) { where.push('action = ?'); p.push(q.action); }
    if (q.resource) { where.push('resource_type = ?'); p.push(q.resource); }
    if (q.actor) { where.push("actor_name LIKE ? ESCAPE '\\'"); p.push(`%${q.actor.replace(/[\\%_]/g, (c) => '\\' + c)}%`); }
    if (q.q) { where.push("(action LIKE ? ESCAPE '\\' OR metadata_json LIKE ? ESCAPE '\\' OR resource_id LIKE ? ESCAPE '\\')"); const l = `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`; p.push(l, l, l); }
    if (q.from) { where.push('created_at >= ?'); p.push(q.from); }
    if (q.to) { where.push('created_at <= ?'); p.push(q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to); }
    const total = (ctx.db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE ${where.join(' AND ')}`).get(...p) as any).c;
    const rows = ctx.db.prepare(`SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT 25 OFFSET ?`).all(...p, (q.page - 1) * 25) as any[];
    res.json({ logs: rows.map((l) => ({ id: l.id, actor: l.actor_name, actorRole: l.actor_role, action: l.action, resourceType: l.resource_type, resourceId: l.resource_id, metadata: JSON.parse(l.metadata_json), ip: l.ip, createdAt: l.created_at })), total, page: q.page });
  }));

  const settingsSchema = z.object({
    'files.maxSizeMB': z.number().min(1).max(200), 'files.labQuotaMB': z.number().min(10).max(100000),
    'files.allowedExtensions': z.array(z.string().regex(/^[a-z0-9]{1,8}$/)).min(1).max(80),
    'ai.enabled': z.boolean(), 'ai.model': z.string().max(60), 'ai.maxRequestsPerUserPerDay': z.number().int().min(0).max(1000),
    'ai.maxInputChars': z.number().int().min(1000).max(60000), 'ai.maxOutputTokens': z.number().int().min(128).max(8192),
    'attendance.requireQrCheckin': z.boolean(), 'attendance.allowConcurrentLabs': z.boolean(), 'attendance.maxSessionMinutes': z.number().int().min(30).max(1440),
    'retention.messagesDays': z.number().int().min(30).max(3650), 'retention.notificationsDays': z.number().int().min(7).max(3650),
    'chat.editWindowMinutes': z.number().int().min(0).max(1440), 'chat.maxMessageChars': z.number().int().min(100).max(10000),
  }).partial().strict();

  r.get('/settings', wrap((_req, res) => res.json({ settings: ctx.settings.all() })));

  r.put('/settings', wrap((req, res) => {
    const a = reqUser(req);
    const b = parse(settingsSchema, req.body);
    const before = ctx.settings.all();
    for (const [k, v] of Object.entries(b)) if (k in DEFAULT_SETTINGS) ctx.settings.set(k, v, a.id);
    const changes = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, { before: before[k], after: v }]));
    audit(ctx, a, 'SETTINGS_UPDATE', 'settings', 'system', { changes }, req);
    res.json({ settings: ctx.settings.all() });
  }));

  r.post('/retention/run', wrap((req, res) => {
    const a = reqUser(req);
    const out = runRetention(ctx);
    audit(ctx, a, 'RETENTION_RUN', 'system', 'retention', out, req);
    res.json(out);
  }));

  return r;
}
