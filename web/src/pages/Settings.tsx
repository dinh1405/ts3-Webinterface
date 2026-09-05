import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { Plug, RotateCcw, Save, Server, Settings2 } from 'lucide-react';
import { ConnectionSettings } from '../components/setup/ConnectionSettings';
import { useT } from '../i18n';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../lib/auth';
import { formatBytes, formatDate } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Field, FullPageSpinner, KV, PageHeader, Toggle } from '../components/ui';

type Value = string | number | boolean;
type Info = Record<string, Value>;
interface Groups { serverGroups: { sgid: string; name: string; type: number }[]; channelGroups: { cgid: string; name: string; type: number }[] }

export default function SettingsPage() {
  const { can } = useAuth();
  const { t } = useT();
  const [tab, setTab] = useState<'virtual' | 'instance' | 'connection'>('virtual');
  type TabKey = 'virtual' | 'instance' | 'connection';
  const tabs: [TabKey, string, typeof Server][] = [['virtual', t('settings.tab.virtual'), Server], ['instance', t('settings.tab.instance'), Settings2], ...(can('system.manage') ? [['connection', t('wizard.settings.tab'), Plug] as [TabKey, string, typeof Server]] : [])];
  return (
    <div>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <div className="mb-4 flex w-fit gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
        {tabs.map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition', tab === key ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-100')}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>
      {tab === 'virtual' ? <VirtualSettings /> : tab === 'instance' ? <InstanceSettings /> : <ConnectionSettings />}
    </div>
  );
}

/* ---------- generisches Formular ---------- */
function useSettingsForm(info: Info | undefined, keys: string[]) {
  const [form, setForm] = useState<Info>({});
  useEffect(() => {
    if (!info) return;
    const next: Info = {};
    for (const k of keys) if (info[k] !== undefined) next[k] = info[k];
    setForm(next);
  }, [info, keys]);
  const set = (k: string, v: Value) => setForm((f) => ({ ...f, [k]: v }));
  const changed = useMemo(() => {
    const out: Info = {};
    if (!info) return out;
    for (const [k, v] of Object.entries(form)) {
      if (String(v) !== String(info[k] ?? '')) out[k] = v;
    }
    return out;
  }, [form, info]);
  const reset = () => { if (info) { const next: Info = {}; for (const k of keys) if (info[k] !== undefined) next[k] = info[k]; setForm(next); } };
  return { form, set, changed, reset };
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card title={title} subtitle={description}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </Card>
  );
}

