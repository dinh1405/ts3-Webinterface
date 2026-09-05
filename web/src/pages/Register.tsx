import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../lib/auth';
import { useT } from '../i18n';
import { Badge, Button, Field, Spinner } from '../components/ui';
import { AuthShell } from './Login';

export default function RegisterPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { refresh } = useAuth();
  const { t, td } = useT();
  const navigate = useNavigate();
  const check = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<{ valid: boolean; error?: string; role?: string; note?: string; createdBy?: string; expiresAt?: string }>(`/api/invites/check?token=${encodeURIComponent(token)}`), enabled: Boolean(token) });
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError(t('auth.passwordMismatch')); return; }
    setLoading(true);
    try {
      await api.post('/api/invites/redeem', { token, username: username.trim(), password, displayName: displayName.trim() || undefined });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (!token) return <AuthShell title={t('register.title')}><p className="text-sm text-slate-300">{t('register.noToken')}</p></AuthShell>;
  if (check.isLoading) return <AuthShell title={t('register.title')}><div className="flex justify-center py-4"><Spinner className="h-6 w-6 text-indigo-400" /></div></AuthShell>;
  if (!check.data?.valid) {
    return (
      <AuthShell title={t('register.title')}>
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{check.data?.error || errorMessage(check.error) || t('register.invalid')}</p>
        <Button className="mt-4 w-full" variant="ghost" onClick={() => navigate('/login')}>{t('auth.toLogin')}</Button>
      </AuthShell>
    );
  }
  const inv = check.data;
  return (
    <AuthShell title={t('register.createTitle')} subtitle={t('register.invitedBy', { by: inv.createdBy ?? '', note: inv.note ? ` – ${inv.note}` : '' })}>
      <p className="mb-4 text-sm text-slate-400">{t('register.role')} <Badge tone={inv.role === 'admin' ? 'red' : inv.role === 'operator' ? 'indigo' : 'slate'}>{td(`role.${inv.role}`, undefined, inv.role)}</Badge></p>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t('auth.username')} htmlFor="username" hint={t('auth.usernameHint')}><input id="username" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus /></Field>
        <Field label={t('auth.displayNameOptional')} htmlFor="displayName"><input id="displayName" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></Field>
        <Field label={t('auth.password')} htmlFor="password" hint={t('auth.passwordHint')}><input id="password" type="password" className="input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>
        <Field label={t('auth.repeatPassword')} htmlFor="confirm"><input id="confirm" type="password" className="input" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
        {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={loading} icon={UserPlus}>{t('register.create')}</Button>
      </form>
    </AuthShell>
  );
}
