import { clsx } from 'clsx';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as RTabs from '@radix-ui/react-tabs';
import * as RTooltip from '@radix-ui/react-tooltip';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import * as RPopover from '@radix-ui/react-popover';
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Check, CheckCircle2, ChevronDown, Inbox, Info, RefreshCw, X, type LucideIcon } from 'lucide-react';
import { ApiError, errorMessage } from '../api/client';
import { t, useT } from '../i18n';

/* =====================================================================
 * Ton-Vokabular: eine semantische Skala für Badge, Alert, StatusText, Kacheln.
 *   success · danger · warning · info · neutral · accent · purple
 * ===================================================================== */
export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'accent' | 'purple';
export const TONES: Tone[] = ['success', 'danger', 'warning', 'info', 'neutral', 'accent', 'purple'];

const toneBadge: Record<Tone, string> = {
  success: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/30',
  danger: 'bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/30',
  warning: 'bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/30',
  info: 'bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30',
  accent: 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/30',
  purple: 'bg-fuchsia-500/15 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/30',
  neutral: 'bg-slate-500/15 text-slate-300 ring-1 ring-inset ring-slate-500/30',
};
const toneAlert: Record<Tone, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  danger: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  accent: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200',
  purple: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200',
  neutral: 'border-slate-500/30 bg-slate-500/10 text-slate-200',
};
const toneText: Record<Tone, string> = {
  success: 'text-emerald-300',
  danger: 'text-rose-300',
  warning: 'text-amber-300',
  info: 'text-sky-300',
  accent: 'text-indigo-300',
  purple: 'text-fuchsia-300',
  neutral: 'text-slate-400',
};
const toneDot: Record<Tone, string> = {
  success: 'bg-emerald-400',
  danger: 'bg-rose-400',
  warning: 'bg-amber-400',
  info: 'bg-sky-400',
  accent: 'bg-indigo-400',
  purple: 'bg-fuchsia-400',
  neutral: 'bg-slate-500',
};
const toneIcon: Record<Tone, LucideIcon> = {
  success: CheckCircle2,
  danger: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
  accent: Info,
  purple: Info,
  neutral: Info,
};
/** Klassen eines Tons für eigene Bausteine (Diagramme, Sparklines). */
export const toneClasses = { badge: toneBadge, alert: toneAlert, text: toneText, dot: toneDot };

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
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 text-slate-400" role="status">
      <Spinner className="h-7 w-7 text-indigo-400" />
      <span className="text-sm">{label ?? t('common.loading')}</span>
    </div>
  );
}