function Text({ label, k, form, set, disabled, hint, mono, type = 'text', full }: { label: string; k: string; form: Info; set: (k: string, v: Value) => void; disabled: boolean; hint?: string; mono?: boolean; type?: string; full?: boolean }) {
  return (
    <Field label={label} hint={hint} className={full ? 'md:col-span-2' : undefined}>
      <input className={clsx('input', mono && 'font-mono')} type={type} value={String(form[k] ?? '')} disabled={disabled} onChange={(e) => set(k, type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
    </Field>
  );
}

function Num(props: Omit<Parameters<typeof Text>[0], 'type'>) {
  return <Text {...props} type="number" />;
}

function Area({ label, k, form, set, disabled, hint }: { label: string; k: string; form: Info; set: (k: string, v: Value) => void; disabled: boolean; hint?: string }) {
  return (
    <Field label={label} hint={hint} className="md:col-span-2">
      <textarea className="input" value={String(form[k] ?? '')} disabled={disabled} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
}

function Select({ label, k, form, set, disabled, options, hint }: { label: string; k: string; form: Info; set: (k: string, v: Value) => void; disabled: boolean; options: { value: string; label: string }[]; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <select className="input" value={String(form[k] ?? '')} disabled={disabled} onChange={(e) => set(k, /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

function Bool({ label, k, form, set, disabled, description }: { label: string; k: string; form: Info; set: (k: string, v: Value) => void; disabled: boolean; description?: string }) {
  const v = form[k];
  const checked = v === true || v === 1 || v === '1';
  return <Toggle checked={checked} disabled={disabled} onChange={(c) => set(k, c ? 1 : 0)} label={label} description={description} />;
}

function SaveBar({ changed, onSave, onReset, saving, disabled }: { changed: Info; onSave: () => void; onReset: () => void; saving: boolean; disabled: boolean }) {
  const { t } = useT();
  const n = Object.keys(changed).length;
  if (disabled) return <p className="text-xs text-slate-500">{t('settings.readOnly')}</p>;
  return (
    <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur">
      <span className="text-sm text-slate-300">{n === 0 ? t('settings.noChanges') : <><Badge tone="amber">{n}</Badge> {t('settings.changedCount', { count: n })}</>}</span>
      <div className="flex gap-2">
        <Button variant="ghost" icon={RotateCcw} onClick={onReset} disabled={n === 0 || saving}>{t('common.reset')}</Button>
        <Button variant="primary" icon={Save} onClick={onSave} loading={saving} disabled={n === 0}>{t('common.save')}</Button>
      </div>
    </div>
  );
}

/* ---------- Virtueller Server ---------- */
function VirtualSettings() {
  const { can } = useAuth(); const canWrite = can('settings.manage');
  const { t } = useT();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['settings', 'virtual'], queryFn: () => api.get<{ info: Info; editableKeys: string[] }>('/api/settings/virtual') });
  const groups = useQuery({ queryKey: ['settings', 'groups'], queryFn: () => api.get<Groups>('/api/settings/groups') });
  const keys = useMemo(() => (data.data?.editableKeys ?? []).filter((k) => k !== 'virtualserverPassword'), [data.data]);
  const { form, set, changed, reset } = useSettingsForm(data.data?.info, keys);
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const disabled = !canWrite;
  const HOSTMESSAGE_MODES = ([0, 1, 2, 3] as const).map((v) => ({ value: String(v), label: t(`settings.hostmsg.${v}`) }));
  const BANNER_MODES = ([0, 1, 2] as const).map((v) => ({ value: String(v), label: t(`settings.banner.${v}`) }));
  const ENCRYPTION_MODES = ([0, 1, 2] as const).map((v) => ({ value: String(v), label: t(`settings.encryption.${v}`) }));
  const unlimited = t('settings.unlimitedHint');

  const save = useMutation({
    mutationFn: () => {
      const payload: Info = { ...changed };
      if (removePassword) payload.virtualserverPassword = '';
      else if (password) payload.virtualserverPassword = password;
      return api.put<{ changed: string[] }>('/api/settings/virtual', payload);
    },
    onSuccess: (r) => { toast.success(t('settings.saved', { count: r.changed.length })); setPassword(''); setRemovePassword(false); qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['status'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (data.isLoading) return <FullPageSpinner />;
  if (data.error) return <ErrorBox error={data.error} onRetry={() => data.refetch()} />;
  const info = data.data!.info;
  const allChanged: Info = { ...changed, ...(password || removePassword ? { virtualserverPassword: '***' } : {}) };
  const sg = (groups.data?.serverGroups ?? []).filter((g) => g.type === 1).map((g) => ({ value: g.sgid, label: `${g.name} (${g.sgid})` }));
  const cg = (groups.data?.channelGroups ?? []).filter((g) => g.type === 1).map((g) => ({ value: g.cgid, label: `${g.name} (${g.cgid})` }));

  return (
    <div className="space-y-4">
      <Card title={t('common.status')} subtitle={t('settings.readOnlyCard')}>
        <KV items={[
          { k: 'Unique ID', v: <span className="font-mono text-xs">{String(info.virtualserverUniqueIdentifier)}</span> },
          { k: t('common.status'), v: <Badge tone={info.virtualserverStatus === 'online' ? 'green' : 'amber'}>{String(info.virtualserverStatus)}</Badge> },
          { k: 'Port', v: String(info.virtualserverPort) },
          { k: t('dash.created'), v: formatDate(Number(info.virtualserverCreated)) },
          { k: t('settings.clientsOnline'), v: `${info.virtualserverClientsonline} (+${info.virtualserverQueryclientsonline} Query)` },
          { k: t('settings.channels'), v: String(info.virtualserverChannelsonline) },
          { k: t('settings.filebase'), v: <span className="font-mono text-xs">{String(info.virtualserverFilebase)}</span> },
          { k: t('settings.passwordSet'), v: info.virtualserverFlagPassword === 1 || info.virtualserverFlagPassword === true ? t('common.yes') : t('common.no') },
          { k: 'Traffic ↑ / ↓', v: `${formatBytes(info.virtualserverTotalBytesUploaded as number)} / ${formatBytes(info.virtualserverTotalBytesDownloaded as number)}` },
        ]} />
      </Card>

      <Section title={t('settings.general')}>
        <Text label={t('settings.serverName')} k="virtualserverName" form={form} set={set} disabled={disabled} />
        <Text label={t('settings.phoneticName')} k="virtualserverNamePhonetic" form={form} set={set} disabled={disabled} hint={t('settings.phoneticHint')} />
        <Area label={t('settings.welcome')} k="virtualserverWelcomemessage" form={form} set={set} disabled={disabled} hint={t('settings.bbcodeHint')} />
        <Num label={t('settings.maxClients')} k="virtualserverMaxclients" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.reservedSlots')} k="virtualserverReservedSlots" form={form} set={set} disabled={disabled} />
        <Field label={t('settings.newServerPassword')} hint={t('settings.newServerPasswordHint')}>
          <input className="input" type="password" autoComplete="new-password" value={password} disabled={disabled || removePassword} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex items-end pb-1">
          <Toggle checked={removePassword} disabled={disabled} onChange={setRemovePassword} label={t('settings.removePassword')} description={t('settings.removePasswordHint')} />
        </div>
        <Select label={t('settings.codecEncryption')} k="virtualserverCodecEncryptionMode" form={form} set={set} disabled={disabled} options={ENCRYPTION_MODES} />
        <Num label={t('settings.securityLevel')} k="virtualserverNeededIdentitySecurityLevel" form={form} set={set} disabled={disabled} />
        <Text label={t('settings.minClientVersion')} k="virtualserverMinClientVersion" form={form} set={set} disabled={disabled} hint={t('settings.minClientVersionHint')} mono />
        <Num label={t('settings.tempDeleteDelay')} k="virtualserverChannelTempDeleteDelayDefault" form={form} set={set} disabled={disabled} />
        <Bool label={t('settings.autostart')} k="virtualserverAutostart" form={form} set={set} disabled={disabled} description={t('settings.autostartHint')} />
        <Bool label={t('settings.weblist')} k="virtualserverWeblistEnabled" form={form} set={set} disabled={disabled} />
      </Section>

      <Section title={t('settings.hostSection')}>
        <Text label={t('settings.hostMessage')} k="virtualserverHostmessage" form={form} set={set} disabled={disabled} />
        <Select label={t('settings.hostMessageMode')} k="virtualserverHostmessageMode" form={form} set={set} disabled={disabled} options={HOSTMESSAGE_MODES} />
        <Text label={t('settings.bannerUrl')} k="virtualserverHostbannerUrl" form={form} set={set} disabled={disabled} mono />
        <Text label={t('settings.bannerGfxUrl')} k="virtualserverHostbannerGfxUrl" form={form} set={set} disabled={disabled} mono />
        <Num label={t('settings.bannerInterval')} k="virtualserverHostbannerGfxInterval" form={form} set={set} disabled={disabled} />
        <Select label={t('settings.bannerMode')} k="virtualserverHostbannerMode" form={form} set={set} disabled={disabled} options={BANNER_MODES} />
        {String(form.virtualserverHostbannerGfxUrl || '') && (
          <div className="md:col-span-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <p className="mb-2 text-xs text-slate-500">{t('settings.preview')}</p>
            <img src={String(form.virtualserverHostbannerGfxUrl)} alt="Hostbanner" className="max-h-40 rounded" />
          </div>
        )}
        <Text label={t('settings.buttonTooltip')} k="virtualserverHostbuttonTooltip" form={form} set={set} disabled={disabled} />
        <Text label={t('settings.buttonUrl')} k="virtualserverHostbuttonUrl" form={form} set={set} disabled={disabled} mono />
        <Text label={t('settings.buttonGfxUrl')} k="virtualserverHostbuttonGfxUrl" form={form} set={set} disabled={disabled} mono full />
      </Section>

      <Section title={t('settings.defaultGroups')} description={t('settings.defaultGroupsHint')}>
        <Select label={t('settings.defaultServerGroup')} k="virtualserverDefaultServerGroup" form={form} set={set} disabled={disabled || !sg.length} options={sg.length ? sg : [{ value: String(form.virtualserverDefaultServerGroup ?? ''), label: String(form.virtualserverDefaultServerGroup ?? '') }]} />
        <Select label={t('settings.defaultChannelGroup')} k="virtualserverDefaultChannelGroup" form={form} set={set} disabled={disabled || !cg.length} options={cg.length ? cg : [{ value: String(form.virtualserverDefaultChannelGroup ?? ''), label: String(form.virtualserverDefaultChannelGroup ?? '') }]} />
        <Select label={t('settings.channelAdminGroup')} k="virtualserverDefaultChannelAdminGroup" form={form} set={set} disabled={disabled || !cg.length} options={cg.length ? cg : [{ value: String(form.virtualserverDefaultChannelAdminGroup ?? ''), label: String(form.virtualserverDefaultChannelAdminGroup ?? '') }]} />
      </Section>

      <Section title={t('settings.antifloodSection')}>
        <Num label={t('settings.floodTickReduce')} k="virtualserverAntifloodPointsTickReduce" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.floodCommandBlock')} k="virtualserverAntifloodPointsNeededCommandBlock" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.floodPluginBlock')} k="virtualserverAntifloodPointsNeededPluginBlock" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.floodIpBlock')} k="virtualserverAntifloodPointsNeededIpBlock" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.complainAutobanCount')} k="virtualserverComplainAutobanCount" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.complainAutobanTime')} k="virtualserverComplainAutobanTime" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.complainRemoveTime')} k="virtualserverComplainRemoveTime" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.forcedSilence')} k="virtualserverMinClientsInChannelBeforeForcedSilence" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.priorityDimm')} k="virtualserverPrioritySpeakerDimmModificator" form={form} set={set} disabled={disabled} />
      </Section>

      <Section title={t('settings.bandwidthSection')}>
        <Num label={t('settings.maxDownload')} k="virtualserverMaxDownloadTotalBandwidth" form={form} set={set} disabled={disabled} hint={unlimited} />
        <Num label={t('settings.maxUpload')} k="virtualserverMaxUploadTotalBandwidth" form={form} set={set} disabled={disabled} hint={unlimited} />
        <Num label={t('settings.downloadQuota')} k="virtualserverDownloadQuota" form={form} set={set} disabled={disabled} hint={unlimited} />
        <Num label={t('settings.uploadQuota')} k="virtualserverUploadQuota" form={form} set={set} disabled={disabled} hint={unlimited} />
      </Section>

      <Section title={t('settings.loggingSection')} description={t('settings.loggingHint')}>
        <Bool label={t('settings.logClient')} k="virtualserverLogClient" form={form} set={set} disabled={disabled} />
        <Bool label={t('settings.logQuery')} k="virtualserverLogQuery" form={form} set={set} disabled={disabled} />
        <Bool label={t('settings.logChannel')} k="virtualserverLogChannel" form={form} set={set} disabled={disabled} />
        <Bool label={t('settings.logPermissions')} k="virtualserverLogPermissions" form={form} set={set} disabled={disabled} />
        <Bool label={t('settings.logServer')} k="virtualserverLogServer" form={form} set={set} disabled={disabled} />
        <Bool label={t('settings.logFiletransfer')} k="virtualserverLogFiletransfer" form={form} set={set} disabled={disabled} />
      </Section>

      <SaveBar changed={allChanged} onSave={() => save.mutate()} onReset={() => { reset(); setPassword(''); setRemovePassword(false); }} saving={save.isPending} disabled={disabled} />
    </div>
  );
}

/* ---------- Instanz ---------- */
function InstanceSettings() {
  const { can } = useAuth(); const canWrite = can('settings.manage');
  const { t } = useT();
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ['settings', 'instance'], queryFn: () => api.get<{ info: Info; editableKeys: string[] }>('/api/settings/instance') });
  const keys = useMemo(() => data.data?.editableKeys ?? [], [data.data]);
  const { form, set, changed, reset } = useSettingsForm(data.data?.info, keys);
  const disabled = !canWrite;
  const unlimited = t('settings.unlimitedHint');
  const save = useMutation({
    mutationFn: () => api.put<{ changed: string[] }>('/api/settings/instance', changed),
    onSuccess: (r) => { toast.success(t('settings.saved', { count: r.changed.length })); qc.invalidateQueries({ queryKey: ['settings', 'instance'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (data.isLoading) return <FullPageSpinner />;
  if (data.error) return <ErrorBox error={data.error} onRetry={() => data.refetch()} />;
  const info = data.data!.info;
  return (
    <div className="space-y-4">
      <Card title={t('settings.tab.instance')} subtitle={t('settings.readOnlyCard')}>
        <KV items={[
          { k: t('settings.dbVersion'), v: String(info.serverinstanceDatabaseVersion) },
          { k: t('settings.permVersion'), v: String(info.serverinstancePermissionsVersion) },
          { k: t('settings.guestQueryGroup'), v: String(info.serverinstanceGuestServerqueryGroup) },
          { k: t('settings.maxQueryPerIp'), v: String(info.serverinstanceServerqueryMaxConnectionsPerIp) },
          { k: t('settings.pendingPerIp'), v: String(info.serverinstancePendingConnectionsPerIp) },
        ]} />
      </Card>
      <Section title={t('settings.networkSection')}>
        <Num label={t('settings.ftPort')} k="serverinstanceFiletransferPort" form={form} set={set} disabled={disabled} hint={t('settings.ftPortHint')} />
        <div />
        <Num label={t('settings.maxDownload')} k="serverinstanceMaxDownloadTotalBandwidth" form={form} set={set} disabled={disabled} hint={unlimited} />
        <Num label={t('settings.maxUpload')} k="serverinstanceMaxUploadTotalBandwidth" form={form} set={set} disabled={disabled} hint={unlimited} />
      </Section>
      <Section title={t('settings.floodSection')} description={t('settings.floodHint')}>
        <Num label={t('settings.floodCommands')} k="serverinstanceServerqueryFloodCommands" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.floodTime')} k="serverinstanceServerqueryFloodTime" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.floodBanTime')} k="serverinstanceServerqueryFloodBanTime" form={form} set={set} disabled={disabled} />
      </Section>
      <Section title={t('settings.templateSection')} description={t('settings.templateHint')}>
        <Num label={t('settings.tplServeradmin')} k="serverinstanceTemplateServeradminGroup" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.tplServerdefault')} k="serverinstanceTemplateServerdefaultGroup" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.tplChanneladmin')} k="serverinstanceTemplateChanneladminGroup" form={form} set={set} disabled={disabled} />
        <Num label={t('settings.tplChanneldefault')} k="serverinstanceTemplateChanneldefaultGroup" form={form} set={set} disabled={disabled} />
      </Section>
      <SaveBar changed={changed} onSave={() => save.mutate()} onReset={reset} saving={save.isPending} disabled={disabled} />
    </div>
  );
}
