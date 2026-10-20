import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner, cx } from '../ui';
import { fmtDateTime } from '../../lib/format';
import type { Notice } from '../../types';

export const NotificationsView: React.FC = () => {
  const { navigate, markAllRead, markRead, unreadCount, refreshNotices } = useApp();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, loading, error, reloadWithSpinner, reload } = useAsync(() => api.get<{ notifications: Notice[]; total: number }>(`/notifications?page=${page}${unreadOnly ? '&unread=1' : ''}`), [page, unreadOnly, unreadCount]);
  const open = async (n: Notice) => {
    await markRead(n.id);
    if (n.link) { const [p, q = ''] = n.link.replace(/^\//, '').split('?'); navigate(p, Object.fromEntries(new URLSearchParams(q))); } else void reload();
  };
  return (
    <>
      <PageHeader title="Notifications" subtitle={unreadCount ? `${unreadCount} unread` : 'You are all caught up.'}
        actions={<><Button variant="secondary" onClick={() => { setUnreadOnly(!unreadOnly); setPage(1); }}>{unreadOnly ? 'Show all' : 'Unread only'}</Button><Button disabled={!unreadCount} onClick={async () => { await markAllRead(); void refreshNotices(); void reload(); }}>Mark all read</Button></>} />
      <Card className="p-0 overflow-hidden">
        {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={reloadWithSpinner} /> : !data?.notifications.length ? <EmptyState icon={<Bell className="w-6 h-6" />} title="No notifications" hint="Messages, files, announcements and attendance updates show up here in real time." /> : (
          <>
            <ul>{data.notifications.map((n) => (
              <li key={n.id}><button onClick={() => open(n)} className={cx('w-full text-left px-4 py-3.5 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 flex gap-3', !n.readAt && 'bg-blue-50/60 dark:bg-blue-950/30')}>
                <span className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0', n.readAt ? 'bg-transparent' : 'bg-blue-600')} aria-label={n.readAt ? 'read' : 'unread'} />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="text-sm font-medium text-slate-900 dark:text-white">{n.title}</span><Badge>{n.type}</Badge></span><span className="block text-sm text-slate-600 dark:text-slate-300">{n.message}</span><span className="block text-xs text-slate-400 mt-0.5">{fmtDateTime(n.createdAt)}</span></span>
              </button></li>))}
            </ul>
            <div className="px-4 pb-3"><Pagination page={page} pageSize={30} total={data.total} onPage={setPage} /></div>
          </>
        )}
      </Card>
    </>
  );
};
