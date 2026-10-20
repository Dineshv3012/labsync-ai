import React, { useState } from 'react';
import { Download, Eye, File as FileIcon, FileText, Flag, Image as ImageIcon, Search, Trash2 } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useAsync, useDebounced } from '../../hooks/useAsync';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Pagination, Spinner, TableWrap, Td, Th, inputCls } from '../ui';
import { UploadButton } from '../labs/UploadButton';
import { fmtBytes, fmtDateTime } from '../../lib/format';
import type { Lab, LabFile } from '../../types';

const Preview: React.FC<{ file: LabFile; onClose: () => void }> = ({ file, onClose }) => {
  const isImg = file.contentType.startsWith('image/');
  const isPdf = file.contentType === 'application/pdf';
  const text = useAsync(() => (file.contentType.startsWith('text/') ? api.get<{ text: string; truncated: boolean }>(`/files/${file.id}/text`) : Promise.resolve(null)), [file.id]);
  return (
    <Modal open onClose={onClose} title={file.name} wide>
      {isImg && <img src={`/api/files/${file.id}/download?inline=1`} alt={file.name} className="max-h-[60vh] mx-auto rounded-lg" />}
      {isPdf && <iframe title={file.name} src={`/api/files/${file.id}/download?inline=1`} sandbox="" className="w-full h-[60vh] rounded-lg border border-slate-200 dark:border-slate-700" />}
      {file.contentType.startsWith('text/') && (text.loading ? <Spinner /> : <pre className="text-xs bg-slate-50 dark:bg-slate-800 rounded-lg p-3 overflow-auto max-h-[60vh] whitespace-pre-wrap text-slate-800 dark:text-slate-100">{text.data?.text}{text.data?.truncated ? '\n… (truncated)' : ''}</pre>)}
    </Modal>
  );
};

