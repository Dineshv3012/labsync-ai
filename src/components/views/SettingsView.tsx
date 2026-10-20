import React, { useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { Alert, Badge, Button, Card, Field, PageHeader, inputCls } from '../ui';
import type { User } from '../../types';

const Toggle: React.FC<{ id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }> = ({ id, label, hint, checked, onChange }) => (
  <label htmlFor={id} className="flex items-start justify-between gap-4 py-3 cursor-pointer">
    <span><span className="block text-sm font-medium text-slate-900 dark:text-white">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 w-5 h-5 accent-blue-900" />
  </label>
);

export const SettingsView: React.FC = () => {
  const { user, setUser, toast, theme, setTheme } = useApp();
  const [name, setName] = useState(user!.name);
  const [dept, setDept] = useState(user!.department);
  const [busy, setBusy] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [pwError, setPwError] = useState('');
  const save = async (key: string, body: unknown, ok: string) => {
    setBusy(key);
    try { const r = await api.patch<{ user: User }>('/auth/profile', body); setUser(r.user); toast(ok, 'success'); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save.', 'error'); } finally { setBusy(''); }
  };
  const changePw = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy('pw'); setPwError('');
    try { await api.post('/auth/change-password', pw); setPw({ currentPassword: '', newPassword: '' }); toast('Password changed. Other devices were signed out.', 'success'); }
    catch (err) { setPwError(err instanceof ApiError ? err.message : 'Failed.'); } finally { setBusy(''); }
  };
  const n = user!.prefs.notify;
  return (
    <>
      <PageHeader title="Profile & settings" />
      <div className="grid lg:grid-cols-2 gap-5">
        <Card className="p-5 space-y-4">
          <h2 className="font-semibold text-slate-900 dark:text-white">Profile</h2>
          <div className="flex flex-wrap gap-2 text-xs"><Badge tone="blue">{user!.role}</Badge><Badge>{user!.email}</Badge><Badge>{user!.studentOrStaffId}</Badge></div>
          <Field label="Full name" htmlFor="pn"><input id="pn" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
          <Field label="Department" htmlFor="pd"><input id="pd" value={dept} onChange={(e) => setDept(e.target.value)} className={inputCls} /></Field>
          <p className="text-xs text-slate-500">Role and ID can only be changed by an administrator.</p>
          <Button loading={busy === 'p'} disabled={name.trim().length < 2 || dept.trim().length < 2} onClick={() => save('p', { name, department: dept }, 'Profile saved.')}>Save profile</Button>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 dark:text-white mb-1">Preferences</h2>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <Toggle id="tdark" label="Dark theme" checked={theme === 'dark'} onChange={(v) => setTheme(v ? 'dark' : 'light')} />
            <Toggle id="tai" label="AI assistance" hint="Allow my questions and lab excerpts to be sent to the AI provider." checked={user!.prefs.aiAssistance} onChange={(v) => save('ai', { prefs: { aiAssistance: v } }, v ? 'AI assistance enabled.' : 'AI assistance disabled.')} />
            <p className="pt-3 text-xs font-semibold uppercase text-slate-400">Notify me about</p>
            <Toggle id="nm" label="Chat messages" checked={n.message} onChange={(v) => save('n', { prefs: { notify: { message: v } } }, 'Saved.')} />
            <Toggle id="nf" label="New files" checked={n.file} onChange={(v) => save('n', { prefs: { notify: { file: v } } }, 'Saved.')} />
            <Toggle id="na" label="Announcements" checked={n.announcement} onChange={(v) => save('n', { prefs: { notify: { announcement: v } } }, 'Saved.')} />
            <Toggle id="nat" label="Attendance updates" checked={n.attendance} onChange={(v) => save('n', { prefs: { notify: { attendance: v } } }, 'Saved.')} />
          </div>
          <p className="text-xs text-slate-500 mt-2">Security and account notices are always delivered.</p>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-semibold text-slate-900 dark:text-white mb-3">Change password</h2>
          <form onSubmit={changePw} className="grid sm:grid-cols-3 gap-3 items-end" noValidate>
            {pwError && <div className="sm:col-span-3"><Alert tone="error">{pwError}</Alert></div>}
            <Field label="Current password" htmlFor="cp"><input id="cp" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} className={inputCls} /></Field>
            <Field label="New password" htmlFor="npw" hint="10+ characters, a letter and a number."><input id="npw" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} className={inputCls} /></Field>
            <Button type="submit" loading={busy === 'pw'} disabled={!pw.currentPassword || pw.newPassword.length < 10}>Update password</Button>
          </form>
        </Card>
      </div>
    </>
  );
};
