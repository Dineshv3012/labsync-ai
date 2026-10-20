import { Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../types';
import { reqUser } from '../types';
import { HttpError, badRequest, conflict, forbidden, notFound, parse, wrap } from '../errors';
import { requireRole } from '../middleware';
import { assertLabActive, inClause, isLabStaff, managedLabIds, requireLabMember, requireLabStaff } from '../permissions';
import { newId, sha256 } from '../security';
import { audit, notify } from '../services';
import { nowIso } from '../db';

const SELECT = `SELECT a.*, u.display_name AS student_name, u.student_or_staff_id AS student_number, u.department, l.name AS lab_name, l.code AS lab_code, s.title AS session_title, s.start_at AS session_start
  FROM attendance_records a JOIN users u ON u.id = a.student_id JOIN labs l ON l.id = a.lab_id JOIN lab_sessions s ON s.id = a.session_id`;

export const attendanceDto = (a: any) => ({
  id: a.id, labId: a.lab_id, labName: a.lab_name, labCode: a.lab_code, sessionId: a.session_id, sessionTitle: a.session_title, sessionStart: a.session_start,
  studentId: a.student_id, studentName: a.student_name, studentNumber: a.student_number, department: a.department,
  checkInAt: a.check_in_at, checkOutAt: a.check_out_at, durationMinutes: a.duration_minutes, status: a.status,
  method: a.method, verificationStatus: a.verification_status,
});

const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));

