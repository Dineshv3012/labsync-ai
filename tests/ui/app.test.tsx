// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import App from '../../src/App';

const student = { id: 'u1', name: 'Asha Raman', email: 'asha@x.edu', role: 'student', department: 'CSE', studentOrStaffId: 'S1', status: 'active', emailVerified: true, avatarUrl: null, createdAt: '', prefs: { notify: { message: true, file: true, announcement: true, attendance: true }, aiAssistance: true } };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

function mockApi(opts: { signedIn?: boolean; loginStatus?: number } = {}) {
  let signedIn = !!opts.signedIn;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api', '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/auth/me') return signedIn ? json({ user: student }) : json({ error: 'UNAUTHENTICATED', message: 'Please sign in' }, 401);
    if (path === '/auth/login') { if (opts.loginStatus === 401) return json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }, 401); signedIn = true; return json({ user: student }); }
    if (path.startsWith('/notifications')) return json({ notifications: [], unreadCount: 0, total: 0 });
    if (path === '/dashboard/student') return json({ attendanceToday: null, attendanceSummary: { sessions: 2, hours: 3.5, missingCheckouts: 0, pendingVerification: 0 }, currentLabs: [], unreadMessages: 0, sharedFiles: 0, recentMessages: [], recentFiles: [], announcements: [], upcoming: [], todaysSchedule: [] });
    if (path.startsWith('/labs')) return json({ labs: [] });
    if (path.startsWith('/attendance')) return json({ records: [], total: 0 });
    return json({ error: 'NOT_FOUND', message: 'nope' }, 404);
  }));
  return calls;
}

beforeEach(() => {
  window.location.hash = '';
  localStorage.clear();
  // jsdom lacks these browser APIs
  window.scrollTo = vi.fn() as never;
  window.matchMedia = window.matchMedia || ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);
  vi.mock('../../src/lib/socket', () => ({ connectSocket: () => ({ on() {}, off() {}, emit() {}, connected: false }), disconnectSocket() {}, getSocket: () => null }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('LabSync UI', () => {
  it('shows the public landing page to signed-out visitors', async () => {
    mockApi();
    render(<App />);
    expect(await screen.findByText(/trusted attendance/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it('shows a clear error for bad credentials and stays on the login form', async () => {
    mockApi({ loginStatus: 401 });
    const user = userEvent.setup();
    render(<App />);
    await user.click((await screen.findAllByRole('button', { name: /sign in/i }))[0]);
    await user.type(await screen.findByLabelText('Email'), 'asha@x.edu');
    await user.type(screen.getByLabelText('Password'), 'wrong-password-1');
    await user.click(within(screen.getByLabelText('Email').closest('form')!).getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/invalid email or password/i);
  });

  it('signs in and renders the role-specific student dashboard with navigation', async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click((await screen.findAllByRole('button', { name: /sign in/i }))[0]);
    await user.type(await screen.findByLabelText('Email'), 'asha@x.edu');
    await user.type(screen.getByLabelText('Password'), 'Right-password-1');
    await user.click(within(screen.getByLabelText('Email').closest('form')!).getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Hello, Asha/)).toBeTruthy();
    expect(screen.getByText('Sessions attended')).toBeTruthy();
    // Students must not see staff/admin navigation.
    expect(screen.queryByText('Users & Roles')).toBeNull();
    expect(screen.queryByText('Reports')).toBeNull();
    expect(calls).toContain('POST /auth/login');
  });

  it('blocks a student from an admin-only route', async () => {
    mockApi({ signedIn: true });
    window.location.hash = '#/admin_users';
    render(<App />);
    expect(await screen.findByText('Access denied')).toBeTruthy();
  });

  it('renders the empty laboratory state with a join action for students', async () => {
    mockApi({ signedIn: true });
    window.location.hash = '#/labs';
    render(<App />);
    await waitFor(() => expect(screen.getByText('No laboratories yet')).toBeTruthy());
    expect(screen.getAllByRole('button', { name: /join with code/i }).length).toBeGreaterThan(0);
  });
});
