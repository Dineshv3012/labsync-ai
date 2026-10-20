import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'net';
import { H, makeEnv } from './helpers';

type Env = Awaited<ReturnType<typeof makeEnv>>;
let env: Env;
let url = '';

beforeAll(async () => {
  env = await makeEnv();
  await new Promise<void>((r) => env.server.listen(0, r));
  url = `http://localhost:${(env.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await env.close(); });

const cookieOf = async (a: any, email: string) => {
  const res = await a.post('/api/auth/login').set(H).send({ email, password: 'Sup3rSecret-pass' });
  return (res.headers['set-cookie'] as string[])[0].split(';')[0];
};
const open = (cookie?: string) => connect(url, { extraHeaders: cookie ? { cookie } : {}, transports: ['websocket'], reconnection: false });
const once = <T,>(s: Socket, ev: string) => new Promise<T>((res) => s.once(ev, res));

describe('real-time lab room', () => {
  it('rejects unauthenticated sockets', async () => {
    const s = open();
    const err = await new Promise<Error>((res) => s.once('connect_error', res));
    expect(err.message).toBe('unauthenticated');
    s.close();
  });

  it('only members can join a lab room, and members receive new messages instantly', async () => {
    const staff = await env.makeStaff('rt-staff@test.edu', 'RT Staff');
    const lab = await env.createLab(staff.a);
    const code = await env.newCode(staff.a, lab.id);
    const member = await env.makeStudent('rt-member@test.edu', 'RT Member');
    const outsider = await env.makeStudent('rt-out@test.edu', 'RT Out');
    await member.a.post('/api/labs/join').set(H).send({ code: code.code });

    const ms = open(await cookieOf(env.agent(), 'rt-member@test.edu'));
    const os = open(await cookieOf(env.agent(), 'rt-out@test.edu'));
    await Promise.all([once(ms, 'connect'), once(os, 'connect')]);

    const denied = await new Promise<any>((res) => os.emit('lab:join', lab.id, res));
    expect(denied.ok).toBe(false);
    const ok = await new Promise<any>((res) => ms.emit('lab:join', lab.id, res));
    expect(ok.ok).toBe(true);

    const leaked: unknown[] = [];
    os.on('message:new', (m) => leaked.push(m));
    const incoming = once<any>(ms, 'message:new');
    await staff.a.post(`/api/labs/${lab.id}/messages`).set(H).send({ content: 'live!' });
    expect((await incoming).content).toBe('live!');
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toHaveLength(0);
    expect(env.ctx.rt.presence(lab.id).map((p) => p.name)).toContain('RT Member');
    ms.close(); os.close();
    void outsider;
  });
});
