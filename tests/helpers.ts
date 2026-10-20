import request from 'supertest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { loadConfig } from '../server/config';
import { createApp, type App } from '../server/app';
import type { AiProvider } from '../server/ai/provider';

export const H = { 'X-Requested-With': 'LabSync' };
export const PASSWORD = 'Sup3rSecret-pass';

export function fakeAi(reply = 'FAKE-AI-ANSWER'): AiProvider & { calls: any[]; fail?: boolean } {
  const p: any = {
    configured: true, model: 'fake-model', calls: [], fail: false,
    async generate(req: any) {
      p.calls.push(req);
      if (p.fail) throw new (await import('../server/ai/provider')).AiProviderError('upstream down', 'upstream');
      return req.json ? JSON.stringify({ title: 'T', overview: 'O', keyQuestions: ['q?'], actionItems: ['a'], unansweredQuestions: [] }) : reply;
    },
  };
  return p;
}

export async function makeEnv(opts: { ai?: AiProvider | null; config?: Record<string, unknown> } = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labsync-test-'));
  const config = loadConfig({
    databasePath: ':memory:', uploadDir, baseUrl: 'http://localhost:3000', adminEmail: 'admin@test.edu', adminPassword: PASSWORD,
    jwtSecret: 'test-secret-test-secret-test-secret-123456', ...(opts.config ?? {}),
  });
  const ai = opts.ai === null ? undefined : opts.ai ?? fakeAi();
  const app: App = await createApp(config, { ai });
  const agent = () => request.agent(app.app);

  const register = async (email: string, name: string, extra: Record<string, unknown> = {}) =>
    request(app.app).post('/api/auth/register').set(H).send({ name, email, password: PASSWORD, department: 'CSE', studentOrStaffId: `ID-${name}`, ...extra });

  const login = async (email: string, password = PASSWORD) => {
    const a = agent();
    const res = await a.post('/api/auth/login').set(H).send({ email, password });
    return { a, res };
  };

  const admin = (await login('admin@test.edu')).a;
  const makeStaff = async (email = 'staff@test.edu', name = 'Staff One') => {
    const reg = await register(email, name, { requestedRole: 'staff' });
    const id = app.ctx.db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string };
    await admin.post(`/api/admin/users/${id.id}/approve`).set(H).send({});
    void reg;
    return { a: (await login(email)).a, id: id.id };
  };
  const makeStudent = async (email: string, name = 'Student') => {
    await register(email, name);
    const id = (app.ctx.db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string }).id;
    return { a: (await login(email)).a, id };
  };
  const createLab = async (staff: request.Agent, over: Record<string, unknown> = {}) =>
    (await staff.post('/api/labs').set(H).send({ name: 'Data Structures Lab', code: 'DS' + Math.random().toString(36).slice(2, 7), capacity: 5, course: 'CS204', roomNumber: '302', ...over })).body.lab as { id: string };
  const newCode = async (staff: request.Agent, labId: string, body: Record<string, unknown> = {}) =>
    (await staff.post(`/api/labs/${labId}/codes`).set(H).send(body)).body as { id: string; code: string };

  return { ...app, agent, register, login, admin, makeStaff, makeStudent, createLab, newCode, uploadDir };
}
