import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

export const newId = () => crypto.randomUUID();
export const sha256 = (v: string | Buffer) => crypto.createHash('sha256').update(v).digest('hex');
export const hmac = (secret: string, v: string) => crypto.createHmac('sha256', secret).update(v).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const hashPassword = (pw: string, rounds: number) => bcrypt.hash(pw, rounds);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

const COMMON = new Set(['password123', 'password1234', '1234567890', 'qwerty12345', 'letmein1234', 'welcome1234', 'admin12345']);

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain at least one letter and one number.')
  .refine((v) => !COMMON.has(v.toLowerCase()), 'That password is too common. Choose a different one.');

// Room codes: 8 characters, unambiguous alphabet, cryptographically secure randomness.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateRoomCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}
export const normalizeRoomCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const formatRoomCode = (v: string) => `${v.slice(0, 4)}-${v.slice(4)}`;
export const hashRoomCode = (secret: string, code: string) => hmac(secret, `room-code:${normalizeRoomCode(code)}`);

export interface SessionClaims {
  sub: string;
  tv: number;
}
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const signSession = (secret: string, claims: SessionClaims) =>
  jwt.sign(claims, secret, { expiresIn: SESSION_TTL_SECONDS, algorithm: 'HS256' });
export function verifySession(secret: string, token: string): SessionClaims | 'expired' | null {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as unknown as SessionClaims;
  } catch (e: any) {
    return e?.name === 'TokenExpiredError' ? 'expired' : null;
  }
}

/** Neutralise spreadsheet formula injection for CSV exports. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (columns: string[], rows: Record<string, unknown>[]) =>
  [columns.map(csvCell).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n');

/** Remove path components and control characters from user supplied file names. */
export function safeFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() || 'file';
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '_').trim().slice(0, 150);
  return cleaned || 'file';
}
