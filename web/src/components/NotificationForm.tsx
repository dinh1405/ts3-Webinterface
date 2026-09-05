import { clsx } from 'clsx';
import { RotateCcw, Save, Send } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { Badge, Button, Card, Field, Toggle } from './ui';

export interface NotificationValue {
  discord: { enabled: boolean; webhookUrl: string };
  telegram: { enabled: boolean; botToken: string; chatId: string };
  webhook: { enabled: boolean; url: string; secret: string };
  email: { enabled: boolean; to: string; from?: string; sendmailPath?: string };
  events: Record<string, boolean>;
}

interface Props {
  value: NotificationValue;
  onChange: (v: NotificationValue) => void;
  onSave: () => void;
  onDiscard: () => void;
  onTest: (channel: string) => void;
  saving: boolean;
  testing: boolean;
  dirty: boolean;
  readOnly: boolean;
  ready: Record<string, boolean>;
  eventLabels: Record<string, string>;
  global?: boolean;
  mailFrom?: string;
  footerNote?: ReactNode;
}

export function NotificationForm({ value: form, onChange, onSave, onDiscard, onTest, saving, testing, dirty, readOnly: ro, ready, eventLabels, global, mailFrom, footerNote }: Props) {
  const { t } = useT();
  const secretHint = t('notif.secretHint');
  const upd = <K extends keyof NotificationValue>(key: K, patch: Partial<NotificationValue[K]>) => onChange({ ...form, [key]: { ...(form[key] as object), ...patch } as NotificationValue[K] });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChannelCard title={t('notif.email')} subtitle={global ? t('notif.emailGlobalSub') : t('notif.emailSender', { from: mailFrom || t('notif.serverDefault') })} enabled={form.email.enabled} onToggle={(v) => upd('email', { enabled: v })} onTest={() => onTest('email')} testing={testing} ok={ready.email} ro={ro}>
          <Field label={t('notif.recipient')}><input className="input" type="email" value={form.email.to} disabled={ro} onChange={(e) => upd('email', { to: e.target.value })} placeholder="name@example.org" /></Field>
          {global && <Field label={t('notif.sender')} hint={t('notif.senderHint')}><input className="input" value={form.email.from ?? ''} disabled={ro} onChange={(e) => upd('email', { from: e.target.value })} placeholder={mailFrom} /></Field>}
          {global && <Field label={t('notif.sendmailPath')}><input className="input font-mono" value={form.email.sendmailPath ?? ''} disabled={ro} onChange={(e) => upd('email', { sendmailPath: e.target.value })} /></Field>}
        </ChannelCard>
        <ChannelCard title="Discord" enabled={form.discord.enabled} onToggle={(v) => upd('discord', { enabled: v })} onTest={() => onTest('discord')} testing={testing} ok={ready.discord} ro={ro}>
          <Field label={t('notif.webhookUrl')} hint={secretHint}><input className="input font-mono" value={form.discord.webhookUrl} disabled={ro} onChange={(e) => upd('discord', { webhookUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/…" /></Field>
        </ChannelCard>
        <ChannelCard title="Telegram" enabled={form.telegram.enabled} onToggle={(v) => upd('telegram', { enabled: v })} onTest={() => onTest('telegram')} testing={testing} ok={ready.telegram} ro={ro}>
          <Field label={t('notif.botToken')} hint={secretHint}><input className="input font-mono" value={form.telegram.botToken} disabled={ro} onChange={(e) => upd('telegram', { botToken: e.target.value })} placeholder="123456:ABC…" /></Field>
          <Field label={t('notif.chatId')}><input className="input font-mono" value={form.telegram.chatId} disabled={ro} onChange={(e) => upd('telegram', { chatId: e.target.value })} placeholder="-1001234567890" /></Field>
        </ChannelCard>
        <ChannelCard title={t('notif.webhook')} subtitle={t('notif.webhookSub')} enabled={form.webhook.enabled} onToggle={(v) => upd('webhook', { enabled: v })} onTest={() => onTest('webhook')} testing={testing} ok={ready.webhook} ro={ro}>
          <Field label="URL"><input className="input font-mono" value={form.webhook.url} disabled={ro} onChange={(e) => upd('webhook', { url: e.target.value })} placeholder="https://…" /></Field>
          <Field label={t('notif.secret')} hint={secretHint}><input className="input font-mono" value={form.webhook.secret} disabled={ro} onChange={(e) => upd('webhook', { secret: e.target.value })} /></Field>
        </ChannelCard>
      </div>
      <Card title={t('notif.events')} subtitle={t('notif.eventsSub')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Object.entries(eventLabels).map(([key, label]) => (
            <Toggle key={key} checked={Boolean(form.events[key])} disabled={ro} onChange={(v) => onChange({ ...form, events: { ...form.events, [key]: v } })} label={label} />
          ))}
        </div>
      </Card>
      {!ro && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur">
          <span className="text-sm text-slate-300">{dirty ? t('wizard.settings.unsaved') : t('wizard.settings.allSaved')}{footerNote}</span>
          <div className="flex gap-2">
            <Button variant="ghost" icon={RotateCcw} disabled={!dirty} onClick={onDiscard}>{t('common.discard')}</Button>
            <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={onSave}>{t('common.save')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelCard({ title, subtitle, enabled, onToggle, onTest, testing, ok, ro, children }: { title: string; subtitle?: string; enabled: boolean; onToggle: (v: boolean) => void; onTest: () => void; testing: boolean; ok: boolean; ro: boolean; children: ReactNode }) {
  const { t } = useT();
  return (
    <Card title={<span className="flex items-center gap-2">{title} {ok && <Badge tone="green" dot>{t('notif.ready')}</Badge>}</span>} subtitle={subtitle}
      actions={<>{!ro && <Button size="sm" icon={Send} loading={testing} disabled={!ok} onClick={onTest}>{t('notif.sendTest')}</Button>}<Toggle checked={enabled} disabled={ro} onChange={onToggle} /></>}>
      <div className={clsx('space-y-3', !enabled && 'opacity-60')}>{children}</div>
    </Card>
  );
}
