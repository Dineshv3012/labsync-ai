import express from 'express';
import http from 'http';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import type { AppConfig } from './config';
import { openDatabase, nowIso, type DB } from './db';
import { createSettings } from './settings';
import { createMailer } from './mailer';
import { createRealtime } from './realtime';
import { createGeminiProvider, type AiProvider } from './ai/provider';
import type { Ctx } from './types';
import { authenticate, csrfGuard, requireAuth } from './middleware';
import { errorHandler } from './errors';
import { authRoutes } from './routes/auth';
import { joinRoutes, labRoutes, sessionRoutes } from './routes/labs';
import { attendanceRoutes } from './routes/attendance';
import { chatRoutes } from './routes/chat';
import { fileRoutes } from './routes/files';
import { miscRoutes } from './routes/misc';
import { reportRoutes } from './routes/reports';
import { aiRoutes } from './routes/ai';
import { adminRoutes } from './routes/admin';
import { dashboardRoutes } from './routes/dashboard';
import { hashPassword, newId } from './security';
import { startJobs } from './jobs';
import { DEFAULT_PREFS, audit } from './services';

export interface App {
  app: express.Express;
  server: http.Server;
  ctx: Ctx;
  close(): Promise<void>;
}

/** Creates the initial administrator from environment variables if none exists (the only trusted way to get an admin). */
export async function ensureAdmin(ctx: Ctx) {
  const { adminEmail, adminPassword, adminName } = ctx.config;
  if ((ctx.db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get() as any).c > 0) return;
  if (!adminEmail || !adminPassword) {
    console.warn('[setup] No administrator exists. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env and restart to create one.');
    return;
  }
  if (adminPassword.length < 10) { console.warn('[setup] ADMIN_PASSWORD must be at least 10 characters. Admin not created.'); return; }
  const id = newId();
  const t = nowIso();
  ctx.db.prepare(`INSERT INTO users(id,email,password_hash,display_name,role,department,student_or_staff_id,status,email_verified,prefs_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,1,?,?,?)`).run(id, adminEmail, await hashPassword(adminPassword, ctx.config.bcryptRounds), adminName, 'admin', 'Administration', 'ADMIN', 'active', JSON.stringify(DEFAULT_PREFS), t, t);
  audit(ctx, null, 'ADMIN_BOOTSTRAP', 'user', id, { email: adminEmail });
  console.log(`[setup] Administrator account created for ${adminEmail}`);
}

export async function createApp(config: AppConfig, opts: { ai?: AiProvider; db?: DB; vite?: boolean } = {}): Promise<App> {
  const db = opts.db ?? openDatabase(config.databasePath);
  const settings = createSettings(db);
  const rt = createRealtime();
  const provider = opts.ai ?? createGeminiProvider(config.geminiApiKey, config.geminiModel);
  const ctx: Ctx = { config, db, rt, mailer: createMailer(config), ai: { provider }, settings };
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  const dev = !config.isProduction && !config.isTest && opts.vite !== false;
  app.use(helmet({
    contentSecurityPolicy: dev ? false : {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'], 'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'connect-src': ["'self'", 'ws:', 'wss:'], 'frame-src': ["'self'"], 'object-src': ["'none'"], 'frame-ancestors': ["'self'"],
        'upgrade-insecure-requests': config.baseUrl.startsWith('https') ? [] : null,
      },
    },
    strictTransportSecurity: config.isProduction && config.baseUrl.startsWith('https'),
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(authenticate(ctx));
  api.use(csrfGuard(ctx));

  api.get('/health', (_req, res) => res.json({ status: 'ok', time: nowIso(), aiConfigured: provider.configured }));
  api.use('/auth', authRoutes(ctx));

  const priv = express.Router();
  priv.use(requireAuth);
  priv.use('/labs', joinRoutes(ctx)); // /labs/join must precede /labs/:id
  priv.use('/labs', labRoutes(ctx));
  priv.use('/labs', sessionRoutes(ctx));
  priv.use('/attendance', attendanceRoutes(ctx));
  priv.use('/', chatRoutes(ctx));
  priv.use('/', fileRoutes(ctx));
  priv.use('/', miscRoutes(ctx));
  priv.use('/reports', reportRoutes(ctx));
  priv.use('/ai', aiRoutes(ctx));
  priv.use('/dashboard', dashboardRoutes(ctx));
  priv.use('/admin', adminRoutes(ctx));
  api.use(priv);
  api.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown API endpoint.' }));
  app.use('/api', api);

  const server = http.createServer(app);
  rt.attach(server, ctx);

  if (!config.isTest) {
    if (dev) {
      const { createServer } = await import('vite');
      const vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
      app.use(vite.middlewares);
    } else {
      const dist = path.resolve(process.cwd(), 'dist');
      app.use(express.static(dist, { index: false, maxAge: '1h' }));
      app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    }
  }
  app.use(errorHandler());

  await ensureAdmin(ctx);
  const stopJobs = config.isTest ? () => {} : startJobs(ctx);

  return {
    app, server, ctx,
    async close() {
      stopJobs();
      rt.close();
      await new Promise<void>((r) => (server.listening ? server.close(() => r()) : r()));
      if (!opts.db) db.close();
    },
  };
}
