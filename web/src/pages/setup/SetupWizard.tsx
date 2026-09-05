import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, Check, Headphones, Rocket } from 'lucide-react';
import { draftFromConfig, draftToConfig, setupApi, SETUP_TOKEN_KEY, type ControlTest, type DirInspection, type QueryTest, type SetupState } from '../../api/setup';
import { errorMessage } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { getLocale, setLocale, useT, type Locale } from '../../i18n';
import { Button, FullPageSpinner, ErrorBox } from '../../components/ui';
import { useDraft } from '../../components/setup/useDraft';
import { StepLanguage, browserTimezone } from '../../components/setup/StepLanguage';
import { StepInstallation } from '../../components/setup/StepInstallation';
import { StepControl } from '../../components/setup/StepControl';
import { StepQuery } from '../../components/setup/StepQuery';
import { StepStorage } from '../../components/setup/StepStorage';
import { StepAdmin, adminValid, type AdminDraft } from '../../components/setup/StepAdmin';
import { StepSummary } from '../../components/setup/StepSummary';
import { TokenGate } from './TokenGate';
import { AuthShell } from '../Login';

type StepKey = 'language' | 'install' | 'control' | 'query' | 'storage' | 'admin' | 'summary';

export default function SetupWizardPage() {
  const { needsSetup, loading, refresh } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  if (loading) return <FullPageSpinner />;
  if (!needsSetup) {
    return (
      <AuthShell title={t('setup.title')}>
        <p className="text-sm text-slate-300">{t('setup.done')}</p>
        <Button className="mt-4 w-full" variant="primary" onClick={() => navigate('/login')}>{t('auth.toLogin')}</Button>
      </AuthShell>
    );
  }
  return <TokenGate><Wizard onDone={async () => { await refresh(); navigate('/', { replace: true }); }} /></TokenGate>;
}

function Wizard({ onDone }: { onDone: () => Promise<void> }) {
  const state = useQuery({ queryKey: ['setup', 'state'], queryFn: () => setupApi.state(), retry: false });
  if (state.isLoading) return <FullPageSpinner />;
  if (state.error || !state.data) return <div className="mx-auto max-w-xl p-8"><ErrorBox error={state.error ?? new Error('state')} onRetry={() => state.refetch()} /></div>;
  return <WizardBody state={state.data} onDone={onDone} />;
}

