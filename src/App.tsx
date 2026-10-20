import React, { useEffect } from 'react';
import { AppProvider, PUBLIC_VIEWS, ROLE_VIEWS, useApp } from './context/AppContext';
import { AppShell } from './components/layout/AppShell';
import { PublicFooter, PublicNavbar } from './components/layout/PublicChrome';
import { AccessDenied, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from './components/auth/AuthPages';
import { AboutPage, ContactPage, LandingView, PrivacyPage, TermsPage } from './components/landing/LandingView';
import { StudentDashboard } from './components/student/StudentDashboard';
import { StaffDashboard } from './components/staff/StaffDashboard';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { AdminSettings, AdminUsers, AuditLogs, SystemHealth } from './components/admin/AdminPages';
import { LaboratoriesView } from './components/labs/LaboratoriesView';
import { LiveLabRoom } from './components/labs/LiveLabRoom';
import { JoinLabModal, LabFormModal } from './components/labs/LabModals';
import { AttendanceView } from './components/views/AttendanceView';
import { FilesView } from './components/views/FilesView';
import { ReportsView } from './components/views/ReportsView';
import { NotificationsView } from './components/views/NotificationsView';
import { SettingsView } from './components/views/SettingsView';
import { AnnouncementsView } from './components/views/AnnouncementsView';
import { AIAssistantView } from './components/views/AIAssistantView';
import { AlertsView } from './components/views/AlertsView';
import { ToastHost, Spinner } from './components/ui';

const Router: React.FC = () => {
  const { user, authLoading, view, navigate, modal, setModal, deepLink, clearDeepLink } = useApp();

  // E-mail links (?verify= / ?reset=) and QR/code join links (?join=) arrive as query strings.
  useEffect(() => {
    if (authLoading) return;
    if (deepLink.verify) navigate('verify-email');
    else if (deepLink.reset) navigate('reset-password');
    else if (deepLink.join) {
      const code = deepLink.join;
      clearDeepLink();
      if (user) { navigate('dashboard'); setModal({ type: 'join', code }); } else { sessionStorage.setItem('labsync_pending_join', code); navigate('login'); }
    }
  }, [authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return;
    const pending = sessionStorage.getItem('labsync_pending_join');
    if (pending) { sessionStorage.removeItem('labsync_pending_join'); setModal({ type: 'join', code: pending }); }
    if (deepLink.checkin && user.role === 'student') navigate('lab_room', { lab: deepLink.checkin.split('.')[0], tab: 'session' }); // the session panel consumes the QR token
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <div className="min-h-screen bg-white dark:bg-slate-950"><Spinner label="Loading LabSync AI…" /></div>;

  const isPublic = PUBLIC_VIEWS.includes(view);
  let page: React.ReactNode;
  if (isPublic || !user) {
    const wrap = (n: React.ReactNode) => <><PublicNavbar /><main>{n}</main><PublicFooter /></>;
    switch (view) {
      case 'login': page = wrap(<LoginPage />); break;
      case 'register': page = wrap(<RegisterPage />); break;
      case 'forgot-password': page = wrap(<ForgotPasswordPage />); break;
      case 'reset-password': page = wrap(<ResetPasswordPage />); break;
      case 'verify-email': page = wrap(<VerifyEmailPage />); break;
      case 'about': page = wrap(<AboutPage />); break;
      case 'contact': page = wrap(<ContactPage />); break;
      case 'terms': page = wrap(<TermsPage />); break;
      case 'privacy': page = wrap(<PrivacyPage />); break;
      case 'features': case 'how-it-works': case 'security': page = wrap(<LandingView section={view} />); break;
      default: page = PUBLIC_VIEWS.includes(view) || !view ? wrap(<LandingView />) : wrap(<LoginPage />);
    }
  } else {
    const allowed = ROLE_VIEWS[view];
    let body: React.ReactNode;
    if (allowed && !allowed.includes(user.role)) body = <AccessDenied />;
    else switch (view) {
      case 'dashboard': body = user.role === 'admin' ? <AdminDashboard /> : user.role === 'staff' ? <StaffDashboard /> : <StudentDashboard />; break;
      case 'labs': body = <LaboratoriesView />; break;
      case 'lab_room': body = <LiveLabRoom />; break;
      case 'attendance': body = <AttendanceView />; break;
      case 'files': body = <FilesView />; break;
      case 'announcements': body = <AnnouncementsView />; break;
      case 'ai_assistant': body = <AIAssistantView />; break;
      case 'alerts': body = <AlertsView />; break;
      case 'reports': body = <ReportsView />; break;
      case 'notifications': body = <NotificationsView />; break;
      case 'settings': body = <SettingsView />; break;
      case 'admin_users': body = <AdminUsers />; break;
      case 'admin_settings': body = <AdminSettings />; break;
      case 'audit_logs': body = <AuditLogs />; break;
      case 'system_health': body = <SystemHealth />; break;
      default: body = user.role === 'admin' ? <AdminDashboard /> : user.role === 'staff' ? <StaffDashboard /> : <StudentDashboard />;
    }
    page = <AppShell>{body}</AppShell>;
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {page}
      {user && modal?.type === 'join' && <JoinLabModal code={modal.code} />}
      {user && modal?.type === 'createLab' && <LabFormModal />}
      {user && modal?.type === 'editLab' && <LabFormModal labId={modal.labId} />}
      <ToastHost />
    </div>
  );
};

export default function App() {
  return <AppProvider><Router /></AppProvider>;
}
