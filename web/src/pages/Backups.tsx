import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, CalendarClock, Camera, Download, History, Info, Play, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { Backup, BackupSchedule, Snapshot } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatBytes, formatDate, formatDurationMs, formatRelative, formatTime, weekdayNames } from '../lib/format';
import { td, useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, FullPageSpinner, Modal, PageHeader, Toggle } from '../components/ui';

const TRIGGER_TONE: Record<string, 'indigo' | 'green' | 'amber' | 'slate' | 'blue'> = { manual: 'indigo', schedule: 'green', 'pre-restore': 'amber', 'pre-update': 'amber', upload: 'blue', unknown: 'slate' };
const triggerLabel = (trigger: string) => td(`backups.trigger.${trigger}`, undefined, trigger);

export default function BackupsPage() {
  const { can } = useAuth(); const canWrite = can('backups.manage'); const isAdmin = can('backups.restore'); const canDownload = can('backups.download');
  const { t } = useT();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [includeLogs, setIncludeLogs] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<{ steps: { ts: string; msg: string }[]; safetyBackup?: string } | null>(null);
  const [detail, setDetail] = useState<Backup | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const backups = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<{ backups: Backup[]; running: { id: string; startedAt: string } | null; restoring: { id: string; startedAt: string } | null; dir: string }>('/api/backups'),
    refetchInterval: (q) => (q.state.data?.running || q.state.data?.restoring ? 2000 : 30000),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['backups'] });

  const create = useMutation({
    mutationFn: () => api.post<{ backup: Backup }>('/api/backups', { includeLogs, label }),
    onSuccess: (r) => { toast.success(t('backups.created'), { description: `${r.backup.id} · ${formatBytes(r.backup.size)}` }); setCreateOpen(false); setLabel(''); invalidate(); },
    onError: (e) => { toast.error(errorMessage(e)); invalidate(); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/backups/${id}`),
    onSuccess: () => { toast.success(t('backups.deleted')); setDeleteId(null); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; steps: { ts: string; msg: string }[]; safetyBackup: string }>(`/api/backups/${id}/restore`, { confirm: id }),
    onSuccess: (r) => { toast.success(t('backups.restored')); setRestoreId(null); setRestoreResult(r); invalidate(); qc.invalidateQueries({ queryKey: ['status'] }); },
    onError: (e: unknown) => { toast.error(errorMessage(e)); setRestoreId(null); const steps = (e as { data?: { steps?: { ts: string; msg: string }[] } }).data?.steps; if (steps) setRestoreResult({ steps }); invalidate(); },
  });
  const upload = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api.post<{ backup: Backup }>('/api/backups/upload', fd); },
    onSuccess: (r) => { toast.success(t('backups.uploaded'), { description: r.backup.id }); invalidate(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const d = backups.data;

  return (
    <div>
      <PageHeader
        title={t('backups.title')}
        description={t('backups.description')}
        actions={<>
          <Button variant="ghost" icon={RefreshCw} onClick={() => backups.refetch()} loading={backups.isFetching}>{t('common.refresh')}</Button>
          {isAdmin && <><input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} /><Button icon={Upload} loading={upload.isPending} onClick={() => fileRef.current?.click()}>{t('files.upload')}</Button></>}
          {canWrite && <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)} disabled={Boolean(d?.running)}>{t('backups.create')}</Button>}
        </>}
      />

      {d?.running && <div className="mb-4 flex items-center gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200"><RefreshCw className="h-4 w-4 animate-spin" /> {t('backups.running', { id: d.running.id, since: formatRelative(d.running.startedAt) })}</div>}
      {d?.restoring && <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"><RefreshCw className="h-4 w-4 animate-spin" /> {t('backups.restoring', { id: d.restoring.id })}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title={t('backups.existing')} subtitle={d ? `${t('backups.countSize', { count: d.backups.length, size: formatBytes(d.backups.reduce((a, b) => a + b.size, 0)) })} · ${d.dir}` : undefined} noPadding>
            {backups.isLoading && <FullPageSpinner />}
            {backups.error && <div className="p-4"><ErrorBox error={backups.error} onRetry={() => backups.refetch()} /></div>}
            {d && (d.backups.length === 0 ? <EmptyState icon={Archive} title={t('backups.none')} description={t('backups.noneHint')} /> : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Backup</th><th>{t('bans.th.created')}</th><th>{t('backups.th.kind')}</th><th>{t('files.th.size')}</th><th>{t('backups.th.contents')}</th><th className="text-right">{t('common.actions')}</th></tr></thead>
                  <tbody>
                    {d.backups.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <p className="font-mono text-xs text-slate-100">{b.id}</p>
                          {b.label && <p className="text-xs text-slate-400">{b.label}</p>}
                        </td>
                        <td className="whitespace-nowrap"><span title={formatDate(b.createdAt, true)}>{formatDate(b.createdAt)}</span><p className="text-xs text-slate-500">{b.createdBy}</p></td>
                        <td><Badge tone={TRIGGER_TONE[b.trigger] || 'slate'}>{triggerLabel(b.trigger)}</Badge></td>
                        <td className="whitespace-nowrap">{formatBytes(b.size)}</td>
                        <td className="text-xs text-slate-400">
                          {b.contents.length ? b.contents.join(', ') : '–'}{b.notes.length > 0 && <span className="ml-1 text-amber-400" title={b.notes.join('\n')}>⚠</span>}
                          {b.dbIntegrity && <span className="ml-2 inline-block align-middle"><Badge tone={b.dbIntegrity === 'ok' ? 'green' : b.dbIntegrity === 'failed' ? 'red' : 'slate'}>{t(`backups.integrity.${b.dbIntegrity}`)}</Badge></span>}
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" icon={Info} onClick={() => setDetail(b)} />
                            {canDownload && <a className="btn btn-secondary btn-sm" href={`/api/backups/${encodeURIComponent(b.id)}/download`} title={t('files.downloadTitle')}><Download className="h-3.5 w-3.5" /></a>}
                            {isAdmin && <Button size="sm" variant="warning" icon={History} onClick={() => setRestoreId(b.id)} disabled={Boolean(d.restoring || d.running)}>Restore</Button>}
                            {canWrite && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDeleteId(b.id)} />}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </Card>
          <SnapshotsCard />
        </div>
        <ScheduleCard />
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('backups.create')} size="sm"
        footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" icon={Archive} loading={create.isPending} onClick={() => create.mutate()}>{t('files.create')}</Button></>}>
        <div className="space-y-4">
          <Field label={t('backups.labelOptional')}><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder={t('backups.labelPlaceholder')} /></Field>
          <Toggle checked={includeLogs} onChange={setIncludeLogs} label={t('backups.includeLogs')} description={t('backups.includeLogsHint')} />
          <p className="text-xs text-slate-500">{t('backups.contentsNote')}</p>
        </div>
      </Modal>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={t('backups.details')} size="md">
        {detail && (
          <dl className="space-y-2 text-sm">
            {[['ID', detail.id], [t('bans.th.created'), formatDate(detail.createdAt, true)], [t('bans.th.by'), detail.createdBy || '–'], [t('backups.th.kind'), triggerLabel(detail.trigger)], [t('files.th.size'), formatBytes(detail.size)], [t('bans.th.duration'), formatDurationMs(detail.durationMs)], [t('backups.dbMethod'), detail.dbMethod || '–'], [t('backups.integrity'), detail.dbIntegrity ? t(`backups.integrity.${detail.dbIntegrity}`) : '–'], [t('backups.ts3Version'), detail.ts3Version || '–'], [t('backups.th.contents'), detail.contents.join(', ') || '–']].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-slate-800/60 py-1"><dt className="text-slate-400">{k}</dt><dd className="text-right font-mono text-xs text-slate-200 break-all">{v}</dd></div>
            ))}
            {detail.notes.length > 0 && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{detail.notes.map((n, i) => <p key={i}>{n}</p>)}</div>}
          </dl>
        )}
      </Modal>

      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del.mutate(deleteId)} loading={del.isPending} title={t('backups.deleteConfirm')} message={<span className="font-mono text-xs">{deleteId}</span>} confirmLabel={t('common.delete')} />
      <ConfirmDialog open={restoreId !== null} onClose={() => setRestoreId(null)} onConfirm={() => restoreId && restore.mutate(restoreId)} loading={restore.isPending} title={t('backups.restoreConfirm')} confirmLabel={t('backups.restore')} tone="warning" requireText={restoreId || ''}
        message={<div className="space-y-2">
          <p>{t('backups.restoreMsg1')}</p>
          <p>{t('backups.restoreMsg2')}</p>
        </div>} />

      <Modal open={Boolean(restoreResult)} onClose={() => setRestoreResult(null)} title={t('backups.restoreLog')} size="md" footer={<Button variant="primary" onClick={() => setRestoreResult(null)}>{t('common.close')}</Button>}>
        <ol className="space-y-1 font-mono text-xs">
          {restoreResult?.steps.map((s, i) => <li key={i} className="flex gap-3"><span className="text-slate-500">{formatTime(s.ts)}</span><span className={/^(Fehler|Error)/.test(s.msg) ? 'text-rose-300' : 'text-slate-200'}>{s.msg}</span></li>)}
        </ol>
      </Modal>
    </div>
  );
}

function ScheduleCard() {
  const { can } = useAuth(); const isAdmin = can('backups.manage'); const canWrite = can('backups.manage');
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['backups', 'schedule'], queryFn: () => api.get<{ schedule: BackupSchedule }>('/api/backups/schedule') });
  const [form, setForm] = useState<Partial<BackupSchedule> | null>(null);
  const s = form ?? q.data?.schedule;

  const save = useMutation({
    mutationFn: () => api.put<{ schedule: BackupSchedule }>('/api/backups/schedule', { enabled: s!.enabled, frequency: s!.frequency, time: s!.time, weekday: s!.weekday, keep: s!.keep, includeLogs: s!.includeLogs, timezone: s!.timezone }),
    onSuccess: () => { toast.success(t('backups.scheduleSaved')); setForm(null); qc.invalidateQueries({ queryKey: ['backups', 'schedule'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const runNow = useMutation({
    mutationFn: () => api.post('/api/backups/schedule/run-now'),
    onSuccess: () => { toast.success(t('backups.scheduledRun')); qc.invalidateQueries({ queryKey: ['backups'] }); },
    onError: (e) => { toast.error(errorMessage(e)); qc.invalidateQueries({ queryKey: ['backups'] }); },
  });

  if (q.isLoading || !s) return <Card title={t('backups.schedule')}><FullPageSpinner /></Card>;
  const set = (patch: Partial<BackupSchedule>) => setForm({ ...(s as BackupSchedule), ...patch });
  const disabled = !isAdmin;

  return (
    <Card title={<span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-indigo-400" /> {t('backups.autoTitle')}</span>} subtitle={t('backups.autoSub')}>
      <div className="space-y-4">
        <Toggle checked={Boolean(s.enabled)} onChange={(v) => set({ enabled: v })} disabled={disabled} label={t('backups.scheduleActive')} />
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
          <Field label={t('backups.keep')} hint={t('backups.keepHint')}><input className="input" type="number" min={1} max={365} value={s.keep} disabled={disabled} onChange={(e) => set({ keep: Number(e.target.value) })} /></Field>
          <Field label={t('wizard.language.timezone')} className="col-span-2"><input className="input" value={s.timezone} disabled={disabled} onChange={(e) => set({ timezone: e.target.value })} /></Field>
        </div>
        <Toggle checked={Boolean(s.includeLogs)} onChange={(v) => set({ includeLogs: v })} disabled={disabled} label={t('backups.includeLogs')} />
        <div className="rounded-lg bg-slate-950/60 p-3 text-xs text-slate-400">
          <p>{t('backups.nextRun')}: <span className="text-slate-200">{q.data?.schedule.nextRun ? `${formatDate(q.data.schedule.nextRun)} (${formatRelative(q.data.schedule.nextRun)})` : t('backups.notScheduled')}</span></p>
          {q.data?.schedule.cron && <p>Cron: <span className="font-mono text-slate-300">{q.data.schedule.cron}</span></p>}
          {q.data?.schedule.lastRun && (
            <p className="mt-1">{t('backups.lastRun')}: <span className={q.data.schedule.lastRun.ok ? 'text-emerald-300' : 'text-rose-300'}>{q.data.schedule.lastRun.ok ? t('system.upd.success') : t('system.upd.failed')}</span> {formatRelative(q.data.schedule.lastRun.at)}
              {q.data.schedule.lastRun.backupId && <span className="block font-mono text-[11px] text-slate-500">{q.data.schedule.lastRun.backupId}</span>}
              {q.data.schedule.lastRun.error && <span className="block text-rose-300">{q.data.schedule.lastRun.error}</span>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {canWrite && <Button icon={Play} loading={runNow.isPending} onClick={() => runNow.mutate()}>{t('backups.runNow')}</Button>}
          {isAdmin && <Button variant="primary" loading={save.isPending} disabled={!form} onClick={() => save.mutate()}>{t('backups.saveSchedule')}</Button>}
        </div>
      </div>
    </Card>
  );
}

function SnapshotsCard() {
  const { can } = useAuth(); const canWrite = can('backups.manage'); const isAdmin = can('backups.restore'); const canDownload = can('backups.download');
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['backups', 'snapshots'], queryFn: () => api.get<{ snapshots: Snapshot[] }>('/api/backups/snapshots') });
  const [deployId, setDeployId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['backups', 'snapshots'] });

  const create = useMutation({ mutationFn: () => api.post('/api/backups/snapshots'), onSuccess: () => { toast.success(t('backups.snapshotCreated')); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/api/backups/snapshots/${id}`), onSuccess: () => { toast.success(t('backups.snapshotDeleted')); setDeleteId(null); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const deploy = useMutation({
    mutationFn: (id: string) => api.post('/api/backups/snapshots/deploy', { id, confirm: 'EINSPIELEN' }),
    onSuccess: () => { toast.success(t('backups.snapshotDeployed')); setDeployId(null); qc.invalidateQueries(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card title={<span className="flex items-center gap-2"><Camera className="h-4 w-4 text-indigo-400" /> {t('backups.snapshots')}</span>}
      subtitle={t('backups.snapshotsSub')}
      actions={canWrite && <Button size="sm" variant="primary" icon={Plus} loading={create.isPending} onClick={() => create.mutate()}>{t('backups.createSnapshot')}</Button>} noPadding>
      {q.error && <div className="p-4"><ErrorBox error={q.error} onRetry={() => q.refetch()} compact /></div>}
      {q.data && (q.data.snapshots.length === 0 ? <EmptyState icon={Camera} title={t('backups.noSnapshots')} /> : (
        <table className="table">
          <thead><tr><th>Snapshot</th><th>Server</th><th>{t('bans.th.created')}</th><th>{t('files.th.size')}</th><th className="text-right">{t('common.actions')}</th></tr></thead>
          <tbody>
            {q.data.snapshots.map((s) => (
              <tr key={s.id}>
                <td className="font-mono text-xs">{s.id}</td>
                <td>{s.serverName}</td>
                <td className="whitespace-nowrap">{formatDate(s.createdAt)}<p className="text-xs text-slate-500">{s.createdBy}</p></td>
                <td>{formatBytes(s.size)}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    {canDownload && <a className="btn btn-secondary btn-sm" href={`/api/backups/snapshots/${encodeURIComponent(s.id)}/download`}><Download className="h-3.5 w-3.5" /></a>}
                    {isAdmin && <Button size="sm" variant="warning" icon={History} onClick={() => setDeployId(s.id)}>{t('backups.deploy')}</Button>}
                    {canWrite && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDeleteId(s.id)} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del.mutate(deleteId)} loading={del.isPending} title={t('backups.deleteSnapshot')} message={<span className="font-mono text-xs">{deleteId}</span>} confirmLabel={t('common.delete')} />
      <ConfirmDialog open={deployId !== null} onClose={() => setDeployId(null)} onConfirm={() => deployId && deploy.mutate(deployId)} loading={deploy.isPending} title={t('backups.deployConfirm')} confirmLabel={t('backups.deploy')} tone="warning" requireText="EINSPIELEN"
        message={t('backups.deployMsg')} />
    </Card>
  );
}
