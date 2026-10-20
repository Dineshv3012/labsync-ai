import type { Request } from 'express';
import type { Ctx, AuthUser, UserPrefs } from './types';
import { clientIp } from './types';
import { newId } from './security';
import { nowIso } from './db';

export const DEFAULT_PREFS: UserPrefs = {
  notify: { message: true, file: true, announcement: true, attendance: true },
  aiAssistance: true,
};

export function parsePrefs(json: string): UserPrefs {
  try {
    const p = JSON.parse(json || '{}');
    return {
      ...DEFAULT_PREFS,
      ...p,
      notify: { ...DEFAULT_PREFS.notify, ...(p.notify ?? {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Append-only audit trail. Never pass secrets or full request bodies in metadata. */
export function audit(
  ctx: Ctx,
  actor: Pick<AuthUser, 'id' | 'name' | 'role'> | null,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {},
  req?: Request,
) {
  ctx.db
    .prepare(
      `INSERT INTO audit_logs(id, actor_id, actor_name, actor_role, action, resource_type, resource_id, metadata_json, ip, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(newId(), actor?.id ?? null, actor?.name ?? 'system', actor?.role ?? 'system', action, resourceType, resourceId, JSON.stringify(metadata), req ? clientIp(req) : '', nowIso());
}

type NotifyKind = 'message' | 'file' | 'announcement' | 'attendance' | 'security' | 'system';

/** Creates an in-app notification (respecting preferences) and pushes it over the socket. */
export function notify(
  ctx: Ctx,
  userId: string,
  kind: NotifyKind,
  title: string,
  message: string,
  opts: { link?: string; dedupeKey?: string } = {},
) {
  const row = ctx.db.prepare('SELECT prefs_json FROM users WHERE id = ?').get(userId) as { prefs_json: string } | undefined;
  if (!row) return;
  const prefs = parsePrefs(row.prefs_json);
  if (kind in prefs.notify && !(prefs.notify as Record<string, boolean>)[kind]) return;
  const id = newId();
  const createdAt = nowIso();
  const res = ctx.db
    .prepare(
      `INSERT OR IGNORE INTO notifications(id, user_id, type, title, message, link, dedupe_key, created_at) VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(id, userId, kind, title.slice(0, 160), message.slice(0, 500), opts.link ?? null, opts.dedupeKey ?? null, createdAt);
  if (res.changes) ctx.rt.emitToUser(userId, 'notification:new', { id, type: kind, title, message, link: opts.link ?? null, createdAt, readAt: null });
}

export function notifyLabMembers(ctx: Ctx, labId: string, exceptUserId: string | null, kind: NotifyKind, title: string, message: string, link?: string) {
  const members = ctx.db
    .prepare(
      `SELECT user_id FROM lab_members WHERE lab_id = ? AND status = 'active'
       UNION SELECT user_id FROM lab_staff WHERE lab_id = ?`,
    )
    .all(labId, labId) as { user_id: string }[];
  for (const m of members) if (m.user_id !== exceptUserId) notify(ctx, m.user_id, kind, title, message, { link });
}

export function notifyLabStaff(ctx: Ctx, labId: string | null, kind: NotifyKind, title: string, message: string, opts: { link?: string; dedupeKey?: string } = {}) {
  const staff = labId
    ? (ctx.db.prepare('SELECT user_id FROM lab_staff WHERE lab_id = ?').all(labId) as { user_id: string }[])
    : [];
  const admins = ctx.db.prepare("SELECT id AS user_id FROM users WHERE role='admin' AND status='active'").all() as { user_id: string }[];
  const seen = new Set<string>();
  for (const r of [...staff, ...admins]) {
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    notify(ctx, r.user_id, kind, title, message, { link: opts.link, dedupeKey: opts.dedupeKey ? `${opts.dedupeKey}:${r.user_id}` : undefined });
  }
}

export type Severity = 'low' | 'medium' | 'high' | 'critical';

/** Rule-based (or AI-suggested) alert. Alerts never change attendance or accounts by themselves. */
export function raiseAlert(
  ctx: Ctx,
  a: { labId: string | null; type: string; severity: Severity; title: string; evidence: Record<string, unknown>; method?: 'rule' | 'ai'; dedupeKey?: string },
) {
  const id = newId();
  const res = ctx.db
    .prepare(
      `INSERT OR IGNORE INTO alerts(id, lab_id, alert_type, detection_method, severity, title, evidence_json, dedupe_key, created_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, a.labId, a.type, a.method ?? 'rule', a.severity, a.title, JSON.stringify(a.evidence), a.dedupeKey ?? null, nowIso());
  if (!res.changes) return null;
  if (a.labId) ctx.rt.emitToLabStaff(a.labId, 'alert:new', { id, type: a.type, severity: a.severity, title: a.title });
  notifyLabStaff(ctx, a.labId, 'security', `Alert: ${a.title}`, 'A new alert needs review.', { link: '/alerts' });
  return id;
}
