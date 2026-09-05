import type { ReactNode } from 'react';
import type { Draft } from '../../api/setup';
import { useT, type Locale } from '../../i18n';
import { KV } from '../ui';
import { Note } from './common';

export function StepSummary({ draft, language, timezone, adminName, warnings, error }: { draft: Draft; language: Locale; timezone: string; adminName?: string; warnings: ReactNode[]; error?: string | null }) {
  const { t } = useT();
  const q = draft.ts3.query;
  const cm = draft.ts3.controlMode;
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">{t('wizard.summary.intro')}</p>
      <KV items={[
        { k: t('wizard.language.system'), v: t(`lang.${language}`) },
        { k: t('wizard.language.timezone'), v: timezone },
        { k: t('wizard.install.dir'), v: <span className="font-mono text-xs">{draft.ts3.dir || '–'}</span> },
        { k: t('wizard.control.title'), v: t(`wizard.control.mode.${cm}`) + (cm === 'systemd' ? ` · ${draft.ts3.systemdUnit}` : cm === 'docker' ? ` · ${draft.ts3.dockerContainer}` : '') },
        { k: t('wizard.query.title'), v: <span className="font-mono text-xs">{q.username}@{q.host}:{q.port} ({q.protocol})</span> },
        { k: t('wizard.query.virtualServer'), v: q.serverId ? `ID ${q.serverId}` : `Port ${q.serverPort}` },
        { k: t('wizard.storage.backupDir'), v: <span className="font-mono text-xs">{draft.backupDir}</span> },
        { k: t('wizard.storage.publicUrl'), v: <span className="font-mono text-xs">{draft.publicUrl || '–'}</span> },
        { k: t('wizard.storage.trustProxy'), v: draft.trustProxy ? t('common.yes') : t('common.no') },
        ...(adminName ? [{ k: t('wizard.admin.title'), v: adminName }] : []),
      ]} />
      {warnings.length > 0 && <Note tone="warn"><ul className="list-disc space-y-1 pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Note>}
      {error && <Note tone="error">{error}</Note>}
      <p className="text-xs text-slate-500">{t('wizard.summary.storageNote')}</p>
    </div>
  );
}
