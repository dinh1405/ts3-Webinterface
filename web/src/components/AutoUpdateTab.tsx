import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, Play, RefreshCw, Save } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { AutoUpdateComponent, AutoUpdateInfo, AutoUpdateSettings } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatDate, formatRelative, weekdayNames } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Field, FullPageSpinner, Toggle } from './ui';

const KEY = ['system', 'autoupdate'];

/** System → Auto-Update: Zeitplan für automatische Updates von TeamSpeak-Server und Webinterface. */
export function AutoUpdateTab() {
  const { can } = useAuth();
  const canManage = can('system.manage');
  const canRun = can('update.run');
  const { t, td } = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState<(AutoUpdateSettings & { timezone: string }) | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [armed, setArmed] = useState(false); // solange ein manuell gestarteter Lauf beobachtet wird

  const q = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<AutoUpdateInfo>('/api/system/autoupdate'),
    refetchInterval: (query) => (query.state.data?.running ? 2000 : 30000),
    enabled: !restarting,
  });
  const save = useMutation({
    mutationFn: () => api.put<AutoUpdateInfo>('/api/system/autoupdate', form),
    onSuccess: (d) => { toast.success(t('system.auto.saved')); setForm(null); qc.setQueryData(KEY, d); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = useMutation({
    mutationFn: () => api.post<AutoUpdateInfo>('/api/system/autoupdate/run-now'),
    onSuccess: (d) => { setConfirm(false); toast.success(t('system.auto.started')); qc.setQueryData(KEY, d); setArmed(true); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Manuell gestarteten Lauf verfolgen: endet er mit Webinterface-Neustart, auf die neue Version warten
  useEffect(() => {
    if (!armed) return;
    const id = window.setInterval(async () => {
      try {
        const d = await api.get<AutoUpdateInfo>('/api/system/autoupdate');
        qc.setQueryData(KEY, d);
        if (!d.running) {
          setArmed(false);
          if (d.lastRun?.restart) setRestarting(true);
          qc.invalidateQueries({ queryKey: ['system'] });
        }
      } catch {
        setArmed(false);
        setRestarting(true);
      }
    }, 1500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);
  useEffect(() => {
    if (!restarting) return;
    const started = Date.now();
    const id = window.setInterval(async () => {
      try {
        await api.get('/api/health');
        if (Date.now() - started > 4000) { window.clearInterval(id); window.location.reload(); }
      } catch { /* Dienst startet gerade neu */ }
      if (Date.now() - started > 180000) { window.clearInterval(id); setRestarting(false); }
    }, 2000);
    return () => window.clearInterval(id);
  }, [restarting]);

  if (restarting) {
    return (
      <Card title={t('system.auto.title')}>
        <div className="flex items-center gap-3 text-sm text-slate-300"><RefreshCw className="h-5 w-5 animate-spin text-indigo-400" />{t('system.auto.restarting')}</div>
      </Card>
    );
  }
  if (q.isLoading) return <FullPageSpinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? new Error('autoupdate')} onRetry={() => q.refetch()} />;
  const info = q.data;
  const s = form ?? { ...info.settings, timezone: info.timezone };
  const set = (patch: Partial<typeof s>) => setForm({ ...s, ...patch });
  const disabled = !canManage;
  const last = info.lastRun;

  const describe = (c: AutoUpdateComponent | null | undefined, busy: boolean): { text: string; tone: 'green' | 'red' | 'amber' | 'slate' } => {
    if (busy) return { text: t('system.auto.sum.busy'), tone: 'amber' };
    if (!c) return { text: t('system.auto.sum.disabled'), tone: 'slate' };
    if (c.skipped) {
      const known = ['disabled', 'noDir', 'upToDate', 'clientsOnline', 'notPossible', 'checkFailed', 'busy'];
      const key = known.includes(c.skipped) ? c.skipped : 'notPossible';
      const params = { current: c.current ?? '?', count: c.count ?? 0, reason: c.reason ? td(`system.self.reason.${c.reason}`, undefined, c.reason) : c.skipped, error: c.error ?? '?' };
      return { text: td(`system.auto.sum.${key}`, params), tone: key === 'upToDate' || key === 'disabled' || key === 'noDir' ? 'slate' : 'amber' };
    }
    if (c.ok) return { text: t(c.restart ? 'system.auto.sum.updatedRestart' : 'system.auto.sum.updated', { from: c.from ?? '?', to: c.to ?? '?' }), tone: 'green' };
    return { text: t('system.auto.sum.failed', { from: c.from ?? '?', to: c.to ?? '?', error: c.error ?? '?' }), tone: 'red' };
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-indigo-400" /> {t('system.auto.title')}</span>} subtitle={t('system.auto.subtitle')}>
        <div className="space-y-4">
          <Toggle checked={s.enabled} disabled={disabled} onChange={(v) => set({ enabled: v })} label={t('system.auto.enable')} description={t('system.auto.enableHint')} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('backups.frequency')}>
              <select className="input" value={s.frequency} disabled={disabled} onChange={(e) => set({ frequency: e.target.value as 'daily' | 'weekly' })}>
                <option value="daily">{t('backups.daily')}</option>
                <option value="weekly">{t('backups.weekly')}</option>
              </select>
            </Field>
            <Field label={t('backups.time')}><input className="input" type="time" value={s.time} disabled={disabled} onChange={(e) => set({ time: e.target.value })} /></Field>
            {s.frequency === 'weekly' && (
              <Field label={t('backups.weekday')}>
                <select className="input" value={s.weekday} disabled={disabled} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                  {weekdayNames().map((w, i) => <option key={i} value={i}>{w}</option>)}
                </select>
              </Field>
            )}
            <Field label={t('wizard.language.timezone')} className={s.frequency === 'weekly' ? undefined : 'col-span-2'}><input className="input" value={s.timezone} disabled={disabled} onChange={(e) => set({ timezone: e.target.value })} /></Field>
          </div>
          <Toggle checked={s.ts3} disabled={disabled} onChange={(v) => set({ ts3: v })} label={t('system.auto.ts3')} description={t('system.auto.ts3Hint')} />
          {s.ts3 && <Toggle checked={s.onlyWhenEmpty} disabled={disabled} onChange={(v) => set({ onlyWhenEmpty: v })} label={t('system.auto.onlyWhenEmpty')} description={t('system.auto.onlyWhenEmptyHint')} />}
          <Toggle checked={s.webinterface} disabled={disabled} onChange={(v) => set({ webinterface: v })} label={t('system.auto.webinterface')} description={t('system.auto.webinterfaceHint')} />
          {s.ts3 && !info.ts3Configured && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{t('system.auto.ts3NotConfigured')}</p>}
          {s.webinterface && !info.selfUpdate.canUpdate && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <p className="font-medium">{t('system.auto.selfNotPossible')}</p>
              <ul className="list-disc pl-5">{info.selfUpdate.reasons.map((r) => <li key={r}>{td(`system.self.reason.${r}`, undefined, r)}</li>)}</ul>
            </div>
          )}
          {s.webinterface && info.selfUpdate.canUpdate && info.selfUpdate.restartMode !== 'systemd' && <p className="text-xs text-amber-200">{t('system.auto.restartManual')}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {canRun && <Button icon={Play} disabled={Boolean(info.running)} onClick={() => setConfirm(true)}>{t('system.auto.runNow')}</Button>}
            {canManage && <Button variant="primary" icon={Save} loading={save.isPending} disabled={!form} onClick={() => save.mutate()}>{t('common.save')}</Button>}
          </div>
        </div>
      </Card>

      <Card title={t('system.auto.lastRun')} subtitle={info.nextRun ? `${t('backups.nextRun')}: ${formatDate(info.nextRun)} (${formatRelative(info.nextRun)})` : t('backups.notScheduled')} actions={info.running && <RefreshCw className="h-4 w-4 animate-spin text-indigo-400" />}>
        {info.cron && <p className="mb-3 text-xs text-slate-500">Cron: <span className="font-mono text-slate-300">{info.cron}</span> · {info.timezone}</p>}
        {info.running && (
          <p className="mb-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200">
            {t('system.auto.running', { when: formatRelative(info.running.startedAt), step: t(info.running.step === 'ts3' ? 'system.auto.comp.ts3' : 'system.auto.comp.webinterface') })}
          </p>
        )}
        {!last ? <p className="text-sm text-slate-500">{t('system.auto.noRun')}</p> : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {(() => { const acted = [last.ts3, last.webinterface].some((c) => c && c.ok !== undefined); return <Badge tone={!last.ok ? 'red' : acted ? 'green' : 'slate'}>{!last.ok ? t('system.upd.failed') : acted ? t('system.upd.success') : t('system.auto.nothingToDo')}</Badge>; })()}
              <span className="text-slate-300">{formatDate(last.at, true)}</span>
              <span className="text-xs text-slate-500">· {last.trigger === 'manual' ? t('system.auto.trigger.manual', { by: last.by }) : t('system.auto.trigger.schedule')}</span>
            </div>
            {last.skipped === 'busy' && <p className="text-amber-200">{t('system.auto.busy')}</p>}
            <ul className="space-y-2">
              {(['ts3', 'webinterface'] as const).map((k) => {
                const d = describe(last[k], last.skipped === 'busy');
                return (
                  <li key={k} className="flex items-start gap-3 rounded-lg bg-slate-950/60 px-3 py-2">
                    <span className="w-36 shrink-0 text-slate-400">{t(k === 'ts3' ? 'system.auto.comp.ts3' : 'system.auto.comp.webinterface')}</span>
                    <span className={d.tone === 'green' ? 'text-emerald-300' : d.tone === 'red' ? 'text-rose-300' : d.tone === 'amber' ? 'text-amber-200' : 'text-slate-300'}>{d.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => run.mutate()} loading={run.isPending} title={t('system.auto.confirmTitle')} confirmLabel={t('system.auto.runNow')} tone="primary" requireText="UPDATE"
        message={<p>{t('system.auto.confirmMsg')}</p>} />
    </div>
  );
}
