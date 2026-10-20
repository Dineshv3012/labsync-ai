import React, { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Spinner } from '../ui';
import { fmtDateTime } from '../../lib/format';

export const AnnouncementsView: React.FC = () => {
  const { params, navigate, user } = useApp();
  const [page, setPage] = useState(1);
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<{ announcements: { id: string; labId: string; labName: string; author: string; title: string; content: string; priority: string; createdAt: string }[]; total: number }>(`/announcements${qs({ labId: params.lab, page })}`), [params.lab, page]);
  return (
    <>
      <PageHeader title="Announcements" subtitle={user?.role === 'student' ? 'Updates from your instructors.' : 'Post announcements from a lab room’s Announcements tab.'} />
      {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={reloadWithSpinner} /> : !data?.announcements.length ? <Card><EmptyState icon={<Megaphone className="w-6 h-6" />} title="No announcements" hint="Instructors’ announcements for your laboratories appear here." /></Card> : (
        <div className="space-y-3">
          {data.announcements.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-900 dark:text-white">{a.title}</h2>{a.priority === 'urgent' && <Badge tone="red">Urgent</Badge>}<button onClick={() => navigate('lab_room', { lab: a.labId })} className="text-xs text-blue-700 dark:text-cyan-400 hover:underline">{a.labName}</button></div>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap">{a.content}</p>
              <p className="text-xs text-slate-400 mt-2">{a.author} · {fmtDateTime(a.createdAt)}</p>
            </Card>
          ))}
          <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
        </div>
      )}
    </>
  );
};
