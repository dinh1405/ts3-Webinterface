import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from 'lucide-react';
import type { ConfigSource, Draft, SetupState } from '../../api/setup';
import { useT } from '../../i18n';
import { Badge } from '../ui';

export type StepMode = 'wizard' | 'settings';

export interface StepProps {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  updateTs3: (patch: Partial<Draft['ts3']>) => void;
  updateQuery: (patch: Partial<Draft['ts3']['query']>) => void;
  state: SetupState;
  mode: StepMode;
}

/** Ergebniszeile einer Prüfung. */
export function CheckLine({ ok, label, detail, warn }: { ok: boolean | null; label: ReactNode; detail?: ReactNode; warn?: boolean }) {
  const Icon = ok === null ? CircleDashed : ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  const color = ok === null ? 'text-slate-500' : ok ? 'text-emerald-400' : warn ? 'text-amber-400' : 'text-rose-400';
  return (
    <li className="flex items-start gap-2 py-1 text-sm">
      <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', color)} />
      <span className="min-w-0 flex-1">
        <span className="text-slate-200">{label}</span>
        {detail && <span className="block truncate font-mono text-[11px] text-slate-500" title={typeof detail === 'string' ? detail : undefined}>{detail}</span>}
      </span>
    </li>
  );
}

/** Hinweisbox (info / warn / error / success). */
export function Note({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode; className?: string }) {
  const Icon = tone === 'info' ? Info : tone === 'success' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : XCircle;
  const cls = {
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    error: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  }[tone];
  return (
    <div className={clsx('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', cls, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
    </div>
  );
}

/** Herkunft eines Konfigurationswerts (nur in der Admin-Ansicht). */
export function SourceBadge({ source }: { source?: ConfigSource }) {
  const { t } = useT();
  if (!source || source === 'default') return null;
  return <Badge tone={source === 'file' ? 'indigo' : 'amber'} className="ml-2 align-middle">{source === 'file' ? t('wizard.source.file') : t('wizard.source.env')}</Badge>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">{children}</code>;
}

export function Pre({ children }: { children: ReactNode }) {
  return <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950/70 p-3 font-mono text-[11px] text-slate-200">{children}</pre>;
}
