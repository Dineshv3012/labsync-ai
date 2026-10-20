import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, FlaskConical, ShieldOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api, ApiError } from '../../lib/api';
import { Alert, Button, Card, Field, inputCls } from '../ui';
import type { User } from '../../types';

const Shell: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-10 bg-slate-50 dark:bg-slate-950">
    <Card className="w-full max-w-md p-6 sm:p-8">
      <div className="flex justify-center mb-4"><span className="w-11 h-11 rounded-xl bg-blue-900 flex items-center justify-center text-white"><FlaskConical className="w-5 h-5" aria-hidden /></span></div>
      <h1 className="text-xl font-bold text-center text-slate-900 dark:text-white">{title}</h1>
      {subtitle && <p className="text-sm text-center text-slate-500 mt-1 mb-5">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-5'}>{children}</div>
    </Card>
  </div>
);

const PasswordInput: React.FC<{ id: string; value: string; onChange: (v: string) => void; autoComplete: string; required?: boolean }> = ({ id, value, onChange, autoComplete }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required className={`${inputCls} pr-10`} />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
    </div>
  );
};

const link = 'text-blue-800 dark:text-cyan-400 font-medium hover:underline';

export const LoginPage: React.FC = () => {
  const { signIn, navigate, toast, sessionMessage } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.post<{ user: User }>('/auth/login', { email, password });
      signIn(r.user);
      toast(`Welcome back, ${r.user.name.split(' ')[0]}.`, 'success');
      navigate('dashboard');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  };
  return (
    <Shell title="Sign in to LabSync AI" subtitle="Use your institutional account.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {sessionMessage && <Alert tone="warn">{sessionMessage}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Email" htmlFor="email"><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></Field>
        <Field label="Password" htmlFor="password"><PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" /></Field>
        <div className="text-right text-sm"><button type="button" onClick={() => navigate('forgot-password')} className={link}>Forgot password?</button></div>
        <Button type="submit" loading={busy} className="w-full">Sign in</Button>
      </form>
      <p className="text-sm text-center text-slate-500 mt-5">New here? <button onClick={() => navigate('register')} className={link}>Create an account</button></p>
    </Shell>
  );
};

export const RegisterPage: React.FC = () => {
  const { signIn, navigate } = useApp();
  const [f, setF] = useState({ name: '', email: '', password: '', department: '', studentOrStaffId: '', requestedRole: 'student' as 'student' | 'staff' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ message: string; devVerifyLink?: string; signedIn: boolean } | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.post<{ user: User | null; message: string; devVerifyLink?: string }>('/auth/register', f);
      if (r.user) { signIn(r.user); navigate('dashboard'); return; }
      setDone({ message: r.message, devVerifyLink: r.devVerifyLink, signedIn: false });
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create the account.'); }
    finally { setBusy(false); }
  };
  if (done) {
    return (
      <Shell title="Almost there">
        <div className="space-y-4">
          <Alert tone="success">{done.message}</Alert>
          {done.devVerifyLink && <Alert tone="info"><strong>Development mode:</strong> e-mail is not configured, so here is your verification link: <a className="underline break-all" href={done.devVerifyLink}>{done.devVerifyLink}</a></Alert>}
          <Button className="w-full" onClick={() => navigate('login')}>Go to sign in</Button>
        </div>
      </Shell>
    );
  }
  return (
    <Shell title="Create your account" subtitle="Students start with student access. Staff accounts need administrator approval.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Full name" htmlFor="name"><input id="name" required autoComplete="name" value={f.name} onChange={(e) => set('name')(e.target.value)} className={inputCls} /></Field>
        <Field label="Institutional email" htmlFor="remail"><input id="remail" type="email" required autoComplete="email" value={f.email} onChange={(e) => set('email')(e.target.value)} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Department" htmlFor="dept"><input id="dept" required value={f.department} onChange={(e) => set('department')(e.target.value)} className={inputCls} /></Field>
          <Field label="Student / staff ID" htmlFor="sid"><input id="sid" required value={f.studentOrStaffId} onChange={(e) => set('studentOrStaffId')(e.target.value)} className={inputCls} /></Field>
        </div>
        <Field label="I am a" htmlFor="role" hint={f.requestedRole === 'staff' ? 'Your staff role will be reviewed by an administrator before you can sign in.' : undefined}>
          <select id="role" value={f.requestedRole} onChange={(e) => set('requestedRole')(e.target.value)} className={inputCls}><option value="student">Student</option><option value="staff">Staff / instructor</option></select>
        </Field>
        <Field label="Password" htmlFor="rpass" hint="At least 10 characters with a letter and a number."><PasswordInput id="rpass" value={f.password} onChange={set('password')} autoComplete="new-password" /></Field>
        <Button type="submit" loading={busy} className="w-full">Create account</Button>
      </form>
      <p className="text-sm text-center text-slate-500 mt-5">Already registered? <button onClick={() => navigate('login')} className={link}>Sign in</button></p>
    </Shell>
  );
};

