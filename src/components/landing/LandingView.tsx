import React, { useEffect } from 'react';
import { Bot, CalendarCheck, FileLock2, KeyRound, MessagesSquare, ScrollText, ShieldCheck, Users, BarChart3, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button, Card } from '../ui';

const FEATURES = [
  { icon: KeyRound, title: 'Secure room codes', text: 'Time-limited, revocable codes (stored only as hashes) with capacity limits and failed-attempt protection.' },
  { icon: CalendarCheck, title: 'Trustworthy attendance', text: 'Server-side timestamps, duplicate prevention, missing check-out detection and fully audited staff corrections.' },
  { icon: MessagesSquare, title: 'Real-time lab chat', text: 'Instant messaging, announcements and presence for every laboratory room, visible only to its members.' },
  { icon: FileLock2, title: 'Protected file sharing', text: 'Type and content checks, size limits, quotas and permission-checked downloads for every shared file.' },
  { icon: Bot, title: 'AI study assistant', text: 'Gemini-powered Q&A over documents you are allowed to see, with sources, plus chat and session summaries.' },
  { icon: BarChart3, title: 'Reports & insights', text: 'Attendance, occupancy, usage and security reports with CSV export, scoped to your role.' },
  { icon: Users, title: 'Role-based access', text: 'Students, staff and administrators each see exactly what they should - enforced on the server, not just the UI.' },
  { icon: ScrollText, title: 'Immutable audit trail', text: 'Sensitive actions are logged by the server in an append-only audit log for accountability.' },
];
const STEPS = [
  ['Staff create a lab', 'Set capacity, schedule and course, then generate a time-limited access code or QR.'],
  ['Students join securely', 'Enter the code once to become a member; staff can revoke access at any time.'],
  ['Sessions & attendance', 'Staff start a session; students check in and out with server-verified times.'],
  ['Collaborate & review', 'Chat, share files, ask the AI assistant and review alerts, reports and audit logs.'],
];

export const LandingView: React.FC<{ section?: string }> = ({ section }) => {
  const { navigate, user } = useApp();
  useEffect(() => {
    if (section) document.getElementById(section)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [section]);
  return (
    <div className="bg-white dark:bg-slate-950">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50 via-white to-white dark:from-slate-900 dark:via-slate-950 dark:to-slate-950" aria-hidden />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-20 text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-950 text-blue-900 dark:text-cyan-300"><ShieldCheck className="w-3.5 h-3.5" aria-hidden /> Smart computer laboratory management</span>
          <h1 className="mt-5 text-3xl sm:text-5xl font-extrabold text-slate-900 dark:text-white leading-tight">Run every lab session with <span className="text-blue-900 dark:text-cyan-400">trusted attendance</span>, live collaboration and AI help.</h1>
          <p className="mt-5 text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">LabSync AI gives students, instructors and administrators one secure place for room access, attendance, chat, files and reporting.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button onClick={() => navigate(user ? 'dashboard' : 'register')}>{user ? 'Open dashboard' : 'Create an account'} <ArrowRight className="w-4 h-4" aria-hidden /></Button>
            {!user && <Button variant="secondary" onClick={() => navigate('login')}>Sign in</Button>}
          </div>
        </div>
      </section>

      <section id="features" className="max-w-7xl mx-auto px-4 sm:px-6 py-16 scroll-mt-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center text-slate-900 dark:text-white">Everything a lab needs, nothing it doesn’t</h2>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <Card key={f.title} className="p-5">
              <span className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-cyan-400 flex items-center justify-center"><f.icon className="w-5 h-5" aria-hidden /></span>
              <h3 className="mt-3 font-semibold text-slate-900 dark:text-white">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{f.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="bg-slate-50 dark:bg-slate-900/50 py-16 scroll-mt-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-slate-900 dark:text-white">How it works</h2>
          <ol className="mt-10 grid sm:grid-cols-2 gap-5">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
                <span className="w-9 h-9 shrink-0 rounded-full bg-blue-900 text-white font-bold flex items-center justify-center" aria-hidden>{i + 1}</span>
                <div><h3 className="font-semibold text-slate-900 dark:text-white">{t}</h3><p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{d}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="security" className="max-w-5xl mx-auto px-4 sm:px-6 py-16 scroll-mt-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center text-slate-900 dark:text-white">Security you can explain to your institution</h2>
        <ul className="mt-8 grid sm:grid-cols-2 gap-3 text-sm text-slate-700 dark:text-slate-300">
          {['Passwords hashed with bcrypt; sessions in HttpOnly cookies', 'Role and lab-membership checks on every API request', 'Room codes hashed at rest, expiring, revocable and rate-limited', 'Uploads validated by real file content, never executed or served inline unless safe', 'AI keys stay on the server; documents are shared with AI only if you can already read them', 'Append-only audit log of sensitive actions with before/after values'].map((t) => (
            <li key={t} className="flex gap-2 items-start"><CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" aria-hidden />{t}</li>
          ))}
        </ul>
      </section>
    </div>
  );
};

const Prose: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14 text-slate-700 dark:text-slate-300 text-sm leading-relaxed space-y-4 bg-white dark:bg-slate-950 min-h-[60vh]">
    <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{title}</h1>{children}
  </div>
);

export const AboutPage = () => (
  <Prose title="About LabSync AI">
    <p>LabSync AI is a laboratory management and collaboration platform for college computer labs. It replaces paper registers and scattered chat groups with one system where instructors control room access, attendance is recorded by the server, and students can collaborate and ask questions about their course material.</p>
    <p>The AI assistant is optional. It only reads documents a user is already permitted to open, labels its answers as AI-generated, and every administrator can disable it or cap its usage.</p>
  </Prose>
);

export const ContactPage = () => {
  const { navigate } = useApp();
  return (
    <Prose title="Contact">
      <p>LabSync AI is operated by your institution. For account, access or attendance questions, contact the staff member assigned to your laboratory or your system administrator.</p>
      <p>Forgot your password? Use the reset link on the sign-in page.</p>
      <Button onClick={() => navigate('login')}>Go to sign in</Button>
    </Prose>
  );
};

export const TermsPage = () => (
  <Prose title="Terms of use">
    <p>By using LabSync AI you agree to use laboratory resources responsibly, keep your credentials private and share only material you are allowed to share.</p>
    <p>Attendance records, messages, uploads and security-relevant actions are stored and may be reviewed by authorised staff and administrators in line with your institution’s policies.</p>
    <p>Attempting to bypass access controls, uploading malicious files or abusing the AI assistant may result in suspension. This page is a template: your institution should review and replace it with its own terms.</p>
  </Prose>
);

export const PrivacyPage = () => (
  <Prose title="Privacy">
    <p><strong>What is stored:</strong> account details, lab memberships, attendance times, chat messages, uploaded files, notifications and an audit log of sensitive actions.</p>
    <p><strong>AI processing:</strong> when AI is enabled and you have not opted out, the text you submit (and, for document questions, the relevant excerpts of documents you can access) is sent to Google’s Gemini API to generate a response. You can turn AI assistance off in Settings.</p>
    <p><strong>Retention:</strong> administrators configure how long chat messages and notifications are kept. Audit logs are append-only.</p>
    <p>This page is a template: your institution should review it and add its own data-protection contacts and legal basis.</p>
  </Prose>
);
