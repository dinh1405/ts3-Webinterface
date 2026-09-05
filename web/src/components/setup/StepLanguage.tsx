import { useMemo } from 'react';
import { Globe, Languages } from 'lucide-react';
import { LOCALES, setLocale, useT, type Locale } from '../../i18n';
import { Field } from '../ui';

export function timezoneOptions(): string[] {
  try {
    // Intl.supportedValuesOf gibt es seit ES2022; Fallback: kleine Liste
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (list?.length) return list;
  } catch { /* Fallback */ }
  return ['UTC', 'Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles'];
}

export function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function StepLanguage({ language, timezone, onChange }: { language: Locale; timezone: string; onChange: (v: { language?: Locale; timezone?: string }) => void }) {
  const { t } = useT();
  const zones = useMemo(timezoneOptions, []);
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">{t('wizard.language.intro')}</p>
      <Field label={<span className="flex items-center gap-1.5"><Languages className="h-3.5 w-3.5" /> {t('wizard.language.system')}</span>} hint={t('wizard.language.systemHint')}>
        <div className="grid grid-cols-2 gap-2">
          {LOCALES.map((l) => (
            <button key={l} type="button" onClick={() => { setLocale(l); onChange({ language: l }); }}
              className={`rounded-lg border px-4 py-3 text-left text-sm transition ${language === l ? 'border-indigo-400 bg-indigo-500/10 text-slate-50' : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600'}`}>
              <span className="block font-medium">{t(`lang.${l}`)}</span>
              <span className="block text-xs text-slate-500">{l === 'de' ? 'Deutsch' : 'English'}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label={<span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> {t('wizard.language.timezone')}</span>} hint={t('wizard.language.timezoneHint')}>
        <select className="input" value={timezone} onChange={(e) => onChange({ timezone: e.target.value })}>
          {!zones.includes(timezone) && <option value={timezone}>{timezone}</option>}
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </Field>
    </div>
  );
}
