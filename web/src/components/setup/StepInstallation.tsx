import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { FolderSearch, Search } from 'lucide-react';
import { setupApi, type Candidate, type Detection, type DirInspection } from '../../api/setup';
import { errorMessage } from '../../api/client';
import { useT } from '../../i18n';
import { Badge, Button, Field, Spinner } from '../ui';
import { CheckLine, Note, SourceBadge, type StepProps } from './common';
import { InstallServer } from './InstallServer';

export function StepInstallation({ draft, updateTs3, updateQuery, state, mode, onInspected }: StepProps & { onInspected?: (r: DirInspection | null) => void }) {
  const { t, td } = useT();
  const [detection, setDetection] = useState<Detection | null>(null);
  const [inspection, setInspection] = useState<DirInspection | null>(null);
  const [dirInput, setDirInput] = useState(draft.ts3.dir);
  const timer = useRef<number | null>(null);

  const detect = useMutation({
    mutationFn: () => setupApi.detect(),
    onSuccess: (d) => {
      setDetection(d);
      // Ohne Auswahl: besten Kandidaten vorschlagen
      if (!draft.ts3.dir && d.candidates.length) choose(d.candidates[0]);
    },
  });
  const inspect = useMutation({
    mutationFn: (dir: string) => setupApi.inspectDir(dir),
    onSuccess: (r) => { setInspection(r); onInspected?.(r); },
    onError: () => { setInspection(null); onInspected?.(null); },
  });

  // Beim ersten Anzeigen im Assistenten automatisch erkennen
  useEffect(() => {
    if (mode === 'wizard' && !detection && !detect.isPending) detect.mutate();
    if (draft.ts3.dir) inspect.mutate(draft.ts3.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyDir(dir: string) {
    setDirInput(dir);
    updateTs3({ dir });
    if (timer.current) window.clearTimeout(timer.current);
    if (!dir.startsWith('/')) { setInspection(null); onInspected?.(null); return; }
    timer.current = window.setTimeout(() => inspect.mutate(dir), 400);
  }

  function choose(c: Candidate) {
    applyDir(c.dir);
    // Empfohlenen Steuerungsmodus aus der Erkennung ableiten
    if (c.unit) updateTs3({ controlMode: 'systemd', systemdUnit: c.unit.replace(/\.service$/, '') });
    else if (c.container) updateTs3({ controlMode: 'docker', dockerContainer: c.container });
    else updateTs3({ controlMode: 'script' });
    if (c.args?.inifile || c.args) {
      const args = Object.entries(c.args || {}).filter(([k]) => k !== 'serveradmin_password').map(([k, v]) => `${k}=${v}`).join(' ');
      if (args) updateTs3({ startArgs: args });
    }
  }

  // Vorschläge aus der ini übernehmen, sobald das Verzeichnis geprüft wurde
  useEffect(() => {
    if (!inspection?.valid || !inspection.suggested) return;
    const s = inspection.suggested;
    const q = draft.ts3.query;
    const patch: Partial<typeof q> = {};
    if (mode === 'wizard' || !state.current.ts3.query.passwordSet) {
      if (q.port !== s.queryPort) patch.port = s.queryPort;
      if (q.host === '127.0.0.1' && s.queryHost !== '127.0.0.1') patch.host = s.queryHost;
      if (q.serverPort !== s.serverPort && !q.serverId) patch.serverPort = s.serverPort;
    }
    if (Object.keys(patch).length) updateQuery(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspection]);

  const src = state.current.source;
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">{t('wizard.install.intro')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Search} loading={detect.isPending} onClick={() => detect.mutate()}>{t('wizard.install.detect')}</Button>
        {detection && <span className="text-xs text-slate-500">{t('wizard.install.found', { count: detection.candidates.length })}</span>}
        {detect.error && <span className="text-xs text-rose-300">{errorMessage(detect.error)}</span>}
      </div>

      {detection && detection.platform !== 'linux' && <Note tone="warn">{t('wizard.install.notLinux')}</Note>}
      {detection && detection.docker.error && <Note tone="info">{t('wizard.install.dockerNoAccess')} <span className="font-mono text-xs">{detection.docker.error}</span></Note>}

      {detection && detection.candidates.length > 0 && (
        <ul className="space-y-2">
          {detection.candidates.map((c) => (
            <li key={c.dir}>
              <button type="button" onClick={() => choose(c)} className={clsx('w-full rounded-lg border px-4 py-3 text-left transition', draft.ts3.dir === c.dir ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-slate-100">{c.dir}</span>
                  {c.running && <Badge tone="green" dot pulse>{t('wizard.install.running')}</Badge>}
                  {c.unit && <Badge tone="blue">systemd · {c.unit}</Badge>}
                  {c.container && <Badge tone="purple">docker · {c.container}</Badge>}
                  {c.sources.includes('scan') && !c.running && <Badge tone="slate">{t('wizard.install.foundByScan')}</Badge>}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {c.owner && <>{t('wizard.install.owner')}: <span className="text-slate-300">{c.owner.name}</span>{' · '}</>}
                  {c.user && c.user !== c.owner?.name && <>{t('wizard.install.runsAs')}: <span className="text-slate-300">{c.user}</span>{' · '}</>}
                  {c.sameUser === true && <span className="text-emerald-300">{t('wizard.install.sameUser')}</span>}
                  {c.sameUser === false && <span className="text-amber-300">{t('wizard.install.otherUser', { me: detection.me.name ?? '?' })}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {detection && detection.candidates.length === 0 && detection.platform === 'linux' && <Note tone="warn">{t('wizard.install.none')}</Note>}

      <InstallServer
        platform={state.platform}
        defaultOpen={Boolean(detection && detection.candidates.length === 0 && detection.platform === 'linux')}
        onInstalled={(r) => {
          updateTs3({ dir: r.dir, controlMode: 'script', startScript: r.startScript, pidFile: r.pidFile, startArgs: 'inifile=ts3server.ini', useSudo: false });
          updateQuery({ host: '127.0.0.1', port: r.queryPort, protocol: 'raw', username: 'serveradmin', password: r.password, serverPort: r.voicePort, serverId: 0 });
          applyDir(r.dir);
        }}
      />

      <Field label={<span>{t('wizard.install.dir')}<SourceBadge source={mode === 'settings' ? src['ts3.dir'] : undefined} /></span>} hint={t('wizard.install.dirHint')}>
        <div className="relative">
          <FolderSearch className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input className="input pl-9 font-mono" placeholder="/opt/teamspeak3-server_linux_amd64" value={dirInput} onChange={(e) => applyDir(e.target.value)} spellCheck={false} />
          {inspect.isPending && <Spinner className="absolute right-3 top-2.5 h-4 w-4 text-indigo-400" />}
        </div>
      </Field>

      {inspection && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-100">{t('wizard.install.checkTitle')}</span>
            {inspection.valid ? <Badge tone="green">{t('wizard.install.valid')}</Badge> : <Badge tone="red">{t('wizard.install.invalid')}</Badge>}
            {inspection.version && <Badge tone="indigo">TeamSpeak {inspection.version}</Badge>}
            {inspection.running && <Badge tone="green" dot pulse>{t('wizard.install.running')}{inspection.pid ? ` · PID ${inspection.pid}` : ''}</Badge>}
          </div>
          {!inspection.exists ? <p className="text-sm text-rose-300">{t('wizard.install.dirMissing')}</p> : (
            <ul>
              {inspection.checks.map((c) => <CheckLine key={c.key} ok={c.ok} warn={!c.required} label={td(`wizard.check.${c.key}`, undefined, c.key)} detail={c.detail} />)}
              {inspection.owner && <CheckLine ok={inspection.sameUser !== false} warn label={inspection.sameUser === false ? t('wizard.install.ownerMismatch', { owner: inspection.owner.name, me: state.me.name ?? '?' }) : t('wizard.install.ownerOk', { owner: inspection.owner.name })} />}
            </ul>
          )}
          {inspection.ini?.exists && !inspection.ini.skipBruteforceCheck && <Note tone="info" className="mt-3">{t('wizard.install.bruteforceHint')}</Note>}
        </div>
      )}
    </div>
  );
}
