import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { Bell, CheckCircle2, Download, HeartPulse, History, RefreshCw, RotateCcw, Save, XCircle, Package } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { SelfUpdateTab } from '../components/SelfUpdateTab';
import type { NotificationSettings, NotificationState, UpdateSummary, WatchdogState } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatDate, formatRelative, formatTime } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, FullPageSpinner, KV, PageHeader, Toggle } from '../components/ui';
import { NotificationForm } from '../components/NotificationForm';

type Tab = 'watchdog' | 'notifications' | 'update' | 'webinterface';

export default function SystemPage() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('watchdog');
  return (
    <div>
      <PageHeader title={t('system.title')} description={t('system.description')} />
      <div className="mb-4 flex w-fit gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
        {([['watchdog', t('system.tab.watchdog'), HeartPulse], ['notifications', t('system.tab.notifications'), Bell], ['update', t('system.tab.update'), Download], ['webinterface', t('system.tab.webinterface'), Package]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition', tab === key ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-100')}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>
      {tab === 'watchdog' && <WatchdogTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'update' && <UpdateTab />}
      {tab === 'webinterface' && <SelfUpdateTab />}
    </div>
  );
}

/* ---------------- Watchdog ---------------- */
function WatchdogTab() {
  const { can } = useAuth(); const isAdmin = can('system.manage'); const canWrite = can('system.manage');
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system', 'watchdog'], queryFn: () => api.get<WatchdogState>('/api/system/watchdog'), refetchInterval: 10000 });
  const [form, setForm] = useState<WatchdogState['settings'] | null>(null);
  const s = form ?? q.data?.settings;
  const save = useMutation({
    mutationFn: () => api.put('/api/system/watchdog', { enabled: s!.enabled, intervalSec: s!.intervalSec, maxRestartsPerHour: s!.maxRestartsPerHour, startOnBoot: s!.startOnBoot }),
    onSuccess: () => { toast.success(t('system.wd.saved')); setForm(null); qc.invalidateQueries({ queryKey: ['system', 'watchdog'] }); qc.invalidateQueries({ queryKey: ['status'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () => api.post('/api/system/watchdog/reset'),
    onSuccess: () => { toast.success(t('system.wd.resumed')); qc.invalidateQueries({ queryKey: ['system', 'watchdog'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading || !s) return <FullPageSpinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const w = q.data!;
  const set = (patch: Partial<WatchdogState['settings']>) => setForm({ ...s, ...patch });
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t('common.status')}>
        <KV items={[
          { k: t('dash.watchdog'), v: <Badge tone={w.active ? 'green' : 'slate'} dot pulse={w.active}>{w.active ? t('system.wd.active') : t('system.wd.inactive')}</Badge> },
          { k: t('dash.processControl'), v: w.configured ? t('system.wd.configured') : <Badge tone="red">{t('wizard.control.notConfigured')}</Badge> },
          { k: t('system.wd.lastCheck'), v: w.lastCheck ? formatRelative(w.lastCheck) : '–' },
          { k: t('system.wd.lastState'), v: w.lastStatus === true ? <Badge tone="green">{t('layout.running')}</Badge> : w.lastStatus === false ? <Badge tone="red">{t('layout.stopped')}</Badge> : '–' },
          { k: t('system.wd.restartsHour'), v: `${w.restartsLastHour} / ${s.maxRestartsPerHour}` },
          { k: t('system.wd.suspended'), v: s.suspended ? <Badge tone="amber">{t('common.yes')}</Badge> : t('common.no') },
          { k: t('system.wd.gaveUp'), v: w.gaveUp ? <Badge tone="red">{t('common.yes')}</Badge> : t('common.no') },
          { k: t('system.wd.lastAction'), v: w.lastAction ? <span className={w.lastAction.ok ? 'text-emerald-300' : 'text-rose-300'}>{w.lastAction.ok ? t('system.wd.startOk') : t('system.wd.startFailed')} · {formatRelative(w.lastAction.ts)}</span> : '–' },
        ]} />
        {(w.gaveUp || s.suspended) && canWrite && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <p>{w.gaveUp ? t('system.wd.gaveUpNote') : t('system.wd.suspendedNote')}</p>
            <Button className="mt-2" size="sm" variant="warning" icon={RotateCcw} loading={reset.isPending} onClick={() => reset.mutate()}>{t('system.wd.resume')}</Button>
          </div>
        )}
        <p className="mt-4 text-xs text-slate-500">{t('system.wd.explain')}</p>
      </Card>
      <Card title={t('nav.settings')}>
        <div className="space-y-4">
          <Toggle checked={s.enabled} disabled={!isAdmin} onChange={(v) => set({ enabled: v })} label={t('system.wd.enable')} description={t('system.wd.enableHint')} />
          <Toggle checked={s.startOnBoot} disabled={!isAdmin} onChange={(v) => set({ startOnBoot: v })} label={t('system.wd.autostart')} description={t('system.wd.autostartHint')} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('system.wd.interval')}><input className="input" type="number" min={10} max={600} value={s.intervalSec} disabled={!isAdmin} onChange={(e) => set({ intervalSec: Number(e.target.value) })} /></Field>
            <Field label={t('system.wd.maxRestarts')} hint={t('system.wd.maxRestartsHint')}><input className="input" type="number" min={1} max={20} value={s.maxRestartsPerHour} disabled={!isAdmin} onChange={(e) => set({ maxRestartsPerHour: Number(e.target.value) })} /></Field>
          </div>
          {isAdmin && <div className="flex justify-end"><Button variant="primary" icon={Save} loading={save.isPending} disabled={!form} onClick={() => save.mutate()}>{t('common.save')}</Button></div>}
        </div>
      </Card>
      <Card title={t('system.wd.log')} className="lg:col-span-2" noPadding>
        {w.log.length === 0 ? <EmptyState icon={HeartPulse} title={t('audit.none')} /> : (
          <ul className="max-h-72 divide-y divide-slate-800/70 overflow-y-auto font-mono text-xs">
            {w.log.map((l, i) => <li key={i} className="flex gap-3 px-4 py-1.5"><span className="shrink-0 text-slate-500">{formatDate(l.ts, true)}</span><span className="text-slate-200">{l.msg}</span></li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Benachrichtigungen (global / System) ---------------- */
function NotificationsTab() {
  const { can } = useAuth(); const isAdmin = can('system.manage');
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system', 'notifications'], queryFn: () => api.get<{ settings: NotificationSettings; state: NotificationState; eventLabels: Record<string, string> }>('/api/system/notifications'), refetchInterval: 30000 });
  const [form, setForm] = useState<NotificationSettings | null>(null);
  useEffect(() => { if (q.data && !form) setForm(q.data.settings); }, [q.data, form]);
  const save = useMutation({
    mutationFn: () => api.put('/api/system/notifications', form),
    onSuccess: () => { toast.success(t('account.notificationsSaved')); setForm(null); qc.invalidateQueries({ queryKey: ['system', 'notifications'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: (channel: string) => api.post('/api/system/notifications/test', { channel }),
    onSuccess: (_, ch) => { toast.success(t('account.testSent', { channel: ch })); qc.invalidateQueries({ queryKey: ['system', 'notifications'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading || !form) return <FullPageSpinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const st = q.data!.state;
  const dirty = JSON.stringify(form) !== JSON.stringify(q.data!.settings);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">{t('system.notif.intro')}</p>
      <NotificationForm value={form} onChange={(v) => setForm(v as NotificationSettings)} onSave={() => save.mutate()} onDiscard={() => setForm(q.data!.settings)} onTest={(ch) => test.mutate(ch)} saving={save.isPending} testing={test.isPending} dirty={dirty} readOnly={!isAdmin} ready={st.channels} eventLabels={q.data!.eventLabels} global mailFrom={st.mailFrom}
        footerNote={st.lastError && <span className="ml-3 text-xs text-rose-300">{t('system.notif.lastError', { error: st.lastError })}</span>} />
      <Card title={t('system.notif.history')} subtitle={st.lastSent ? t('system.notif.lastSent', { when: formatRelative(st.lastSent) }) : t('system.notif.nothingSent')} noPadding>
        {st.history.length === 0 ? <EmptyState icon={Bell} title={t('system.notif.none')} /> : (
          <ul className="max-h-72 divide-y divide-slate-800/70 overflow-y-auto text-sm">
            {st.history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="text-xs text-slate-500">{formatDate(h.ts, true)}</span>
                <span className="font-medium text-slate-100">{h.title}</span>
                <span className="ml-auto flex gap-1">{h.results.map((r, j) => <Badge key={j} tone={r.ok ? 'green' : 'red'} className="gap-1">{r.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{r.owner && r.owner !== 'system' ? `${r.owner}/` : ''}{r.channel}{r.error && <span title={r.error}> !</span>}</Badge>)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Update ---------------- */
function UpdateTab() {
  const { can } = useAuth(); const isAdmin = can('update.run'); const canWrite = can('system.view');
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['system', 'update'], queryFn: () => api.get<UpdateSummary>('/api/system/update'), refetchInterval: (query) => (query.state.data?.running ? 2000 : 60000) });
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [customVersion, setCustomVersion] = useState('');
  const check = useMutation({ mutationFn: () => api.post<UpdateSummary>('/api/system/update/check'), onSuccess: (d) => { qc.setQueryData(['system', 'update'], d); toast.success(t('system.upd.checked')); }, onError: (e) => toast.error(errorMessage(e)) });
  const run = useMutation({
    mutationFn: (version: string) => api.post('/api/system/update/run', { version, confirm: 'UPDATE' }),
    onSuccess: () => { toast.success(t('system.upd.started')); setConfirmUpdate(false); qc.invalidateQueries({ queryKey: ['system', 'update'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rollback = useMutation({
    mutationFn: () => api.post('/api/system/update/rollback', { confirm: 'ROLLBACK' }),
    onSuccess: () => { toast.success(t('system.upd.rollbackStarted')); setConfirmRollback(false); qc.invalidateQueries({ queryKey: ['system', 'update'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <FullPageSpinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const u = q.data!;
  const target = customVersion.trim() || u.latest || '';
  const steps = u.running?.steps ?? u.lastResult?.steps ?? [];
  const runKind = (rb?: boolean) => (rb ? t('system.upd.rollback') : t('system.upd.update'));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title={t('system.upd.versions')} actions={canWrite && <Button size="sm" icon={RefreshCw} loading={check.isPending} onClick={() => check.mutate()}>{t('system.upd.checkNow')}</Button>}>
        <KV items={[
          { k: t('system.upd.installed'), v: <span className="font-mono">{u.current || t('common.unknown')}</span> },
          { k: t('system.upd.available'), v: u.latest ? <span className="flex items-center justify-end gap-2"><span className="font-mono">{u.latest}</span>{u.updateAvailable ? <Badge tone="amber">{t('system.upd.updateAvailable')}</Badge> : <Badge tone="green">{t('system.upd.upToDate')}</Badge>}</span> : '–' },
          { k: t('dash.checked'), v: u.checkedAt ? formatRelative(u.checkedAt) : '–' },
          { k: t('system.upd.previous'), v: u.previousVersion ? <span className="font-mono">{u.previousVersion}</span> : '–' },
        ]} />
        {u.checkError && <p className="mt-3 text-xs text-rose-300">{u.checkError}</p>}
        {u.latestUrl && <p className="mt-3 truncate font-mono text-[11px] text-slate-500" title={u.latestUrl}>{u.latestUrl}</p>}
        {isAdmin && (
          <div className="mt-5 space-y-3">
            <Field label={t('system.upd.targetVersion')} hint={t('system.upd.targetHint')}>
              <input className="input font-mono" value={customVersion} placeholder={u.latest || '3.13.x'} onChange={(e) => setCustomVersion(e.target.value)} disabled={Boolean(u.running)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={Download} disabled={!target || Boolean(u.running) || target === u.current} onClick={() => setConfirmUpdate(true)}>{t('system.upd.updateTo', { version: target || '…' })}</Button>
              {u.previousVersion && <Button variant="warning" icon={History} disabled={Boolean(u.running)} onClick={() => setConfirmRollback(true)}>{t('system.upd.rollbackTo', { version: u.previousVersion })}</Button>}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-slate-500">{t('system.upd.flow')}</p>
      </Card>
      <Card title={u.running ? t('system.upd.runningTitle', { kind: runKind(u.running.rollback) }) : u.lastResult ? t('system.upd.lastRun', { result: u.lastResult.ok ? t('system.upd.success') : t('system.upd.failed') }) : t('system.wd.log')}
        subtitle={u.running ? t('system.upd.startedBy', { when: formatRelative(u.running.startedAt), by: u.running.by }) : u.lastResult ? `${runKind(u.lastResult.rollback)} ${u.lastResult.from ? `${u.lastResult.from} → ` : ''}${u.lastResult.to} · ${formatDate(u.lastResult.finishedAt, true)}` : undefined}
        actions={u.running && <RefreshCw className="h-4 w-4 animate-spin text-indigo-400" />} noPadding>
        {steps.length === 0 ? <EmptyState icon={Download} title={t('system.upd.noneYet')} /> : (
          <ol className="max-h-96 space-y-1 overflow-y-auto p-4 font-mono text-xs">
            {steps.map((s, i) => <li key={i} className="flex gap-3"><span className="shrink-0 text-slate-500">{formatTime(s.ts)}</span><span className={clsx(/^(FEHLER|ERROR)/.test(s.msg) ? 'text-rose-300' : /^(Warnung|Warning)/.test(s.msg) ? 'text-amber-300' : 'text-slate-200')}>{s.msg}</span></li>)}
            {u.lastResult && !u.running && !u.lastResult.ok && <li className="text-rose-300">{t('common.error')}: {u.lastResult.error}</li>}
          </ol>
        )}
      </Card>
      <ConfirmDialog open={confirmUpdate} onClose={() => setConfirmUpdate(false)} onConfirm={() => run.mutate(target)} loading={run.isPending} title={t('system.upd.confirmTitle', { version: target })} confirmLabel={t('system.upd.startUpdate')} tone="primary" requireText="UPDATE"
        message={<div className="space-y-2"><p>{t('system.upd.confirmMsg')}</p><p className="text-xs text-slate-400">{t('system.upd.confirmNote')}</p></div>} />
      <ConfirmDialog open={confirmRollback} onClose={() => setConfirmRollback(false)} onConfirm={() => rollback.mutate()} loading={rollback.isPending} title={t('system.upd.rollbackConfirmTitle', { version: u.previousVersion ?? '' })} confirmLabel={t('system.upd.startRollback')} tone="warning" requireText="ROLLBACK"
        message={t('system.upd.rollbackMsg')} />
    </div>
  );
}
