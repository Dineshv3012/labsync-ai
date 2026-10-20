import React, { useEffect, useRef, useState } from 'react';
import { Bell, Bot, Building2, CalendarCheck, ChevronDown, FileText, FlaskConical, LayoutDashboard, LogOut, Megaphone, Menu, Moon, Search, Settings, ShieldAlert, ShieldCheck, Sun, Users, BarChart3, Activity, ScrollText, X, SlidersHorizontal } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../lib/api';
import { useDebounced } from '../../hooks/useAsync';
import { cx } from '../ui';
import { initials, timeAgo } from '../../lib/format';
import type { Role } from '../../types';

interface NavItem { view: string; label: string; icon: React.ElementType; roles?: Role[] }
const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Workspace', items: [
    { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { view: 'labs', label: 'Laboratories', icon: Building2 },
    { view: 'attendance', label: 'Attendance', icon: CalendarCheck },
    { view: 'files', label: 'Files', icon: FileText },
    { view: 'announcements', label: 'Announcements', icon: Megaphone },
    { view: 'ai_assistant', label: 'AI Assistant', icon: Bot },
  ] },
  { title: 'Staff tools', items: [
    { view: 'alerts', label: 'Alerts & Review', icon: ShieldAlert, roles: ['staff', 'admin'] },
    { view: 'reports', label: 'Reports', icon: BarChart3, roles: ['staff', 'admin'] },
  ] },
  { title: 'Administration', items: [
    { view: 'admin_users', label: 'Users & Roles', icon: Users, roles: ['admin'] },
    { view: 'admin_settings', label: 'System Settings', icon: SlidersHorizontal, roles: ['admin'] },
    { view: 'audit_logs', label: 'Audit Logs', icon: ScrollText, roles: ['admin'] },
    { view: 'system_health', label: 'System Health', icon: Activity, roles: ['admin'] },
  ] },
];

const TITLES: Record<string, string> = {
  dashboard: 'Dashboard', labs: 'Laboratories', lab_room: 'Lab room', attendance: 'Attendance', files: 'Files', announcements: 'Announcements',
  ai_assistant: 'AI Assistant', alerts: 'Alerts & Review', reports: 'Reports', admin_users: 'Users & Roles', admin_settings: 'System Settings',
  audit_logs: 'Audit Logs', system_health: 'System Health', notifications: 'Notifications', settings: 'Settings',
};

function GlobalSearch() {
  const { navigate } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [res, setRes] = useState<{ labs: any[]; files: any[]; announcements: any[] } | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dq.trim().length < 2) { setRes(null); return; }
    let live = true;
    api.get<any>(`/search?q=${encodeURIComponent(dq.trim())}`).then((r) => live && setRes(r)).catch(() => live && setRes(null));
    return () => { live = false; };
  }, [dq]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const go = (view: string, params: Record<string, string> = {}) => { setOpen(false); setQ(''); navigate(view, params); };
  const empty = res && !res.labs.length && !res.files.length && !res.announcements.length;
  return (
    <div ref={ref} className="relative hidden md:block w-72 lg:w-96">
      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} aria-label="Search laboratories, files and announcements" placeholder="Search labs, files, announcements…"
        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600" />
      {open && res && (
        <div className="absolute mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-40 max-h-96 overflow-auto p-2 text-sm">
          {empty && <p className="p-3 text-slate-500">No results for “{dq}”.</p>}
          {res.labs.length > 0 && <p className="px-2 pt-1 text-xs font-semibold text-slate-400 uppercase">Laboratories</p>}
          {res.labs.map((l) => <button key={l.id} onClick={() => go('lab_room', { lab: l.id })} className="w-full text-left px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100">{l.name} <span className="text-slate-400">· {l.code}</span></button>)}
          {res.files.length > 0 && <p className="px-2 pt-2 text-xs font-semibold text-slate-400 uppercase">Files</p>}
          {res.files.map((f) => <button key={f.id} onClick={() => go('files', { lab: f.labId, q: f.name })} className="w-full text-left px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100">{f.name}</button>)}
          {res.announcements.length > 0 && <p className="px-2 pt-2 text-xs font-semibold text-slate-400 uppercase">Announcements</p>}
          {res.announcements.map((a) => <button key={a.id} onClick={() => go('announcements', { lab: a.labId })} className="w-full text-left px-2 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100">{a.title}</button>)}
        </div>
      )}
    </div>
  );
}

