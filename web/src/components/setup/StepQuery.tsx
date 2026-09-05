import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Eye, EyeOff, KeyRound, Plug, RotateCcw, ScrollText } from 'lucide-react';
import { setupApi, type QueryTest, type ResetJob } from '../../api/setup';
import { ApiError, errorMessage } from '../../api/client';
import { useT } from '../../i18n';
import { Badge, Button, ConfirmDialog, Field, Spinner } from '../ui';
import { Code, Note, Pre, SourceBadge, type StepProps } from './common';

export function StepQuery({ draft, updateQuery, state, mode, controlOk, onTested }: StepProps & { controlOk: boolean; onTested?: (r: QueryTest | null) => void }) {
  const { t, td } = useT();
  const q = draft.ts3.query;
  const src = state.current.source;
  const [result, setResult] = useState<QueryTest | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [banWait, setBanWait] = useState<number | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [job, setJob] = useState<ResetJob | null>(null);
  const [logSearch, setLogSearch] = useState<{ found: boolean; loginname?: string; password?: string; logFile?: string; searched?: number } | null>(null);

  const test = useMutation({
    mutationFn: () => setupApi.testQuery({ host: q.host, port: Number(q.port), protocol: q.protocol, username: q.username, password: q.password }),
    onSuccess: (r) => {
      setResult(r); onTested?.(r);
      // Passenden virtuellen Server vorbelegen
      if (r.ok && r.servers?.length) {
        const byPort = r.servers.find((s) => s.port === Number(q.serverPort));
        if (!byPort && !q.serverId) updateQuery({ serverPort: r.servers[0].port });
      }
    },
    onError: (e) => {
      setResult(null); onTested?.(null);
      if (e instanceof ApiError && e.status === 429 && typeof e.data.retryAfterSec === 'number') setBanWait(e.data.retryAfterSec);
    },
  });
  const findPw = useMutation({ mutationFn: () => setupApi.findInitialPassword(draft.ts3.dir), onSuccess: setLogSearch });
  const startReset = useMutation({
    mutationFn: () => setupApi.startReset(draft),
    onSuccess: async ({ jobId }) => { setResetOpen(false); setJob({ id: jobId, startedAt: '', done: false, ok: null, steps: [], result: null }); },
  });

  // Countdown nach Sperre
  useEffect(() => {
    if (banWait === null) return;
    if (banWait <= 0) { setBanWait(null); return; }
    const id = window.setTimeout(() => setBanWait((v) => (v === null ? null : v - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [banWait]);

  // Reset-Job verfolgen
  useEffect(() => {
    if (!job || job.done) return;
    const id = window.setInterval(async () => {
      try {
        const j = await setupApi.resetJob(job.id);
        setJob(j);
        if (j.done && j.ok && j.result?.passwordAvailable) {
          const { password } = await setupApi.takeResetPassword(j.id);
          updateQuery({ username: 'serveradmin', password });
          setResult({ ok: true, durationMs: 0, servers: j.result.servers ?? [] });
          onTested?.({ ok: true, durationMs: 0, servers: j.result.servers ?? [] });
        }
      } catch { /* weiter pollen */ }
    }, 2000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.done]);

  const err = result?.error;
  const canReset = draft.ts3.controlMode === 'script' && controlOk && state.platform === 'linux';

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">{t('wizard.query.intro')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={<span>{t('wizard.query.host')}<SourceBadge source={mode === 'settings' ? src['ts3.query.host'] : undefined} /></span>}>
          <input className="input font-mono" value={q.host} onChange={(e) => updateQuery({ host: e.target.value })} spellCheck={false} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('wizard.query.port')}><input className="input font-mono" type="number" min={1} max={65535} value={q.port} onChange={(e) => updateQuery({ port: Number(e.target.value) })} /></Field>
          <Field label={t('wizard.query.protocol')}>
            <select className="input" value={q.protocol} onChange={(e) => { const protocol = e.target.value as 'raw' | 'ssh'; updateQuery({ protocol, port: protocol === 'ssh' ? (q.port === 10011 ? 10022 : q.port) : (q.port === 10022 ? 10011 : q.port) }); }}>
              <option value="raw">raw (10011)</option>
              <option value="ssh">ssh (10022)</option>
            </select>
          </Field>
        </div>
        <Field label={t('wizard.query.username')}><input className="input font-mono" value={q.username} onChange={(e) => updateQuery({ username: e.target.value })} spellCheck={false} autoComplete="off" /></Field>
        <Field label={<span>{t('wizard.query.password')}<SourceBadge source={mode === 'settings' ? src['ts3.query.password'] : undefined} /></span>} hint={q.password === '***' ? t('wizard.query.passwordKept') : undefined}>
          <div className="relative">
            <input className="input pr-10 font-mono" type={showPw ? 'text' : 'password'} value={q.password} onChange={(e) => updateQuery({ password: e.target.value })} autoComplete="new-password" />
            <button type="button" className="absolute right-2 top-2 text-slate-500 hover:text-slate-300" onClick={() => setShowPw(!showPw)} aria-label={t('wizard.query.togglePassword')}>{showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          </div>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon={Plug} loading={test.isPending} disabled={banWait !== null || !q.password} onClick={() => test.mutate()}>{t('wizard.query.test')}</Button>
        {banWait !== null && <span className="text-sm text-amber-300">{t('wizard.query.banned', { seconds: banWait })}</span>}
        {test.error && banWait === null && <span className="text-sm text-rose-300">{errorMessage(test.error)}</span>}
        {result?.ok && <Badge tone="green" dot>{t('wizard.query.ok')}{result.version ? ` · TeamSpeak ${result.version.version}` : ''}</Badge>}
      </div>

      {err && (
        <Note tone={err.code === 'badCredentials' ? 'warn' : 'error'}>
          <p className="font-medium">{t(`wizard.query.err.${err.code}`)}</p>
          <p className="font-mono text-xs opacity-80">{err.message}</p>
          {err.code === 'refused' && <p className="text-xs">{t('wizard.query.refusedHint')}</p>}
          {err.code === 'badCredentials' && (
            <div className="mt-2 space-y-3">
              <p className="text-xs">{t('wizard.query.badCredentialsHelp')}</p>
              <div className="flex flex-wrap gap-2">
                {draft.ts3.dir && <Button size="sm" icon={ScrollText} loading={findPw.isPending} onClick={() => findPw.mutate()}>{t('wizard.query.searchLog')}</Button>}
                {canReset && <Button size="sm" variant="warning" icon={RotateCcw} onClick={() => setResetOpen(true)}>{t('wizard.query.resetButton')}</Button>}
              </div>
              {logSearch && (logSearch.found ? (
                <p className="text-xs">{t('wizard.query.logFound')} <Code>{logSearch.loginname}</Code> / <Code>{logSearch.password}</Code> <button type="button" className="ml-2 underline" onClick={() => updateQuery({ username: logSearch.loginname!, password: logSearch.password! })}>{t('wizard.query.useIt')}</button></p>
              ) : <p className="text-xs">{t('wizard.query.logNotFound', { count: logSearch.searched ?? 0 })}</p>)}
              {!canReset && (
                <div className="text-xs">
                  <p className="mb-1">{t('wizard.query.manualReset')}</p>
                  <Pre>{`cd ${draft.ts3.dir || '/path/to/teamspeak3-server'}\n./ts3server_startscript.sh stop\n./ts3server_startscript.sh start ${draft.ts3.startArgs || 'inifile=ts3server.ini'} serveradmin_password=NEUES_PASSWORT\n# ${t('wizard.query.manualResetRestart')}\n./ts3server_startscript.sh restart`}</Pre>
                </div>
              )}
            </div>
          )}
        </Note>
      )}

      {job && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <div className="mb-2 flex items-center gap-2 font-medium text-slate-100">
            {!job.done && <Spinner className="h-4 w-4 text-indigo-400" />}
            {t('wizard.query.resetTitle')}
            {job.done && (job.ok ? <Badge tone="green">{t('wizard.query.resetOk')}</Badge> : <Badge tone="red">{t('wizard.query.resetFailed')}</Badge>)}
          </div>
          <ol className="space-y-1 text-xs">
            {job.steps.map((s, i) => <li key={i} className={clsx('flex gap-2', s.key === 'failed' ? 'text-rose-300' : 'text-slate-300')}><span className="text-slate-500">{s.ts.slice(11, 19)}</span><span>{td(`wizard.reset.step.${s.key}`, undefined, s.key)}{s.detail ? <span className="text-slate-500"> · {s.detail}</span> : null}</span></li>)}
          </ol>
        </div>
      )}

      {result?.ok && result.servers && (
        <Field label={t('wizard.query.virtualServer')} hint={t('wizard.query.virtualServerHint')}>
          {result.servers.length === 0 ? <Note tone="warn">{t('wizard.query.noServers')}</Note> : (
            <ul className="space-y-2">
              {result.servers.map((s) => {
                const selected = q.serverId ? String(q.serverId) === s.id : Number(q.serverPort) === s.port;
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => updateQuery({ serverId: 0, serverPort: s.port })} className={clsx('flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left transition', selected ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600')}>
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-100">{s.name || `Server #${s.id}`}</span><span className="block text-xs text-slate-500">ID {s.id} · Port {s.port} · {s.clientsOnline}/{s.maxClients}</span></span>
                      <Badge tone={s.status === 'online' ? 'green' : 'slate'}>{s.status}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Field>
      )}

      <ConfirmDialog open={resetOpen} onClose={() => setResetOpen(false)} onConfirm={() => startReset.mutate()} loading={startReset.isPending} title={t('wizard.query.resetTitle')} confirmLabel={t('wizard.query.resetConfirm')} requireText="RESET" tone="warning"
        message={<div className="space-y-2"><p>{t('wizard.query.resetExplain')}</p><ul className="list-disc space-y-1 pl-5 text-xs"><li>{t('wizard.query.resetPoint1')}</li><li>{t('wizard.query.resetPoint2')}</li><li>{t('wizard.query.resetPoint3')}</li></ul>{startReset.error && <p className="text-rose-300">{errorMessage(startReset.error)}</p>}</div>} />
      <p className="text-[11px] text-slate-500"><KeyRound className="mr-1 inline h-3 w-3" />{t('wizard.query.storageNote')}</p>
    </div>
  );
}