function WizardBody({ state, onDone }: { state: SetupState; onDone: () => Promise<void> }) {
  const { t } = useT();
  const { draft, update, updateTs3, updateQuery } = useDraft(draftFromConfig(state.current));
  const [language, setLanguage] = useState<Locale>(getLocale());
  const [timezone, setTimezone] = useState(state.timezone || browserTimezone());
  const [admin, setAdmin] = useState<AdminDraft>({ username: 'admin', displayName: '', password: '', confirm: '' });
  const [inspection, setInspection] = useState<DirInspection | null>(null);
  const [controlTest, setControlTest] = useState<ControlTest | null>(null);
  const [queryTest, setQueryTest] = useState<QueryTest | null>(null);
  const [idx, setIdx] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => { setLocale(language); }, [language]);
  // Beim Verlassen ohne Abschluss: ServerQuery-Manager wieder aktivieren
  useEffect(() => () => { setupApi.resume().catch(() => {}); }, []);

  const steps = useMemo<{ key: StepKey; label: string }[]>(() => [
    { key: 'language', label: t('wizard.step.language') },
    { key: 'install', label: t('wizard.step.install') },
    { key: 'control', label: t('wizard.step.control') },
    { key: 'query', label: t('wizard.step.query') },
    { key: 'storage', label: t('wizard.step.storage') },
    ...(state.hasUsers ? [] : [{ key: 'admin' as StepKey, label: t('wizard.step.admin') }]),
    { key: 'summary', label: t('wizard.step.summary') },
  ], [state.hasUsers, t]);
  const step = steps[idx].key;

  const controlOk = draft.ts3.controlMode === 'none' || Boolean(controlTest?.configured);
  const canNext = (): boolean => {
    switch (step) {
      case 'install': return draft.ts3.controlMode === 'none' || Boolean(draft.ts3.dir && (inspection?.valid ?? true));
      case 'query': return Boolean(draft.ts3.query.password) && (queryTest?.ok ?? false);
      case 'admin': return adminValid(admin);
      default: return true;
    }
  };
  const skipHint = (): string | null => {
    if (step === 'install' && draft.ts3.dir && inspection && !inspection.valid) return t('wizard.nav.dirInvalid');
    if (step === 'query' && !queryTest?.ok) return t('wizard.nav.testFirst');
    if (step === 'admin' && !adminValid(admin)) return t('wizard.nav.adminIncomplete');
    return null;
  };

  const warnings: ReactNode[] = [];
  if (inspection && inspection.sameUser === false && draft.ts3.controlMode === 'script') warnings.push(t('wizard.hint.scriptNeedsSameUser', { me: state.me.name ?? '?', owner: inspection.owner?.name ?? '?' }));
  if (draft.ts3.controlMode !== 'none' && controlTest && !controlTest.configured) warnings.push(t('wizard.control.notConfigured'));
  if (draft.ts3.controlMode !== 'none' && !controlTest) warnings.push(t('wizard.summary.controlUntested'));
  if (inspection?.ini?.exists && inspection.ini.skipBruteforceCheck === false) warnings.push(t('wizard.install.bruteforceHint'));

  async function apply() {
    setApplying(true);
    setApplyError(null);
    try {
      await setupApi.apply({ language, timezone, config: draftToConfig(draft), admin: state.hasUsers ? undefined : { username: admin.username.trim(), password: admin.password, displayName: admin.displayName.trim() || undefined } });
      try { sessionStorage.removeItem(SETUP_TOKEN_KEY); } catch { /* ignore */ }
      await onDone();
    } catch (e) {
      setApplyError(errorMessage(e));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="min-h-full px-4 py-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-white"><Headphones className="h-5 w-5" /></div>
          <div>
            <h1 className="text-lg font-semibold text-slate-50">{t('layout.appName')} · {t('setup.title')}</h1>
            <p className="text-xs text-slate-400">{t('wizard.intro')}</p>
          </div>
          <span className="ml-auto text-xs text-slate-500">v{state.version}</span>
        </div>

        <ol className="mb-6 flex flex-wrap gap-1">
          {steps.map((s, i) => (
            <li key={s.key}>
              <button type="button" disabled={i > idx} onClick={() => setIdx(i)} className={clsx('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition', i === idx ? 'bg-indigo-500/15 text-indigo-200' : i < idx ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600')}>
                <span className={clsx('flex h-4 w-4 items-center justify-center rounded-full text-[10px]', i < idx ? 'bg-emerald-500/20 text-emerald-300' : i === idx ? 'bg-indigo-500 text-white' : 'bg-slate-800')}>{i < idx ? <Check className="h-3 w-3" /> : i + 1}</span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>

        <div className="card p-6">
          <h2 className="mb-4 text-base font-semibold text-slate-50">{steps[idx].label}</h2>
          {step === 'language' && <StepLanguage language={language} timezone={timezone} onChange={(v) => { if (v.language) setLanguage(v.language); if (v.timezone) setTimezone(v.timezone); }} />}
          {step === 'install' && <StepInstallation draft={draft} update={update} updateTs3={updateTs3} updateQuery={updateQuery} state={state} mode="wizard" onInspected={setInspection} />}
          {step === 'control' && <StepControl draft={draft} update={update} updateTs3={updateTs3} updateQuery={updateQuery} state={state} mode="wizard" onTested={setControlTest} />}
          {step === 'query' && <StepQuery draft={draft} update={update} updateTs3={updateTs3} updateQuery={updateQuery} state={state} mode="wizard" controlOk={controlOk} onTested={setQueryTest} />}
          {step === 'storage' && <StepStorage draft={draft} update={update} updateTs3={updateTs3} updateQuery={updateQuery} state={state} mode="wizard" />}
          {step === 'admin' && <StepAdmin admin={admin} onChange={setAdmin} />}
          {step === 'summary' && <StepSummary draft={draft} language={language} timezone={timezone} adminName={state.hasUsers ? undefined : admin.username} warnings={warnings} error={applyError} />}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <Button variant="ghost" icon={ArrowLeft} disabled={idx === 0 || applying} onClick={() => setIdx(idx - 1)}>{t('common.back')}</Button>
          <div className="flex items-center gap-3">
            {skipHint() && <span className="text-xs text-slate-500">{skipHint()}</span>}
            {step === 'summary'
              ? <Button variant="primary" icon={Rocket} loading={applying} onClick={apply}>{t('wizard.nav.apply')}</Button>
              : <Button variant="primary" icon={ArrowRight} disabled={!canNext()} onClick={() => setIdx(idx + 1)}>{t('common.next')}</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
