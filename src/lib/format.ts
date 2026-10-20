export const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString([], { dateStyle: 'medium' }) : '—');
export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
export const fmtDuration = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`);
export const timeAgo = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
export const attendanceLabel = (s?: string | null) =>
  ({ checked_in: 'Checked In', checked_out: 'Checked Out', missing_checkout: 'Missing Check-out', pending: 'Pending Verification' } as Record<string, string>)[s ?? ''] ?? 'Not Checked In';

export function downloadBlob(filename: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
