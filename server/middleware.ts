import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { Ctx, Role, AuthUser } from './types';
import { reqUser } from './types';
import { forbidden, unauthorized, HttpError } from './errors';
import { verifySession } from './security';
import { parsePrefs } from './services';

export const SESSION_COOKIE = 'labsync_session';

export function loadUser(ctx: Ctx, id: string): (AuthUser & { tokenVersion: number }) | null {
  const r = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  if (!r) return null;
  return {
    id: r.id, email: r.email, name: r.display_name, role: r.role, department: r.department,
    studentOrStaffId: r.student_or_staff_id, status: r.status, emailVerified: !!r.email_verified,
    avatarUrl: r.avatar_url, prefs: parsePrefs(r.prefs_json), createdAt: r.created_at, tokenVersion: r.token_version,
  };
}

/** Resolve the user from the session cookie (no error when absent). */
export function authenticate(ctx: Ctx) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const claims = verifySession(ctx.config.jwtSecret, token);
    if (claims === 'expired') {
      res.clearCookie(SESSION_COOKIE);
      (req as any).sessionExpired = true;
      return next();
    }
    if (!claims) return next();
    const user = loadUser(ctx, claims.sub);
    if (user && user.status === 'active' && user.tokenVersion === claims.tv) (req as any).user = user;
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!(req as any).user) {
    return next((req as any).sessionExpired ? unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED') : unauthorized());
  }
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const u = (req as any).user as AuthUser | undefined;
    if (!u) return next(unauthorized());
    if (!roles.includes(u.role)) return next(forbidden('Your role does not have access to this resource.', 'ROLE_FORBIDDEN'));
    next();
  };

/** CSRF defence in depth: cookies are SameSite=Lax; state-changing calls must also carry the custom header and a same-origin Origin. */
export function csrfGuard(ctx: Ctx) {
  const allowed = new Set([ctx.config.baseUrl]);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'LabSync') return next(forbidden('Missing request header.', 'CSRF'));
    const origin = req.get('origin');
    if (origin && !allowed.has(origin) && origin !== `${req.protocol}://${req.get('host')}`) return next(forbidden('Cross-origin request blocked.', 'CSRF'));
    next();
  };
}

export function limiter(ctx: Ctx, windowMs: number, max: number, message: string) {
  if (!ctx.config.rateLimitEnabled) return (_q: Request, _s: Response, n: NextFunction) => n();
  return rateLimit({
    windowMs, limit: max, standardHeaders: true, legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', message)),
  });
}

/** Small in-memory per-user fixed-window limiter for chat/AI bursts. */
export function userBurstLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (userId: string): boolean => {
    const now = Date.now();
    const arr = (hits.get(userId) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(userId, arr); return false; }
    arr.push(now);
    hits.set(userId, arr);
    return true;
  };
}

export { reqUser };