/* ---------- Skeleton ---------- */
/** Platzhalterfläche beim Laden; `lines` erzeugt mehrere Textzeilen unterschiedlicher Breite. */
export function Skeleton({ className, lines }: { className?: string; lines?: number }) {
  if (lines && lines > 1) {
    return (
      <div className={clsx('space-y-2', className)} aria-hidden>
        {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton h-3" style={{ width: `${100 - ((i * 23) % 45)}%` }} />)}
      </div>
    );
  }
  return <div className={clsx('skeleton', className)} aria-hidden />;
}

/** Skelett einer typischen Seite: Titel, vier Kacheln, zwei Karten. */
export function PageSkeleton({ tiles = 4 }: { tiles?: number }) {
  useT();
  return (
    <div role="status" aria-label={t('common.loading')}>
      <div className="mb-6 space-y-2"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-80" /></div>
      {tiles > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: tiles }, (_, i) => <div key={i} className="card p-5"><Skeleton className="mb-3 h-3 w-24" /><Skeleton className="h-7 w-28" /></div>)}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2"><Skeleton lines={6} /></div>
        <div className="card p-5"><Skeleton lines={4} /></div>
      </div>
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
/** Knopf; ein reiner Icon-Knopf (ohne Text) übernimmt `title` als zugänglichen Namen. */
export function Button({ variant = 'secondary', size = 'md', loading, icon: Icon, children, className, disabled, type = 'button', title, ...props }: ButtonProps) {
  const iconOnly = !children && Boolean(Icon);
  return (
    <button
      type={type}
      className={clsx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', iconOnly && 'btn-icon', className)}
      disabled={disabled || loading}
      title={title}
      aria-label={iconOnly && !props['aria-label'] ? title : props['aria-label']}
      {...props}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : Icon ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden /> : null}
      {children}
    </button>
  );
}

/** Icon-Knopf mit Pflichtbeschriftung (aria-label + Tooltip). */
export function IconButton({ label, icon, side, ...props }: Omit<ButtonProps, 'children' | 'icon' | 'title'> & { label: string; icon: LucideIcon; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tip content={label} side={side}>
      <Button icon={icon} aria-label={label} {...props} />
    </Tip>
  );
}

/* ---------- Card ---------- */
export function Card({ title, subtitle, actions, children, className, bodyClassName, noPadding, as: Heading = 'h2' }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; noPadding?: boolean; as?: 'h2' | 'h3' }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="card-header">
          <div className="min-w-0">
            {title && <Heading className="card-title">{title}</Heading>}
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
export function Badge({ tone = 'neutral', children, dot, pulse, className, title }: { tone?: Tone; children: ReactNode; dot?: boolean; pulse?: boolean; className?: string; title?: string }) {
  return (
    <span className={clsx('badge', toneBadge[tone], className)} title={title}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full bg-current', pulse && 'pulse-dot')} aria-hidden />}
      {children}
    </span>
  );
}

/* ---------- Status text / Alert ---------- */
/** Farbiger Statustext (Erfolg, Fehler, Warnung …) – ersetzt lose text-emerald/rose/amber-Klassen. */
export function StatusText({ tone, children, dot, pulse, className, title }: { tone: Tone; children: ReactNode; dot?: boolean; pulse?: boolean; className?: string; title?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5', toneText[tone], className)} title={title}>
      {dot && <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', toneDot[tone], pulse && 'pulse-dot')} aria-hidden />}
      {children}
    </span>
  );
}

/** Hinweisbox mit Ton; `danger` wird als role="alert" angekündigt, alles andere als status. */
export function Alert({ tone = 'info', title, children, icon, compact, className, action, spinning }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: LucideIcon | null; compact?: boolean; className?: string; action?: ReactNode; spinning?: boolean }) {
  const Icon = icon === undefined ? toneIcon[tone] : icon;
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('alert', toneAlert[tone], compact && 'alert-compact', className)}>
      {Icon && <Icon className={clsx('mt-0.5 shrink-0', compact ? 'h-3.5 w-3.5' : 'h-4 w-4', spinning && 'animate-spin')} aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5 opacity-90', !title && 'space-y-1')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- Form field ---------- */
/**
 * Formularfeld mit Beschriftung, Hinweis und Fehler-Slot. Bei `error` erhält das Eingabeelement
 * über CSS die Fehlerfarbe; zusätzlich `aria-invalid` am Eingabeelement setzen (siehe `invalid`).
 */
export function Field({ label, hint, error, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  const id = useId();
  return (
    <div className={className} data-invalid={error ? 'true' : undefined}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p className="mt-1 text-xs text-rose-300" id={`${id}-err`} role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
/** Attribute für ein ungültiges Eingabeelement: `<input {...invalid(Boolean(err))} />`. */
export const invalid = (isInvalid: boolean) => (isInvalid ? ({ 'aria-invalid': 'true' } as const) : {});

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
        className={clsx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/60', checked ? 'bg-indigo-500' : 'bg-slate-700')}
      >
        <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200', checked ? 'translate-x-4.5' : 'translate-x-0.5')} />
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

/* ---------- Tabs ---------- */
export interface TabItem<K extends string> { value: K; label: ReactNode; icon?: LucideIcon; badge?: ReactNode }
/**
 * Registerleiste (Radix Tabs: Pfeiltasten, role=tablist) mit gleitender Unterstreichung.
 * Der Inhalt wird von der Seite selbst nach `value` gerendert.
 */
export function TabBar<K extends string>({ value, onChange, items, className, label }: { value: K; onChange: (v: K) => void; items: TabItem<K>[]; className?: string; label?: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const el = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!el) { setBar(null); return; }
      setBar({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [value, items.length]);
  return (
    <RTabs.Root value={value} onValueChange={(v) => onChange(v as K)} className={clsx('mb-4', className)}>
      <RTabs.List ref={listRef} aria-label={label} className="relative flex w-fit max-w-full gap-1 overflow-x-auto rounded-control border border-slate-800 bg-slate-900/60 p-1">
        {items.map((it) => (
          <RTabs.Trigger key={it.value} value={it.value} className="tab-trigger">
            {it.icon && <it.icon className="h-4 w-4" aria-hidden />}
            {it.label}
            {it.badge}
          </RTabs.Trigger>
        ))}
        {bar && <span aria-hidden className="pointer-events-none absolute bottom-1 top-1 rounded-control bg-indigo-500/15 ring-1 ring-inset ring-indigo-500/30 transition-[left,width] duration-200 ease-out" style={{ left: bar.left, width: bar.width }} />}
      </RTabs.List>
    </RTabs.Root>
  );
}

/* ---------- Tooltip ---------- */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={300} skipDelayDuration={200}>{children}</RTooltip.Provider>;
}
/** Tooltip; das Kind muss Ref und Ereignisse annehmen (Button, a, span). */
export function Tip({ content, children, side = 'top', disabled }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; disabled?: boolean }) {
  if (disabled || !content) return <>{children}</>;
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="tooltip-content" collisionPadding={8}>{content}</RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/* ---------- Dropdown menu ---------- */
export type MenuItem =
  | { type?: 'item'; label: ReactNode; icon?: LucideIcon; onSelect: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }
  | { type: 'separator' }
  | { type: 'label'; label: ReactNode }
  | { type: 'radio'; label: ReactNode; value: string; onChange: (v: string) => void; options: { value: string; label: ReactNode; icon?: LucideIcon }[] };
/** Aufklappmenü („Mehr“) auf Radix DropdownMenu: Tastatur, Fokusrückgabe, Kollisionsvermeidung. */
export function Menu({ trigger, items, align = 'end', side = 'bottom', label }: { trigger: ReactNode; items: MenuItem[]; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right'; label?: string }) {
  return (
    <RMenu.Root modal={false}>
      <RMenu.Trigger asChild aria-label={label}>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content align={align} side={side} sideOffset={6} collisionPadding={8} className="menu-content">
          {items.map((it, i) => {
            if (it.type === 'separator') return <RMenu.Separator key={i} className="menu-separator" />;
            if (it.type === 'label') return <RMenu.Label key={i} className="px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">{it.label}</RMenu.Label>;
            if (it.type === 'radio') {
              return (
                <RMenu.RadioGroup key={i} value={it.value} onValueChange={it.onChange}>
                  <RMenu.Label className="px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-slate-500">{it.label}</RMenu.Label>
                  {it.options.map((o) => (
                    <RMenu.RadioItem key={o.value} value={o.value} className="menu-item">
                      {o.icon && <o.icon className="h-4 w-4 text-slate-400" aria-hidden />}
                      <span className="flex-1">{o.label}</span>
                      <RMenu.ItemIndicator><Check className="h-3.5 w-3.5 text-indigo-300" aria-hidden /></RMenu.ItemIndicator>
                    </RMenu.RadioItem>
                  ))}
                </RMenu.RadioGroup>
              );
            }
            return (
              <RMenu.Item key={i} className={clsx('menu-item', it.danger && 'menu-item-danger')} disabled={it.disabled} onSelect={it.onSelect}>
                {it.icon && <it.icon className={clsx('h-4 w-4', it.danger ? 'text-rose-300' : 'text-slate-400')} aria-hidden />}
                <span className="flex-1">{it.label}</span>
                {it.shortcut && <kbd className="kbd">{it.shortcut}</kbd>}
              </RMenu.Item>
            );
          })}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

/* ---------- Popover ---------- */
export function Pop({ trigger, children, align = 'end', side = 'bottom', className, open, onOpenChange }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right'; className?: string; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content align={align} side={side} sideOffset={6} collisionPadding={8} className={clsx('menu-content p-3', className)}>{children}</RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/* ---------- Sortable table header ---------- */
export type SortDir = 'asc' | 'desc';
/** Sortierbare Kopfzelle mit aria-sort; Klick wechselt die Richtung, wenn die Spalte schon aktiv ist. */
export function SortableTh({ label, active, dir, onSort, className, align = 'left' }: { label: ReactNode; active: boolean; dir: SortDir; onSort: () => void; className?: string; align?: 'left' | 'right' }) {
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={className} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={onSort} className={clsx('inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200', align === 'right' && 'flex-row-reverse', active && 'text-slate-200')}>
        {label}<Icon className={clsx('h-3 w-3', !active && 'opacity-50')} aria-hidden />
      </button>
    </th>
  );
}

/* ---------- Modal ---------- */
/** Offene Dialoge (IDs) – der oberste reagiert auf Escape; der Seiteninhalt (#root) ist solange inert. */
const modalStack: string[] = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}
function setBackgroundInert(inert: boolean) {
  const root = document.getElementById('root');
  if (!root) return;
  root.inert = inert;
  if (inert) root.setAttribute('aria-hidden', 'true'); else root.removeAttribute('aria-hidden');
}

/**
 * Dialog mit Tastaturbedienung: Fokus wandert beim Öffnen hinein (autofocus-Element, sonst erstes Feld, sonst der Dialog),
 * Tab/Shift+Tab bleiben im Dialog, Escape schließt den obersten Dialog, beim Schließen kehrt der Fokus zum Auslöser zurück.
 * Gerendert als Portal in <body>, damit der Seiteninhalt per `inert` für Tastatur und Screenreader ausgeblendet werden kann.
 */
export function Modal({ open, onClose, title, children, footer, size = 'md', describedBy, bare }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl'; describedBy?: string; bare?: boolean }) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wasOpen = useRef(false);
  // Auslöser beim Öffnen merken – noch während des Renderns, denn `autoFocus`-Elemente im Dialog ziehen den Fokus
  // bereits beim Commit (vor den Effekten) auf sich.
  if (open && !wasOpen.current) restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    modalStack.push(id);
    setBackgroundInert(true);
    document.body.style.overflow = 'hidden';
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const preferred = panel.querySelector<HTMLElement>('[autofocus]') ?? focusables(panel).find((el) => !el.hasAttribute('data-modal-close'));
      (preferred ?? panel).focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== id) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(id), 1);
      if (modalStack.length === 0) { setBackgroundInert(false); document.body.style.overflow = ''; }
      const back = restoreRef.current;
      if (back && back.isConnected) back.focus();
    };
  }, [open, id]);

  if (!open) return null;
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = focusables(panelRef.current);
    if (items.length === 0) { e.preventDefault(); panelRef.current.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };
  return createPortal(
    <div className={clsx('fixed inset-0 z-50 flex justify-center bg-black/60 p-4 backdrop-blur-sm', bare ? 'items-start pt-[12vh]' : 'items-center')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} tabIndex={-1} onKeyDown={onKeyDown} className={clsx('card flex w-full max-h-[90vh] flex-col overflow-hidden shadow-float outline-none', width)} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-describedby={describedBy}>
        {title && (
          <header className="card-header">
            <h2 className="card-title" id={titleId}>{title}</h2>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={t('common.close')} data-modal-close><X className="h-4 w-4" /></button>
          </header>
        )}
        {bare ? children : <div className="card-body overflow-y-auto">{children}</div>}
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Confirm dialog ---------- */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, tone = 'danger', loading, requireText, children }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: ReactNode; message?: ReactNode; confirmLabel?: string; tone?: Variant; loading?: boolean; requireText?: string; children?: ReactNode;
}) {
  const { t } = useT();
  const descId = useId();
  const [text, setText] = useState('');
  useEffect(() => { if (!open) setText(''); }, [open]);
  const blocked = Boolean(requireText) && text !== requireText;
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" describedBy={message ? descId : undefined}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={loading}>{t('common.cancel')}</Button>
        <Button variant={tone} onClick={onConfirm} loading={loading} disabled={blocked} autoFocus={!requireText}>{confirmLabel ?? t('common.confirm')}</Button>
      </>}
    >
      {message && <div className="text-sm text-slate-300" id={descId}>{message}</div>}
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
  const NUL = String.fromCharCode(0);
  const parts = t('ui.typeToConfirm', { text: NUL }).split(NUL);
  return <>{parts[0]}<span className="font-mono normal-case text-slate-200">{text}</span>{parts[1] ?? ''}</>;
}

/* ---------- Empty / Error ---------- */
export function EmptyState({ icon: Icon = Inbox, title, description, action, compact }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center text-center', compact ? 'py-6' : 'py-12')}>
      <div className="mb-3 rounded-full border border-slate-800 bg-slate-900/70 p-3 text-slate-400 shadow-surface"><Icon className="h-6 w-6" strokeWidth={1.5} aria-hidden /></div>
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
    <Alert tone={offline ? 'warning' : 'danger'} compact={compact} title={offline ? t('ui.ts3Unreachable') : t('ui.errorTitle')}
      action={onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t('common.retry')}</button>}>
      <p className="text-xs opacity-80">{msg}</p>
    </Alert>
  );
}

