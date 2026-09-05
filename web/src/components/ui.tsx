import { clsx } from 'clsx';
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw, X, type LucideIcon } from 'lucide-react';
import { ApiError, errorMessage } from '../api/client';
import { t, useT } from '../i18n';

/* ---------- Spinner ---------- */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

export function FullPageSpinner({ label }: { label?: string }) {
  useT();
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 text-slate-400">
      <Spinner className="h-7 w-7 text-indigo-400" />
      <span className="text-sm">{label ?? t('common.loading')}</span>
    </div>
  );
}

/* ---------- Button ---------- */
type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'ghost';
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: LucideIcon;
}
export function Button({ variant = 'secondary', size = 'md', loading, icon: Icon, children, className, disabled, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : Icon ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
      {children}
    </button>
  );
}

/* ---------- Card ---------- */
export function Card({ title, subtitle, actions, children, className, bodyClassName, noPadding }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; noPadding?: boolean }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(!noPadding && 'card-body', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------- Badge ---------- */
type Tone = 'green' | 'red' | 'amber' | 'blue' | 'slate' | 'indigo' | 'purple';
const toneClass: Record<Tone, string> = {
  green: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  red: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  blue: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30',
  indigo: 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/30',
  purple: 'bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/30',
  slate: 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/30',
};
export function Badge({ tone = 'slate', children, dot, pulse, className }: { tone?: Tone; children: ReactNode; dot?: boolean; pulse?: boolean; className?: string }) {
  return (
    <span className={clsx('badge', toneClass[tone], className)}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full bg-current', pulse && 'pulse-dot')} />}
      {children}
    </span>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- Form field ---------- */
export function Field({ label, hint, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/* ---------- Toggle ---------- */
export function Toggle({ checked, onChange, label, disabled, description }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; description?: ReactNode }) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60', checked ? 'bg-indigo-500' : 'bg-slate-700')}
      >
        <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white shadow transition', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
      </button>
      {(label || description) && (
        <span className="text-sm">
          {label && <span className="text-slate-200">{label}</span>}
          {description && <span className="block text-xs text-slate-500">{description}</span>}
        </span>
      )}
    </label>
  );
}

/* ---------- Modal ---------- */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={clsx('card w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl shadow-black/50', width)} role="dialog" aria-modal>
        {title && (
          <header className="card-header">
            <h2 className="card-title">{title}</h2>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t('common.close')}><X className="h-4 w-4" /></button>
          </header>
        )}
        <div className="card-body overflow-y-auto">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- Confirm dialog ---------- */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, tone = 'danger', loading, requireText, children }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; message?: ReactNode; confirmLabel?: string; tone?: Variant; loading?: boolean; requireText?: string; children?: ReactNode;
}) {
  const { t } = useT();
  const [text, setText] = useState('');
  useEffect(() => { if (!open) setText(''); }, [open]);
  const blocked = Boolean(requireText) && text !== requireText;
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={loading}>{t('common.cancel')}</Button>
        <Button variant={tone} onClick={onConfirm} loading={loading} disabled={blocked}>{confirmLabel ?? t('common.confirm')}</Button>
      </>}
    >
      {message && <div className="text-sm text-slate-300">{message}</div>}
      {children}
      {requireText && (
        <div className="mt-4">
          <label className="label"><TypeToConfirm text={requireText} /></label>
          <input className="input font-mono" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </div>
      )}
    </Modal>
  );
}

/** Rendert „Zur Bestätigung {text} eingeben“ mit hervorgehobenem Text in beliebiger Wortstellung. */
function TypeToConfirm({ text }: { text: string }) {
  const parts = t('ui.typeToConfirm', { text: '\u0000' }).split('\u0000');
  return <>{parts[0]}<span className="font-mono normal-case text-slate-200">{text}</span>{parts[1] ?? ''}</>;
}

/* ---------- Empty / Error ---------- */
export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 rounded-full bg-slate-800/80 p-3 text-slate-400"><Icon className="h-6 w-6" /></div>
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const { t } = useT();
  const msg = errorMessage(error);
  const offline = (error instanceof ApiError && (error.status === 503 || String(error.data.key || '').startsWith('errors.ts3.unavailable'))) || /nicht erreichbar|unreachable/i.test(msg);
  return (
    <div className={clsx('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', offline ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200', compact && 'py-2')}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">{offline ? t('ui.ts3Unreachable') : t('ui.errorTitle')}</p>
        <p className="text-xs opacity-80">{msg}</p>
      </div>
      {onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" /> {t('common.retry')}</button>}
    </div>
  );
}

/* ---------- Stat tile ---------- */
export function Stat({ label, value, sub, icon: Icon, tone = 'indigo' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <div className="card flex items-center gap-4 p-4">
      {Icon && <div className={clsx('rounded-lg p-2.5', toneClass[tone])}><Icon className="h-5 w-5" /></div>}
      <div className="min-w-0">
        <p className="stat-label">{label}</p>
        <p className="stat-value truncate">{value}</p>
        {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}

/* ---------- Description list ---------- */
export function KV({ items }: { items: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="flex justify-between gap-4 border-b border-slate-800/60 py-1.5">
          <dt className="text-slate-400">{it.k}</dt>
          <dd className="truncate text-right text-slate-200">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}
