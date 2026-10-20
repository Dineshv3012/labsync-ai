import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
export function connectSocket(): Socket {
  if (!socket) socket = io({ withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 8000 });
  return socket;
}
export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
export const getSocket = () => socket;