export const ForgotPasswordPage: React.FC = () => {
  const { navigate } = useApp();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ message: string; devResetLink?: string } | null>(null);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { setRes(await api.post('/auth/forgot-password', { email })); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Request failed.'); }
    finally { setBusy(false); }
  };
  return (
    <Shell title="Reset your password" subtitle="We’ll send a single-use link that expires in 30 minutes.">
      {res ? (
        <div className="space-y-4">
          <Alert tone="success">{res.message}</Alert>
          {res.devResetLink && <Alert tone="info"><strong>Development mode:</strong> e-mail is not configured. Use this link: <a className="underline break-all" href={res.devResetLink}>{res.devResetLink}</a></Alert>}
          <Button variant="secondary" className="w-full" onClick={() => navigate('login')}>Back to sign in</Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email" htmlFor="femail"><input id="femail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></Field>
          <Button type="submit" loading={busy} className="w-full">Send reset link</Button>
          <p className="text-sm text-center"><button type="button" onClick={() => navigate('login')} className={link}>Back to sign in</button></p>
        </form>
      )}
    </Shell>
  );
};

export const ResetPasswordPage: React.FC = () => {
  const { navigate, deepLink, clearDeepLink, toast } = useApp();
  const [token] = useState(deepLink.reset ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api.post('/auth/reset-password', { token, password }); clearDeepLink(); toast('Password updated. Please sign in.', 'success'); navigate('login'); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not reset the password.'); }
    finally { setBusy(false); }
  };
  if (!token) return <Shell title="Reset link missing"><Alert tone="error">Open the link from your e-mail, or request a new one.</Alert><Button className="w-full mt-4" onClick={() => navigate('forgot-password')}>Request a new link</Button></Shell>;
  return (
    <Shell title="Choose a new password" subtitle="You will be signed out of all other devices.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="New password" htmlFor="np" hint="At least 10 characters with a letter and a number."><PasswordInput id="np" value={password} onChange={setPassword} autoComplete="new-password" /></Field>
        <Button type="submit" loading={busy} className="w-full">Update password</Button>
      </form>
    </Shell>
  );
};

export const VerifyEmailPage: React.FC = () => {
  const { navigate, deepLink, clearDeepLink } = useApp();
  const [state, setState] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    if (!deepLink.verify) { setState({ ok: false, msg: 'This verification link is incomplete.' }); return; }
    api.post<{ message: string }>('/auth/verify-email', { token: deepLink.verify })
      .then((r) => setState({ ok: true, msg: r.message }))
      .catch((e) => setState({ ok: false, msg: e instanceof ApiError ? e.message : 'Verification failed.' }))
      .finally(clearDeepLink);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Shell title="E-mail verification">
      {!state ? <p className="text-center text-sm text-slate-500">Verifying…</p> : <div className="space-y-4"><Alert tone={state.ok ? 'success' : 'error'}>{state.msg}</Alert><Button className="w-full" onClick={() => navigate('login')}>Go to sign in</Button></div>}
    </Shell>
  );
};

export const AccessDenied: React.FC = () => {
  const { navigate, user } = useApp();
  return (
    <div className="py-16 flex flex-col items-center text-center gap-3">
      <ShieldOff className="w-12 h-12 text-red-500" aria-hidden />
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Access denied</h1>
      <p className="text-sm text-slate-500 max-w-sm">Your role{user ? ` (${user.role})` : ''} does not have permission to view this page.</p>
      <Button onClick={() => navigate('dashboard')}>Back to dashboard</Button>
    </div>
  );
};
