import path from 'path';
import crypto from 'crypto';

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  baseUrl: string;
  jwtSecret: string;
  databasePath: string;
  uploadDir: string;
  geminiApiKey: string;
  geminiModel: string;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
  autoApproveStudents: boolean;
  requireEmailVerification: boolean;
  allowedEmailDomains: string[];
  smtp: { host: string; port: number; user: string; pass: string; from: string } | null;
  trustProxy: boolean;
  exposeDevLinks: boolean;
  bcryptRounds: number;
  rateLimitEnabled: boolean;
}

const PLACEHOLDER_ADMIN_PASSWORD = 'ChangeMe-LabSync-2026!';

const bool = (v: string | undefined, d: boolean) =>
  v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';
  const cwd = process.cwd();

  let jwtSecret = env.JWT_SECRET || '';
  if (!jwtSecret) {
    if (isProduction) throw new Error('JWT_SECRET must be set in production (at least 32 random characters).');
    jwtSecret = crypto.randomBytes(32).toString('hex');
    if (!isTest) console.warn('[config] JWT_SECRET is not set - using a temporary secret. Sessions reset on every restart.');
  }
  if (isProduction && jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production.');

  const adminPassword = env.ADMIN_PASSWORD || '';
  if (isProduction && adminPassword === PLACEHOLDER_ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD still has the placeholder value. Change it before running in production.');
  }

  const smtp = env.SMTP_HOST
    ? {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 587),
        user: env.SMTP_USER || '',
        pass: env.SMTP_PASS || '',
        from: env.SMTP_FROM || 'LabSync AI <no-reply@localhost>',
      }
    : null;

  const port = Number(env.PORT || 3000);
  const cfg: AppConfig = {
    nodeEnv,
    isProduction,
    isTest,
    port,
    baseUrl: (env.APP_BASE_URL || env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    jwtSecret,
    databasePath: path.resolve(cwd, env.DATABASE_PATH || './data/labsync.db'),
    uploadDir: path.resolve(cwd, env.UPLOAD_DIR || './data/uploads'),
    geminiApiKey: env.GEMINI_API_KEY && !env.GEMINI_API_KEY.startsWith('MY_') ? env.GEMINI_API_KEY : '',
    geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash',
    adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    adminPassword,
    adminName: env.ADMIN_NAME || 'System Administrator',
    autoApproveStudents: bool(env.AUTO_APPROVE_STUDENTS, true),
    requireEmailVerification: bool(env.REQUIRE_EMAIL_VERIFICATION, false),
    allowedEmailDomains: (env.ALLOWED_EMAIL_DOMAINS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    smtp,
    trustProxy: bool(env.TRUST_PROXY, false),
    exposeDevLinks: bool(env.DEV_EXPOSE_LINKS, !isProduction),
    bcryptRounds: isTest ? 4 : 12,
    rateLimitEnabled: !isTest,
  };
  return { ...cfg, ...overrides };
}
