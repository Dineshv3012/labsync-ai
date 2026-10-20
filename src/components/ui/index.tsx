import React, { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...p }) => (
  <div className={cx('bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm', className)} {...p} />
);

export const PageHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode; crumbs?: { label: string; onClick?: () => void }[] }> = ({ title, subtitle, actions, crumbs }) => (
  <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
    <div className="min-w-0">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="text-xs text-slate-500 mb-1 flex items-center gap-1 flex-wrap">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {c.onClick ? <button onClick={c.onClick} className="hover:underline text-blue-700 dark:text-cyan-400">{c.label}</button> : <span aria-current="page">{c.label}</span>}
              {i < crumbs.length - 1 && <ChevronRight className="w-3 h-3" aria-hidden />}
            </span>
          ))}
        </nav>
      )}
      <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white truncate">{title}</h1>
      {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; size?: 'sm' | 'md' }> = ({ variant = 'primary', loading, size = 'md', className, children, disabled, ...p }) => (
  <button
    disabled={disabled || loading}
    className={cx(
      'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap',
      size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm',
      variant === 'primary' && 'bg-blue-900 hover:bg-blue-800 text-white shadow-sm',
      variant === 'secondary' && 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700',
      variant === 'danger' && 'bg-red-600 hover:bg-red-700 text-white',
      variant === 'ghost' && 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
      className,
    )}
    {...p}
  >
    {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
    {children}
  </button>
);

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
    <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> {label}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
    <AlertCircle className="w-8 h-8 text-red-500" aria-hidden />
    <p className="text-sm text-slate-600 dark:text-slate-300 max-w-sm">{message}</p>
    {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
  </div>
);

export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }> = ({ icon, title, hint, action }) => (
  <div className="flex flex-col items-center text-center gap-2 py-10 px-4">
    {icon && <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400" aria-hidden>{icon}</div>}
    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
    {hint && <p className="text-sm text-slate-500 max-w-sm">{hint}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

const TONES: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
  red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900',
  blue: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-cyan-300 dark:border-blue-900',
  slate: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};
export const Badge: React.FC<{ tone?: keyof typeof TONES; children: React.ReactNode; className?: string }> = ({ tone = 'slate', children, className }) => (
  <span className={cx('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border whitespace-nowrap', TONES[tone], className)}>{children}</span>
);

export const attendanceTone = (s?: string | null) => (s === 'checked_in' ? 'green' : s === 'checked_out' ? 'blue' : s === 'missing_checkout' ? 'amber' : 'slate');
export const severityTone = (s: string) => (s === 'critical' || s === 'high' ? 'red' : s === 'medium' ? 'amber' : 'slate');

export const Field: React.FC<{ label: string; hint?: string; error?: string; htmlFor: string; children: React.ReactNode }> = ({ label, hint, error, htmlFor, children }) => (
  <div>
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">{label}</label>
    {children}
    {hint && !error && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
  </div>
);
export const inputCls = 'w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:focus:ring-cyan-500 focus:border-transparent disabled:opacity-60';

export const Alert: React.FC<{ tone?: 'error' | 'success' | 'info' | 'warn'; children: React.ReactNode }> = ({ tone = 'info', children }) => {
  const map = {
    error: ['bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300', AlertCircle],
    success: ['bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300', CheckCircle2],
    info: ['bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-200', Info],
    warn: ['bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200', AlertCircle],
  } as const;
  const [cls, Icon] = map[tone];
  return <div role={tone === 'error' ? 'alert' : 'status'} className={cx('flex items-start gap-2 p-3 rounded-lg border text-sm', cls)}><Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /><div className="min-w-0 break-words">{children}</div></div>;
};

export const Modal: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }> = ({ open, onClose, title, children, wide }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea')?.focus(), 30);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('w-full bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<{ open: boolean; title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onClose: () => void }> = ({ open, title, message, confirmLabel = 'Confirm', danger, loading, onConfirm, onClose }) => (
  <Modal open={open} onClose={onClose} title={title}>
    <div className="text-sm text-slate-600 dark:text-slate-300 mb-5">{message}</div>
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
    </div>
  </Modal>
);

export const Pagination: React.FC<{ page: number; pageSize: number; total: number; onPage: (p: number) => void }> = ({ page, pageSize, total, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between pt-4 text-sm text-slate-500" aria-label="Pagination">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></Button>
        <span className="px-2">Page {page} / {pages}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></Button>
      </div>
    </div>
  );
};

export const StatCard: React.FC<{ label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode; onClick?: () => void }> = ({ label, value, hint, icon, onClick }) => {
  const inner = (
    <>
      <div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>{icon && <span className="text-blue-900 dark:text-cyan-400" aria-hidden>{icon}</span>}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1 truncate">{hint}</div>}
    </>
  );
  return onClick
    ? <button onClick={onClick} className="text-left w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-sm hover:border-blue-300 dark:hover:border-cyan-700 transition-colors">{inner}</button>
    : <Card className="p-4">{inner}</Card>;
};

export const ToastHost: React.FC = () => {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(92vw,22rem)]" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('flex items-start gap-2 p-3 rounded-lg shadow-lg text-sm border bg-white dark:bg-slate-800', t.kind === 'error' ? 'border-red-300 text-red-800 dark:text-red-300' : t.kind === 'success' ? 'border-emerald-300 text-emerald-800 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100')}>
          <span className="flex-1 break-words">{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss notification" className="opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
};

export const TableWrap: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="overflow-x-auto"><table className="w-full text-sm text-left">{children}</table></div>;
export const Th: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ className, ...p }) => <th scope="col" className={cx('px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 dark:bg-slate-800/60 whitespace-nowrap', className)} {...p} />;
export const Td: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className, ...p }) => <td className={cx('px-3 py-2.5 border-t border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-200', className)} {...p} />;
