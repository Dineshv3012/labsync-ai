import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import type { Ctx } from './types';
import { SESSION_COOKIE, loadUser } from './middleware';
import { verifySession } from './security';
import { isLabMember, isLabStaff } from './permissions';

export interface Realtime {
  attach(server: HttpServer, ctx: Ctx): void;
  emitToLab(labId: string, event: string, payload: unknown): void;
  emitToLabStaff(labId: string, event: string, payload: unknown): void;
  emitToUser(userId: string, event: string, payload: unknown): void;
  presence(labId: string): { userId: string; name: string }[];
  connectionCount(): number;
  close(): void;
}

export function createRealtime(): Realtime {
  let io: Server | null = null;
  // labId -> userId -> {name, sockets}
  const presence = new Map<string, Map<string, { name: string; sockets: Set<string> }>>();

  const snapshot = (labId: string) => [...(presence.get(labId) ?? new Map()).entries()].map(([userId, v]) => ({ userId, name: v.name }));

  return {
    attach(server, ctx) {
      io = new Server(server, { cors: { origin: false }, serveClient: false });
      io.use((socket, next) => {
        const origin = socket.handshake.headers.origin;
        const host = socket.handshake.headers.host;
        if (origin && origin !== ctx.config.baseUrl && !origin.endsWith(`//${host}`)) return next(new Error('origin_not_allowed'));
        const cookies = parseCookie(socket.handshake.headers.cookie || '');
        const token = cookies[SESSION_COOKIE];
        const claims = token ? verifySession(ctx.config.jwtSecret, token) : null;
        if (!claims || claims === 'expired') return next(new Error('unauthenticated'));
        const user = loadUser(ctx, claims.sub);
        if (!user || user.status !== 'active' || user.tokenVersion !== claims.tv) return next(new Error('unauthenticated'));
        socket.data.user = user;
        next();
      });
      io.on('connection', (socket) => {
        const user = socket.data.user as { id: string; name: string };
        socket.join(`user:${user.id}`);
        const joined = new Set<string>();

        socket.on('lab:join', (labId: unknown, ack?: (r: { ok: boolean; error?: string }) => void) => {
          if (typeof labId !== 'string' || !isLabMember(ctx, socket.data.user, labId)) return ack?.({ ok: false, error: 'forbidden' });
          socket.join(`lab:${labId}`);
          if (isLabStaff(ctx, socket.data.user, labId)) socket.join(`labstaff:${labId}`);
          joined.add(labId);
          const lab = presence.get(labId) ?? new Map();
          const entry = lab.get(user.id) ?? { name: user.name, sockets: new Set<string>() };
          entry.sockets.add(socket.id);
          lab.set(user.id, entry);
          presence.set(labId, lab);
          io!.to(`lab:${labId}`).emit('presence:update', { labId, online: snapshot(labId) });
          ack?.({ ok: true });
        });

        socket.on('lab:leave', (labId: unknown) => {
          if (typeof labId === 'string') leave(labId);
        });

        const leave = (labId: string) => {
          socket.leave(`lab:${labId}`);
          socket.leave(`labstaff:${labId}`);
          joined.delete(labId);
          const lab = presence.get(labId);
          const entry = lab?.get(user.id);
          if (entry) {
            entry.sockets.delete(socket.id);
            if (!entry.sockets.size) lab!.delete(user.id);
          }
          io?.to(`lab:${labId}`).emit('presence:update', { labId, online: snapshot(labId) });
        };
        socket.on('disconnect', () => [...joined].forEach(leave));
      });
    },
    emitToLab: (labId, e, p) => void io?.to(`lab:${labId}`).emit(e, p),
    emitToLabStaff: (labId, e, p) => void io?.to(`labstaff:${labId}`).emit(e, p),
    emitToUser: (userId, e, p) => void io?.to(`user:${userId}`).emit(e, p),
    presence: snapshot,
    connectionCount: () => io?.engine?.clientsCount ?? 0,
    close() { void io?.close(); io = null; },
  };
}
