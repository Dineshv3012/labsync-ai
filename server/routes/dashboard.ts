import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import type { Ctx } from '../types';
import { reqUser } from '../types';
import { wrap } from '../errors';
import { requireRole } from '../middleware';
import { accessibleLabIds, inClause, managedLabIds } from '../permissions';
import { messageDto } from './chat';
import { fileDto } from './files';
import { attendanceDto } from './attendance';

export const dirSize = (dir: string): number => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => s + (e.isFile() ? fs.statSync(path.join(dir, e.name)).size : 0), 0);
  } catch { return 0; }
};

export function dashboardRoutes(ctx: Ctx) {
  const r = Router();
  const msgSel = `SELECT m.*, u.display_name AS sender_name, u.role AS sender_role, NULL AS file_id, NULL AS file_name, NULL AS file_size, NULL AS file_type, NULL AS file_deleted, NULL AS reply_content, NULL AS reply_sender FROM messages m JOIN users u ON u.id=m.sender_id`;
  const fileSel = `SELECT f.*, u.display_name AS uploader_name, l.name AS lab_name FROM files f JOIN users u ON u.id=f.uploader_id JOIN labs l ON l.id=f.lab_id`;

  r.get('/student', requireRole('student'), wrap((req, res) => {
    const u = reqUser(req);
    const ids = accessibleLabIds(ctx, u);
    const L = inClause(ids);
    const today = new Date().toISOString().slice(0, 10);
    const attendanceToday = ctx.db.prepare(`SELECT a.*, u.display_name AS student_name, u.student_or_staff_id AS student_number, u.department, l.name AS lab_name, l.code AS lab_code, s.title AS session_title, s.start_at AS session_start
      FROM attendance_records a JOIN users u ON u.id=a.student_id JOIN labs l ON l.id=a.lab_id JOIN lab_sessions s ON s.id=a.session_id WHERE a.student_id=? AND a.check_in_at >= ? ORDER BY a.check_in_at DESC LIMIT 1`).get(u.id, today) as any;
    const summary = ctx.db.prepare("SELECT COUNT(*) sessions, COALESCE(SUM(duration_minutes),0) minutes, SUM(status='missing_checkout') missing, SUM(verification_status='pending') pending FROM attendance_records WHERE student_id=?").get(u.id) as any;
    const unread = ids.length ? (ctx.db.prepare(`SELECT COUNT(*) c FROM messages m WHERE m.lab_id IN (${L}) AND m.deleted_at IS NULL AND m.sender_id != ? AND m.created_at > COALESCE((SELECT last_read_at FROM lab_reads WHERE lab_id=m.lab_id AND user_id=?),'1970')`).get(...ids, u.id, u.id) as any).c : 0;
    res.json({
      attendanceToday: attendanceToday ? attendanceDto(attendanceToday) : null,
      attendanceSummary: { sessions: summary.sessions, hours: Math.round((summary.minutes / 60) * 10) / 10, missingCheckouts: summary.missing ?? 0, pendingVerification: summary.pending ?? 0 },
      currentLabs: ids.length ? ctx.db.prepare(`SELECT l.id, l.name, l.code, l.room_number AS roomNumber, s.id AS sessionId, s.start_at AS startAt FROM lab_sessions s JOIN labs l ON l.id=s.lab_id WHERE s.status='active' AND l.id IN (${L})`).all(...ids) : [],
      unreadMessages: unread,
      sharedFiles: ids.length ? (ctx.db.prepare(`SELECT COUNT(*) c FROM files WHERE lab_id IN (${L}) AND deleted_at IS NULL`).get(...ids) as any).c : 0,
      recentMessages: ids.length ? (ctx.db.prepare(`${msgSel} WHERE m.lab_id IN (${L}) AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 5`).all(...ids) as any[]).map(messageDto) : [],
      recentFiles: ids.length ? (ctx.db.prepare(`${fileSel} WHERE f.lab_id IN (${L}) AND f.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 5`).all(...ids) as any[]).map(fileDto) : [],
      announcements: ids.length ? ctx.db.prepare(`SELECT a.id, a.title, a.content, a.priority, a.created_at AS createdAt, l.name AS labName, l.id AS labId FROM announcements a JOIN labs l ON l.id=a.lab_id WHERE a.lab_id IN (${L}) ORDER BY a.created_at DESC LIMIT 5`).all(...ids) : [],
      upcoming: ids.length ? ctx.db.prepare(`SELECT s.id, s.title, s.scheduled_start AS start, s.scheduled_end AS end, l.name AS labName, l.id AS labId FROM lab_sessions s JOIN labs l ON l.id=s.lab_id WHERE s.status='scheduled' AND s.scheduled_start > ? AND s.lab_id IN (${L}) ORDER BY s.scheduled_start LIMIT 5`).all(new Date().toISOString(), ...ids) : [],
      todaysSchedule: ids.length ? ctx.db.prepare(`SELECT s.id, s.title, COALESCE(s.start_at, s.scheduled_start) AS start, s.status, l.name AS labName FROM lab_sessions s JOIN labs l ON l.id=s.lab_id WHERE s.lab_id IN (${L}) AND COALESCE(s.start_at, s.scheduled_start) >= ? AND COALESCE(s.start_at, s.scheduled_start) < ? ORDER BY start`).all(...ids, today, new Date(Date.now() + 86400000).toISOString().slice(0, 10)) : [],
    });
  }));

  r.get('/staff', requireRole('staff', 'admin'), wrap((req, res) => {
    const u = reqUser(req);
    const ids = managedLabIds(ctx, u);
    const L = inClause(ids);
    const c = (sql: string, ...p: unknown[]) => (ctx.db.prepare(sql).get(...p) as any).c as number;
    res.json({
      totalLabs: ids.length,
      activeSessions: ids.length ? c(`SELECT COUNT(*) c FROM lab_sessions WHERE status='active' AND lab_id IN (${L})`, ...ids) : 0,
      checkedInNow: ids.length ? c(`SELECT COUNT(*) c FROM attendance_records WHERE status='checked_in' AND lab_id IN (${L})`, ...ids) : 0,
      pendingVerification: ids.length ? c(`SELECT COUNT(*) c FROM attendance_records WHERE verification_status='pending' AND status != 'checked_in' AND lab_id IN (${L})`, ...ids) : 0,
      openAlerts: ids.length ? c(`SELECT COUNT(*) c FROM alerts WHERE status IN ('open','reviewing') AND lab_id IN (${L})`, ...ids) : 0,
      recentUploads: ids.length ? c(`SELECT COUNT(*) c FROM files WHERE deleted_at IS NULL AND created_at > ? AND lab_id IN (${L})`, new Date(Date.now() - 7 * 86400000).toISOString(), ...ids) : 0,
      unreadMessages: ids.length ? c(`SELECT COUNT(*) c FROM messages m WHERE m.lab_id IN (${L}) AND m.deleted_at IS NULL AND m.sender_id != ? AND m.created_at > COALESCE((SELECT last_read_at FROM lab_reads WHERE lab_id=m.lab_id AND user_id=?),'1970')`, ...ids, u.id, u.id) : 0,
      upcoming: ids.length ? ctx.db.prepare(`SELECT s.id, s.title, s.scheduled_start AS start, l.name AS labName, l.id AS labId FROM lab_sessions s JOIN labs l ON l.id=s.lab_id WHERE s.status='scheduled' AND s.lab_id IN (${L}) ORDER BY s.scheduled_start LIMIT 5`).all(...ids) : [],
      recentFiles: ids.length ? (ctx.db.prepare(`${fileSel} WHERE f.lab_id IN (${L}) AND f.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 5`).all(...ids) as any[]).map(fileDto) : [],
      recentAttendance: ids.length ? (ctx.db.prepare(`SELECT a.*, u.display_name AS student_name, u.student_or_staff_id AS student_number, u.department, l.name AS lab_name, l.code AS lab_code, s.title AS session_title, s.start_at AS session_start FROM attendance_records a JOIN users u ON u.id=a.student_id JOIN labs l ON l.id=a.lab_id JOIN lab_sessions s ON s.id=a.session_id WHERE a.lab_id IN (${L}) ORDER BY a.check_in_at DESC LIMIT 8`).all(...ids) as any[]).map(attendanceDto) : [],
    });
  }));

  r.get('/admin', requireRole('admin'), wrap((_req, res) => {
    const c = (sql: string, ...p: unknown[]) => (ctx.db.prepare(sql).get(...p) as any).c as number;
    const since = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const storageBytes = (ctx.db.prepare('SELECT COALESCE(SUM(size),0) s FROM files WHERE deleted_at IS NULL').get() as any).s as number;
    res.json({
      totals: {
        users: c('SELECT COUNT(*) c FROM users'), students: c("SELECT COUNT(*) c FROM users WHERE role='student'"), staff: c("SELECT COUNT(*) c FROM users WHERE role='staff'"), admins: c("SELECT COUNT(*) c FROM users WHERE role='admin'"),
        activeLabs: c("SELECT COUNT(*) c FROM labs WHERE status='active'"), activeSessions: c("SELECT COUNT(*) c FROM lab_sessions WHERE status='active'"),
        pendingApprovals: c("SELECT COUNT(*) c FROM users WHERE status='pending'"), openAlerts: c("SELECT COUNT(*) c FROM alerts WHERE status IN ('open','reviewing')"),
        attendanceRecords: c('SELECT COUNT(*) c FROM attendance_records'), storageBytes,
      },
      attendanceOverTime: ctx.db.prepare("SELECT substr(check_in_at,1,10) AS date, COUNT(*) AS records FROM attendance_records WHERE check_in_at >= ? GROUP BY date ORDER BY date").all(since),
      labUtilization: ctx.db.prepare("SELECT l.name AS lab, COUNT(a.id) AS records FROM labs l LEFT JOIN attendance_records a ON a.lab_id=l.id AND a.check_in_at >= ? GROUP BY l.id ORDER BY records DESC LIMIT 8").all(since),
      userActivity: ctx.db.prepare("SELECT substr(created_at,1,10) AS date, COUNT(*) AS logins FROM audit_logs WHERE action='USER_LOGIN' AND created_at >= ? GROUP BY date ORDER BY date").all(since),
      fileActivity: ctx.db.prepare("SELECT substr(created_at,1,10) AS date, COUNT(*) AS uploads FROM files WHERE created_at >= ? GROUP BY date ORDER BY date").all(since),
      alertStatus: ctx.db.prepare('SELECT status, COUNT(*) AS count FROM alerts GROUP BY status').all(),
      recentAdminActivity: (ctx.db.prepare("SELECT id, actor_name, action, resource_type, resource_id, created_at FROM audit_logs WHERE actor_role='admin' ORDER BY created_at DESC LIMIT 8").all() as any[]).map((a) => ({ id: a.id, actor: a.actor_name, action: a.action, resourceType: a.resource_type, resourceId: a.resource_id, createdAt: a.created_at })),
    });
  }));

  r.get('/health', requireRole('admin'), wrap((_req, res) => {
    const dbSize = ctx.config.databasePath === ':memory:' ? 0 : (() => { try { return fs.statSync(ctx.config.databasePath).size; } catch { return 0; } })();
    res.json({
      status: 'ok', uptimeSeconds: Math.round(process.uptime()), node: process.version, environment: ctx.config.nodeEnv,
      memoryMB: Math.round(process.memoryUsage().rss / 1048576), databaseBytes: dbSize, uploadsBytes: dirSize(ctx.config.uploadDir),
      realtimeConnections: ctx.rt.connectionCount(), ai: { configured: ctx.ai.provider.configured, model: ctx.ai.provider.configured ? (ctx.settings.get('ai.model') || ctx.ai.provider.model) : null },
      email: { configured: ctx.mailer.configured }, requireEmailVerification: ctx.config.requireEmailVerification,
      lastRetentionRun: (ctx.db.prepare("SELECT created_at FROM audit_logs WHERE action='RETENTION_RUN' ORDER BY created_at DESC LIMIT 1").get() as any)?.created_at ?? null,
    });
  }));
  return r;
}
