import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { H, PASSWORD, fakeAi, makeEnv } from './helpers';

type Env = Awaited<ReturnType<typeof makeEnv>>;
let env: Env;
let ai: ReturnType<typeof fakeAi>;

beforeAll(async () => {
  ai = fakeAi('Grounded answer [1]');
  env = await makeEnv({ ai });
});
afterAll(async () => { await env.close(); });

describe('authentication', () => {
  it('registers a student and signs in with valid credentials', async () => {
    const reg = await env.register('alice@test.edu', 'Alice');
    expect(reg.status).toBe(201);
    expect(reg.body.user.role).toBe('student');
    const { res } = await env.login('alice@test.edu');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
  });

  it('rejects invalid login with a generic message', async () => {
    const { res } = await env.login('alice@test.edu', 'wrong-password-1');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('INVALID_CREDENTIALS');
    const unknown = await env.login('nobody@test.edu');
    expect(unknown.res.body.message).toBe(res.body.message);
  });

  it('rejects duplicate accounts and weak passwords', async () => {
    expect((await env.register('alice@test.edu', 'Alice 2')).status).toBe(409);
    const weak = await env.agent().post('/api/auth/register').set(H).send({ name: 'Weak', email: 'weak@test.edu', password: 'short', department: 'CSE', studentOrStaffId: 'W1' });
    expect(weak.status).toBe(400);
  });

  it('never lets public registration choose a privileged role', async () => {
    const adminTry = await env.register('evil@test.edu', 'Evil', { role: 'admin' });
    expect(adminTry.status).toBe(400); // unknown key rejected by strict schema
    const staffTry = await env.register('wantsstaff@test.edu', 'Wants Staff', { requestedRole: 'staff' });
    expect(staffTry.body.needsApproval).toBe(true);
    expect(staffTry.body.user).toBeNull();
    const { res } = await env.login('wantsstaff@test.edu');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_PENDING');
    const row = env.ctx.db.prepare('SELECT role FROM users WHERE email=?').get('wantsstaff@test.edu') as any;
    expect(row.role).toBe('student');
  });

  it('users cannot assign themselves a role through profile updates', async () => {
    const { a } = await env.login('alice@test.edu');
    expect((await a.patch('/api/auth/profile').set(H).send({ role: 'admin' })).status).toBe(400);
    expect((await a.get('/api/auth/me')).body.user.role).toBe('student');
  });

  it('supports password reset and invalidates old sessions', async () => {
    const old = (await env.login('alice@test.edu')).a;
    env.ctx.mailer.outbox.length = 0;
    const f = await env.agent().post('/api/auth/forgot-password').set(H).send({ email: 'alice@test.edu' });
    expect(f.status).toBe(200);
    const token = /reset=([\w-]+)/.exec(env.ctx.mailer.outbox.at(-1)!.text)![1];
    const bad = await env.agent().post('/api/auth/reset-password').set(H).send({ token: 'x'.repeat(30), password: 'Another-pass-99' });
    expect(bad.status).toBe(400);
    const ok = await env.agent().post('/api/auth/reset-password').set(H).send({ token, password: 'Another-pass-99' });
    expect(ok.status).toBe(200);
    expect((await old.get('/api/auth/me')).status).toBe(401);
    expect((await env.agent().post('/api/auth/reset-password').set(H).send({ token, password: 'Third-pass-9999' })).status).toBe(400); // single use
    expect((await env.login('alice@test.edu', 'Another-pass-99')).res.status).toBe(200);
    // restore for later tests
    const { a } = await env.login('alice@test.edu', 'Another-pass-99');
    await a.post('/api/auth/change-password').set(H).send({ currentPassword: 'Another-pass-99', newPassword: PASSWORD });
  });

  it('reports an expired session distinctly', async () => {
    const id = (env.ctx.db.prepare('SELECT id FROM users WHERE email=?').get('alice@test.edu') as any).id;
    const expired = jwt.sign({ sub: id, tv: 0, exp: Math.floor(Date.now() / 1000) - 10 }, env.ctx.config.jwtSecret);
    const res = await env.agent().get('/api/auth/me').set('Cookie', `labsync_session=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('SESSION_EXPIRED');
  });

  it('blocks unauthenticated access and CSRF-less writes', async () => {
    expect((await env.agent().get('/api/labs')).status).toBe(401);
    const { a } = await env.login('alice@test.edu');
    const noHeader = await a.post('/api/labs/join').send({ code: 'ABCD1234' });
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error).toBe('CSRF');
  });

  it('locks an account after repeated failures', async () => {
    await env.register('lock@test.edu', 'Lock');
    for (let i = 0; i < 5; i++) await env.login('lock@test.edu', 'bad-password-12');
    const res = (await env.login('lock@test.edu')).res;
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('ACCOUNT_LOCKED');
  });
});

describe('roles and permissions', () => {
  it('student cannot reach admin or staff endpoints', async () => {
    const { a } = await env.login('alice@test.edu');
    expect((await a.get('/api/admin/users')).status).toBe(403);
    expect((await a.get('/api/dashboard/admin')).status).toBe(403);
    expect((await a.get('/api/alerts')).status).toBe(403);
    expect((await a.post('/api/labs').set(H).send({ name: 'Mine', code: 'MINE', capacity: 5 })).status).toBe(403);
  });

  it('staff cannot modify a laboratory they are not assigned to', async () => {
    const s1 = await env.makeStaff('s1@test.edu', 'S One');
    const s2 = await env.makeStaff('s2@test.edu', 'S Two');
    const lab = await env.createLab(s1.a);
    expect((await s2.a.patch(`/api/labs/${lab.id}`).set(H).send({ name: 'Hijacked' })).status).toBe(403);
    expect((await s2.a.post(`/api/labs/${lab.id}/codes`).set(H).send({})).status).toBe(403);
    expect((await s2.a.post(`/api/labs/${lab.id}/sessions/start`).set(H).send({})).status).toBe(403);
    expect((await s1.a.patch(`/api/labs/${lab.id}`).set(H).send({ name: 'Renamed Lab' })).status).toBe(200);
  });

  it('only admins change roles and cannot demote themselves', async () => {
    const st = await env.makeStudent('promote@test.edu', 'Promote');
    expect((await st.a.patch(`/api/admin/users/${st.id}`).set(H).send({ role: 'admin' })).status).toBe(403);
    const adminId = (env.ctx.db.prepare("SELECT id FROM users WHERE role='admin'").get() as any).id;
    expect((await env.admin.patch(`/api/admin/users/${adminId}`).set(H).send({ role: 'student' })).status).toBe(400);
    const ok = await env.admin.patch(`/api/admin/users/${st.id}`).set(H).send({ role: 'staff' });
    expect(ok.body.user.role).toBe('staff');
    const log = env.ctx.db.prepare("SELECT * FROM audit_logs WHERE action='USER_ROLE_CHANGE' AND resource_id=?").get(st.id) as any;
    expect(JSON.parse(log.metadata_json).after.role).toBe('staff');
  });

  it('audit logs are append-only', () => {
    expect(() => env.ctx.db.prepare("UPDATE audit_logs SET action='X'").run()).toThrow(/append-only/);
    expect(() => env.ctx.db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
  });
});

describe('laboratories and room codes', () => {
  it('staff creates a lab, student joins with a code, hashing keeps plaintext out of the DB', async () => {
    const staff = await env.makeStaff('lab1staff@test.edu', 'Lab1 Staff');
    const lab = await env.createLab(staff.a, { capacity: 2 });
    expect(lab.id).toBeTruthy();
    const code = await env.newCode(staff.a, lab.id);
    expect(code.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const stored = env.ctx.db.prepare('SELECT code_hash FROM room_access_codes WHERE id=?').get(code.id) as any;
    expect(stored.code_hash).not.toContain(code.code.replace('-', ''));
    const s = await env.makeStudent('joiner@test.edu', 'Joiner');
    const join = await s.a.post('/api/labs/join').set(H).send({ code: code.code });
    expect(join.status).toBe(200);
    expect((await s.a.get('/api/labs')).body.labs.map((l: any) => l.id)).toContain(lab.id);
    expect((await s.a.post('/api/labs/join').set(H).send({ code: code.code })).body.alreadyMember).toBe(true);
  });

  it('rejects invalid, expired and revoked codes', async () => {
    const staff = await env.makeStaff('lab2staff@test.edu', 'Lab2 Staff');
    const lab = await env.createLab(staff.a);
    const s = await env.makeStudent('codes@test.edu', 'Codes');
    expect((await s.a.post('/api/labs/join').set(H).send({ code: 'ZZZZ9999' })).body.error).toBe('CODE_INVALID');
    const expired = await env.newCode(staff.a, lab.id);
    env.ctx.db.prepare('UPDATE room_access_codes SET expires_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), expired.id);
    expect((await s.a.post('/api/labs/join').set(H).send({ code: expired.code })).body.error).toBe('CODE_EXPIRED');
    const revoked = await env.newCode(staff.a, lab.id);
    await staff.a.post(`/api/labs/${lab.id}/codes/${revoked.id}/revoke`).set(H).send({});
    expect((await s.a.post('/api/labs/join').set(H).send({ code: revoked.code })).body.error).toBe('CODE_REVOKED');
  });

  it('enforces capacity and usage limits', async () => {
    const staff = await env.makeStaff('lab3staff@test.edu', 'Lab3 Staff');
    const lab = await env.createLab(staff.a, { capacity: 1 });
    const code = await env.newCode(staff.a, lab.id);
    const a = await env.makeStudent('cap1@test.edu', 'Cap1');
    const b = await env.makeStudent('cap2@test.edu', 'Cap2');
    expect((await a.a.post('/api/labs/join').set(H).send({ code: code.code })).status).toBe(200);
    const full = await b.a.post('/api/labs/join').set(H).send({ code: code.code });
    expect(full.status).toBe(409);
    expect(full.body.error).toBe('LAB_FULL');
  });

  it('rate limits repeated failed attempts and raises a staff alert', async () => {
    const staff = await env.makeStaff('lab4staff@test.edu', 'Lab4 Staff');
    const lab = await env.createLab(staff.a);
    const code = await env.newCode(staff.a, lab.id);
    env.ctx.db.prepare('UPDATE room_access_codes SET expires_at=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), code.id);
    const s = await env.makeStudent('brute@test.edu', 'Brute');
    for (let i = 0; i < 5; i++) await s.a.post('/api/labs/join').set(H).send({ code: code.code });
    const blocked = await s.a.post('/api/labs/join').set(H).send({ code: 'AAAA2222' });
    expect(blocked.status).toBe(429);
    const alerts = await staff.a.get(`/api/alerts?labId=${lab.id}`);
    expect(alerts.body.alerts.some((x: any) => x.type === 'repeated_failed_codes' && x.detectionMethod === 'rule')).toBe(true);
  });
});

describe('attendance', () => {
  let staff: Awaited<ReturnType<Env['makeStaff']>>;
  let lab: { id: string };
  let s1: Awaited<ReturnType<Env['makeStudent']>>;
  let s2: Awaited<ReturnType<Env['makeStudent']>>;

  beforeAll(async () => {
    staff = await env.makeStaff('att-staff@test.edu', 'Att Staff');
    lab = await env.createLab(staff.a, { capacity: 10 });
    const code = await env.newCode(staff.a, lab.id);
    s1 = await env.makeStudent('att1@test.edu', 'Att One');
    s2 = await env.makeStudent('att2@test.edu', 'Att Two');
    for (const s of [s1, s2]) await s.a.post('/api/labs/join').set(H).send({ code: code.code });
  });

  it('needs an active session and uses server timestamps', async () => {
    expect((await s1.a.post('/api/attendance/check-in').set(H).send({ labId: lab.id })).body.error).toBe('NO_ACTIVE_SESSION');
    expect((await staff.a.post(`/api/labs/${lab.id}/sessions/start`).set(H).send({ title: 'Week 1' })).status).toBe(201);
    const forged = await s1.a.post('/api/attendance/check-in').set(H).send({ labId: lab.id, checkInAt: '2001-01-01T00:00:00Z' });
    expect(forged.status).toBe(400);
    const res = await s1.a.post('/api/attendance/check-in').set(H).send({ labId: lab.id });
    expect(res.status).toBe(201);
    expect(Math.abs(Date.now() - new Date(res.body.record.checkInAt).getTime())).toBeLessThan(5000);
    expect(res.body.record.verificationStatus).toBe('pending');
  });

  it('prevents duplicate check-in and supports check-out', async () => {
    expect((await s1.a.post('/api/attendance/check-in').set(H).send({ labId: lab.id })).body.error).toBe('DUPLICATE_CHECKIN');
    const out = await s1.a.post('/api/attendance/check-out').set(H).send({ labId: lab.id });
    expect(out.status).toBe(200);
    expect(out.body.record.status).toBe('checked_out');
    expect((await s1.a.post('/api/attendance/check-out').set(H).send({ labId: lab.id })).body.error).toBe('NOT_CHECKED_IN');
  });

  it("a student cannot read another student's attendance", async () => {
    await s2.a.post('/api/attendance/check-in').set(H).send({ labId: lab.id });
    const mine = await s1.a.get('/api/attendance');
    expect(mine.body.records.every((r: any) => r.studentId === s1.id)).toBe(true);
    const peek = await s1.a.get(`/api/attendance?studentId=${s2.id}`);
    expect(peek.body.records.every((r: any) => r.studentId === s1.id)).toBe(true);
    const rec = (env.ctx.db.prepare('SELECT id FROM attendance_records WHERE student_id=?').get(s2.id) as any).id;
    expect((await s1.a.get(`/api/attendance/${rec}/corrections`)).status).toBe(403);
    expect((await s1.a.post(`/api/attendance/${rec}/verify`).set(H).send({})).status).toBe(403);
  });

  it('flags missing check-outs at session end instead of inventing a time', async () => {
    const sid = (env.ctx.db.prepare("SELECT id FROM lab_sessions WHERE lab_id=? AND status='active'").get(lab.id) as any).id;
    const end = await staff.a.post(`/api/labs/${lab.id}/sessions/${sid}/end`).set(H).send({});
    expect(end.body.missingCheckouts).toBe(1);
    const rec = env.ctx.db.prepare('SELECT * FROM attendance_records WHERE student_id=?').get(s2.id) as any;
    expect(rec.status).toBe('missing_checkout');
    expect(rec.check_out_at).toBeNull();
    const alerts = await staff.a.get(`/api/alerts?labId=${lab.id}`);
    expect(alerts.body.alerts.some((a: any) => a.type === 'missing_checkout')).toBe(true);
  });

  it('requires a reason for corrections and records history + audit trail', async () => {
    const rec = env.ctx.db.prepare('SELECT * FROM attendance_records WHERE student_id=?').get(s2.id) as any;
    const outAt = new Date(new Date(rec.check_in_at).getTime() + 3600_000 - 1000).toISOString();
    const noReason = await staff.a.post(`/api/attendance/${rec.id}/correct`).set(H).send({ checkOutAt: new Date().toISOString() });
    expect(noReason.status).toBe(400);
    const ok = await staff.a.post(`/api/attendance/${rec.id}/correct`).set(H).send({ checkOutAt: new Date(Math.min(Date.now(), Date.parse(outAt))).toISOString(), reason: 'Student left at bell, confirmed by staff' });
    expect(ok.status).toBe(200);
    expect(ok.body.record.verificationStatus).toBe('corrected');
    const hist = await staff.a.get(`/api/attendance/${rec.id}/corrections`);
    expect(hist.body.corrections[0].reason).toMatch(/bell/);
    expect(hist.body.corrections[0].previous.checkOutAt).toBeNull();
    const n = (env.ctx.db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='ATTENDANCE_CORRECTION'").get() as any).c;
    expect(n).toBe(1);
  });
});

describe('chat, files and AI documents', () => {
  let staff: Awaited<ReturnType<Env['makeStaff']>>;
  let lab: { id: string };
  let member: Awaited<ReturnType<Env['makeStudent']>>;
  let outsider: Awaited<ReturnType<Env['makeStudent']>>;
  let fileId = '';

  beforeAll(async () => {
    staff = await env.makeStaff('chat-staff@test.edu', 'Chat Staff');
    lab = await env.createLab(staff.a, { capacity: 10 });
    const code = await env.newCode(staff.a, lab.id);
    member = await env.makeStudent('member@test.edu', 'Member');
    outsider = await env.makeStudent('outsider@test.edu', 'Outsider');
    await member.a.post('/api/labs/join').set(H).send({ code: code.code });
  });

  it('members can chat; outsiders are denied for read and write', async () => {
    const sent = await member.a.post(`/api/labs/${lab.id}/messages`).set(H).send({ content: 'Hello lab', clientId: 'c-1' });
    expect(sent.status).toBe(201);
    const dup = await member.a.post(`/api/labs/${lab.id}/messages`).set(H).send({ content: 'Hello lab', clientId: 'c-1' });
    expect(dup.body.duplicate).toBe(true);
    expect((await staff.a.get(`/api/labs/${lab.id}/messages`)).body.messages).toHaveLength(1);
    expect((await outsider.a.get(`/api/labs/${lab.id}/messages`)).status).toBe(403);
    expect((await outsider.a.post(`/api/labs/${lab.id}/messages`).set(H).send({ content: 'sneaky' })).status).toBe(403);
    expect((await member.a.post(`/api/labs/${lab.id}/messages`).set(H).send({ content: '   ' })).status).toBe(400);
  });

  it('paginates with a cursor', async () => {
    for (let i = 0; i < 5; i++) await member.a.post(`/api/labs/${lab.id}/messages`).set(H).send({ content: `m${i}` });
    const first = await member.a.get(`/api/labs/${lab.id}/messages?limit=3`);
    expect(first.body.messages).toHaveLength(3);
    expect(first.body.hasMore).toBe(true);
    const next = await member.a.get(`/api/labs/${lab.id}/messages?limit=3&before=${first.body.nextBefore}`);
    expect(next.body.messages.length).toBeGreaterThan(0);
    expect(next.body.messages[0].id).not.toBe(first.body.messages[0].id);
  });

  it('accepts valid files, indexes text, and rejects bad types and spoofed content', async () => {
    const notes = '# Pointers\n\nA pointer stores the memory address of another variable. Dereferencing reads the value at that address.\n\n# Recursion\n\nRecursion needs a base case.';
    const up = await member.a.post(`/api/labs/${lab.id}/files`).set(H).attach('file', Buffer.from(notes), 'notes.txt');
    expect(up.status).toBe(201);
    fileId = up.body.file.id;
    expect((await member.a.post(`/api/labs/${lab.id}/files`).set(H).attach('file', Buffer.from('MZ\x90\x00'), 'tool.exe')).body.error).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await member.a.post(`/api/labs/${lab.id}/files`).set(H).attach('file', Buffer.from('this is not a pdf'), 'fake.pdf')).body.error).toBe('FILE_CONTENT_MISMATCH');
    expect((await member.a.post(`/api/labs/${lab.id}/files`).set(H).attach('file', Buffer.from('x'), '../../evil.txt')).body.file.name).toBe('evil.txt');
    const alerts = await staff.a.get(`/api/alerts?labId=${lab.id}`);
    expect(alerts.body.alerts.some((a: any) => a.type === 'unexpected_file_type')).toBe(true);
  });

  it('authorises every download', async () => {
    expect((await member.a.get(`/api/files/${fileId}/download`)).status).toBe(200);
    const dl = await staff.a.get(`/api/files/${fileId}/download`);
    expect(dl.headers['content-disposition']).toMatch(/attachment/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect((await outsider.a.get(`/api/files/${fileId}/download`)).status).toBe(403);
    expect((await env.agent().get(`/api/files/${fileId}/download`)).status).toBe(401);
    expect((await outsider.a.get('/api/files')).body.files).toHaveLength(0);
    expect((await outsider.a.delete(`/api/files/${fileId}`).set(H)).status).toBe(403);
  });

  it('answers document questions only from authorised documents and cites sources', async () => {
    await new Promise((r) => setTimeout(r, 300)); // indexing is async
    const res = await member.a.post('/api/ai/document-question').set(H).send({ labId: lab.id, question: 'What does a pointer store?' });
    expect(res.status).toBe(200);
    expect(res.body.grounded).toBe(true);
    expect(res.body.sources[0].name).toBe('notes.txt');
    const sent = ai.calls.at(-1);
    expect(sent.prompt).toContain('<data>');
    expect(sent.system).toMatch(/UNTRUSTED/);
    expect((await outsider.a.post('/api/ai/document-question').set(H).send({ labId: lab.id, question: 'What does a pointer store?' })).status).toBe(403);
  });

  it('states when documents do not contain the answer without calling the model', async () => {
    const before = ai.calls.length;
    const res = await member.a.post('/api/ai/document-question').set(H).send({ labId: lab.id, question: 'photosynthesis chloroplast mitochondria' });
    expect(res.body.grounded).toBe(false);
    expect(res.body.answer).toMatch(/do not contain enough information/);
    expect(ai.calls.length).toBe(before);
  });

  it('handles provider errors safely and enforces the daily AI quota', async () => {
    ai.fail = true;
    const bad = await member.a.post('/api/ai/chat').set(H).send({ message: 'Explain pointers', labId: lab.id });
    expect(bad.status).toBe(502);
    expect(JSON.stringify(bad.body)).not.toMatch(/stack|at .*\.ts/);
    ai.fail = false;
    env.ctx.settings.set('ai.maxRequestsPerUserPerDay', 1, null);
    const lim = await outsider.a.post('/api/ai/chat').set(H).send({ message: 'hello there' });
    expect([200, 429]).toContain(lim.status);
    const lim2 = await outsider.a.post('/api/ai/chat').set(H).send({ message: 'hello again' });
    expect(lim2.status).toBe(429);
    expect(lim2.body.error).toBe('AI_QUOTA');
    env.ctx.settings.set('ai.maxRequestsPerUserPerDay', 50, null);
  });

  it('summarises chat with a clearly labelled rule-based fallback when AI is off', async () => {
    const off = await makeEnvNoAi();
    expect(off.res.status).toBe(200);
    expect(off.res.body.summary.generatedBy).toBe('rule-based');
    expect(off.chat.status).toBe(503);
    expect(off.chat.body.error).toBe('AI_NOT_CONFIGURED');
  });

  it('opted-out users cannot use AI', async () => {
    await member.a.patch('/api/auth/profile').set(H).send({ prefs: { aiAssistance: false } });
    expect((await member.a.post('/api/ai/chat').set(H).send({ message: 'hi there' })).body.error).toBe('AI_OPTED_OUT');
    await member.a.patch('/api/auth/profile').set(H).send({ prefs: { aiAssistance: true } });
  });
});

async function makeEnvNoAi() {
  const e = await makeEnv({ ai: null });
  try {
    const staff = await e.makeStaff('noai@test.edu', 'No AI');
    const lab = await e.createLab(staff.a);
    await staff.a.post(`/api/labs/${lab.id}/messages`).set(H).send({ content: 'Does anyone know how malloc works?' });
    const res = await staff.a.post('/api/ai/summarize').set(H).send({ labId: lab.id });
    const chat = await staff.a.post('/api/ai/chat').set(H).send({ message: 'hello assistant' });
    return { res, chat };
  } finally { await e.close(); }
}

describe('reports', () => {
  it('scopes reports to the caller and neutralises CSV formulas', async () => {
    const staff = await env.makeStaff('rep-staff@test.edu', 'Rep Staff');
    const other = await env.makeStaff('rep-other@test.edu', 'Rep Other');
    const lab = await env.createLab(staff.a, { name: '=HYPERLINK("x")' });
    const csv = await staff.a.get('/api/reports/lab-usage?format=csv');
    expect(csv.text).toContain(`"'=HYPERLINK`);
    const otherRep = await other.a.get('/api/reports/lab-usage');
    expect(JSON.stringify(otherRep.body.rows)).not.toContain('HYPERLINK');
    expect((await other.a.get(`/api/reports/lab-usage?labId=${lab.id}`)).status).toBe(403);
    const st = await env.makeStudent('rep-student@test.edu', 'Rep Student');
    expect((await st.a.get('/api/reports/lab-usage')).status).toBe(403);
    expect((await st.a.get('/api/reports/student-history')).status).toBe(200);
  });
});