export function attendanceRoutes(ctx: Ctx) {
  const r = Router();

  r.post('/check-in', requireRole('student'), wrap((req, res) => {
    const u = reqUser(req);
    const b = parse(z.object({ labId: z.string().min(1), qrToken: z.string().max(100).optional() }).strict(), req.body);
    const lab = requireLabMember(ctx, u, b.labId);
    assertLabActive(lab);
    const session = ctx.db.prepare("SELECT * FROM lab_sessions WHERE lab_id=? AND status='active'").get(lab.id) as any;
    if (!session) throw new HttpError(409, 'NO_ACTIVE_SESSION', 'There is no active session in this laboratory right now.');
    let method: 'self' | 'qr' = 'self';
    if (b.qrToken) {
      if (!session.checkin_token_hash || sha256(b.qrToken) !== session.checkin_token_hash) throw forbidden('That check-in QR code is not valid for this session.', 'QR_INVALID');
      method = 'qr';
    } else if (ctx.settings.get('attendance.requireQrCheckin')) {
      throw forbidden('This institution requires scanning the session QR code to check in.', 'QR_REQUIRED');
    }
    if (!ctx.settings.get('attendance.allowConcurrentLabs')) {
      const other = ctx.db.prepare("SELECT l.name FROM attendance_records a JOIN labs l ON l.id=a.lab_id WHERE a.student_id=? AND a.status='checked_in' AND a.lab_id != ?").get(u.id, lab.id) as any;
      if (other) throw conflict(`You are still checked in to ${other.name}. Check out there first.`, 'OVERLAPPING_SESSION');
    }
    const existing = ctx.db.prepare('SELECT status FROM attendance_records WHERE session_id=? AND student_id=?').get(session.id, u.id) as any;
    if (existing) throw conflict(existing.status === 'checked_in' ? 'You are already checked in to this session.' : 'You already have an attendance record for this session.', 'DUPLICATE_CHECKIN');
    const id = newId();
    const t = nowIso(); // server clock only: clients cannot choose timestamps
    ctx.db.prepare(`INSERT INTO attendance_records(id,student_id,lab_id,session_id,check_in_at,status,method,verification_status,created_at) VALUES(?,?,?,?,?,'checked_in',?,'pending',?)`)
      .run(id, u.id, lab.id, session.id, t, method, t);
    audit(ctx, u, 'ATTENDANCE_CHECKIN', 'attendance', id, { labId: lab.id, method }, req);
    notify(ctx, u.id, 'attendance', 'Checked in', `You checked in to ${lab.name}.`, { link: '/attendance' });
    ctx.rt.emitToLab(lab.id, 'attendance:update', { labId: lab.id, studentId: u.id, status: 'checked_in' });
    const full = ctx.db.prepare(`${SELECT} WHERE a.id = ?`).get(id);
    res.status(201).json({ record: attendanceDto(full) });
  }));

  r.post('/check-out', requireRole('student'), wrap((req, res) => {
    const u = reqUser(req);
    const b = parse(z.object({ labId: z.string().min(1) }).strict(), req.body);
    const lab = requireLabMember(ctx, u, b.labId);
    const rec = ctx.db.prepare("SELECT * FROM attendance_records WHERE lab_id=? AND student_id=? AND status='checked_in' ORDER BY check_in_at DESC").get(lab.id, u.id) as any;
    if (!rec) throw conflict('You are not checked in to this laboratory.', 'NOT_CHECKED_IN');
    const t = nowIso();
    const dur = minutesBetween(rec.check_in_at, t);
    ctx.db.prepare("UPDATE attendance_records SET check_out_at=?, duration_minutes=?, status='checked_out' WHERE id=?").run(t, dur, rec.id);
    audit(ctx, u, 'ATTENDANCE_CHECKOUT', 'attendance', rec.id, { labId: lab.id, durationMinutes: dur }, req);
    notify(ctx, u.id, 'attendance', 'Checked out', `Session length: ${dur} minute(s).`, { link: '/attendance' });
    ctx.rt.emitToLab(lab.id, 'attendance:update', { labId: lab.id, studentId: u.id, status: 'checked_out' });
    res.json({ record: attendanceDto(ctx.db.prepare(`${SELECT} WHERE a.id = ?`).get(rec.id)) });
  }));

  // Staff-assisted recording for a student who cannot use their own device.
  r.post('/staff-record', requireRole('staff', 'admin'), wrap((req, res) => {
    const u = reqUser(req);
    const b = parse(z.object({ labId: z.string(), studentId: z.string(), action: z.enum(['check_in', 'check_out']) }).strict(), req.body);
    const lab = requireLabStaff(ctx, u, b.labId);
    assertLabActive(lab);
    const session = ctx.db.prepare("SELECT * FROM lab_sessions WHERE lab_id=? AND status='active'").get(lab.id) as any;
    if (!session) throw new HttpError(409, 'NO_ACTIVE_SESSION', 'Start a session before recording attendance.');
    const member = ctx.db.prepare("SELECT 1 FROM lab_members WHERE lab_id=? AND user_id=? AND status='active'").get(lab.id, b.studentId);
    if (!member) throw badRequest('That student is not a member of this laboratory.');
    const t = nowIso();
    let id: string;
    if (b.action === 'check_in') {
      if (ctx.db.prepare('SELECT 1 FROM attendance_records WHERE session_id=? AND student_id=?').get(session.id, b.studentId)) throw conflict('This student already has a record for the session.', 'DUPLICATE_CHECKIN');
      id = newId();
      ctx.db.prepare(`INSERT INTO attendance_records(id,student_id,lab_id,session_id,check_in_at,status,method,verification_status,created_at) VALUES(?,?,?,?,?,'checked_in','staff','verified',?)`).run(id, b.studentId, lab.id, session.id, t, t);
    } else {
      const rec = ctx.db.prepare("SELECT * FROM attendance_records WHERE session_id=? AND student_id=? AND status='checked_in'").get(session.id, b.studentId) as any;
      if (!rec) throw conflict('This student is not checked in.', 'NOT_CHECKED_IN');
      id = rec.id;
      ctx.db.prepare("UPDATE attendance_records SET check_out_at=?, duration_minutes=?, status='checked_out', method='staff', verification_status='verified' WHERE id=?").run(t, minutesBetween(rec.check_in_at, t), id);
    }
    audit(ctx, u, `ATTENDANCE_STAFF_${b.action.toUpperCase()}`, 'attendance', id, { labId: lab.id, studentId: b.studentId }, req);
    notify(ctx, b.studentId, 'attendance', b.action === 'check_in' ? 'Checked in by staff' : 'Checked out by staff', `Recorded by ${u.name} for ${lab.name}.`, { link: '/attendance' });
    ctx.rt.emitToLab(lab.id, 'attendance:update', { labId: lab.id, studentId: b.studentId });
    res.status(201).json({ record: attendanceDto(ctx.db.prepare(`${SELECT} WHERE a.id = ?`).get(id)) });
  }));

  r.get('/', wrap((req, res) => {
    const u = reqUser(req);
    const q = parse(z.object({
      labId: z.string().optional(), studentId: z.string().optional(), status: z.enum(['checked_in', 'checked_out', 'missing_checkout']).optional(),
      verification: z.enum(['pending', 'verified', 'corrected']).optional(),
      from: z.string().optional(), to: z.string().optional(), sessionId: z.string().optional(),
      page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }), req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (u.role === 'student') { where.push('a.student_id = ?'); params.push(u.id); }
    else {
      const ids = managedLabIds(ctx, u);
      where.push(`a.lab_id IN (${inClause(ids)})`); params.push(...ids);
      if (q.studentId) { where.push('a.student_id = ?'); params.push(q.studentId); }
    }
    if (q.labId) { where.push('a.lab_id = ?'); params.push(q.labId); }
    if (q.sessionId) { where.push('a.session_id = ?'); params.push(q.sessionId); }
    if (q.status) { where.push('a.status = ?'); params.push(q.status); }
    if (q.verification) { where.push('a.verification_status = ?'); params.push(q.verification); }
    if (q.from) { where.push('a.check_in_at >= ?'); params.push(q.from); }
    if (q.to) { where.push('a.check_in_at <= ?'); params.push(q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (ctx.db.prepare(`SELECT COUNT(*) c FROM attendance_records a ${w}`).get(...params) as any).c;
    const rows = ctx.db.prepare(`${SELECT} ${w} ORDER BY a.check_in_at DESC LIMIT ? OFFSET ?`).all(...params, q.pageSize, (q.page - 1) * q.pageSize);
    res.json({ records: rows.map(attendanceDto), total, page: q.page, pageSize: q.pageSize });
  }));

  const loadManaged = (req: any, id: string) => {
    const u = reqUser(req);
    const rec = ctx.db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as any;
    if (!rec) throw notFound('Attendance record not found.');
    if (!isLabStaff(ctx, u, rec.lab_id)) throw forbidden('Only staff of this laboratory can change attendance.');
    return { u, rec };
  };

  r.post('/:id/verify', requireRole('staff', 'admin'), wrap((req, res) => {
    const { u, rec } = loadManaged(req, String(req.params.id));
    if (rec.status === 'missing_checkout') throw conflict('Resolve the missing check-out with a correction before verifying.', 'NEEDS_CORRECTION');
    ctx.db.prepare("UPDATE attendance_records SET verification_status = CASE WHEN verification_status='corrected' THEN 'corrected' ELSE 'verified' END WHERE id=?").run(rec.id);
    audit(ctx, u, 'ATTENDANCE_VERIFY', 'attendance', rec.id, { labId: rec.lab_id }, req);
    res.json({ record: attendanceDto(ctx.db.prepare(`${SELECT} WHERE a.id = ?`).get(rec.id)) });
  }));

  r.post('/:id/correct', requireRole('staff', 'admin'), wrap((req, res) => {
    const { u, rec } = loadManaged(req, String(req.params.id));
    const b = parse(z.object({
      reason: z.string().trim().min(5, 'Give a reason of at least 5 characters.').max(500),
      checkInAt: z.string().datetime().optional(), checkOutAt: z.string().datetime().nullable().optional(),
    }).strict(), req.body);
    const checkIn = b.checkInAt ?? rec.check_in_at;
    const checkOut = b.checkOutAt === undefined ? rec.check_out_at : b.checkOutAt;
    if (checkOut && checkOut < checkIn) throw badRequest('Check-out cannot be before check-in.');
    if (checkOut && new Date(checkOut).getTime() > Date.now() + 60_000) throw badRequest('Check-out cannot be in the future.');
    const status = checkOut ? 'checked_out' : rec.status === 'missing_checkout' ? 'missing_checkout' : 'checked_in';
    const dur = checkOut ? minutesBetween(checkIn, checkOut) : 0;
    const prev = { checkInAt: rec.check_in_at, checkOutAt: rec.check_out_at, status: rec.status, durationMinutes: rec.duration_minutes };
    const next = { checkInAt: checkIn, checkOutAt: checkOut, status, durationMinutes: dur };
    ctx.db.transaction(() => {
      ctx.db.prepare("UPDATE attendance_records SET check_in_at=?, check_out_at=?, status=?, duration_minutes=?, verification_status='corrected' WHERE id=?").run(checkIn, checkOut, status, dur, rec.id);
      ctx.db.prepare('INSERT INTO attendance_corrections(id,attendance_id,editor_id,reason,previous_json,new_json,created_at) VALUES(?,?,?,?,?,?,?)').run(newId(), rec.id, u.id, b.reason, JSON.stringify(prev), JSON.stringify(next), nowIso());
    })();
    audit(ctx, u, 'ATTENDANCE_CORRECTION', 'attendance', rec.id, { labId: rec.lab_id, previous: prev, next, reason: b.reason }, req);
    notify(ctx, rec.student_id, 'attendance', 'Attendance record corrected', `${u.name} corrected your record for ${rec.lab_name}. Reason: ${b.reason}`, { link: '/attendance' });
    res.json({ record: attendanceDto(ctx.db.prepare(`${SELECT} WHERE a.id = ?`).get(rec.id)) });
  }));

  r.get('/:id/corrections', wrap((req, res) => {
    const u = reqUser(req);
    const rec = ctx.db.prepare('SELECT student_id, lab_id FROM attendance_records WHERE id=?').get(String(req.params.id)) as any;
    if (!rec) throw notFound('Attendance record not found.');
    if (rec.student_id !== u.id && !isLabStaff(ctx, u, rec.lab_id)) throw forbidden();
    const rows = ctx.db.prepare('SELECT c.*, e.display_name AS editor FROM attendance_corrections c JOIN users e ON e.id = c.editor_id WHERE attendance_id=? ORDER BY c.created_at DESC').all(String(req.params.id)) as any[];
    res.json({ corrections: rows.map((c) => ({ id: c.id, editor: c.editor, reason: c.reason, previous: JSON.parse(c.previous_json), next: JSON.parse(c.new_json), createdAt: c.created_at })) });
  }));

  return r;
}
