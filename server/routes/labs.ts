import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import type { Ctx } from '../types';
import { clientIp, reqUser } from '../types';
import { HttpError, badRequest, conflict, forbidden, notFound, parse, tooMany, wrap } from '../errors';
import { requireRole } from '../middleware';
import { assertLabActive, getLab, inClause, isLabStaff, requireLabMember, requireLabStaff, accessibleLabIds, type LabRow } from '../permissions';
import { formatRoomCode, generateRoomCode, hashRoomCode, newId, normalizeRoomCode, randomToken, sha256 } from '../security';
import { audit, notify, notifyLabMembers, raiseAlert } from '../services';
import { nowIso } from '../db';

const labFields = {
  name: z.string().trim().min(3, 'Name must be at least 3 characters.').max(120),
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, - or _ only.'),
  description: z.string().trim().max(1000).default(''),
  course: z.string().trim().max(120).default(''),
  building: z.string().trim().max(80).default(''),
  roomNumber: z.string().trim().max(40).default(''),
  capacity: z.number().int().min(1).max(500),
  schedule: z.string().trim().max(200).default(''),
  startsOn: z.string().date().nullable().optional(),
  endsOn: z.string().date().nullable().optional(),
};

export function labDto(ctx: Ctx, lab: LabRow, userId?: string) {
  const staff = ctx.db.prepare('SELECT u.id, u.display_name AS name FROM lab_staff s JOIN users u ON u.id = s.user_id WHERE s.lab_id = ?').all(lab.id);
  const members = (ctx.db.prepare("SELECT COUNT(*) c FROM lab_members WHERE lab_id = ? AND status='active' AND membership_role='student'").get(lab.id) as any).c;
  const active = ctx.db.prepare("SELECT id, start_at AS startAt, title FROM lab_sessions WHERE lab_id = ? AND status='active'").get(lab.id) as any;
  const checkedIn = active ? (ctx.db.prepare("SELECT COUNT(*) c FROM attendance_records WHERE session_id = ? AND status='checked_in'").get(active.id) as any).c : 0;
  const unread = userId
    ? (ctx.db.prepare(`SELECT COUNT(*) c FROM messages m WHERE m.lab_id = ? AND m.deleted_at IS NULL AND m.sender_id != ? AND m.created_at > COALESCE((SELECT last_read_at FROM lab_reads WHERE lab_id = m.lab_id AND user_id = ?), '1970')`).get(lab.id, userId, userId) as any).c
    : 0;
  return {
    id: lab.id, name: lab.name, code: lab.code, description: lab.description, course: lab.course, building: lab.building,
    roomNumber: lab.room_number, capacity: lab.capacity, schedule: lab.schedule, startsOn: lab.starts_on, endsOn: lab.ends_on,
    status: lab.status, createdAt: lab.created_at, staff, memberCount: members, activeSession: active ?? null, checkedInCount: checkedIn, unread,
  };
}

