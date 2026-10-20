import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, onUnauthorized } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';
import type { Notice, User } from '../types';

export type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; text: string }
export type ModalState =
  | { type: 'join'; code?: string }
  | { type: 'createLab' }
  | { type: 'editLab'; labId: string }
  | null;

interface Ctx {
  user: User | null;
  authLoading: boolean;
  view: string;
  params: Record<string, string>;
  navigate: (view: string, params?: Record<string, string>) => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  toasts: Toast[];
  toast: (text: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
  notices: Notice[];
  unreadCount: number;
  refreshNotices: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  signIn: (user: User) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (u: User) => void;
  modal: ModalState;
  setModal: (m: ModalState) => void;
  dataVersion: number;
  bumpData: () => void;
  deepLink: DeepLink;
  clearDeepLink: () => void;
  sessionMessage: string | null;
}

export interface DeepLink { checkin?: string; verify?: string; reset?: string; join?: string }
const AppContext = createContext<Ctx | undefined>(undefined);

export const PUBLIC_VIEWS = ['landing', 'features', 'how-it-works', 'security', 'about', 'contact', 'terms', 'privacy', 'login', 'register', 'forgot-password', 'reset-password', 'verify-email'];
export const ROLE_VIEWS: Record<string, string[]> = {
  alerts: ['staff', 'admin'], reports: ['staff', 'admin'],
  admin_users: ['admin'], admin_settings: ['admin'], audit_logs: ['admin'], system_health: ['admin'],
};

function parseHash(): { view: string; params: Record<string, string> } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [view, query = ''] = raw.split('?');
  return { view: view || '', params: Object.fromEntries(new URLSearchParams(query)) };
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const initial = parseHash();
  const [view, setView] = useState(initial.view || 'landing');
  const [params, setParams] = useState<Record<string, string>>(initial.params);
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => (localStorage.getItem('labsync_theme') as 'light' | 'dark') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [unreadCount, setUnread] = useState(0);
  const [modal, setModal] = useState<ModalState>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const toastId = useRef(0);

  const deepLinkRef = useRef(() => {
    const q = new URLSearchParams(window.location.search);
    return { checkin: q.get('checkin') ?? undefined, verify: q.get('verify') ?? undefined, reset: q.get('reset') ?? undefined, join: q.get('join') ?? undefined };
  });
  const [deepLink, setDeepLink] = useState<DeepLink>(() => deepLinkRef.current());
  const clearDeepLink = useCallback(() => {
    setDeepLink({});
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, []);

  const navigate = useCallback((v: string, p: Record<string, string> = {}) => {
    setView(v);
    setParams(p);
    const q = new URLSearchParams(p).toString();
    window.location.hash = `/${v}${q ? `?${q}` : ''}`;
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const onHash = () => { const h = parseHash(); setView(h.view || 'landing'); setParams(h.params); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    localStorage.setItem('labsync_theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refreshNotices = useCallback(async () => {
    try {
      const r = await api.get<{ notifications: Notice[]; unreadCount: number }>('/notifications');
      setNotices(r.notifications.slice(0, 10));
      setUnread(r.unreadCount);
    } catch { /* non-critical */ }
  }, []);

  // Restore the session on first load.
  useEffect(() => {
    api.get<{ user: User }>('/auth/me')
      .then((r) => setUserState(r.user))
      .catch(() => setUserState(null))
      .finally(() => setAuthLoading(false));
  }, []);

  // Real-time connection + notifications while signed in.
  useEffect(() => {
    if (!user) { disconnectSocket(); setNotices([]); setUnread(0); return; }
    void refreshNotices();
    const s = connectSocket();
    const onNew = (n: Notice) => {
      setNotices((p) => [n, ...p].slice(0, 10));
      setUnread((c) => c + 1);
      toast(`${n.title}: ${n.message}`.slice(0, 140), 'info');
    };
    s.on('notification:new', onNew);
    return () => { s.off('notification:new', onNew); };
  }, [user?.id, refreshNotices, toast]);

  const signIn = useCallback((u: User) => { setUserState(u); setSessionMessage(null); }, []);
  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setUserState(null);
    navigate('landing');
  }, [navigate]);
  const refreshUser = useCallback(async () => {
    try { setUserState((await api.get<{ user: User }>('/auth/me')).user); } catch { /* ignore */ }
  }, []);

  // A 401 from any call means the session ended.
  useEffect(() => onUnauthorized((code) => {
    setUserState((u) => {
      if (u) {
        setSessionMessage(code === 'SESSION_EXPIRED' ? 'Your session expired. Please sign in again.' : 'You were signed out. Please sign in again.');
        setTimeout(() => navigate('login'), 0);
      }
      return null;
    });
  }), [navigate]);

  const markAllRead = useCallback(async () => {
    try {
      const r = await api.post<{ unreadCount: number }>('/notifications/read', { all: true });
      setUnread(r.unreadCount);
      setNotices((p) => p.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update notifications.', 'error'); }
  }, [toast]);
  const markRead = useCallback(async (id: string) => {
    try {
      const r = await api.post<{ unreadCount: number }>('/notifications/read', { ids: [id] });
      setUnread(r.unreadCount);
      setNotices((p) => p.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)));
    } catch { /* ignore */ }
  }, []);

  const value = useMemo<Ctx>(() => ({
    user, authLoading, view, params, navigate, theme, setTheme: setThemeState, toasts, toast, dismissToast, notices, unreadCount,
    refreshNotices, markAllRead, markRead, signIn, logout, refreshUser, setUser: setUserState, modal, setModal, dataVersion,
    bumpData: () => setDataVersion((v) => v + 1), deepLink, clearDeepLink, sessionMessage,
  }), [user, authLoading, view, params, navigate, theme, toasts, toast, dismissToast, notices, unreadCount, refreshNotices, markAllRead, markRead, signIn, logout, refreshUser, modal, dataVersion, deepLink, clearDeepLink, sessionMessage]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp must be used inside AppProvider');
  return c;
};