export const FileBrowser: React.FC<{ fixedLabId?: string; archived?: boolean }> = ({ fixedLabId, archived }) => {
  const { user, params, toast, dataVersion } = useApp();
  const [labId, setLabId] = useState(fixedLabId ?? params.lab ?? '');
  const [q, setQ] = useState(params.q ?? '');
  const dq = useDebounced(q, 300);
  const [type, setType] = useState('');
  const [sort, setSort] = useState('date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState<LabFile | null>(null);
  const [del, setDel] = useState<LabFile | null>(null);
  const [rep, setRep] = useState<LabFile | null>(null);
  const [reason, setReason] = useState('');
  const labs = useAsync(() => (fixedLabId ? Promise.resolve({ labs: [] as Lab[] }) : api.get<{ labs: Lab[] }>('/labs')), [fixedLabId]);
  const { data, loading, error, reloadWithSpinner } = useAsync(() => api.get<{ files: LabFile[]; total: number }>(`/files${qs({ labId, q: dq, type, sort, order, page, pageSize: 15 })}`), [labId, dq, type, sort, order, page, version, dataVersion]);
  const storage = useAsync(() => (labId ? api.get<{ usedBytes: number; quotaBytes: number; maxFileMB: number; allowedExtensions: string[] }>(`/labs/${labId}/storage`) : Promise.resolve(null)), [labId, version]);
  const icon = (f: LabFile) => (f.contentType.startsWith('image/') ? <ImageIcon className="w-4 h-4 text-purple-500" aria-hidden /> : f.contentType === 'application/pdf' ? <FileText className="w-4 h-4 text-red-500" aria-hidden /> : <FileIcon className="w-4 h-4 text-slate-400" aria-hidden />);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-100 dark:border-slate-800">
        {!fixedLabId && <select aria-label="Laboratory" value={labId} onChange={(e) => { setLabId(e.target.value); setPage(1); }} className={`${inputCls} !w-auto`}><option value="">All my labs</option>{labs.data?.labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        <div className="relative flex-1 min-w-48"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden /><input aria-label="Search files" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by file name…" className={`${inputCls} pl-9`} /></div>
        <select aria-label="File type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className={`${inputCls} !w-auto`}><option value="">All types</option><option value="document">Documents</option><option value="image">Images</option><option value="code">Code</option><option value="media">Audio/Video</option><option value="archive">Archives</option></select>
        <select aria-label="Sort by" value={`${sort}:${order}`} onChange={(e) => { const [s, o] = e.target.value.split(':'); setSort(s); setOrder(o as 'asc' | 'desc'); }} className={`${inputCls} !w-auto`}><option value="date:desc">Newest</option><option value="date:asc">Oldest</option><option value="name:asc">Name A–Z</option><option value="size:desc">Largest</option><option value="uploader:asc">Uploader</option></select>
        {labId && !archived && <UploadButton labId={labId} onUploaded={() => setVersion((v) => v + 1)} />}
      </div>
      {labId && storage.data && <p className="px-4 pt-3 text-xs text-slate-500">Storage {fmtBytes(storage.data.usedBytes)} of {fmtBytes(storage.data.quotaBytes)} · max file {storage.data.maxFileMB} MB</p>}
      {!labId && !fixedLabId && <div className="px-4 pt-3"><Alert tone="info">Pick a laboratory to upload files.</Alert></div>}
      {loading ? <Spinner /> : error ? <ErrorState message={error} onRetry={reloadWithSpinner} /> : !data?.files.length ? <EmptyState icon={<FileText className="w-6 h-6" />} title={dq || type ? 'No files match your filters' : 'No files shared yet'} hint={dq || type ? 'Try a different search.' : 'Uploaded notes, slides and code will appear here for lab members.'} /> : (
        <div className="p-2">
          <TableWrap>
            <thead><tr><Th>Name</Th><Th>Lab</Th><Th>Uploader</Th><Th>Size</Th><Th>Uploaded</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>{data.files.map((f) => (
              <tr key={f.id}>
                <Td><span className="flex items-center gap-2 min-w-0">{icon(f)}<span className="truncate max-w-56" title={f.name}>{f.name}</span>{f.indexed && <Badge tone="blue">AI-readable</Badge>}</span></Td>
                <Td>{f.labName}</Td><Td>{f.uploaderName}</Td><Td>{fmtBytes(f.size)}</Td><Td>{fmtDateTime(f.createdAt)}</Td>
                <Td className="text-right whitespace-nowrap">
                  {(f.previewable || f.contentType.startsWith('text/')) && <Button size="sm" variant="ghost" aria-label={`Preview ${f.name}`} onClick={() => setPreview(f)}><Eye className="w-4 h-4" aria-hidden /></Button>}
                  <a href={`/api/files/${f.id}/download`} aria-label={`Download ${f.name}`} className="inline-flex p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"><Download className="w-4 h-4" aria-hidden /></a>
                  {f.uploaderId !== user?.id && <Button size="sm" variant="ghost" aria-label={`Report ${f.name}`} onClick={() => setRep(f)}><Flag className="w-4 h-4" aria-hidden /></Button>}
                  {(f.uploaderId === user?.id || user?.role !== 'student') && <Button size="sm" variant="ghost" aria-label={`Delete ${f.name}`} onClick={() => setDel(f)}><Trash2 className="w-4 h-4 text-red-500" aria-hidden /></Button>}
                </Td>
              </tr>))}
            </tbody>
          </TableWrap>
          <div className="px-2 pb-2"><Pagination page={page} pageSize={15} total={data.total} onPage={setPage} /></div>
        </div>
      )}
      {preview && <Preview file={preview} onClose={() => setPreview(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger confirmLabel="Delete" title="Delete file?" message={<>Delete <strong>{del?.name}</strong>? Members will no longer be able to open it.</>}
        onConfirm={async () => { try { await api.del(`/files/${del!.id}`); toast('File deleted.', 'success'); setDel(null); setVersion((v) => v + 1); } catch (e) { toast(e instanceof ApiError ? e.message : 'Failed.', 'error'); } }} />
      <Modal open={!!rep} onClose={() => setRep(null)} title="Report file">
        <textarea aria-label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="What is wrong with this file?" />
        <div className="flex justify-end gap-2 mt-4"><Button variant="secondary" onClick={() => setRep(null)}>Cancel</Button><Button disabled={reason.trim().length < 3} onClick={async () => { try { await api.post(`/files/${rep!.id}/report`, { reason }); toast('Reported to lab staff.', 'success'); setRep(null); setReason(''); } catch (e) { toast(e instanceof ApiError ? e.message : 'Failed.', 'error'); } }}>Send report</Button></div>
      </Modal>
    </Card>
  );
};

export const FilesView: React.FC = () => (
  <>
    <PageHeader title="Files" subtitle="Notes, slides and code shared in your laboratories. Every download is permission-checked." />
    <FileBrowser />
  </>
);
