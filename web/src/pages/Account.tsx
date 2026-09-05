import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, KeyRound, Languages } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { UserNotificationSettings } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import { LOCALES, useT, type Locale } from '../i18n';
import { Badge, Button, Card, ErrorBox, Field, FullPageSpinner, KV, PageHeader } from '../components/ui';
import { NotificationForm } from '../components/NotificationForm';

export default function AccountPage() {
  const { user } = useAuth();
  const { t, td } = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) { toast.error(t('account.newMismatch')); return; }
    setLoading(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: current, newPassword: next });
      toast.success(t('account.passwordChanged'));
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title={t('account.title')} description={t('account.description')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('account.info')}>
          <KV items={[
            { k: t('auth.username'), v: user?.username },
            { k: t('account.displayName'), v: user?.displayName || '–' },
            { k: t('account.role'), v: <Badge tone={user?.role === 'admin' ? 'red' : user?.role === 'operator' ? 'indigo' : 'slate'}>{td(`role.${user?.role}`, undefined, user?.role)}</Badge> },
            { k: t('account.created'), v: formatDate(user?.createdAt) },
            { k: t('account.lastLogin'), v: formatDate(user?.lastLoginAt) },
          ]} />
          <div className="mt-4 border-t border-slate-800/60 pt-4"><LanguageSelect /></div>
        </Card>
        <Card title={t('account.changePassword')}>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label={t('account.currentPassword')}><input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
            <Field label={t('account.newPassword')} hint={t('auth.passwordHint')}><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} /></Field>
            <Field label={t('account.repeatNewPassword')}><input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></Field>
            <Button type="submit" variant="primary" icon={KeyRound} loading={loading}>{t('account.changePassword')}</Button>
          </form>
        </Card>
      </div>
      <h2 className="mb-3 mt-8 flex items-center gap-2 text-lg font-semibold text-slate-50"><Bell className="h-5 w-5 text-indigo-400" /> {t('account.myNotifications')}</h2>
      <p className="mb-4 text-sm text-slate-400">{t('account.notificationsIntro')}</p>
      <MyNotifications />
    </div>
  );
}

function LanguageSelect() {
  const { user, systemLanguage, setLanguage } = useAuth();
  const { t } = useT();
  const [saving, setSaving] = useState(false);
  const value = user?.language ?? '';
  async function change(v: string) {
    setSaving(true);
    try {
      await setLanguage(v === '' ? null : (v as Locale));
      toast.success(t('account.languageSaved'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Field label={<span className="flex items-center gap-1.5"><Languages className="h-3.5 w-3.5" /> {t('account.language')}</span>} hint={t('account.languageHint')}>
      <select className="input" value={value} disabled={saving} onChange={(e) => change(e.target.value)}>
        <option value="">{t('lang.system', { lang: t(`lang.${systemLanguage}`) })}</option>
        {LOCALES.map((l) => <option key={l} value={l}>{t(`lang.${l}`)}</option>)}
      </select>
    </Field>
  );
}

function MyNotifications() {
  const qc = useQueryClient();
  const { t } = useT();
  const q = useQuery({ queryKey: ['me', 'notifications'], queryFn: () => api.get<{ settings: UserNotificationSettings; eventLabels: Record<string, string>; channels: Record<string, boolean>; mailFrom: string }>('/api/auth/notifications') });
  const [form, setForm] = useState<UserNotificationSettings | null>(null);
  useEffect(() => { if (q.data && !form) setForm(q.data.settings); }, [q.data, form]);
  const save = useMutation({
    mutationFn: () => api.put('/api/auth/notifications', form),
    onSuccess: () => { toast.success(t('account.notificationsSaved')); setForm(null); qc.invalidateQueries({ queryKey: ['me', 'notifications'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const test = useMutation({
    mutationFn: (channel: string) => api.post('/api/auth/notifications/test', { channel }),
    onSuccess: (_, ch) => toast.success(t('account.testSent', { channel: ch })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading || !form) return <FullPageSpinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const dirty = JSON.stringify(form) !== JSON.stringify(q.data!.settings);
  return (
    <NotificationForm value={form} onChange={(v) => setForm(v as UserNotificationSettings)} onSave={() => save.mutate()} onDiscard={() => setForm(q.data!.settings)} onTest={(ch) => test.mutate(ch)} saving={save.isPending} testing={test.isPending} dirty={dirty} readOnly={false} ready={q.data!.channels} eventLabels={q.data!.eventLabels} mailFrom={q.data!.mailFrom}
      footerNote={dirty && <span className="ml-3 text-xs text-slate-500">{t('account.saveBeforeTest')}</span>} />
  );
}
