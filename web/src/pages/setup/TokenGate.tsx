import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { setupApi, SETUP_TOKEN_KEY } from '../../api/setup';
import { errorMessage } from '../../api/client';
import { useT } from '../../i18n';
import { Button, Field, Spinner } from '../../components/ui';
import { Code, Note } from '../../components/setup/common';
import { AuthShell } from '../Login';

function readToken(): string | null {
  try { return sessionStorage.getItem(SETUP_TOKEN_KEY); } catch { return null; }
}
function storeToken(token: string | null) {
  try { if (token) sessionStorage.setItem(SETUP_TOKEN_KEY, token); else sessionStorage.removeItem(SETUP_TOKEN_KEY); } catch { /* blockiert */ }
}

/** Fragt das Setup-Token ab (aus #token=… oder per Eingabe) und gibt den Assistenten erst danach frei. */
export function TokenGate({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [status, setStatus] = useState<'checking' | 'ask' | 'ok'>('checking');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(token: string): Promise<boolean> {
    try {
      const r = await setupApi.verifyToken(token.trim());
      if (r.ok) { storeToken(token.trim()); setStatus('ok'); return true; }
    } catch (e) {
      setError(errorMessage(e));
    }
    storeToken(null);
    return false;
  }

  useEffect(() => {
    (async () => {
      const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
      if (fromHash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        if (await verify(fromHash)) return;
      }
      const stored = readToken();
      if (stored && (await verify(stored))) return;
      setError(null);
      setStatus('ask');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await verify(input);
    if (!ok && !error) setError(t('wizard.token.invalid'));
    setBusy(false);
  }

  if (status === 'ok') return <>{children}</>;
  if (status === 'checking') return <AuthShell title={t('setup.title')}><div className="flex justify-center py-6"><Spinner className="h-6 w-6 text-indigo-400" /></div></AuthShell>;
  return (
    <AuthShell title={t('setup.title')} subtitle={t('wizard.token.subtitle')}>
      <Note tone="info" className="mb-4">
        <p>{t('wizard.token.where')}</p>
        <p className="text-xs opacity-80">{t('wizard.token.howto')}</p>
        <Code>ts3web setup-token</Code> <span className="text-xs opacity-70">·</span> <Code>journalctl -u ts3-webinterface | grep "setup token"</Code>
      </Note>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t('wizard.token.label')} htmlFor="token">
          <input id="token" className="input font-mono" autoFocus autoComplete="off" spellCheck={false} value={input} onChange={(e) => setInput(e.target.value)} required />
        </Field>
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={busy} icon={KeyRound}>{t('wizard.token.continue')}</Button>
      </form>
      <p className="mt-4 flex items-start gap-2 text-[11px] text-slate-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t('wizard.token.why')}</p>
    </AuthShell>
  );
}
