import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../types';
import { reqUser } from '../types';
import { badRequest, forbidden, parse, wrap } from '../errors';
import { inClause, managedLabIds } from '../permissions';
import { audit } from '../services';
import { toCsv } from '../security';

export const REPORT_TYPES = [
  'attendance-daily', 'attendance-weekly', 'attendance-monthly', 'attendance-semester', 'student-history', 'lab-usage',
  'session-duration', 'room-occupancy', 'file-activity', 'security-events', 'alert-reviews',
] as const;

type Report = { title: string; columns: string[]; rows: Record<string, unknown>[]; chart?: { x: string; y: string } };

export function reportRoutes(ctx: Ctx) {
  const r = Router();
  r.get('/:type', wrap((req, res) => {
    const u = reqUser(req);
    const type = String(req.params.type) as (typeof REPORT_TYPES)[number];
    if (!REPORT_TYPES.includes(type)) throw badRequest('Unknown report type.');
    const f = parse(z.object({
      labId: z.string().optional(), course: z.string().max(100).optional(), studentId: z.string().optional(), staffId: z.string().optional(),
      status: z.enum(['checked_in', 'checked_out', 'missing_checkout']).optional(), event: z.string().max(60).optional(),
      from: z.string().optional(), to: z.string().optional(), format: z.enum(['json', 'csv']).default('json'),
    }), req.query);
    const from = f.from ? (f.from.length === 10 ? `${f.from}T00:00:00.000Z` : f.from) : new Date(Date.now() - 30 * 86400000).toISOString();
    const to = f.to ? (f.to.length === 10 ? `${f.to}T23:59:59.999Z` : f.to) : new Date().toISOString();

    // Scope: students may only run their own history; staff only their labs; admins everything.
    if (u.role === 'student' && type !== 'student-history') throw forbidden('Students can only view their own attendance history.');
    const labs = u.role === 'student' ? [] : managedLabIds(ctx, u);
    let labScope = f.labId ? labs.filter((l) => l === f.labId) : labs;
    if (f.labId && u.role !== 'student' && !labScope.length) throw forbidden('You do not manage that laboratory.');
    if (f.course) labScope = (ctx.db.prepare(`SELECT id FROM labs WHERE id IN (${inClause(labScope)}) AND course = ?`).all(...labScope, f.course) as { id: string }[]).map((x) => x.id);
    if (f.staffId) labScope = (ctx.db.prepare(`SELECT lab_id AS id FROM lab_staff WHERE user_id = ? AND lab_id IN (${inClause(labScope)})`).all(f.staffId, ...labScope) as { id: string }[]).map((x) => x.id);
    const L = inClause(labScope);
    const extra: string[] = [];
    const ep: unknown[] = [];
    if (f.status) { extra.push('a.status = ?'); ep.push(f.status); }
    const att = (sel: string, group: string) =>
      ctx.db.prepare(`SELECT ${sel} FROM attendance_records a JOIN labs l ON l.id=a.lab_id JOIN users u ON u.id=a.student_id
        WHERE a.lab_id IN (${L}) AND a.check_in_at BETWEEN ? AND ? ${f.studentId ? 'AND a.student_id = ?' : ''} ${extra.length ? 'AND ' + extra.join(' AND ') : ''} ${group}`)
        .all(...labScope, from, to, ...(f.studentId ? [f.studentId] : []), ...ep) as Record<string, unknown>[];

    let rep: Report;
    switch (type) {
      case 'attendance-daily':
      case 'attendance-weekly':
      case 'attendance-monthly':
      case 'attendance-semester': {
        const bucket = { 'attendance-daily': "substr(a.check_in_at,1,10)", 'attendance-weekly': "strftime('%Y-W%W', a.check_in_at)", 'attendance-monthly': "substr(a.check_in_at,1,7)", 'attendance-semester': "substr(a.check_in_at,1,4) || CASE WHEN CAST(substr(a.check_in_at,6,2) AS INTEGER) BETWEEN 1 AND 6 THEN '-S1' ELSE '-S2' END" }[type];
        rep = { title: type.replace('-', ' '), columns: ['period', 'lab', 'records', 'students', 'avgMinutes', 'missingCheckouts'], chart: { x: 'period', y: 'records' },
          rows: att(`${bucket} AS period, l.name AS lab, COUNT(*) AS records, COUNT(DISTINCT a.student_id) AS students, ROUND(AVG(NULLIF(a.duration_minutes,0)),1) AS avgMinutes, SUM(a.status='missing_checkout') AS missingCheckouts`, 'GROUP BY period, l.id ORDER BY period DESC, lab') };
        break;
      }
      case 'student-history': {
        const sid = u.role === 'student' ? u.id : f.studentId;
        if (!sid) throw badRequest('Choose a student for this report.');
        const rows = ctx.db.prepare(`SELECT substr(a.check_in_at,1,10) AS date, l.name AS lab, a.check_in_at AS checkIn, a.check_out_at AS checkOut, a.duration_minutes AS minutes, a.status, a.verification_status AS verification
          FROM attendance_records a JOIN labs l ON l.id=a.lab_id WHERE a.student_id=? AND a.check_in_at BETWEEN ? AND ? ${u.role === 'student' ? '' : `AND a.lab_id IN (${L})`} ORDER BY a.check_in_at DESC`)
          .all(sid, from, to, ...(u.role === 'student' ? [] : labScope)) as Record<string, unknown>[];
        rep = { title: 'student attendance history', columns: ['date', 'lab', 'checkIn', 'checkOut', 'minutes', 'status', 'verification'], rows, chart: { x: 'date', y: 'minutes' } };
        break;
      }
      case 'lab-usage':
        rep = { title: 'laboratory usage', columns: ['lab', 'course', 'sessions', 'attendanceRecords', 'uniqueStudents', 'totalHours'], chart: { x: 'lab', y: 'attendanceRecords' },
          rows: ctx.db.prepare(`SELECT l.name AS lab, l.course, COUNT(DISTINCT s.id) AS sessions, COUNT(a.id) AS attendanceRecords, COUNT(DISTINCT a.student_id) AS uniqueStudents, ROUND(COALESCE(SUM(a.duration_minutes),0)/60.0,1) AS totalHours
            FROM labs l LEFT JOIN lab_sessions s ON s.lab_id=l.id AND s.start_at BETWEEN ? AND ? LEFT JOIN attendance_records a ON a.session_id=s.id WHERE l.id IN (${L}) GROUP BY l.id ORDER BY attendanceRecords DESC`).all(from, to, ...labScope) as any };
        break;
      case 'session-duration':
        rep = { title: 'session duration', columns: ['lab', 'session', 'startedAt', 'endedAt', 'minutes', 'attendees'], chart: { x: 'startedAt', y: 'minutes' },
          rows: ctx.db.prepare(`SELECT l.name AS lab, COALESCE(NULLIF(s.title,''),'Session') AS session, s.start_at AS startedAt, s.end_at AS endedAt,
            CAST(ROUND((julianday(COALESCE(s.end_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))) - julianday(s.start_at))*1440) AS INTEGER) AS minutes, (SELECT COUNT(*) FROM attendance_records a WHERE a.session_id=s.id) AS attendees
            FROM lab_sessions s JOIN labs l ON l.id=s.lab_id WHERE s.lab_id IN (${L}) AND s.start_at BETWEEN ? AND ? ORDER BY s.start_at DESC`).all(...labScope, from, to) as any };
        break;
      case 'room-occupancy':
        rep = { title: 'room occupancy', columns: ['lab', 'session', 'startedAt', 'capacity', 'peakCheckedIn', 'occupancyPct'], chart: { x: 'startedAt', y: 'occupancyPct' },
          rows: ctx.db.prepare(`SELECT l.name AS lab, COALESCE(NULLIF(s.title,''),'Session') AS session, s.start_at AS startedAt, l.capacity AS capacity,
            (SELECT COUNT(*) FROM attendance_records a WHERE a.session_id=s.id) AS peakCheckedIn,
            ROUND(100.0*(SELECT COUNT(*) FROM attendance_records a WHERE a.session_id=s.id)/l.capacity,1) AS occupancyPct
            FROM lab_sessions s JOIN labs l ON l.id=s.lab_id WHERE s.lab_id IN (${L}) AND s.start_at BETWEEN ? AND ? ORDER BY s.start_at DESC`).all(...labScope, from, to) as any };
        break;
      case 'file-activity':
        rep = { title: 'file-sharing activity', columns: ['date', 'lab', 'uploads', 'totalMB', 'uploaders'], chart: { x: 'date', y: 'uploads' },
          rows: ctx.db.prepare(`SELECT substr(f.created_at,1,10) AS date, l.name AS lab, COUNT(*) AS uploads, ROUND(SUM(f.size)/1048576.0,2) AS totalMB, COUNT(DISTINCT f.uploader_id) AS uploaders
            FROM files f JOIN labs l ON l.id=f.lab_id WHERE f.lab_id IN (${L}) AND f.created_at BETWEEN ? AND ? GROUP BY date, l.id ORDER BY date DESC`).all(...labScope, from, to) as any };
        break;
      case 'security-events': {
        const actions = ['JOIN_FAILED', 'LOGIN_FAILED', 'LOGIN_LOCKED', 'FILE_REJECTED', 'ROOM_CODE_REVOKE', 'ROOM_CODE_REVOKE_ALL', 'MESSAGE_MODERATE_DELETE', 'MESSAGE_REPORT', 'FILE_REPORT', 'ATTENDANCE_CORRECTION'];
        const evt = f.event ? [f.event] : actions;
        const rows = ctx.db.prepare(`SELECT created_at AS time, action AS event, actor_name AS actor, resource_type AS resource, resource_id AS resourceId, metadata_json AS details
          FROM audit_logs WHERE action IN (${inClause(evt)}) AND created_at BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 1000`).all(...evt, from, to) as any[];
        const scoped = u.role === 'admin' ? rows : rows.filter((x) => { try { const m = JSON.parse(x.details); return m.labId && labScope.includes(m.labId); } catch { return false; } });
        rep = { title: 'security events', columns: ['time', 'event', 'actor', 'resource', 'resourceId', 'details'], rows: scoped };
        break;
      }
      case 'alert-reviews':
        rep = { title: 'alert reviews', columns: ['createdAt', 'lab', 'type', 'method', 'severity', 'status', 'reviewer', 'decision', 'notes'],
          rows: ctx.db.prepare(`SELECT a.created_at AS createdAt, l.name AS lab, a.alert_type AS type, a.detection_method AS method, a.severity, a.status, ru.display_name AS reviewer, i.decision, i.notes
            FROM alerts a LEFT JOIN labs l ON l.id=a.lab_id LEFT JOIN incident_reviews i ON i.alert_id=a.id LEFT JOIN users ru ON ru.id=i.reviewer_id
            WHERE ${u.role === 'admin' ? '1=1' : `a.lab_id IN (${L})`} AND a.created_at BETWEEN ? AND ? ORDER BY a.created_at DESC`).all(...(u.role === 'admin' ? [] : labScope), from, to) as any };
        break;
    }
    audit(ctx, u, 'REPORT_GENERATE', 'report', type, { format: f.format, rows: rep.rows.length }, req);
    const generatedAt = new Date().toISOString();
    if (f.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="labsync-${type}-${generatedAt.slice(0, 10)}.csv"`);
      return res.send('\uFEFF' + toCsv(rep.columns, rep.rows));
    }
    res.json({ ...rep, type, generatedAt, range: { from, to } });
  }));
  return r;
}