export function labRoutes(ctx: Ctx) {
  const r = Router();

  r.get('/', wrap((req, res) => {
    const u = reqUser(req);
    const ids = accessibleLabIds(ctx, u);
    const status = req.query.status === 'archived' ? 'archived' : req.query.status === 'all' ? null : 'active';
    const rows = ids.length
      ? (ctx.db.prepare(`SELECT * FROM labs WHERE id IN (${inClause(ids)}) ${status ? 'AND status = ?' : ''} ORDER BY name`).all(...ids, ...(status ? [status] : [])) as LabRow[])
      : [];
    const labs = rows.map((l) => {
      const dto = labDto(ctx, l, u.id) as any;
      if (u.role === 'student') {
        dto.myAttendance = ctx.db.prepare(
          `SELECT a.id, a.status, a.check_in_at AS checkInAt, a.check_out_at AS checkOutAt, a.verification_status AS verificationStatus
           FROM attendance_records a JOIN lab_sessions s ON s.id = a.session_id WHERE a.lab_id = ? AND a.student_id = ? AND s.status='active'`,
        ).get(l.id, u.id) ?? null;
      }
      return dto;
    });
    res.json({ labs });
  }));

  r.get('/:id', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabMember(ctx, u, String(req.params.id));
    res.json({ lab: labDto(ctx, lab, u.id), canManage: isLabStaff(ctx, u, lab.id) });
  }));

  r.post('/', requireRole('staff', 'admin'), wrap((req, res) => {
    const u = reqUser(req);
    const body = parse(z.object({ ...labFields, assignedStaffIds: z.array(z.string()).max(10).optional() }).strict(), req.body);
    if (ctx.db.prepare('SELECT 1 FROM labs WHERE code = ?').get(body.code)) throw conflict('A laboratory with this code already exists.', 'LAB_CODE_TAKEN');
    if (body.startsOn && body.endsOn && body.endsOn < body.startsOn) throw badRequest('End date must be after the start date.');
    const id = newId();
    const t = nowIso();
    const staffIds = new Set<string>([u.role === 'staff' ? u.id : '', ...(u.role === 'admin' ? body.assignedStaffIds ?? [] : [])].filter(Boolean));
    if (u.role === 'admin' && !staffIds.size) throw badRequest('Assign at least one staff member to this laboratory.');
    for (const sid of staffIds) {
      const s = ctx.db.prepare("SELECT role FROM users WHERE id = ? AND status = 'active'").get(sid) as any;
      if (!s || s.role !== 'staff') throw badRequest('Assigned users must be active staff accounts.');
    }
    ctx.db.transaction(() => {
      ctx.db.prepare(`INSERT INTO labs(id,name,code,description,course,building,room_number,capacity,schedule,starts_on,ends_on,created_by,created_at,updated_at)
                      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, body.name, body.code, body.description, body.course, body.building, body.roomNumber, body.capacity, body.schedule, body.startsOn ?? null, body.endsOn ?? null, u.id, t, t);
      for (const sid of staffIds) ctx.db.prepare('INSERT INTO lab_staff(lab_id,user_id) VALUES(?,?)').run(id, sid);
    })();
    audit(ctx, u, 'LAB_CREATE', 'lab', id, { name: body.name, code: body.code }, req);
    res.status(201).json({ lab: labDto(ctx, getLab(ctx, id), u.id) });
  }));

  r.patch('/:id', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    const body = parse(z.object({ ...labFields, assignedStaffIds: z.array(z.string()).max(10).optional() }).partial().strict(), req.body);
    if (body.code && body.code.toLowerCase() !== lab.code.toLowerCase() && ctx.db.prepare('SELECT 1 FROM labs WHERE code = ?').get(body.code)) throw conflict('A laboratory with this code already exists.', 'LAB_CODE_TAKEN');
    if (body.capacity !== undefined) {
      const current = (ctx.db.prepare("SELECT COUNT(*) c FROM lab_members WHERE lab_id = ? AND status='active' AND membership_role='student'").get(lab.id) as any).c;
      if (body.capacity < current) throw badRequest(`Capacity cannot be lower than the current ${current} members.`);
    }
    const before = { name: lab.name, capacity: lab.capacity, roomNumber: lab.room_number, schedule: lab.schedule };
    const m = (k: keyof typeof body, fallback: unknown) => (body[k] === undefined ? fallback : body[k]);
    ctx.db.transaction(() => {
      ctx.db.prepare(`UPDATE labs SET name=?,code=?,description=?,course=?,building=?,room_number=?,capacity=?,schedule=?,starts_on=?,ends_on=?,updated_at=? WHERE id=?`)
        .run(m('name', lab.name), m('code', lab.code), m('description', lab.description), m('course', lab.course), m('building', lab.building), m('roomNumber', lab.room_number),
          m('capacity', lab.capacity), m('schedule', lab.schedule), m('startsOn', lab.starts_on), m('endsOn', lab.ends_on), nowIso(), lab.id);
      if (u.role === 'admin' && body.assignedStaffIds) {
        if (!body.assignedStaffIds.length) throw badRequest('A laboratory needs at least one staff member.');
        ctx.db.prepare('DELETE FROM lab_staff WHERE lab_id = ?').run(lab.id);
        for (const sid of body.assignedStaffIds) {
          const s = ctx.db.prepare("SELECT role FROM users WHERE id = ? AND status='active'").get(sid) as any;
          if (!s || s.role !== 'staff') throw badRequest('Assigned users must be active staff accounts.');
          ctx.db.prepare('INSERT INTO lab_staff(lab_id,user_id) VALUES(?,?)').run(lab.id, sid);
        }
      }
    })();
    audit(ctx, u, 'LAB_UPDATE', 'lab', lab.id, { before, changed: Object.keys(body) }, req);
    res.json({ lab: labDto(ctx, getLab(ctx, lab.id), u.id) });
  }));

  r.post('/:id/archive', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    ctx.db.transaction(() => {
      ctx.db.prepare("UPDATE labs SET status='archived', updated_at=? WHERE id=?").run(nowIso(), lab.id);
      ctx.db.prepare('UPDATE room_access_codes SET revoked_at = COALESCE(revoked_at, ?) WHERE lab_id = ?').run(nowIso(), lab.id);
    })();
    audit(ctx, u, 'LAB_ARCHIVE', 'lab', lab.id, {}, req);
    res.json({ ok: true });
  }));

  r.post('/:id/reactivate', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    ctx.db.prepare("UPDATE labs SET status='active', updated_at=? WHERE id=?").run(nowIso(), lab.id);
    audit(ctx, u, 'LAB_REACTIVATE', 'lab', lab.id, {}, req);
    res.json({ ok: true });
  }));

  // ---- members ----
  r.get('/:id/members', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabMember(ctx, u, String(req.params.id));
    const staff = isLabStaff(ctx, u, lab.id);
    const online = new Set(ctx.rt.presence(lab.id).map((p) => p.userId));
    const rows = ctx.db.prepare(
      `SELECT u.id, u.display_name AS name, u.department, u.student_or_staff_id AS studentId, 'student' AS role, m.joined_at AS joinedAt
       FROM lab_members m JOIN users u ON u.id = m.user_id WHERE m.lab_id = ? AND m.status='active'
       UNION SELECT u.id, u.display_name, u.department, u.student_or_staff_id, 'staff', l.created_at FROM lab_staff s JOIN users u ON u.id = s.user_id JOIN labs l ON l.id = s.lab_id WHERE s.lab_id = ?
       ORDER BY role DESC, name`,
    ).all(lab.id, lab.id) as any[];
    res.json({ members: rows.map((m) => ({ id: m.id, name: m.name, role: m.role, online: online.has(m.id), ...(staff ? { department: m.department, studentId: m.studentId, joinedAt: m.joinedAt } : {}) })) });
  }));

  r.delete('/:id/members/:userId', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    const res1 = ctx.db.prepare("UPDATE lab_members SET status='removed' WHERE lab_id=? AND user_id=? AND status='active'").run(lab.id, String(req.params.userId));
    if (!res1.changes) throw notFound('Member not found.');
    audit(ctx, u, 'LAB_MEMBER_REMOVE', 'lab', lab.id, { userId: req.params.userId }, req);
    notify(ctx, String(req.params.userId), 'system', 'Removed from laboratory', `You were removed from ${lab.name}.`);
    res.json({ ok: true });
  }));

  // ---- access codes ----
  r.get('/:id/codes', wrap((req, res) => {
    const lab = requireLabStaff(ctx, reqUser(req), String(req.params.id));
    const rows = ctx.db.prepare(
      `SELECT c.id, c.created_at AS createdAt, c.expires_at AS expiresAt, c.revoked_at AS revokedAt, c.usage_limit AS usageLimit, c.usage_count AS usageCount, u.display_name AS createdBy
       FROM room_access_codes c JOIN users u ON u.id = c.created_by WHERE c.lab_id = ? ORDER BY c.created_at DESC LIMIT 20`,
    ).all(lab.id);
    res.json({ codes: rows });
  }));

  r.post('/:id/codes', wrap(async (req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    assertLabActive(lab);
    const body = parse(z.object({ expiresInMinutes: z.number().int().min(5).max(60 * 24 * 14).default(180), usageLimit: z.number().int().min(1).max(1000).nullable().optional() }).strict(), req.body ?? {});
    let plain = '';
    let hash = '';
    for (let i = 0; i < 5; i++) {
      plain = generateRoomCode();
      hash = hashRoomCode(ctx.config.jwtSecret, plain);
      if (!ctx.db.prepare('SELECT 1 FROM room_access_codes WHERE code_hash = ?').get(hash)) break;
    }
    const id = newId();
    const expiresAt = new Date(Date.now() + body.expiresInMinutes * 60_000).toISOString();
    ctx.db.prepare('INSERT INTO room_access_codes(id,lab_id,code_hash,created_by,created_at,expires_at,usage_limit) VALUES(?,?,?,?,?,?,?)')
      .run(id, lab.id, hash, u.id, nowIso(), expiresAt, body.usageLimit ?? null);
    audit(ctx, u, 'ROOM_CODE_CREATE', 'code', id, { labId: lab.id, expiresAt, usageLimit: body.usageLimit ?? null }, req);
    const joinUrl = `${ctx.config.baseUrl}/?join=${plain}`;
    // The plaintext code is returned exactly once; only a keyed hash is stored.
    res.status(201).json({ id, code: formatRoomCode(plain), expiresAt, joinUrl, qrDataUrl: await QRCode.toDataURL(joinUrl, { margin: 1, width: 240 }) });
  }));

  r.post('/:id/codes/:codeId/revoke', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    const r1 = ctx.db.prepare('UPDATE room_access_codes SET revoked_at = ? WHERE id = ? AND lab_id = ? AND revoked_at IS NULL').run(nowIso(), String(req.params.codeId), lab.id);
    if (!r1.changes) throw notFound('Active code not found.');
    audit(ctx, u, 'ROOM_CODE_REVOKE', 'code', String(req.params.codeId), { labId: lab.id }, req);
    res.json({ ok: true });
  }));

  r.post('/:id/codes-revoke-all', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    const r1 = ctx.db.prepare('UPDATE room_access_codes SET revoked_at = ? WHERE lab_id = ? AND revoked_at IS NULL').run(nowIso(), lab.id);
    audit(ctx, u, 'ROOM_CODE_REVOKE_ALL', 'lab', lab.id, { count: r1.changes }, req);
    res.json({ ok: true, revoked: r1.changes });
  }));

  r.post('/:id/read', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabMember(ctx, u, String(req.params.id));
    ctx.db.prepare(`INSERT INTO lab_reads(lab_id,user_id,last_read_at) VALUES(?,?,?) ON CONFLICT(lab_id,user_id) DO UPDATE SET last_read_at=excluded.last_read_at`).run(lab.id, u.id, nowIso());
    res.json({ ok: true });
  }));

  return r;
}

const FAIL_WINDOW_MIN = 10;
const MAX_FAILS_USER = 5;
const MAX_FAILS_IP = 20;

/** POST /api/labs/join handled separately so it can be mounted before the /:id routes. */
export function joinRoutes(ctx: Ctx) {
  const r = Router();
  r.post('/join', wrap((req, res) => {
    const u = reqUser(req);
    const { code } = parse(z.object({ code: z.string().trim().min(4).max(32) }).strict(), req.body);
    const ip = clientIp(req);
    const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60_000).toISOString();
    const userFails = (ctx.db.prepare('SELECT COUNT(*) c FROM join_attempts WHERE user_id=? AND success=0 AND created_at>?').get(u.id, since) as any).c;
    const ipFails = (ctx.db.prepare('SELECT COUNT(*) c FROM join_attempts WHERE ip=? AND success=0 AND created_at>?').get(ip, since) as any).c;
    if (userFails >= MAX_FAILS_USER || ipFails >= MAX_FAILS_IP) {
      throw tooMany(`Too many invalid codes. Please wait ${FAIL_WINDOW_MIN} minutes before trying again.`, 'JOIN_RATE_LIMITED');
    }
    const record = (success: boolean, labId: string | null, reason: string) => {
      ctx.db.prepare('INSERT INTO join_attempts(id,user_id,ip,lab_id,success,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(newId(), u.id, ip, labId, success ? 1 : 0, reason, nowIso());
      if (!success) {
        const fails = userFails + 1;
        audit(ctx, u, 'JOIN_FAILED', 'code', labId ?? 'unknown', { reason }, req);
        if (fails >= MAX_FAILS_USER) {
          raiseAlert(ctx, {
            labId, type: 'repeated_failed_codes', severity: 'medium', title: `Repeated failed room-code attempts by ${u.name}`,
            evidence: { userId: u.id, attempts: fails, windowMinutes: FAIL_WINDOW_MIN, ip }, dedupeKey: `failcodes:${u.id}:${Math.floor(Date.now() / (FAIL_WINDOW_MIN * 60_000))}`,
          });
        }
      }
    };
    const row = ctx.db.prepare('SELECT * FROM room_access_codes WHERE code_hash = ?').get(hashRoomCode(ctx.config.jwtSecret, code)) as any;
    if (!row) { record(false, null, 'unknown_code'); throw new HttpError(404, 'CODE_INVALID', 'That code is not valid. Check it with your instructor.'); }
    const lab = getLab(ctx, row.lab_id);
    if (row.revoked_at) { record(false, lab.id, 'revoked'); throw new HttpError(410, 'CODE_REVOKED', 'This code was revoked by the instructor.'); }
    if (row.expires_at < nowIso()) { record(false, lab.id, 'expired'); throw new HttpError(410, 'CODE_EXPIRED', 'This code has expired. Ask your instructor for a new one.'); }
    if (lab.status !== 'active') { record(false, lab.id, 'archived'); throw new HttpError(409, 'LAB_ARCHIVED', 'This laboratory is archived.'); }
    if (u.role === 'admin' || isLabStaff(ctx, u, lab.id)) throw conflict('Staff already have access to this laboratory.', 'ALREADY_STAFF');

    const existing = ctx.db.prepare('SELECT status FROM lab_members WHERE lab_id=? AND user_id=?').get(lab.id, u.id) as any;
    if (existing?.status === 'active') return res.json({ ok: true, alreadyMember: true, labId: lab.id, labName: lab.name });
    if (row.usage_limit !== null && row.usage_count >= row.usage_limit) { record(false, lab.id, 'usage_limit'); throw new HttpError(410, 'CODE_EXHAUSTED', 'This code has reached its usage limit.'); }
    const count = (ctx.db.prepare("SELECT COUNT(*) c FROM lab_members WHERE lab_id=? AND status='active' AND membership_role='student'").get(lab.id) as any).c;
    if (count >= lab.capacity) {
      record(false, lab.id, 'capacity');
      raiseAlert(ctx, { labId: lab.id, type: 'capacity_reached', severity: 'low', title: `${lab.name} reached its capacity of ${lab.capacity}`, evidence: { capacity: lab.capacity }, dedupeKey: `cap:${lab.id}:${count}` });
      throw new HttpError(409, 'LAB_FULL', `This laboratory is full (${lab.capacity} students).`);
    }
    ctx.db.transaction(() => {
      ctx.db.prepare(`INSERT INTO lab_members(lab_id,user_id,membership_role,status,joined_at) VALUES(?,?,?,?,?)
                      ON CONFLICT(lab_id,user_id) DO UPDATE SET status='active', joined_at=excluded.joined_at`).run(lab.id, u.id, 'student', 'active', nowIso());
      ctx.db.prepare('UPDATE room_access_codes SET usage_count = usage_count + 1 WHERE id = ?').run(row.id);
    })();
    record(true, lab.id, 'joined');
    audit(ctx, u, 'LAB_JOIN', 'lab', lab.id, { codeId: row.id }, req);
    ctx.rt.emitToLab(lab.id, 'member:joined', { labId: lab.id, userId: u.id, name: u.name });
    notify(ctx, u.id, 'system', 'Joined laboratory', `You joined ${lab.name}.`, { link: `/lab_room?lab=${lab.id}` });
    res.json({ ok: true, labId: lab.id, labName: lab.name });
  }));
  return r;
}

// ---- sessions ----
export function sessionRoutes(ctx: Ctx) {
  const r = Router();

  const dto = (s: any) => ({
    id: s.id, labId: s.lab_id, title: s.title, status: s.status, scheduledStart: s.scheduled_start, scheduledEnd: s.scheduled_end,
    startAt: s.start_at, endAt: s.end_at, notes: s.notes, createdAt: s.created_at,
  });

  r.get('/:id/sessions', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabMember(ctx, u, String(req.params.id));
    const status = ['scheduled', 'active', 'ended'].includes(String(req.query.status)) ? String(req.query.status) : null;
    const rows = ctx.db.prepare(`SELECT * FROM lab_sessions WHERE lab_id = ? ${status ? 'AND status = ?' : ''} ORDER BY COALESCE(start_at, scheduled_start, created_at) DESC LIMIT 50`).all(lab.id, ...(status ? [status] : []));
    res.json({ sessions: rows.map(dto) });
  }));

  r.post('/:id/sessions/schedule', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    assertLabActive(lab);
    const b = parse(z.object({ title: z.string().trim().max(120).default(''), scheduledStart: z.string().datetime(), scheduledEnd: z.string().datetime() }).strict(), req.body);
    if (b.scheduledEnd <= b.scheduledStart) throw badRequest('Session end must be after its start.');
    const id = newId();
    ctx.db.prepare("INSERT INTO lab_sessions(id,lab_id,title,scheduled_start,scheduled_end,status,created_by,created_at) VALUES(?,?,?,?,?,'scheduled',?,?)")
      .run(id, lab.id, b.title, b.scheduledStart, b.scheduledEnd, u.id, nowIso());
    audit(ctx, u, 'SESSION_SCHEDULE', 'session', id, { labId: lab.id }, req);
    notifyLabMembers(ctx, lab.id, u.id, 'announcement', `Session scheduled: ${lab.name}`, `${b.title || 'Lab session'} starts ${new Date(b.scheduledStart).toLocaleString()}.`, `/lab_room?lab=${lab.id}`);
    res.status(201).json({ session: dto(ctx.db.prepare('SELECT * FROM lab_sessions WHERE id=?').get(id)) });
  }));

  r.post('/:id/sessions/start', wrap(async (req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    assertLabActive(lab);
    const b = parse(z.object({ sessionId: z.string().optional(), title: z.string().trim().max(120).default('') }).strict(), req.body ?? {});
    if (ctx.db.prepare("SELECT 1 FROM lab_sessions WHERE lab_id=? AND status='active'").get(lab.id)) throw conflict('A session is already running in this laboratory.', 'SESSION_ALREADY_ACTIVE');
    const token = randomToken(18);
    const t = nowIso();
    let id = b.sessionId;
    if (id) {
      const s = ctx.db.prepare("SELECT 1 FROM lab_sessions WHERE id=? AND lab_id=? AND status='scheduled'").get(id, lab.id);
      if (!s) throw notFound('Scheduled session not found.');
      ctx.db.prepare("UPDATE lab_sessions SET status='active', start_at=?, checkin_token_hash=? WHERE id=?").run(t, sha256(token), id);
    } else {
      id = newId();
      ctx.db.prepare("INSERT INTO lab_sessions(id,lab_id,title,start_at,status,checkin_token_hash,created_by,created_at) VALUES(?,?,?,?,'active',?,?,?)")
        .run(id, lab.id, b.title, t, sha256(token), u.id, t);
    }
    audit(ctx, u, 'SESSION_START', 'session', id, { labId: lab.id }, req);
    ctx.rt.emitToLab(lab.id, 'session:update', { labId: lab.id, sessionId: id, status: 'active' });
    notifyLabMembers(ctx, lab.id, u.id, 'attendance', `${lab.name} session started`, 'Check in to record your attendance.', `/lab_room?lab=${lab.id}`);
    const checkinUrl = `${ctx.config.baseUrl}/?checkin=${lab.id}.${token}`;
    res.status(201).json({ session: dto(ctx.db.prepare('SELECT * FROM lab_sessions WHERE id=?').get(id)), checkinUrl, qrDataUrl: await QRCode.toDataURL(checkinUrl, { margin: 1, width: 240 }) });
  }));

  r.post('/:id/sessions/:sid/end', wrap((req, res) => {
    const u = reqUser(req);
    const lab = requireLabStaff(ctx, u, String(req.params.id));
    const s = ctx.db.prepare("SELECT * FROM lab_sessions WHERE id=? AND lab_id=? AND status='active'").get(String(req.params.sid), lab.id) as any;
    if (!s) throw notFound('Active session not found.');
    const t = nowIso();
    let flagged = 0;
    ctx.db.transaction(() => {
      ctx.db.prepare("UPDATE lab_sessions SET status='ended', end_at=?, checkin_token_hash=NULL WHERE id=?").run(t, s.id);
      // Never invent a check-out time: flag for staff verification instead.
      flagged = ctx.db.prepare("UPDATE attendance_records SET status='missing_checkout', verification_status='pending' WHERE session_id=? AND status='checked_in'").run(s.id).changes;
    })();
    if (flagged) raiseAlert(ctx, { labId: lab.id, type: 'missing_checkout', severity: 'low', title: `${flagged} student(s) did not check out of ${lab.name}`, evidence: { sessionId: s.id, count: flagged }, dedupeKey: `missing:${s.id}` });
    audit(ctx, u, 'SESSION_END', 'session', s.id, { labId: lab.id, missingCheckouts: flagged }, req);
    ctx.rt.emitToLab(lab.id, 'session:update', { labId: lab.id, sessionId: s.id, status: 'ended' });
    res.json({ ok: true, missingCheckouts: flagged });
  }));

  return r;
}
