import type { Request } from 'express';
import type { AppConfig } from './config';
import type { DB } from './db';
import type { Realtime } from './realtime';
import type { Mailer } from './mailer';
import type { AiProvider } from './ai/provider';
import type { Settings } from './settings';

export type Role = 'student' | 'staff' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string;
  studentOrStaffId: string;
  status: 'active' | 'pending' | 'suspended';
  emailVerified: boolean;
  avatarUrl: string | null;
  prefs: UserPrefs;
  createdAt: string;
}

export interface UserPrefs {
  notify: { message: boolean; file: boolean; announcement: boolean; attendance: boolean };
  aiAssistance: boolean;
  [k: string]: unknown;
}

export interface Ctx {
  config: AppConfig;
  db: DB;
  rt: Realtime;
  mailer: Mailer;
  ai: { provider: AiProvider };
  settings: Settings;
}

export type AuthedRequest = Request & { user: AuthUser };
export const reqUser = (req: Request): AuthUser => {
  const u = (req as Partial<AuthedRequest>).user;
  if (!u) throw new Error('reqUser called on unauthenticated request');
  return u;
};
export const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || '';
