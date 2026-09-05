import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Copy, Download, KeyRound, PackagePlus } from 'lucide-react';
import { setupApi, type InstallInfo, type InstallJob } from '../../api/setup';
import { errorMessage } from '../../api/client';
import { useT } from '../../i18n';
import { Badge, Button, Field, Spinner } from '../ui';
import { CheckLine, Code, Note } from './common';

export interface InstalledServer { dir: string; version: string; queryPort: number; voicePort: number; password: string; startScript: string; pidFile: string; privilegeKey: string | null }

/**
 * „TeamSpeak-Server jetzt installieren“: lädt die aktuelle Version von teamspeak.com, richtet sie im Zielverzeichnis ein,
 * startet sie einmal mit zufälligem serveradmin-Passwort und übergibt Verzeichnis, Zugangsdaten und Privilege-Key an den Entwurf.
 */
export function InstallServer({ platform, defaultOpen, onInstalled }: { platform: string; defaultOpen: boolean; onInstalled: (r: InstalledServer) => void }) {
  const { t, td } = useT();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<InstallInfo | null>(null);
  const [dir, setDir] = useState('');
  const [ports, setPorts] = useState({ voice: 9987, query: 10011, ft: 30033 });
  const [license, setLicense] = useState(false);
  const [job, setJob] = useState<InstallJob | null>(null);
  const [result, setResult] = useState<InstalledServer | null>(null);
  const timer = useRef<number | null>(null);
  const openedOnce = useRef(false);

  const load = useMutation({
    mutationFn: (body: { dir?: string; ports?: Record<string, number> }) => setupApi.installInfo(body),
    onSuccess: (i) => { setInfo(i); if (!dir && i.defaultDir) setDir(i.defaultDir); },
  });
  const start = useMutation({
    mutationFn: () => setupApi.startInstall({ dir, acceptLicense: license, voicePort: ports.voice, queryPort: ports.query, filetransferPort: ports.ft }),
    onSuccess: ({ jobId }) => setJob({ id: jobId, startedAt: '', done: false, ok: null, dir, steps: [], result: null }),
  });

  useEffect(() => { if (defaultOpen && !openedOnce.current) setOpen(true); }, [defaultOpen]);
  // Beim Öffnen: Voraussetzungen und neueste Version laden
  useEffect(() => {
    if (!open || openedOnce.current) return;
    openedOnce.current = true;
    load.mutate({ ports });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // Verzeichnis/Ports verzögert prüfen
  useEffect(() => {
    if (!open || !info) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => load.mutate({ dir: dir || undefined, ports }), 500);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, ports.voice, ports.query, ports.ft]);
  // Job verfolgen
  useEffect(() => {
    if (!job || job.done) return;
    const id = window.setInterval(async () => {
      try {
        const j = await setupApi.installJob(job.id);
        setJob(j);
        if (j.done && j.ok && j.result?.passwordAvailable) {
          const { password } = await setupApi.takeInstallPassword(j.id);
          const r: InstalledServer = { dir: j.result.dir, version: j.result.version, queryPort: j.result.queryPort, voicePort: j.result.voicePort, password, startScript: j.result.startScript, pidFile: j.result.pidFile, privilegeKey: j.result.privilegeKey };
          setResult(r);
          onInstalled(r);
          toast.success(t('wizard.setupInstall.applied'));
        }
      } catch { /* weiter pollen */ }
    }, 2000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.done]);

  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t('wizard.setupInstall.copied')); } catch { toast.error(t('users.copyFailed')); } };
  const dirStatus = info?.dir;
  const portsInUse = Object.entries(info?.ports ?? {}).filter(([, used]) => used).map(([k]) => k);
  const canStart = Boolean(info?.canInstall && info.latest && license && dir.startsWith('/') && dirStatus?.ok && !info.running && !(job && !job.done));

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-slate-100">
        {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
        <PackagePlus className="h-4 w-4 text-indigo-400" />
        {t('wizard.setupInstall.toggle')}
        {platform !== 'linux' && <Badge tone="slate" className="ml-2">{t('wizard.setupInstall.linuxOnly')}</Badge>}
        {info?.latest && <Badge tone="indigo" className="ml-auto">TeamSpeak {info.latest.version}</Badge>}
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-800 px-4 py-4">
          <p className="text-sm text-slate-400">{t('wizard.setupInstall.intro')}</p>
          {load.isPending && !info && <div className="flex items-center gap-2 text-sm text-slate-400"><Spinner className="h-4 w-4" /> {t('common.loading')}</div>}
          {load.error && !info && <Note tone="error">{errorMessage(load.error)}</Note>}
          {info && !info.canInstall && (
            <Note tone="warn">
              <p className="font-medium">{t('wizard.setupInstall.notPossible')}</p>
              <ul className="list-disc pl-5 text-xs">{info.reasons.map((r) => <li key={r}>{t(`wizard.setupInstall.reason.${r}`)}</li>)}</ul>
            </Note>
          )}
          {info?.canInstall && info.latestError && <Note tone="error">{t('wizard.setupInstall.latestError')} <span className="font-mono text-xs">{info.latestError}</span></Note>}
          {info?.canInstall && info.isRoot && <Note tone="warn">{t('wizard.setupInstall.rootWarning')}</Note>}

          {info?.canInstall && !result && (
            <>
              <Field label={t('wizard.setupInstall.dir')} hint={t('wizard.setupInstall.dirHint', { user: info.me.name ?? '?' })}>
                <input className="input font-mono" value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} disabled={Boolean(job && !job.done)} />
              </Field>
              {dirStatus && (
                <ul className="-mt-2">
                  <CheckLine ok={dirStatus.ok} label={dirStatus.ok ? (dirStatus.exists ? t('wizard.setupInstall.dirEmptyOk') : t('wizard.setupInstall.dirWillBeCreated')) : td(`wizard.setupInstall.dirReason.${dirStatus.reason}`, { parent: dirStatus.parent ?? '' }, dirStatus.reason ?? '')} detail={dirStatus.path} />
                </ul>
              )}
              <div className="grid grid-cols-3 gap-3">
                <Field label={t('wizard.setupInstall.voicePort')}><input className="input font-mono" type="number" min={1} max={65535} value={ports.voice} onChange={(e) => setPorts({ ...ports, voice: Number(e.target.value) })} /></Field>
                <Field label={t('wizard.setupInstall.queryPort')}><input className="input font-mono" type="number" min={1} max={65535} value={ports.query} onChange={(e) => setPorts({ ...ports, query: Number(e.target.value) })} /></Field>
                <Field label={t('wizard.setupInstall.ftPort')}><input className="input font-mono" type="number" min={1} max={65535} value={ports.ft} onChange={(e) => setPorts({ ...ports, ft: Number(e.target.value) })} /></Field>
              </div>
              {portsInUse.length > 0 && <Note tone="warn">{t('wizard.setupInstall.portsInUse', { ports: portsInUse.map((k) => `${k} (${ports[k as keyof typeof ports]})`).join(', ') })}</Note>}
              <label className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={license} onChange={(e) => setLicense(e.target.checked)} />
                <span>
                  {t('wizard.setupInstall.license')}{' '}
                  <a className="text-indigo-300 underline" href="https://www.teamspeak.com/en/privacy-and-terms/" target="_blank" rel="noreferrer">{t('wizard.setupInstall.licenseLink')}</a>
                  <span className="block text-xs text-slate-500">{t('wizard.setupInstall.licenseNote')}</span>
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" icon={Download} loading={start.isPending || Boolean(job && !job.done)} disabled={!canStart} onClick={() => start.mutate()}>{t('wizard.setupInstall.start')}</Button>
                {info.latest && <span className="text-xs text-slate-500">{t('wizard.setupInstall.willDownload', { version: info.latest.version })}</span>}
                {start.error && <span className="text-sm text-rose-300">{errorMessage(start.error)}</span>}
              </div>
            </>
          )}

          {job && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm">
              <div className="mb-2 flex items-center gap-2 font-medium text-slate-100">
                {!job.done && <Spinner className="h-4 w-4 text-indigo-400" />}
                {t('wizard.setupInstall.jobTitle')}
                {job.done && (job.ok ? <Badge tone="green">{t('wizard.query.resetOk')}</Badge> : <Badge tone="red">{t('wizard.query.resetFailed')}</Badge>)}
              </div>
              <ol className="space-y-1 text-xs">
                {job.steps.map((s, i) => <li key={i} className={clsx('flex gap-2', s.key === 'failed' ? 'text-rose-300' : s.key === 'privilegeKeyMissing' || s.key === 'noChecksum' ? 'text-amber-300' : 'text-slate-300')}><span className="text-slate-500">{s.ts.slice(11, 19)}</span><span>{td(`wizard.setupInstall.step.${s.key}`, undefined, s.key)}{s.detail ? <span className="break-all text-slate-500"> · {s.detail}</span> : null}</span></li>)}
              </ol>
              {job.done && !job.ok && <Button className="mt-3" size="sm" onClick={() => { setJob(null); load.mutate({ dir, ports }); }}>{t('common.retry')}</Button>}
            </div>
          )}

          {result && (
            <Note tone="success">
              <p className="font-medium">{t('wizard.setupInstall.resultTitle', { version: result.version })}</p>
              <p className="text-xs">{t('wizard.setupInstall.resultText')}</p>
              <ul className="mt-1 text-xs">
                <li>{t('wizard.install.dir')}: <Code>{result.dir}</Code></li>
                <li>ServerQuery: <Code>127.0.0.1:{result.queryPort}</Code> · {t('wizard.setupInstall.voicePort')}: <Code>{result.voicePort}</Code></li>
              </ul>
              <div className="mt-2 rounded-lg border border-emerald-500/30 bg-slate-950/50 p-3 text-slate-100">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium"><KeyRound className="h-3.5 w-3.5" /> {t('wizard.setupInstall.privilegeKey')}</p>
                {result.privilegeKey ? (
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs">{result.privilegeKey}</code>
                    <Button size="sm" icon={Copy} onClick={() => copy(result.privilegeKey!)}>{t('users.copy')}</Button>
                  </div>
                ) : <p className="text-xs text-amber-300">{t('wizard.setupInstall.privilegeKeyMissing', { dir: result.dir })}</p>}
                <p className="mt-1 text-[11px] text-slate-400">{t('wizard.setupInstall.privilegeKeyHint')}</p>
              </div>
            </Note>
          )}
        </div>
      )}
    </div>
  );
}
