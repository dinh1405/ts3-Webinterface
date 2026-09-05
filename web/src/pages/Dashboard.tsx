import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import {
  Activity, ArrowDownToLine, ArrowRight, ArrowUpFromLine, Clock, Cpu, Hash, MessageSquare, Play, Power, RotateCw, Server, Square, Users, Wifi, Zap,
} from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { Channel, Client, ServerStatus, Ts3Event } from '../api/types';
import { useAuth } from '../lib/auth';
import { useEvents } from '../lib/events';
import { describeEvent, describeProcessDetail } from '../lib/events-text';
import { countryFlag, formatBitrate, formatBytes, formatDate, formatDuration, formatRelative, formatTime } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, FullPageSpinner, KV, PageHeader, Stat } from '../components/ui';

type Action = 'start' | 'stop' | 'restart';

export default function DashboardPage() {
  const { can } = useAuth(); const canControl = can('server.control'); const canMessage = can('server.message');
  const { t, td } = useT();
  const { events, queryStatus } = useEvents();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcast, setBroadcast] = useState('');
  const actionLabel = (a: Action) => t(`dash.action.${a}`);

  const status = useQuery({ queryKey: ['status'], queryFn: () => api.get<ServerStatus>('/api/server/status'), refetchInterval: 10000 });

  const control = useMutation({
    mutationFn: (action: Action) => api.post<{ ok: boolean; output: string; durationMs: number }>(`/api/server/control/${action}`),
    onSuccess: (res, action) => {
      toast.success(t('dash.actionDone', { action: actionLabel(action) }), { description: res.output?.split('\n').slice(-1)[0] });
      setConfirm(null);
      setTimeout(() => qc.invalidateQueries({ queryKey: ['status'] }), 1500);
      setTimeout(() => qc.invalidateQueries({ queryKey: ['status'] }), 6000);
    },
    onError: (e: unknown) => {
      const data = (e as { data?: { output?: string } }).data;
      toast.error(errorMessage(e), { description: data?.output });
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ['status'] });
    },
  });

  const vsAction = useMutation({
    mutationFn: ({ sid, action }: { sid: string; action: 'start' | 'stop' }) => api.post(`/api/server/virtualservers/${sid}/${action}`),
    onSuccess: () => { toast.success(t('dash.vsUpdated')); qc.invalidateQueries({ queryKey: ['status'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sendBroadcast = useMutation({
    mutationFn: () => api.post('/api/clients/broadcast', { message: broadcast }),
    onSuccess: () => { toast.success(t('dash.broadcastSent')); setBroadcast(''); setBroadcastOpen(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (status.isLoading) return <FullPageSpinner />;
  if (status.error) return <ErrorBox error={status.error} onRetry={() => status.refetch()} />;
  const s = status.data!;
  const running = s.process.running;
  const connected = queryStatus?.connected ?? s.query.connected;
  const cur = s.current;
  const host = s.host;

  return (
    <div>
      <PageHeader
        title={t('dash.title')}
        description={s.version ? t('dash.versionLine', { version: s.version.version, build: s.version.build, platform: s.version.platform }) : t('dash.subtitle')}
        actions={(canControl || canMessage) && (
          <>
            {canMessage && <Button variant="ghost" icon={MessageSquare} onClick={() => setBroadcastOpen(true)} disabled={!connected}>{t('dash.broadcast')}</Button>}
            {canControl && running !== true && <Button variant="success" icon={Play} onClick={() => setConfirm('start')} disabled={!s.control.configured || Boolean(s.busy)}>{t('dash.action.start')}</Button>}
            {canControl && <Button variant="warning" icon={RotateCw} onClick={() => setConfirm('restart')} disabled={!s.control.configured || Boolean(s.busy)}>{t('dash.restartShort')}</Button>}
            {canControl && running !== false && <Button variant="danger" icon={Square} onClick={() => setConfirm('stop')} disabled={!s.control.configured || Boolean(s.busy)}>{t('dash.action.stop')}</Button>}
          </>
        )}
      />

      {s.busy && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
          <RotateCw className="h-4 w-4 animate-spin" /> {t('dash.busy', { action: (['start', 'stop', 'restart'] as Action[]).includes(s.busy.action as Action) ? actionLabel(s.busy.action as Action) : s.busy.action, since: formatRelative(s.busy.startedAt) })}
        </div>
      )}
      {!s.control.configured && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {t('dash.controlNotConfigured')}
        </div>
      )}
      {!connected && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <p className="font-medium">{t('dash.noQuery')}</p>
          <p className="text-xs opacity-80">{s.query.lastError || t('dash.connecting')}{s.query.nextReconnectAt && t('dash.nextTry', { when: formatRelative(s.query.nextReconnectAt) })}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t('dash.process')} value={running ? t('dash.running') : running === false ? t('dash.stopped') : t('common.unknown')} sub={s.process.pid ? `PID ${s.process.pid}` : describeProcessDetail(s.process.detail)} icon={Power} tone={running ? 'green' : running === false ? 'red' : 'slate'} />
        <Stat label={t('dash.clientsOnline')} value={cur ? `${Math.max(0, Number(cur.virtualserverClientsonline) - Number(cur.virtualserverQueryclientsonline || 0))} / ${cur.virtualserverMaxclients}` : '–'} sub={cur ? t('dash.reservedSlots', { reserved: String(cur.virtualserverReservedSlots ?? 0), query: String(cur.virtualserverQueryclientsonline ?? 0) }) : t('dash.queryDisconnected')} icon={Users} tone="indigo" />
        <Stat label={t('dash.uptime')} value={cur ? formatDuration(cur.virtualserverUptime) : '–'} sub={host ? t('dash.instance', { uptime: formatDuration(host.instanceUptime) }) : undefined} icon={Clock} tone="blue" />
        <Stat label={t('dash.channels')} value={cur ? String(cur.virtualserverChannelsonline) : '–'} sub={cur ? t('dash.pingLoss', { ping: Number(cur.virtualserverTotalPing).toFixed(1), loss: (Number(cur.virtualserverTotalPacketlossTotal) * 100).toFixed(2) }) : undefined} icon={Hash} tone="purple" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={t('dash.serverInfo')} className="lg:col-span-2">
          {cur ? (
            <KV items={[
              { k: t('common.name'), v: String(cur.virtualserverName) },
              { k: t('common.port'), v: String(cur.virtualserverPort) },
              { k: t('common.status'), v: <Badge tone={cur.virtualserverStatus === 'online' ? 'green' : 'amber'}>{String(cur.virtualserverStatus)}</Badge> },
              { k: t('dash.serverId'), v: String(cur.virtualserverId ?? s.servers[0]?.id ?? '–') },
              { k: t('dash.created'), v: formatDate(Number(cur.virtualserverCreated)) },
              { k: t('dash.uniqueId'), v: <span className="font-mono text-xs">{String(cur.virtualserverUniqueIdentifier)}</span> },
              { k: t('dash.sentTotal'), v: formatBytes(cur.virtualserverTotalBytesUploaded) },
              { k: t('dash.receivedTotal'), v: formatBytes(cur.virtualserverTotalBytesDownloaded) },
              { k: t('dash.bandwidthUp'), v: formatBitrate(cur.connectionBandwidthSentLastSecondTotal) },
              { k: t('dash.bandwidthDown'), v: formatBitrate(cur.connectionBandwidthReceivedLastSecondTotal) },
              { k: t('dash.queryClients'), v: String(cur.virtualserverQueryclientsonline) },
              { k: t('dash.ts3Dir'), v: <span className="font-mono text-xs">{s.ts3Dir || '–'}</span> },
            ]} />
          ) : (
            <EmptyState icon={Server} title={t('dash.noServerData')} description={t('dash.noServerDataHint')} />
          )}
        </Card>

        <div className="space-y-4">
          <Card title={t('dash.query')}>
            <KV items={[
              { k: t('common.status'), v: <Badge tone={connected ? 'green' : 'amber'} dot pulse={connected}>{connected ? t('dash.connected') : s.query.connecting ? t('dash.connectingShort') : t('dash.disconnected')}</Badge> },
              { k: t('dash.target'), v: <span className="font-mono text-xs">{s.query.host}:{s.query.port} ({s.query.protocol})</span> },
              { k: t('common.user'), v: s.query.username },
              { k: t('dash.since'), v: s.query.connectedSince ? formatRelative(s.query.connectedSince) : '–' },
            ]} />
            {s.query.lastError && !connected && <p className="mt-3 text-xs text-amber-300">{s.query.lastError}</p>}
          </Card>
          <Card title={t('dash.processControl')}>
            <KV items={[
              { k: t('dash.mode'), v: <Badge tone="indigo">{td(`wizard.control.mode.${s.control.mode}`, undefined, s.control.mode)}</Badge> },
              { k: 'PID', v: s.process.pid ? String(s.process.pid) : '–' },
              { k: t('dash.started'), v: s.process.startedAt ? formatDate(s.process.startedAt) : '–' },
              { k: t('dash.checked'), v: formatRelative(s.process.checkedAt) },
              { k: t('dash.watchdog'), v: s.watchdog ? <Badge tone={!s.watchdog.enabled ? 'slate' : s.watchdog.gaveUp ? 'red' : s.watchdog.suspended ? 'amber' : 'green'} dot>{!s.watchdog.enabled ? t('dash.wdOff') : s.watchdog.gaveUp ? t('dash.wdGaveUp') : s.watchdog.suspended ? t('dash.wdSuspended') : t('dash.wdActive')}</Badge> : '–' },
            ]} />
            <p className="mt-2 truncate font-mono text-[11px] text-slate-500" title={s.control.detail}>{describeProcessDetail(s.control.detail)}</p>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={t('dash.virtualServers')} className="lg:col-span-2" noPadding>
          {s.servers.length === 0 ? (
            <EmptyState icon={Server} title={t('dash.noVirtual')} description={connected ? t('dash.noVirtualHint') : t('dash.queryNotConnected')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>ID</th><th>{t('common.name')}</th><th>{t('common.port')}</th><th>{t('common.status')}</th><th>{t('dash.th.clients')}</th><th>{t('dash.uptime')}</th><th>{t('dash.th.autostart')}</th>{canControl && <th className="text-right">{t('dash.th.action')}</th>}</tr></thead>
                <tbody>
                  {s.servers.map((v) => (
                    <tr key={v.id}>
                      <td className="font-mono text-xs">{v.id}</td>
                      <td className="font-medium text-slate-100">{v.name}</td>
                      <td>{v.port}</td>
                      <td><Badge tone={v.status === 'online' ? 'green' : 'red'} dot>{v.status}</Badge></td>
                      <td>{v.clientsonline} / {v.maxclients}</td>
                      <td>{v.status === 'online' ? formatDuration(v.uptime) : '–'}</td>
                      <td>{v.autostart ? t('common.yes') : t('common.no')}</td>
                      {canControl && (
                        <td className="text-right">
                          {v.status === 'online'
                            ? <Button size="sm" variant="danger" icon={Square} loading={vsAction.isPending} onClick={() => vsAction.mutate({ sid: v.id, action: 'stop' })}>{t('dash.vsStop')}</Button>
                            : <Button size="sm" variant="success" icon={Play} loading={vsAction.isPending} onClick={() => vsAction.mutate({ sid: v.id, action: 'start' })}>{t('dash.vsStart')}</Button>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t('dash.instanceTraffic')}>
          {host ? (
            <div className="space-y-3 text-sm">
              <TrafficRow icon={ArrowUpFromLine} label={t('dash.sent')} total={formatBytes(host.connectionBytesSentTotal)} rate={formatBitrate(host.connectionBandwidthSentLastSecondTotal)} />
              <TrafficRow icon={ArrowDownToLine} label={t('dash.received')} total={formatBytes(host.connectionBytesReceivedTotal)} rate={formatBitrate(host.connectionBandwidthReceivedLastSecondTotal)} />
              <TrafficRow icon={Zap} label={t('dash.ftUp')} total={formatBytes(host.connectionFiletransferBytesSentTotal)} />
              <TrafficRow icon={Zap} label={t('dash.ftDown')} total={formatBytes(host.connectionFiletransferBytesReceivedTotal)} />
              <TrafficRow icon={Cpu} label={t('dash.virtualServers')} total={t('dash.vsRunning', { count: Number(host.virtualserversRunningTotal) })} rate={t('dash.vsClients', { online: String(host.virtualserversTotalClientsOnline), max: String(host.virtualserversTotalMaxclients) })} />
            </div>
          ) : (
            <EmptyState icon={Wifi} title={t('dash.noData')} description={t('dash.queryNotConnected')} />
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OnlineClientsCard connected={connected} />
        <Card title={t('dash.liveActivity')} subtitle={t('dash.liveSubtitle')} noPadding>
          <ActivityFeed events={events} />
        </Card>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && control.mutate(confirm)}
        loading={control.isPending}
        title={t('dash.confirmTitle', { action: confirm ? actionLabel(confirm).toLowerCase() : '' })}
        tone={confirm === 'start' ? 'success' : confirm === 'restart' ? 'warning' : 'danger'}
        confirmLabel={confirm ? actionLabel(confirm) : ''}
        message={
          confirm === 'start'
            ? t('dash.confirmStart')
            : t('dash.confirmStop', { count: String(cur?.virtualserverClientsonline ?? 0), after: confirm === 'restart' ? t('dash.afterRestart') : t('dash.afterStop') })
        }
      />

      <ConfirmDialog
        open={broadcastOpen}
        onClose={() => setBroadcastOpen(false)}
        onConfirm={() => sendBroadcast.mutate()}
        loading={sendBroadcast.isPending}
        title={t('dash.broadcastTitle')}
        tone="primary"
        confirmLabel={t('dash.send')}
      >
        <textarea className="input" placeholder={t('dash.broadcastPlaceholder')} value={broadcast} onChange={(e) => setBroadcast(e.target.value)} maxLength={1024} autoFocus />
      </ConfirmDialog>
    </div>
  );
}

/** Aktuell verbundene Clients – aktualisiert sich über den Ereignisstrom. */
function OnlineClientsCard({ connected }: { connected: boolean }) {
  const canHistory = useAuth().can('history.view');
  const { t } = useT();
  const tree = useQuery({ queryKey: ['clients', 'tree'], queryFn: () => api.get<{ tree: Channel[]; clients: Client[] }>('/api/clients/tree'), refetchInterval: 15000, enabled: connected });
  const channelNames = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (list: Channel[]) => { for (const c of list) { m.set(c.cid, c.name); walk(c.children); } };
    walk(tree.data?.tree ?? []);
    return m;
  }, [tree.data]);
  const clients = useMemo(() => [...(tree.data?.clients ?? [])].sort((a, b) => a.nickname.localeCompare(b.nickname)), [tree.data]);
  return (
    <Card title={<span>{t('dash.onlineClients')} {clients.length > 0 && <Badge tone="indigo" className="ml-1">{clients.length}</Badge>}</span>} subtitle={t('dash.onlineSubtitle')}
      actions={<Link to="/clients" className="btn btn-ghost btn-sm">{t('dash.channelTree')} <ArrowRight className="h-3.5 w-3.5" /></Link>} noPadding>
      {!connected ? <EmptyState icon={Users} title={t('dash.queryDisconnectedTitle')} description={t('dash.queryDisconnectedHint')} />
        : tree.error ? <div className="p-4"><ErrorBox error={tree.error} onRetry={() => tree.refetch()} compact /></div>
        : clients.length === 0 ? <EmptyState icon={Users} title={t('dash.nobodyOnline')} description={t('dash.nobodyOnlineHint')} />
        : (
          <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto">
            {clients.map((c) => (
              <li key={c.clid} className="flex items-center gap-3 px-5 py-2 text-sm">
                <span title={c.away ? t('dash.away') : c.outputMuted ? t('dash.speakerOff') : c.inputMuted ? t('dash.micOff') : t('dash.active')} className={clsx('h-2 w-2 shrink-0 rounded-full', c.away ? 'bg-slate-500' : c.outputMuted ? 'bg-rose-400' : c.inputMuted ? 'bg-amber-400' : 'bg-emerald-400')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-100">{canHistory ? <Link to={`/history/${encodeURIComponent(c.uid)}`} className="hover:underline" title={t('common.profileTitle')}>{c.nickname}</Link> : c.nickname}{c.country && <span className="ml-1.5 text-xs" title={c.country}>{countryFlag(c.country)}</span>}</span>
                  <span className="block truncate text-xs text-slate-500">{channelNames.get(c.cid) || t('dash.channelNum', { cid: c.cid })}{c.away && c.awayMessage ? ` · ${c.awayMessage}` : ''}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-slate-500">
                  <span className="block">{t('dash.sinceFor', { duration: formatDuration(Math.max(0, Math.floor(Date.now() / 1000) - c.lastconnected)) })}</span>
                  {c.idleTime > 5 * 60 * 1000 && <span className="block text-slate-600">{t('dash.idle', { duration: formatDuration(Math.floor(c.idleTime / 1000)) })}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

function TrafficRow({ icon: Icon, label, total, rate }: { icon: typeof Zap; label: string; total: string; rate?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-slate-500" />
      <span className="flex-1 text-slate-400">{label}</span>
      <span className="font-medium text-slate-100">{total}</span>
      {rate && <span className="w-24 text-right text-xs text-slate-500">{rate}</span>}
    </div>
  );
}

const EVENT_TONE: Record<string, string> = {
  'client.connect': 'bg-emerald-400',
  'client.disconnect': 'bg-slate-500',
  'client.kicked': 'bg-amber-400',
  'client.banned': 'bg-rose-500',
  'client.moved': 'bg-sky-400',
  chat: 'bg-fuchsia-400',
  'server.edit': 'bg-indigo-400',
  'query.connected': 'bg-emerald-400',
  'query.disconnected': 'bg-rose-400',
};

export function ActivityFeed({ events, limit = 40 }: { events: Ts3Event[]; limit?: number }) {
  const { t } = useT();
  if (!events.length) return <EmptyState icon={Activity} title={t('dash.noEvents')} description={t('dash.noEventsHint')} />;
  return (
    <ul className="max-h-96 divide-y divide-slate-800/70 overflow-y-auto">
      {events.slice(0, limit).map((e) => (
        <li key={e.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
          <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', EVENT_TONE[e.type] || (e.type.startsWith('channel.') ? 'bg-purple-400' : 'bg-slate-500'))} />
          <span className="flex-1 break-words text-slate-200">{describeEvent(e)}</span>
          <span className="shrink-0 text-xs text-slate-500" title={formatDate(e.ts, true)}>{formatTime(e.ts)}</span>
        </li>
      ))}
    </ul>
  );
}
