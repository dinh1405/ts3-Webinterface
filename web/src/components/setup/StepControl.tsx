import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Play, TerminalSquare } from 'lucide-react';
import { setupApi, type ControlMode, type ControlTest } from '../../api/setup';
import { errorMessage } from '../../api/client';
import { useT } from '../../i18n';
import { Badge, Button, Field, Toggle } from '../ui';
import { Code, Note, Pre, SourceBadge, type StepProps } from './common';

const MODES: ControlMode[] = ['script', 'systemd', 'docker', 'custom', 'none'];

export function StepControl({ draft, updateTs3, state, mode, onTested }: StepProps & { onTested?: (r: ControlTest | null) => void }) {
  const { t, td } = useT();
  const [result, setResult] = useState<ControlTest | null>(null);
  const test = useMutation({
    mutationFn: () => setupApi.testControl(draft),
    onSuccess: (r) => { setResult(r); onTested?.(r); },
    onError: () => { setResult(null); onTested?.(null); },
  });
  const cm = draft.ts3.controlMode;
  const src = state.current.source;
  const unitName = draft.ts3.systemdUnit || 'teamspeak3';
  const sudoersLine = cm === 'systemd'
    ? `${state.me.name ?? 'USER'} ALL=(root) NOPASSWD: /usr/bin/systemctl start ${unitName}, /usr/bin/systemctl stop ${unitName}, /usr/bin/systemctl restart ${unitName}`
    : `${state.me.name ?? 'USER'} ALL=(root) NOPASSWD: /usr/bin/docker start ${draft.ts3.dockerContainer || 'teamspeak'}, /usr/bin/docker stop ${draft.ts3.dockerContainer || 'teamspeak'}, /usr/bin/docker restart ${draft.ts3.dockerContainer || 'teamspeak'}`;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">{t('wizard.control.intro')}</p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {MODES.map((m) => (
          <button key={m} type="button" onClick={() => { updateTs3({ controlMode: m }); setResult(null); onTested?.(null); }}
            className={clsx('rounded-lg border px-4 py-3 text-left text-sm transition', cm === m ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-800 bg-slate-900 hover:border-slate-600')}>
            <span className="block font-medium text-slate-100">{t(`wizard.control.mode.${m}`)}</span>
            <span className="block text-xs text-slate-500">{t(`wizard.control.modeHint.${m}`)}</span>
          </button>
        ))}
      </div>
      {mode === 'settings' && <p className="text-xs text-slate-500">{t('wizard.control.current')} <SourceBadge source={src['ts3.controlMode']} /></p>}

      {cm === 'script' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('wizard.control.startScript')} hint={t('wizard.control.startScriptHint')} className="sm:col-span-2">
            <input className="input font-mono" value={draft.ts3.startScript ?? ''} placeholder={draft.ts3.dir ? `${draft.ts3.dir}/ts3server_startscript.sh` : '/opt/…/ts3server_startscript.sh'} onChange={(e) => updateTs3({ startScript: e.target.value || null })} spellCheck={false} />
          </Field>
          <Field label={t('wizard.control.startArgs')} hint={t('wizard.control.startArgsHint')}>
            <input className="input font-mono" value={draft.ts3.startArgs} onChange={(e) => updateTs3({ startArgs: e.target.value })} spellCheck={false} />
          </Field>
          <Field label={t('wizard.control.pidFile')} hint={t('wizard.control.derivedHint')}>
            <input className="input font-mono" value={draft.ts3.pidFile ?? ''} placeholder={draft.ts3.dir ? `${draft.ts3.dir}/ts3server.pid` : ''} onChange={(e) => updateTs3({ pidFile: e.target.value || null })} spellCheck={false} />
          </Field>
        </div>
      )}
      {cm === 'systemd' && (
        <div className="space-y-4">
          <Field label={t('wizard.control.unit')}><input className="input font-mono" value={draft.ts3.systemdUnit} onChange={(e) => updateTs3({ systemdUnit: e.target.value })} spellCheck={false} /></Field>
          <Toggle checked={draft.ts3.useSudo} onChange={(v) => updateTs3({ useSudo: v })} label={t('wizard.control.useSudo')} description={t('wizard.control.useSudoHint')} />
        </div>
      )}
      {cm === 'docker' && (
        <div className="space-y-4">
          <Field label={t('wizard.control.container')}><input className="input font-mono" value={draft.ts3.dockerContainer} onChange={(e) => updateTs3({ dockerContainer: e.target.value })} spellCheck={false} /></Field>
          <Toggle checked={draft.ts3.useSudo} onChange={(v) => updateTs3({ useSudo: v })} label={t('wizard.control.useSudo')} description={t('wizard.control.useSudoHintDocker')} />
        </div>
      )}
      {cm === 'custom' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(['start', 'stop', 'restart', 'status'] as const).map((k) => (
            <Field key={k} label={t(`wizard.control.cmd.${k}`)} hint={k === 'restart' ? t('wizard.control.cmdRestartHint') : k === 'status' ? t('wizard.control.cmdStatusHint') : undefined}>
              <input className="input font-mono" value={draft.ts3.customCmd[k]} onChange={(e) => updateTs3({ customCmd: { ...draft.ts3.customCmd, [k]: e.target.value } })} spellCheck={false} />
            </Field>
          ))}
        </div>
      )}
      {cm === 'none' && <Note tone="info">{t('wizard.control.noneNote')}</Note>}

      {cm !== 'none' && (
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={Play} loading={test.isPending} onClick={() => test.mutate()}>{t('wizard.control.test')}</Button>
          {test.error && <span className="text-sm text-rose-300">{errorMessage(test.error)}</span>}
          {result && (
            <span className="flex items-center gap-2 text-sm">
              {!result.configured ? <Badge tone="red">{t('wizard.control.notConfigured')}</Badge>
                : result.status?.running === true ? <Badge tone="green" dot pulse>{t('wizard.control.statusRunning')}{result.status.pid ? ` · PID ${result.status.pid}` : ''}</Badge>
                  : result.status?.running === false ? <Badge tone="amber">{t('wizard.control.statusStopped')}</Badge>
                    : <Badge tone="slate">{t('wizard.control.statusUnknown')}</Badge>}
              {result.status?.detail && <span className="font-mono text-xs text-slate-500">{result.status.detail}</span>}
            </span>
          )}
        </div>
      )}

      {result?.command && <p className="text-xs text-slate-500"><TerminalSquare className="mr-1 inline h-3.5 w-3.5" />{t('wizard.control.startCommand')}: <Code>{result.command}</Code></p>}

      {result?.hints.map((h) => (
        <Note key={h} tone={h === 'controlDisabled' ? 'info' : 'warn'}>
          <p>{td(`wizard.hint.${h}`, { me: state.me.name ?? '?', owner: result.dirOwner?.name ?? '?' }, h)}</p>
          {(h === 'systemdNeedsSudo' || h === 'dockerNeedsGroupOrSudo' || h === 'sudoNotAllowed') && (
            <>
              <p className="text-xs opacity-80">{t('wizard.hint.sudoersHow')}</p>
              <Pre>{`# /etc/sudoers.d/ts3-webinterface\n${sudoersLine}`}</Pre>
              {h === 'dockerNeedsGroupOrSudo' && <p className="text-xs opacity-80">{t('wizard.hint.dockerGroup')} <Code>usermod -aG docker {state.me.name ?? 'USER'}</Code></p>}
            </>
          )}
          {h === 'scriptNeedsSameUser' && <p className="text-xs opacity-80">{t('wizard.hint.sameUserHow', { owner: result.dirOwner?.name ?? '?' })}</p>}
        </Note>
      ))}
    </div>
  );
}
