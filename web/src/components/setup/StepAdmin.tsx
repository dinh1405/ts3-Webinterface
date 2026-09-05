import { useT } from '../../i18n';
import { Field } from '../ui';

export interface AdminDraft { username: string; displayName: string; password: string; confirm: string }

export function StepAdmin({ admin, onChange }: { admin: AdminDraft; onChange: (a: AdminDraft) => void }) {
  const { t } = useT();
  const mismatch = admin.confirm.length > 0 && admin.password !== admin.confirm;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">{t('wizard.admin.intro')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('auth.username')} hint={t('auth.usernameHint')}><input className="input" autoComplete="username" value={admin.username} onChange={(e) => onChange({ ...admin, username: e.target.value })} /></Field>
        <Field label={t('auth.displayNameOptional')}><input className="input" value={admin.displayName} onChange={(e) => onChange({ ...admin, displayName: e.target.value })} /></Field>
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}><input className="input" type="password" autoComplete="new-password" value={admin.password} onChange={(e) => onChange({ ...admin, password: e.target.value })} /></Field>
        <Field label={t('auth.repeatPassword')} hint={mismatch ? <span className="text-rose-300">{t('auth.passwordMismatch')}</span> : undefined}><input className="input" type="password" autoComplete="new-password" value={admin.confirm} onChange={(e) => onChange({ ...admin, confirm: e.target.value })} /></Field>
      </div>
    </div>
  );
}

export function adminValid(a: AdminDraft): boolean {
  return /^[a-zA-Z0-9._-]{3,32}$/.test(a.username) && a.password.length >= 8 && a.password === a.confirm;
}