function Bell_() {
  const { notices, unreadCount, markAllRead, markRead, navigate } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const open_ = (link: string | null, id: string) => {
    void markRead(id); setOpen(false);
    if (!link) return;
    const [path, query = ''] = link.replace(/^\//, '').split('?');
    navigate(path, Object.fromEntries(new URLSearchParams(query)));
  };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={open} className="relative p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(92vw,22rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-40">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</span>
            {unreadCount > 0 && <button onClick={() => void markAllRead()} className="text-xs text-blue-700 dark:text-cyan-400 hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-auto">
            {notices.length === 0 && <p className="p-6 text-center text-sm text-slate-500">You’re all caught up.</p>}
            {notices.map((n) => (
              <button key={n.id} onClick={() => open_(n.link, n.id)} className={cx('w-full text-left px-4 py-3 border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60', !n.readAt && 'bg-blue-50/60 dark:bg-blue-950/30')}>
                <div className="flex justify-between gap-2"><span className="text-sm font-medium text-slate-900 dark:text-white truncate">{n.title}</span><span className="text-[11px] text-slate-400 shrink-0">{timeAgo(n.createdAt)}</span></div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{n.message}</p>
              </button>
            ))}
          </div>
          <button onClick={() => { setOpen(false); navigate('notifications'); }} className="w-full py-2.5 text-sm text-blue-700 dark:text-cyan-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-b-xl">View all notifications</button>
        </div>
      )}
    </div>
  );
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, view, navigate, theme, setTheme, logout } = useApp();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setDrawer(false); }, [view]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!user) return null;

  const sidebar = (
    <nav aria-label="Main navigation" className="flex flex-col h-full">
      <button onClick={() => navigate('dashboard')} className="flex items-center gap-2.5 px-5 h-16 shrink-0 border-b border-slate-200 dark:border-slate-800">
        <span className="w-8 h-8 rounded-lg bg-blue-900 flex items-center justify-center text-white"><FlaskConical className="w-4 h-4" aria-hidden /></span>
        <span className="font-heading font-bold text-slate-900 dark:text-white">LabSync <span className="text-cyan-600">AI</span></span>
      </button>
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.roles || i.roles.includes(user.role));
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <p className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</p>
              {items.map((i) => {
                const active = view === i.view || (i.view === 'labs' && view === 'lab_room');
                return (
                  <button key={i.view} onClick={() => navigate(i.view)} aria-current={active ? 'page' : undefined}
                    className={cx('w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors', active ? 'bg-blue-900 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800')}>
                    <i.icon className="w-[18px] h-[18px]" aria-hidden /> {i.label}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="px-3 pb-4 text-[11px] text-slate-400 flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" aria-hidden /> Signed in as {user.role}</div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 bg-white text-blue-900 px-3 py-2 rounded-lg">Skip to content</a>
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-30">{sidebar}</aside>
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-72 max-w-[85vw] bg-white dark:bg-slate-900 shadow-2xl relative">{sidebar}<button onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute top-4 right-3 p-1.5 text-slate-500"><X className="w-5 h-5" /></button></div>
          <div className="flex-1 bg-slate-900/50" onClick={() => setDrawer(false)} />
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 px-4 sm:px-6">
          <button onClick={() => setDrawer(true)} aria-label="Open menu" className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"><Menu className="w-5 h-5" /></button>
          <span className="font-semibold text-slate-900 dark:text-white truncate hidden sm:block">{TITLES[view] ?? ''}</span>
          <div className="flex-1" />
          <GlobalSearch />
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">{theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}</button>
          <Bell_ />
          <div ref={menuRef} className="relative">
            <button onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="Account menu" className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
              <span className="w-8 h-8 rounded-full bg-blue-900 text-white text-xs font-bold flex items-center justify-center">{initials(user.name)}</span>
              <ChevronDown className="w-4 h-4 text-slate-400 hidden sm:block" aria-hidden />
            </button>
            {menu && (
              <div className="absolute right-0 mt-2 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-40 p-1.5">
                <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 mb-1"><p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{user.name}</p><p className="text-xs text-slate-500 truncate">{user.email}</p></div>
                <button onClick={() => { setMenu(false); navigate('settings'); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"><Settings className="w-4 h-4" aria-hidden /> Profile & settings</button>
                <button onClick={() => { setMenu(false); void logout(); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"><LogOut className="w-4 h-4" aria-hidden /> Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main id="main" className="p-4 sm:p-6 max-w-7xl mx-auto">{children}</main>
      </div>
    </div>
  );
};
