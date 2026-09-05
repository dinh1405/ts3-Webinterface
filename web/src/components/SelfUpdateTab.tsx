import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { Download, ExternalLink, Package, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { SelfUpdateSummary } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatDate, formatRelative, formatTime } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, FullPageSpinner, KV } from './ui';

/** System → Webinterface: Version prüfen und das Webinterface selbst aus GitHub-Releases aktualisieren. */
export function SelfUpdateTab() {
  const { can } = useAuth(); const canManage = can('system.manage');
  const { t } = useT();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null); // Zielversion während des Neustarts
  const pollRef = useRef<number | null>(null);
  const [armed, setArmed] = useState<string | null>(null); // Zielversion, solange der Job läuft

  const q = useQuery({
    queryKey: ['system', 'selfupdate'],
    queryFn: () => api.get<SelfUpdateSummary>('/api/system/selfupdate'),
    refetchInterval: (query) => (query.state.data?.running ? 2000 : 120000),
    retry: false,
    enabled: !restarting && !armed,
  });
  const check = useMutation({ mutationFn: () => api.post<SelfUpdateSummary>('/api/system/selfupdate/check'), onSuccess: (d) => { qc.setQueryData(['system', 'selfupdate'], d); toast.success(t('system.upd.checked')); }, onError: (e) => toast.error(errorMessage(e)) });
  const run = useMutation({
    mutationFn: () => api.post<SelfUpdateSummary>('/api/system/selfupdate/run', { confirm: 'UPDATE' }),
    onSuccess: (d) => { setConfirm(false); qc.setQueryData(['system', 'selfupdate'], d); toast.success(t('system.self.started')); setArmed(d.running?.version ?? d.latest?.version ?? null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // Während des Jobs engmaschig nachfragen; bricht die Verbindung ab, startet der Dienst gerade neu
  useEffect(() => {
    if (!armed) return;
    const id = window.setInterval(async () => {
      try {
        const s = await api.get<SelfUpdateSummary>('/api/system/selfupdate');
        qc.setQueryData(['system', 'selfupdate'], s);
        if (!s.running) { setArmed(null); if (s.lastResult?.ok && s.lastResult.restart) setRestarting(armed); }
      } catch {
        setArmed(null);
        setRestarting(armed);
      }
    }, 1500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  // Nach erfolgreichem Tausch mit Neustart: auf die neue Version warten und die Seite neu laden
  const data = q.data;
  useEffect(() => {
    const done = data?.lastResult;
    if (!data || data.running || !done?.ok || !done.restart || restarting || done.confirmedAt) return;
    setRestarting(done.to);
  }, [data, restarting]);
  useEffect(() => {
    if (!restarting) return;
    const started = Date.now();
    pollRef.current = window.setInterval(async () => {
      try {
        const h = await api.get<{ version: string }>('/api/health');
        if (h.version === restarting) { window.clearInterval(pollRef.current!); toast.success(t('system.self.updated', { version: h.version })); window.location.reload(); }
      } catch { /* Dienst startet gerade neu */ }
      if (Date.now() - started > 180000) { window.clearInterval(pollRef.current!); setRestarting(null); toast.error(t('system.self.restartTimeout')); }
    }, 2000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restarting]);

  if (restarting) {
    return (
      <Card title={t('system.self.restartingTitle', { version: restarting })}>
        <div className="flex items-center gap-3 text-sm text-slate-300"><RefreshCw className="h-5 w-5 animate-spin text-indigo-400" />{t('system.self.restartingText')}</div>
      </Card>
    );
  }
  if (q.isLoading) return <FullPageSpinner />;
  if (q.error || !data) return <ErrorBox error={q.error ?? new Error('selfupdate')} onRetry={() => q.refetch()} />;
  const u = data;
  const steps = u.running?.steps ?? u.lastResult?.steps ?? [];
  const latest = u.latest;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t('system.self.title')} subtitle={t('system.self.subtitle')} actions={<Button size="sm" icon={RefreshCw} loading={check.isPending} onClick={() => check.mutate()}>{t('system.upd.checkNow')}</Button>}>
        <KV items={[
          { k: t('system.upd.installed'), v: <span className="font-mono">{u.current}</span> },
          { k: t('system.upd.available'), v: latest ? <span className="whitespace-nowrap"><span className="font-mono">{latest.version}</span> {u.updateAvailable ? <Badge tone="amber" className="ml-1">{t('system.upd.updateAvailable')}</Badge> : <Badge tone="green" className="ml-1">{t('system.upd.upToDate')}</Badge>}</span> : '–' },
          { k: t('system.self.published'), v: latest?.publishedAt ? formatDate(latest.publishedAt) : '–' },
          { k: t('dash.checked'), v: u.checkedAt ? formatRelative(u.checkedAt) : '–' },
          { k: t('system.upd.previous'), v: u.previousVersion ? <span className="font-mono">{u.previousVersion}</span> : '–' },
          { k: t('system.self.restart'), v: u.restartMode === 'systemd' ? t('system.self.restartSystemd') : t('system.self.restartManual') },
        ]} />
        {u.checkError && <p className="mt-3 text-xs text-rose-300">{u.checkError}</p>}
        {!u.canUpdate && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <p className="font-medium">{t('system.self.notPossible')}</p>
            <ul className="list-disc pl-5 text-xs">{u.reasons.map((r) => <li key={r}>{t(`system.self.reason.${r}`)}</li>)}</ul>
            <p className="mt-1 text-xs">{t('system.self.cliHint')} <code className="rounded bg-slate-950/60 px-1 font-mono">sudo ts3web update</code></p>
          </div>
        )}
        {latest?.notes && (
          <div className="mt-4">
            <p className="label flex items-center justify-between">{t('system.self.notes', { version: latest.version })}{latest.url && <a className="flex items-center gap-1 text-xs text-indigo-300 hover:underline" href={latest.url} target="_blank" rel="noreferrer">GitHub <ExternalLink className="h-3 w-3" /></a>}</p>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300">{latest.notes}</pre>
          </div>
        )}
        {canManage && u.canUpdate && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={Download} disabled={!u.updateAvailable || Boolean(u.running)} onClick={() => setConfirm(true)}>{t('system.upd.updateTo', { version: latest?.version ?? '…' })}</Button>
            {!u.updateAvailable && latest && <span className="text-xs text-slate-500">{t('system.self.nothingToDo')}</span>}
          </div>
        )}
        <p className="mt-4 text-xs text-slate-500">{t('system.self.flow')}</p>
      </Card>

      <Card title={u.running ? t('system.self.runningTitle') : u.lastResult ? t('system.upd.lastRun', { result: u.lastResult.ok ? (u.lastResult.rolledBack ? t('system.self.rolledBack') : t('system.upd.success')) : t('system.upd.failed') }) : t('system.wd.log')}
        subtitle={u.running ? t('system.upd.startedBy', { when: formatRelative(u.running.startedAt), by: u.running.by }) : u.lastResult ? `${u.lastResult.from} → ${u.lastResult.to}${u.lastResult.finishedAt ? ` · ${formatDate(u.lastResult.finishedAt, true)}` : ''}` : undefined}
        actions={u.running && <RefreshCw className="h-4 w-4 animate-spin text-indigo-400" />} noPadding>
        {steps.length === 0 ? (
          <div className="p-4">
            {u.lastResult ? (
              <div className={clsx('rounded-lg border px-3 py-2 text-sm', u.lastResult.ok && !u.lastResult.rolledBack ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200')}>
                {u.lastResult.rolledBack ? t('system.self.rolledBackText', { from: u.lastResult.from, to: u.lastResult.to }) : u.lastResult.ok ? t('system.self.confirmedText', { version: u.lastResult.to }) : `${t('common.error')}: ${u.lastResult.error}`}
              </div>
            ) : <EmptyState icon={Package} title={t('system.upd.noneYet')} />}
          </div>
        ) : (
          <ol className="max-h-96 space-y-1 overflow-y-auto p-4 font-mono text-xs">
            {steps.map((s, i) => <li key={i} className="flex gap-3"><span className="shrink-0 text-slate-500">{formatTime(s.ts)}</span><span className={clsx(/^(FEHLER|ERROR)/.test(s.msg) ? 'text-rose-300' : 'text-slate-200')}>{s.msg}</span></li>)}
            {u.lastResult && !u.running && !u.lastResult.ok && <li className="text-rose-300">{t('common.error')}: {u.lastResult.error}</li>}
          </ol>
        )}
      </Card>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => run.mutate()} loading={run.isPending} title={t('system.upd.confirmTitle', { version: latest?.version ?? '' })} confirmLabel={t('system.upd.startUpdate')} tone="primary" requireText="UPDATE"
        message={<div className="space-y-2"><p>{t('system.self.confirmMsg')}</p><ul className="list-disc space-y-1 pl-5 text-xs text-slate-400"><li>{t('system.self.confirmPoint1')}</li><li>{t('system.self.confirmPoint2')}</li><li>{u.restartMode === 'systemd' ? t('system.self.confirmPoint3') : t('system.self.confirmPoint3Manual')}</li></ul></div>} />
    </div>
  );
}
