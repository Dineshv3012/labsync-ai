import React, { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { uploadWithProgress, ApiError } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui';
import type { LabFile } from '../../types';

export const UploadButton: React.FC<{ labId: string; onUploaded: (f: LabFile) => void; compact?: boolean; label?: string }> = ({ labId, onUploaded, compact, label = 'Upload file' }) => {
  const { toast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [name, setName] = useState('');

  const start = (file: File) => {
    const form = new FormData();
    form.append('file', file);
    setPct(0); setName(file.name);
    const { promise, cancel } = uploadWithProgress<{ file: LabFile; duplicateOf: { name: string } | null }>(`/labs/${labId}/files`, form, setPct);
    cancelRef.current = cancel;
    promise
      .then((r) => { toast(r.duplicateOf ? `Uploaded - note: identical to existing file “${r.duplicateOf.name}”.` : 'File uploaded.', 'success'); onUploaded(r.file); })
      .catch((e: ApiError) => { if (e.code !== 'ABORTED') toast(e.message, 'error'); })
      .finally(() => { setPct(null); cancelRef.current = null; if (input.current) input.current.value = ''; });
  };

  return (
    <>
      <input ref={input} type="file" className="sr-only" aria-label="Choose a file to upload" tabIndex={-1} onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
      {pct === null ? (
        compact
          ? <button type="button" onClick={() => input.current?.click()} aria-label="Attach a file" className="p-2.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Paperclip className="w-5 h-5" /></button>
          : <Button variant="secondary" onClick={() => input.current?.click()}><Paperclip className="w-4 h-4" aria-hidden /> {label}</Button>
      ) : (
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300" role="status">
          <div className="w-28"><div className="truncate">{name}</div><div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div className="h-full bg-blue-700 transition-all" style={{ width: `${pct}%` }} /></div></div>
          <span>{pct}%</span>
          <button type="button" onClick={() => cancelRef.current?.()} aria-label="Cancel upload" className="p-1 text-slate-500 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}
    </>
  );
};
