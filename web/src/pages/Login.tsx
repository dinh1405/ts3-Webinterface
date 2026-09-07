import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import { ArrowLeft, Headphones, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../api/client';
import { useT } from '../i18n';
import { Button, Field } from '../components/ui';

export default function LoginPage() {
  const { login, loginMfa } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null); // zweiter Schritt aktiv
  const [code, setCode] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(username.trim(), password);
      if (res.mfaRequired && res.ticket) { setTicket(res.ticket); setCode(''); return; }
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitMfa(e: FormEvent) {
    e.preventDefault();
    if (!ticket) return;
    setError(null);
    setLoading(true);
    try {
      const res = await loginMfa(ticket, code.trim());
      if (res.mfa === 'recovery') toast.warning(t('auth.mfaRecoveryUsed', { count: res.recoveryCodesLeft ?? 0 }));
      navigate('/', { replace: true });
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg);
      // Ticket abgelaufen → zurück zu Schritt 1
      if ((err as { data?: { key?: string } })?.data?.key === 'auth.mfaTicketExpired') { setTicket(null); setPassword(''); }
    } finally {
      setLoading(false);
    }
  }

  if (ticket) {
    return (
      <AuthShell title={t('auth.mfaTitle')} subtitle={t('auth.mfaSubtitle')}>
        <form onSubmit={onSubmitMfa} className="space-y-4">
          <Field label={t('auth.mfaCode')} htmlFor="mfa-code">
            <input id="mfa-code" className="input font-mono text-lg tracking-[0.25em]" autoComplete="one-time-code" inputMode="text" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required maxLength={20} />
          </Field>
          {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" loading={loading} icon={ShieldCheck}>{t('auth.mfaVerify')}</Button>
          <button type="button" className="flex w-full items-center justify-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={() => { setTicket(null); setError(null); }}><ArrowLeft className="h-3 w-3" /> {t('auth.mfaBack')}</button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.signInTitle')} subtitle={t('auth.signInSubtitle')}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t('auth.username')} htmlFor="username">
          <input id="username" className="input" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label={t('auth.password')} htmlFor="password">
          <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={loading} icon={LogIn}>{t('auth.signIn')}</Button>
      </form>
    </AuthShell>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500 text-white"><Headphones className="h-6 w-6" /></div>
          <h1 className="text-xl font-semibold text-slate-50">{t('layout.appName')}</h1>
          <p className="text-sm text-slate-400">{title}</p>
        </div>
        <div className="card p-6">
          {subtitle && <p className="mb-4 text-sm text-slate-400">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
