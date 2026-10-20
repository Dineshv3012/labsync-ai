import { Router } from 'express';
import { z } from 'zod';
import type { Ctx, AuthUser } from '../types';
import { clientIp, reqUser } from '../types';
import { HttpError, badRequest, conflict, forbidden, parse, unauthorized, wrap } from '../errors';
import { SESSION_COOKIE, limiter, loadUser, requireAuth } from '../middleware';
import { hashPassword, newId, passwordSchema, randomToken, sha256, signSession, verifyPassword, SESSION_TTL_SECONDS } from '../security';
import { audit, notify, DEFAULT_PREFS } from '../services';
import { nowIso } from '../db';

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

export function publicUser(u: AuthUser) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, department: u.department,
    studentOrStaffId: u.studentOrStaffId, status: u.status, emailVerified: u.emailVerified,
    avatarUrl: u.avatarUrl, prefs: u.prefs, createdAt: u.createdAt,
  };
}

export function authRoutes(ctx: Ctx) {
  const r = Router();
  const authLimit = limiter(ctx, 15 * 60_000, 40, 'Too many attempts. Please wait a few minutes and try again.');

  const setCookie = (res: any, user: AuthUser & { tokenVersion?: number }, tv: number) => {
    res.cookie(SESSION_COOKIE, signSession(ctx.config.jwtSecret, { sub: user.id, tv }), {
      httpOnly: true, sameSite: 'lax', secure: ctx.config.isProduction, maxAge: SESSION_TTL_SECONDS * 1000, path: '/',
    });
  };

  const issueToken = (userId: string, kind: 'verify' | 'reset', ttlMinutes: number) => {
    const token = randomToken(32);
    ctx.db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL').run(userId, kind);
    ctx.db
      .prepare('INSERT INTO auth_tokens(id,user_id,kind,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)')
      .run(newId(), userId, kind, sha256(token), new Date(Date.now() + ttlMinutes * 60_000).toISOString(), nowIso());
    return token;
  };

  const sendLink = async (email: string, kind: 'verify' | 'reset', token: string) => {
    const link = `${ctx.config.baseUrl}/?${kind === 'verify' ? 'verify' : 'reset'}=${token}`;
    const subject = kind === 'verify' ? 'Verify your LabSync AI email' : 'Reset your LabSync AI password';
    const text = kind === 'verify'
      ? `Welcome to LabSync AI.\n\nConfirm your email address using this link (valid 24 hours):\n${link}\n`
      : `A password reset was requested for your LabSync AI account.\n\nUse this link within 30 minutes:\n${link}\n\nIf you did not request this, ignore this email.`;
    try { await ctx.mailer.send(email, subject, text); } catch (e) { console.error('[mail] send failed', (e as Error).message); }
    // Only exposed when SMTP is not configured and not in production, so local demos work without email.
    return !ctx.mailer.configured && ctx.config.exposeDevLinks ? link : undefined;
  };

  r.post('/register', authLimit, wrap(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2, 'Enter your full name.').max(100),
        email: emailSchema,
        password: passwordSchema,
        department: z.string().trim().min(2, 'Enter your department.').max(100),
        studentOrStaffId: z.string().trim().min(2, 'Enter your institutional ID.').max(40),
        requestedRole: z.enum(['student', 'staff']).default('student'),
      }).strict(),
      req.body,
    );
    const domains = ctx.config.allowedEmailDomains;
    if (domains.length && !domains.includes(body.email.split('@')[1])) {
      throw badRequest(`Please register with your institutional email (${domains.map((d) => '@' + d).join(', ')}).`, 'EMAIL_DOMAIN_NOT_ALLOWED');
    }
    if (ctx.db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) {
      throw conflict('An account with this email already exists. Try signing in or resetting your password.', 'EMAIL_TAKEN');
    }
    // Public registration can never grant a privileged role: everyone starts as a student.
    const wantsStaff = body.requestedRole === 'staff';
    const status = wantsStaff || !ctx.config.autoApproveStudents ? 'pending' : 'active';
    const id = newId();
    const t = nowIso();
    ctx.db
      .prepare(`INSERT INTO users(id,email,password_hash,display_name,role,requested_role,department,student_or_staff_id,status,prefs_json,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, body.email, await hashPassword(body.password, ctx.config.bcryptRounds), body.name, 'student', wantsStaff ? 'staff' : null,
        body.department, body.studentOrStaffId, status, JSON.stringify(DEFAULT_PREFS), t, t);
    audit(ctx, { id, name: body.name, role: 'student' }, 'USER_REGISTER', 'user', id, { requestedRole: body.requestedRole, status }, req);

    const verifyToken = issueToken(id, 'verify', 24 * 60);
    const devLink = await sendLink(body.email, 'verify', verifyToken);

    if (status === 'pending') {
      for (const a of ctx.db.prepare("SELECT id FROM users WHERE role='admin' AND status='active'").all() as { id: string }[]) {
        notify(ctx, a.id, 'security', 'Account awaiting approval', `${body.name} (${body.email}) registered${wantsStaff ? ' and requested a staff role' : ''}.`, { link: '/admin_users' });
      }
    }
    const needsVerification = ctx.config.requireEmailVerification;
    let signedIn = false;
    if (status === 'active' && !needsVerification) {
      setCookie(res, { id } as AuthUser, 0);
      signedIn = true;
    }
    const user = loadUser(ctx, id)!;
    res.status(201).json({
      user: signedIn ? publicUser(user) : null,
      needsApproval: status === 'pending',
      needsVerification,
      devVerifyLink: devLink,
      message:
        status === 'pending'
          ? wantsStaff
            ? 'Your staff request was received. An administrator must approve it before you can sign in.'
            : 'Your account was created and is waiting for administrator approval.'
          : needsVerification ? 'Account created. Check your email to verify your address before signing in.' : 'Account created.',
    });
  }));

  r.post('/login', authLimit, wrap(async (req, res) => {
    const { email, password } = parse(z.object({ email: emailSchema, password: z.string().min(1).max(128) }), req.body);
    const row = ctx.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    const generic = new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    if (!row) {
      await hashPassword(password, ctx.config.bcryptRounds); // equalise timing
      throw generic;
    }
    if (row.locked_until && row.locked_until > nowIso()) {
      throw new HttpError(429, 'ACCOUNT_LOCKED', 'Too many failed sign-in attempts. Try again in a few minutes or reset your password.');
    }
    if (!(await verifyPassword(password, row.password_hash))) {
      const fails = row.failed_logins + 1;
      const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
      ctx.db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, row.id);
      audit(ctx, { id: row.id, name: row.display_name, role: row.role }, lock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', 'user', row.id, {}, req);
      throw generic;
    }
    if (row.status === 'pending') throw new HttpError(403, 'ACCOUNT_PENDING', 'Your account is waiting for administrator approval.');
    if (row.status === 'suspended') throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Contact your administrator.');
    if (ctx.config.requireEmailVerification && !row.email_verified) {
      throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address first. Check your inbox for the link.');
    }
    ctx.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(nowIso(), row.id);
    setCookie(res, { id: row.id } as AuthUser, row.token_version);
    audit(ctx, { id: row.id, name: row.display_name, role: row.role }, 'USER_LOGIN', 'user', row.id, {}, req);
    res.json({ user: publicUser(loadUser(ctx, row.id)!) });
  }));

  r.post('/logout', wrap((req, res) => {
    const u = (req as any).user as AuthUser | undefined;
    if (u) audit(ctx, u, 'USER_LOGOUT', 'user', u.id, {}, req);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  r.get('/me', wrap((req, res) => {
    const u = (req as any).user as AuthUser | undefined;
    if (!u) {
      if ((req as any).sessionExpired) throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
      throw unauthorized();
    }
    res.json({ user: publicUser(u) });
  }));

  r.post('/verify-email', authLimit, wrap((req, res) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const row = ctx.db.prepare("SELECT * FROM auth_tokens WHERE token_hash = ? AND kind='verify'").get(sha256(token)) as any;
    if (!row || row.used_at || row.expires_at < nowIso()) throw badRequest('This verification link is invalid or has expired.', 'TOKEN_INVALID');
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
      ctx.db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(nowIso(), row.user_id);
    })();
    audit(ctx, null, 'EMAIL_VERIFIED', 'user', row.user_id, {}, req);
    res.json({ ok: true, message: 'Email verified. You can sign in now.' });
  }));

  r.post('/resend-verification', authLimit, wrap(async (req, res) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const u = ctx.db.prepare('SELECT id, email_verified FROM users WHERE email = ?').get(email) as any;
    let devLink: string | undefined;
    if (u && !u.email_verified) devLink = await sendLink(email, 'verify', issueToken(u.id, 'verify', 24 * 60));
    res.json({ ok: true, message: 'If that account exists and is unverified, a new link has been sent.', devVerifyLink: devLink });
  }));

  r.post('/forgot-password', authLimit, wrap(async (req, res) => {
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const u = ctx.db.prepare("SELECT id FROM users WHERE email = ? AND status != 'suspended'").get(email) as any;
    let devLink: string | undefined;
    if (u) {
      devLink = await sendLink(email, 'reset', issueToken(u.id, 'reset', 30));
      audit(ctx, null, 'PASSWORD_RESET_REQUESTED', 'user', u.id, {}, req);
    }
    res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.', devResetLink: devLink });
  }));

  r.post('/reset-password', authLimit, wrap(async (req, res) => {
    const { token, password } = parse(z.object({ token: z.string().min(10).max(200), password: passwordSchema }), req.body);
    const row = ctx.db.prepare("SELECT * FROM auth_tokens WHERE token_hash = ? AND kind='reset'").get(sha256(token)) as any;
    if (!row || row.used_at || row.expires_at < nowIso()) throw badRequest('This reset link is invalid or has expired. Request a new one.', 'TOKEN_INVALID');
    const hash = await hashPassword(password, ctx.config.bcryptRounds);
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
      ctx.db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(hash, nowIso(), row.user_id);
    })();
    audit(ctx, null, 'PASSWORD_RESET_COMPLETED', 'user', row.user_id, {}, req);
    res.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
  }));

  r.post('/change-password', requireAuth, authLimit, wrap(async (req, res) => {
    const u = reqUser(req);
    const { currentPassword, newPassword } = parse(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }), req.body);
    const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id) as any;
    if (!(await verifyPassword(currentPassword, row.password_hash))) throw forbidden('Current password is incorrect.', 'WRONG_PASSWORD');
    ctx.db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?').run(await hashPassword(newPassword, ctx.config.bcryptRounds), nowIso(), u.id);
    audit(ctx, u, 'PASSWORD_CHANGED', 'user', u.id, {}, req);
    const fresh = ctx.db.prepare('SELECT token_version FROM users WHERE id = ?').get(u.id) as any;
    setCookie(res, u, fresh.token_version);
    res.json({ ok: true });
  }));

  r.patch('/profile', requireAuth, wrap((req, res) => {
    const u = reqUser(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(100).optional(),
        department: z.string().trim().min(2).max(100).optional(),
        avatarUrl: z.string().url().max(500).nullable().optional(),
        prefs: z.object({
          notify: z.object({ message: z.boolean(), file: z.boolean(), announcement: z.boolean(), attendance: z.boolean() }).partial().optional(),
          aiAssistance: z.boolean().optional(),
        }).optional(),
      }).strict(),
      req.body,
    );
    const prefs = { ...u.prefs, ...(body.prefs ?? {}), notify: { ...u.prefs.notify, ...(body.prefs?.notify ?? {}) } };
    ctx.db
      .prepare('UPDATE users SET display_name = ?, department = ?, avatar_url = ?, prefs_json = ?, updated_at = ? WHERE id = ?')
      .run(body.name ?? u.name, body.department ?? u.department, body.avatarUrl === undefined ? u.avatarUrl : body.avatarUrl, JSON.stringify(prefs), nowIso(), u.id);
    audit(ctx, u, 'PROFILE_UPDATED', 'user', u.id, { fields: Object.keys(body) }, req);
    res.json({ user: publicUser(loadUser(ctx, u.id)!) });
  }));

  return r;
}
