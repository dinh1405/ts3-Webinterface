import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { HardDrive } from 'lucide-react';
import { setupApi, type BackupDirTest } from '../../api/setup';
import { useT } from '../../i18n';
import { formatBytes } from '../../lib/format';
import { Field, KV, Toggle } from '../ui';
import { CheckLine, Note, SourceBadge, type StepProps } from './common';

export function StepStorage({ draft, update, state, mode }: StepProps) {
  const { t } = useT();
  const [check, setCheck] = useState<BackupDirTest | null>(null);
  const timer = useRef<number | null>(null);
  const test = useMutation({ mutationFn: (dir: string) => setupApi.testBackupDir(dir), onSuccess: setCheck, onError: () => setCheck(null) });
  useEffect(() => { test.mutate(draft.backupDir); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  function setDir(v: string) {
    update({ backupDir: v });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => test.mutate(v), 500);
  }
  const src = state.current.source;
  const https = typeof window !== 'undefined' && window.location.protocol === 'https:';
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">{t('wizard.storage.intro')}</p>
      <Field label={<span>{t('wizard.storage.backupDir')}<SourceBadge source={mode === 'settings' ? src.backupDir : undefined} /></span>} hint={t('wizard.storage.backupDirHint')}>
        <div className="relative">
          <HardDrive className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input className="input pl-9 font-mono" value={draft.backupDir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
        </div>
        {check && (
          <ul className="mt-2">
            <CheckLine ok={check.exists} label={t('wizard.storage.dirExists')} detail={check.path} />
            <CheckLine ok={check.writable} label={t('wizard.storage.writable')} />
            {check.disk && <CheckLine ok={check.disk.free > 2 * 1024 ** 3} warn label={t('wizard.storage.free', { free: formatBytes(check.disk.free), total: formatBytes(check.disk.total) })} />}
          </ul>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={<span>{t('wizard.storage.publicUrl')}<SourceBadge source={mode === 'settings' ? src.publicUrl : undefined} /></span>} hint={t('wizard.storage.publicUrlHint')}>
          <input className="input font-mono" value={draft.publicUrl} onChange={(e) => update({ publicUrl: e.target.value })} placeholder="https://ts.example.org" spellCheck={false} />
        </Field>
        <Field label={<span>{t('wizard.storage.mailFrom')}<SourceBadge source={mode === 'settings' ? src.mailFrom : undefined} /></span>} hint={t('wizard.storage.mailFromHint')}>
          <input className="input font-mono" value={draft.mailFrom} onChange={(e) => update({ mailFrom: e.target.value })} placeholder={state.current.mailFrom} spellCheck={false} />
        </Field>
      </div>
      <Toggle checked={draft.trustProxy} onChange={(v) => update({ trustProxy: v })} label={t('wizard.storage.trustProxy')} description={t('wizard.storage.trustProxyHint')} />
      {https && !draft.trustProxy && <Note tone="info">{t('wizard.storage.httpsProxyHint')}</Note>}
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t('wizard.storage.envOnly')}</p>
        <KV items={[
          { k: t('wizard.storage.listen'), v: <span className="font-mono text-xs">{state.current.envOnly.host}:{state.current.envOnly.port}</span> },
          { k: t('wizard.storage.dataDir'), v: <span className="font-mono text-xs">{state.current.envOnly.dataDir}</span> },
          { k: t('wizard.storage.sessionHours'), v: String(state.current.envOnly.sessionHours) },
        ]} />
        <p className="mt-1 text-[11px] text-slate-500">{t('wizard.storage.envOnlyHint')}</p>
      </div>
    </div>
  );
}
