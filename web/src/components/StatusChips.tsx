import { Link } from 'react-router';
import { clsx } from 'clsx';
import { Archive, Download, Users } from 'lucide-react';
import type { Overview, ServerStatus } from '../api/types';
import { formatRelative } from '../lib/format';
import { useT } from '../i18n';
import { Tip } from './ui';

const toneClass = {
  success: 'text-emerald-300',
  warning: 'border-amber-500/35 bg-amber-500/10 text-amber-200',
  danger: 'text-rose-300',
  neutral: 'text-slate-400',
} as const;

function Chip({ to, tone = 'neutral', children, title, className }: { to: string; tone?: keyof typeof toneClass; children: React.ReactNode; title: string; className?: string }) {
  return (
    <Tip content={title}>
      <Link to={to} className={clsx('chip', toneClass[tone], className)} aria-label={title}>{children}</Link>
    </Tip>
  );
}

/**
 * Status-Chips der Kopfleiste: Prozess, ServerQuery, Clients online, letztes Backup, Update verfügbar.
 * Jeder Chip führt zur passenden Seite. `compact` zeigt nur die beiden Statuspunkte (schmale Fenster).
 */
export function StatusChips({ status, queryConnected, overview, compact, canBackups, canSystem }: { status?: ServerStatus; queryConnected: boolean; overview?: Overview; compact?: boolean; canBackups: boolean; canSystem: boolean }) {
  const { t } = useT();
  const running = status?.process.running;
  const cur = status?.current;
  const online = cur ? Math.max(0, Number(cur.virtualserverClientsonline) - Number(cur.virtualserverQueryclientsonline || 0)) : null;
  const procText = running ? t('layout.processRunning') : running === false ? t('layout.processStopped') : t('layout.processUnknown');
  const queryText = queryConnected ? t('layout.queryConnected') : t('layout.queryDisconnected');
  const updates = overview?.updates;
  const updateVersion = updates?.ts3.available ? updates.ts3.latest : updates?.webinterface.available ? updates.webinterface.latest : null;
  const both = Boolean(updates?.ts3.available && updates?.webinterface.available);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Tip content={procText}><Link to="/" className={clsx('flex h-8 w-8 items-center justify-center rounded-control', running ? 'text-emerald-300' : running === false ? 'text-rose-300' : 'text-slate-500')} aria-label={procText}><span className="dot" /></Link></Tip>
        <Tip content={queryText}><Link to="/" className={clsx('flex h-8 w-8 items-center justify-center rounded-control', queryConnected ? 'text-emerald-300' : 'text-amber-300')} aria-label={queryText}><span className="dot" /></Link></Tip>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Chip to="/" tone={running ? 'success' : running === false ? 'danger' : 'neutral'} title={procText}><span className={clsx('dot', running && 'pulse-dot')} /><span className="text-slate-300">{procText}</span></Chip>
      <Chip to="/" tone={queryConnected ? 'success' : 'warning'} title={queryText}><span className="dot" /><span className={queryConnected ? 'text-slate-300' : undefined}>{queryText}</span></Chip>
      {online !== null && <Chip to="/clients" title={t('dash.clientsOnline')}><Users className="h-3.5 w-3.5" aria-hidden /><span className="tabular-nums text-slate-200">{online} / {String(cur?.virtualserverMaxclients ?? '–')}</span></Chip>}
      {canBackups && overview && (
        overview.lastBackup
          ? <Chip to="/backups" tone={overview.lastBackup.ok ? 'neutral' : 'danger'} title={t('layout.lastBackupTitle')}><Archive className="h-3.5 w-3.5" aria-hidden /><span className="text-slate-300">{t('layout.lastBackup', { when: formatRelative(overview.lastBackup.createdAt) })}</span></Chip>
          : <Chip to="/backups" tone="warning" title={t('layout.lastBackupTitle')}><Archive className="h-3.5 w-3.5" aria-hidden />{t('layout.noBackup')}</Chip>
      )}
      {canSystem && updateVersion && (
        <Chip to="/system" tone="warning" title={t('layout.updateTitle')}><span className="dot" />{both ? t('layout.updatesAvailable') : t('layout.updateAvailable', { version: updateVersion })}<Download className="h-3 w-3 opacity-70" aria-hidden /></Chip>
      )}
    </div>
  );
}
