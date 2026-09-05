import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { FileCog, FolderOpen, HardDrive, Plug, Power, RotateCcw, Save } from 'lucide-react';
import { draftFromConfig, draftToConfig, setupApi, type ControlTest, type QueryTest, type SetupState } from '../../api/setup';
import { errorMessage } from '../../api/client';
import { useT } from '../../i18n';
import { Button, Card, ErrorBox, FullPageSpinner } from '../ui';
import { Note } from './common';
import { useDraft } from './useDraft';
import { StepInstallation } from './StepInstallation';
import { StepControl } from './StepControl';
import { StepQuery } from './StepQuery';
import { StepStorage } from './StepStorage';
import { SystemCheckPanel } from './SystemCheckPanel';

/** Admin-Seite „Verbindung & Installation“: dieselben Schritte wie im Assistenten, mit Speichern-Leiste. */
export function ConnectionSettings() {
  const { t } = useT();
  const state = useQuery({ queryKey: ['setup', 'state'], queryFn: () => setupApi.state() });
  if (state.isLoading) return <FullPageSpinner />;
  if (state.error || !state.data) return <ErrorBox error={state.error ?? new Error('state')} onRetry={() => state.refetch()} />;
  return (
    <div className="space-y-6">
      <SystemCheckPanel />
      <Editor key={JSON.stringify(state.data.current.source)} state={state.data} />
      <p className="text-xs text-slate-500">{t('wizard.settings.footer')}</p>
    </div>
  );
}

type Section = 'install' | 'control' | 'query' | 'storage';

function Editor({ state }: { state: SetupState }) {
  const { t } = useT();
  const qc = useQueryClient();
  const { draft, update, updateTs3, updateQuery, setDraft } = useDraft(draftFromConfig(state.current));
  const [section, setSection] = useState<Section>('query');
  const [controlTest, setControlTest] = useState<ControlTest | null>(null);
  const [queryTest, setQueryTest] = useState<QueryTest | null>(null);
  const initial = JSON.stringify(draftToConfig(draftFromConfig(state.current)));
  const dirty = JSON.stringify(draftToConfig(draft)) !== initial;

  // Beim Verlassen: Manager läuft wieder (Tests pausieren ihn)
  useEffect(() => () => { setupApi.resume().catch(() => {}); }, []);

  const save = useMutation({
    mutationFn: () => setupApi.saveConfig({ config: draftToConfig(draft) }),
    onSuccess: (r) => { toast.success(t('wizard.settings.saved', { count: r.changed.length })); qc.invalidateQueries({ queryKey: ['setup'] }); qc.invalidateQueries({ queryKey: ['status'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const migrate = useMutation({
    mutationFn: () => setupApi.migrateEnv(),
    onSuccess: () => { toast.success(t('wizard.settings.migrated')); qc.invalidateQueries({ queryKey: ['setup'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const envValues = Object.values(state.current.source).filter((s) => s === 'env').length;
  const sections: { key: Section; label: string; icon: typeof Plug }[] = [
    { key: 'query', label: t('wizard.query.title'), icon: Plug },
    { key: 'install', label: t('wizard.install.title'), icon: FolderOpen },
    { key: 'control', label: t('wizard.control.title'), icon: Power },
    { key: 'storage', label: t('wizard.storage.title'), icon: HardDrive },
  ];
  const queryChanged = JSON.stringify(draft.ts3.query) !== JSON.stringify(draftFromConfig(state.current).ts3.query);

  return (
    <Card title={t('wizard.settings.title')} subtitle={t('wizard.settings.subtitle')} noPadding
      actions={envValues > 0 && <Button size="sm" variant="ghost" icon={FileCog} loading={migrate.isPending} onClick={() => migrate.mutate()} title={t('wizard.settings.migrateHint')}>{t('wizard.settings.migrate', { count: envValues })}</Button>}>
      <div className="flex flex-wrap gap-1 border-b border-slate-800 px-4 py-2">
        {sections.map((s) => (
          <button key={s.key} type="button" onClick={() => setSection(s.key)} className={clsx('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition', section === s.key ? 'bg-indigo-500/15 text-indigo-200' : 'text-slate-400 hover:text-slate-100')}><s.icon className="h-3.5 w-3.5" />{s.label}</button>
        ))}
      </div>
      <div className="p-5">
        {section === 'install' && <StepInstallation draft={draft} update={update} updateTs3={updateTs3} updateQuery={updateQuery} state={state} mode="settings" />}
        {section === 'control' && <StepControl draft={draft} update={update} updateTs3={updateTs3} updateQuery={updateQuery} state={state} mode="settings" onTested={setControlTest} />}
        {section === 'query' && <StepQuery draft={draft} update={update} updateTs3={updateTs3} updateQuery={updateQuery} state={state} mode="settings" controlOk={draft.ts3.controlMode === 'none' || Boolean(controlTest?.configured)} onTested={setQueryTest} />}
        {section === 'storage' && <StepStorage draft={draft} update={update} updateTs3={updateTs3} updateQuery={updateQuery} state={state} mode="settings" />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-5 py-3">
        <span className="text-xs text-slate-500">{dirty ? t('wizard.settings.unsaved') : t('wizard.settings.allSaved')}</span>
        <div className="flex items-center gap-2">
          {dirty && queryChanged && !queryTest?.ok && <Note tone="warn" className="py-1 text-xs">{t('wizard.settings.queryUntested')}</Note>}
          <Button variant="ghost" icon={RotateCcw} disabled={!dirty || save.isPending} onClick={() => setDraft(draftFromConfig(state.current))}>{t('common.discard')}</Button>
          <Button variant="primary" icon={Save} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
        </div>
      </div>
    </Card>
  );
}