/* ---------- Sparkline ---------- */
/** Kleine Linie mit Verlaufsfüllung; `values` von alt nach neu, `null` unterbricht die Linie nicht (wird übersprungen). */
export function Sparkline({ values, tone = 'accent', width = 120, height = 36, className }: { values: (number | null)[]; tone?: Tone; width?: number; height?: number; className?: string }) {
  const id = useId();
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null && Number.isFinite(p[1]));
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((p) => p[1]));
  const max = Math.max(...pts.map((p) => p[1]));
  const span = max - min || 1;
  const n = values.length - 1 || 1;
  const x = (i: number) => (i / n) * width;
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts[pts.length - 1][0]).toFixed(1)} ${height} L${x(pts[0][0]).toFixed(1)} ${height} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', maxWidth: width, height }} className={clsx('min-w-0 overflow-visible', toneText[tone], className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.4" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- Stat tile ---------- */
/**
 * Kennzahl-Kachel: Beschriftung, Wert (+ Einheit), Trend-Chip und optional eine Sparkline der letzten Stunde.
 * Ohne `spark`/`trend` verhält sie sich wie die frühere `Stat`-Kachel mit Icon.
 */
export function StatTile({ label, value, unit, sub, icon: Icon, tone = 'accent', trend, spark, className }: {
  label: ReactNode; value: ReactNode; unit?: ReactNode; sub?: ReactNode; icon?: LucideIcon; tone?: Tone;
  trend?: { text: ReactNode; tone?: Tone }; spark?: (number | null)[]; className?: string;
}) {
  return (
    <div className={clsx('card flex flex-col gap-2.5 px-5 py-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="stat-label flex items-center gap-2">{Icon && <Icon className={clsx('h-3.5 w-3.5', toneText[tone])} aria-hidden />}{label}</span>
        {trend && <span className={clsx('badge', toneBadge[trend.tone ?? 'neutral'])}>{trend.text}</span>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 shrink-0">
          <p className="stat-value whitespace-nowrap">{value}{unit && <span className="ml-1 text-base font-medium text-slate-500">{unit}</span>}</p>
          {sub && <p className="mt-1.5 truncate text-xs text-slate-500">{sub}</p>}
        </div>
        {spark && <div className="flex min-w-0 flex-1 justify-end"><Sparkline values={spark} tone={tone} /></div>}
      </div>
    </div>
  );
}
/** @deprecated Alias für StatTile (Signatur der 1.x-Kachel). */
export function Stat({ label, value, sub, icon, tone = 'accent' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return <StatTile label={label} value={value} sub={sub} icon={icon} tone={tone} />;
}

/* ---------- Description list ---------- */
export function KV({ items }: { items: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="flex justify-between gap-4 border-b border-slate-800/60 py-1.5">
          <dt className="text-slate-400">{it.k}</dt>
          <dd className="truncate text-right text-slate-200 tabular-nums">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Disclosure chevron ---------- */
export function Chevron({ open, className }: { open: boolean; className?: string }) {
  return <ChevronDown className={clsx('h-4 w-4 transition-transform duration-200', open && 'rotate-180', className)} aria-hidden />;
}
