import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import {
  Ban, ChevronDown, ChevronRight, Database, Eye, FolderOpen, Hash, Headphones, History, KeyRound, Lock, LogOut, MessageSquare, Mic, MicOff, Moon, Move, Pencil, Plus, RefreshCw, Search, Shield, Star, Trash2, UserMinus, Users, VolumeX, X, Zap,
} from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { Channel, Client, DbClient, GroupsResponse } from '../api/types';
import { useAuth } from '../lib/auth';
import { countryFlag, durationPresets, formatDate, formatDuration } from '../lib/format';
import { t as tt, useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, FullPageSpinner, KV, Modal, PageHeader } from '../components/ui';
import { ChannelFormModal, ChannelMoveModal } from '../components/ChannelForm';

type ChannelAction = { type: 'edit' | 'create' | 'move' | 'delete'; cid: string; name: string };
type DropZone = 'before' | 'into' | 'after';
type DropEvent = { kind: 'client' | 'channel'; id: string; targetCid: string; zone: DropZone };
const DND_CLIENT = 'application/x-ts3-client';
const DND_CHANNEL = 'application/x-ts3-channel';

type Tab = 'tree' | 'list' | 'db';

interface TreeResponse { tree: Channel[]; clients: Client[]; channelCount: number; clientCount: number }

export default function ClientsPage() {
  const { can } = useAuth(); const canWrite = can('clients.manage'); const canChannels = can('channels.manage'); const canBan = can('bans.manage'); const canGroups = can('groups.manage'); const canHistory = can('history.view');
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('tree');
  const [selected, setSelected] = useState<Client | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [chAction, setChAction] = useState<ChannelAction | null>(null);
  const qc = useQueryClient();

  const tree = useQuery({ queryKey: ['clients', 'tree'], queryFn: () => api.get<TreeResponse>('/api/clients/tree'), refetchInterval: 15000 });

  const flatChannels = useMemo(() => {
    const out: { cid: string; pid: string; name: string; depth: number }[] = [];
    const walk = (list: Channel[], depth: number) => {
      for (const c of list) { out.push({ cid: c.cid, pid: c.pid, name: c.name, depth }); walk(c.children, depth + 1); }
    };
    walk(tree.data?.tree ?? [], 0);
    return out;
  }, [tree.data]);

  const toggle = (cid: string) => setCollapsed((prev) => { const n = new Set(prev); if (n.has(cid)) n.delete(cid); else n.add(cid); return n; });
  const deleteChannel = useMutation({
    mutationFn: (cid: string) => api.delete(`/api/channels/${cid}?force=1`),
    onSuccess: () => { toast.success(t('clients.channelDeleted')); setChAction(null); qc.invalidateQueries({ queryKey: ['clients'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Drag & Drop: Client → Kanal (verschieben), Kanal → Kanal (verschieben / umsortieren)
  const drop = useMutation({
    mutationFn: async (d: DropEvent) => {
      if (d.kind === 'client') return api.post(`/api/clients/${d.id}/move`, { cid: d.targetCid });
      const target = flatChannels.find((c) => c.cid === d.targetCid);
      if (!target) throw new Error(tt('clients.targetNotFound'));
      if (d.id === d.targetCid) throw new Error(tt('clients.moveSelf'));
      const descendants = new Set<string>();
      const collect = (id: string) => { for (const c of flatChannels) if (c.pid === id && !descendants.has(c.cid)) { descendants.add(c.cid); collect(c.cid); } };
      collect(d.id);
      if (descendants.has(d.targetCid)) throw new Error(tt('clients.moveIntoChild'));
      let cpid: string; let order: string;
      if (d.zone === 'into') { cpid = target.cid; order = '0'; }
      else if (d.zone === 'after') { cpid = target.pid; order = target.cid; }
      else { cpid = target.pid; const siblings = flatChannels.filter((c) => c.pid === target.pid && c.cid !== d.id); const idx = siblings.findIndex((c) => c.cid === target.cid); order = idx > 0 ? siblings[idx - 1].cid : '0'; }
      return api.post(`/api/channels/${d.id}/move`, { cpid, order: Number(order) });
    },
    onSuccess: (_, d) => { toast.success(d.kind === 'client' ? t('clients.clientMoved') : t('channel.moved')); qc.invalidateQueries({ queryKey: ['clients'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div>
      <PageHeader
        title={t('clients.title')}
        description={tree.data ? t('clients.summary', { clients: tree.data.clientCount, channels: tree.data.channelCount }) : t('clients.description')}
        actions={<>
          {canChannels && tab === 'tree' && <Button variant="primary" icon={Plus} onClick={() => setChAction({ type: 'create', cid: '0', name: '' })}>{t('channel.create')}</Button>}
          <Button variant="ghost" icon={RefreshCw} onClick={() => tree.refetch()} loading={tree.isFetching}>{t('common.refresh')}</Button>
        </>}
      />

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1 w-fit">
        {([['tree', t('clients.tab.tree'), Hash], ['list', t('clients.tab.list'), Users], ['db', t('clients.tab.db'), Database]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition', tab === key ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-100')}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab !== 'db' && tree.isLoading && <FullPageSpinner />}
      {tab !== 'db' && tree.error && <ErrorBox error={tree.error} onRetry={() => tree.refetch()} />}

      {tab === 'tree' && tree.data && (
        <Card noPadding>
          {tree.data.tree.length === 0 ? <EmptyState icon={Hash} title={t('clients.noChannels')} /> : (
            <>
              <ul className="py-2">
                {tree.data.tree.map((ch) => <ChannelNode key={ch.cid} ch={ch} depth={0} collapsed={collapsed} toggle={toggle} onSelect={setSelected} canWrite={canWrite} canChannels={canChannels} onAction={setChAction} onDrop={(d) => drop.mutate(d)} />)}
              </ul>
              {(canWrite || canChannels) && <p className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">{t('clients.dndHint')}</p>}
            </>
          )}
        </Card>
      )}

      {tab === 'list' && tree.data && (
        <Card noPadding>
          {tree.data.clients.length === 0 ? <EmptyState icon={Users} title={t('dash.nobodyOnline')} description={t('dash.nobodyOnlineHint')} /> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Nickname</th><th>{t('clients.th.channel')}</th><th>{t('clients.th.country')}</th><th>IP</th><th>Idle</th><th>{t('clients.th.connectedSince')}</th><th>{t('clients.client')}</th><th></th></tr></thead>
                <tbody>
                  {tree.data.clients.map((c) => {
                    const ch = flatChannels.find((x) => x.cid === c.cid);
                    return (
                      <tr key={c.clid} className="cursor-pointer" onClick={() => setSelected(c)}>
                        <td><ClientName c={c} /></td>
                        <td className="text-slate-300">{ch?.name || c.cid}</td>
                        <td>{countryFlag(c.country)} {c.country}</td>
                        <td className="font-mono text-xs">{c.ip || '–'}</td>
                        <td>{formatDuration(Math.floor(c.idleTime / 1000))}</td>
                        <td>{formatDate(c.lastconnected)}</td>
                        <td className="text-xs text-slate-400">{c.version?.split(' ')[0]} · {c.platform}</td>
                        <td className="text-right"><span className="inline-flex items-center gap-1">{canHistory && <Link to={`/history/${encodeURIComponent(c.uid)}`} className="btn btn-ghost btn-sm" title={t('common.profileTitle')} onClick={(e) => e.stopPropagation()}><History className="h-3.5 w-3.5" /></Link>}<Button size="sm" variant="ghost">{t('clients.details')}</Button></span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'db' && <DbSearch canWrite={canBan} />}

      <ClientModal client={selected} onClose={() => setSelected(null)} channels={flatChannels} canWrite={canWrite} canBan={canBan} canGroups={canGroups} />
      <ChannelFormModal open={chAction?.type === 'edit'} onClose={() => setChAction(null)} mode="edit" cid={chAction?.cid} />
      <ChannelFormModal open={chAction?.type === 'create'} onClose={() => setChAction(null)} mode="create" parentCid={chAction?.cid} parentName={chAction?.name || undefined} />
      <ChannelMoveModal open={chAction?.type === 'move'} onClose={() => setChAction(null)} cid={chAction?.cid || '0'} name={chAction?.name || ''} channels={flatChannels} />
      <ConfirmDialog open={chAction?.type === 'delete'} onClose={() => setChAction(null)} onConfirm={() => chAction && deleteChannel.mutate(chAction.cid)} loading={deleteChannel.isPending} title={t('clients.deleteChannelConfirm')} confirmLabel={t('common.delete')}
        message={t('clients.deleteChannelMsg', { name: chAction?.name ?? '' })} />
    </div>
  );
}

function ChannelNode({ ch, depth, collapsed, toggle, onSelect, canWrite, canChannels, onAction, onDrop }: { ch: Channel; depth: number; collapsed: Set<string>; toggle: (cid: string) => void; onSelect: (c: Client) => void; canWrite: boolean; canChannels: boolean; onAction: (a: ChannelAction) => void; onDrop: (d: DropEvent) => void }) {
  const { t } = useT();
  const isCollapsed = collapsed.has(ch.cid);
  const hasContent = ch.children.length > 0 || ch.clients.length > 0;
  const isSpacer = /^\[[*c]?spacer[^\]]*\]/i.test(ch.name);
  const displayName = ch.name.replace(/^\[[*c]?spacer[^\]]*\]/i, '').trim();
  const [zone, setZone] = useState<DropZone | null>(null);

  const zoneFor = (e: React.DragEvent<HTMLDivElement>): DropZone => {
    if (e.dataTransfer.types.includes(DND_CLIENT)) return 'into';
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const isClientDrag = e.dataTransfer.types.includes(DND_CLIENT); const isChannelDrag = e.dataTransfer.types.includes(DND_CHANNEL);
    if (!((isClientDrag && canWrite) || (isChannelDrag && canChannels))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const z = zoneFor(e);
    if (z !== zone) setZone(z);
  };
  const onDropHere = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const z = zoneFor(e);
    setZone(null);
    const clid = e.dataTransfer.getData(DND_CLIENT);
    const cid = e.dataTransfer.getData(DND_CHANNEL);
    if (clid) onDrop({ kind: 'client', id: clid, targetCid: ch.cid, zone: 'into' });
    else if (cid && cid !== ch.cid) onDrop({ kind: 'channel', id: cid, targetCid: ch.cid, zone: z });
  };
  return (
    <li>
      <div
        className={clsx('group relative flex items-center gap-2 px-4 py-1.5 text-sm hover:bg-slate-800/40', isSpacer && 'opacity-60', canChannels && 'cursor-grab active:cursor-grabbing',
          zone === 'into' && 'bg-indigo-500/20 ring-1 ring-inset ring-indigo-400/60', zone === 'before' && 'shadow-[inset_0_2px_0_0_#818cf8]', zone === 'after' && 'shadow-[inset_0_-2px_0_0_#818cf8]')}
        style={{ paddingLeft: `${16 + depth * 20}px` }}
        draggable={canChannels}
        onDragStart={(e) => { e.dataTransfer.setData(DND_CHANNEL, ch.cid); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={onDragOver}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setZone(null); }}
        onDrop={onDropHere}
      >
        <button className={clsx('flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:text-slate-200', !hasContent && 'invisible')} onClick={() => toggle(ch.cid)}>
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {ch.flagDefault ? <Star className="h-4 w-4 text-amber-400" /> : ch.flagPassword ? <Lock className="h-4 w-4 text-rose-400" /> : <Hash className="h-4 w-4 text-slate-500" />}
        <span className={clsx('truncate font-medium', isSpacer ? 'text-slate-500' : 'text-slate-100')}>{isSpacer ? displayName || t('clients.spacer') : ch.name}</span>
        {ch.topic && <span className="hidden truncate text-xs text-slate-500 md:inline">— {ch.topic}</span>}
        <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <span className="hidden items-center gap-0.5 group-hover:flex">
            {canChannels && <button className="btn btn-ghost btn-icon h-6 w-6" title={t('users.edit')} onClick={() => onAction({ type: 'edit', cid: ch.cid, name: ch.name })}><Pencil className="h-3.5 w-3.5" /></button>}
            {canChannels && <button className="btn btn-ghost btn-icon h-6 w-6" title={t('clients.createSub')} onClick={() => onAction({ type: 'create', cid: ch.cid, name: ch.name })}><Plus className="h-3.5 w-3.5" /></button>}
            {canChannels && <button className="btn btn-ghost btn-icon h-6 w-6" title={t('channel.move')} onClick={() => onAction({ type: 'move', cid: ch.cid, name: ch.name })}><Move className="h-3.5 w-3.5" /></button>}
            <Link to={`/permissions/channel/${ch.cid}`} className="btn btn-ghost btn-icon h-6 w-6" title={t('clients.channelPerms')}><KeyRound className="h-3.5 w-3.5" /></Link>
            <Link to={`/files?cid=${ch.cid}`} className="btn btn-ghost btn-icon h-6 w-6" title={t('nav.files')}><FolderOpen className="h-3.5 w-3.5" /></Link>
            {canChannels && <button className="btn btn-ghost btn-icon h-6 w-6 text-rose-400" title={t('common.delete')} onClick={() => onAction({ type: 'delete', cid: ch.cid, name: ch.name })}><Trash2 className="h-3.5 w-3.5" /></button>}
          </span>
          {ch.flagPermanent ? null : <Badge tone="slate">{ch.flagSemiPermanent ? t('clients.semiPermanent') : t('clients.temporary')}</Badge>}
          {ch.clients.length > 0 && <Badge tone="indigo">{ch.clients.length}{ch.maxclients >= 0 ? ` / ${ch.maxclients}` : ''}</Badge>}
        </span>
      </div>
      {!isCollapsed && (
        <ul>
          {ch.clients.map((c) => (
            <li key={c.clid} draggable={canWrite} onDragStart={(e) => { e.dataTransfer.setData(DND_CLIENT, c.clid); e.dataTransfer.effectAllowed = 'move'; e.stopPropagation(); }}>
              <button onClick={() => onSelect(c)} className={clsx('flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-indigo-500/10', canWrite && 'cursor-grab active:cursor-grabbing')} style={{ paddingLeft: `${16 + (depth + 1) * 20 + 4}px` }}>
                <ClientIcon c={c} />
                <ClientName c={c} />
                <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                  {c.country && <span title={c.country}>{countryFlag(c.country)}</span>}
                  {c.isChannelCommander && <Badge tone="amber">{t('clients.commander')}</Badge>}
                  {c.isPrioritySpeaker && <Badge tone="blue">{t('clients.priority')}</Badge>}
                  {c.isRecording && <Badge tone="red">REC</Badge>}
                  <span className="hidden sm:inline">{t('clients.idle', { duration: formatDuration(Math.floor(c.idleTime / 1000)) })}</span>
                </span>
              </button>
            </li>
          ))}
          {ch.children.map((child) => <ChannelNode key={child.cid} ch={child} depth={depth + 1} collapsed={collapsed} toggle={toggle} onSelect={onSelect} canWrite={canWrite} canChannels={canChannels} onAction={onAction} onDrop={onDrop} />)}
        </ul>
      )}
    </li>
  );
}

function ClientIcon({ c }: { c: Client }) {
  if (c.away) return <Moon className="h-4 w-4 text-slate-500" />;
  if (c.outputMuted) return <VolumeX className="h-4 w-4 text-rose-400" />;
  if (c.inputMuted) return <MicOff className="h-4 w-4 text-amber-400" />;
  return <Mic className="h-4 w-4 text-emerald-400" />;
}

function ClientName({ c }: { c: Client }) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-medium text-slate-100">{c.nickname}</span>
      {c.away && c.awayMessage && <span className="text-xs text-slate-500">({c.awayMessage})</span>}
    </span>
  );
}

function ClientModal({ client, onClose, channels, canWrite, canBan, canGroups }: { client: Client | null; onClose: () => void; channels: { cid: string; name: string; depth: number }[]; canWrite: boolean; canBan: boolean; canGroups: boolean }) {
  const qc = useQueryClient();
  const { t } = useT();
  const canHistory = useAuth().can('history.view');
  const [mode, setMode] = useState<'info' | 'groups' | 'kick' | 'poke' | 'message' | 'move' | 'ban'>('info');
  const [text, setText] = useState('');
  const [scope, setScope] = useState<'server' | 'channel'>('server');
  const [cid, setCid] = useState('');
  const [time, setTime] = useState(0);
  const [customTime, setCustomTime] = useState('');

  const reset = () => { setMode('info'); setText(''); setScope('server'); setCid(''); setTime(0); setCustomTime(''); };
  const close = () => { reset(); onClose(); };

  const act = useMutation({
    mutationFn: async () => {
      if (!client) return;
      const clid = client.clid;
      if (mode === 'kick') return api.post(`/api/clients/${clid}/kick`, { scope, reason: text });
      if (mode === 'poke') return api.post(`/api/clients/${clid}/poke`, { message: text });
      if (mode === 'message') return api.post(`/api/clients/${clid}/message`, { message: text });
      if (mode === 'move') return api.post(`/api/clients/${clid}/move`, { cid });
      if (mode === 'ban') return api.post(`/api/clients/${clid}/ban`, { time: customTime ? Number(customTime) * 60 : time, reason: text });
    },
    onSuccess: () => {
      const msg = { kick: t('clients.kicked'), poke: t('clients.poked'), message: t('clients.messageSent'), move: t('clients.clientMoved'), ban: t('clients.banned'), info: '', groups: '' }[mode];
      if (msg) toast.success(msg);
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['bans'] });
      close();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!client) return null;
  const c = client;
  const chName = channels.find((x) => x.cid === c.cid)?.name || c.cid;
  const actionLabel = { kick: t('clients.kick'), poke: t('clients.poke'), message: t('dash.send'), move: t('channel.move'), ban: t('clients.ban'), info: '', groups: '' }[mode];

  return (
    <Modal open onClose={close} title={<span className="flex items-center gap-2"><Headphones className="h-4 w-4 text-indigo-400" />{c.nickname}</span>} size="lg"
      footer={mode === 'groups' ? (
        <Button variant="ghost" onClick={() => setMode('info')}>{t('common.back')}</Button>
      ) : mode === 'info' ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={Shield} onClick={() => setMode('groups')}>{t('clients.serverGroups')}</Button>
          {canHistory && <Link to={`/history/${encodeURIComponent(c.uid)}`} className="btn btn-secondary btn-sm" onClick={close}><History className="h-3.5 w-3.5" /> {t('clients.profile')}</Link>}
          <Link to={`/permissions/client/${c.databaseId}`} className="btn btn-secondary btn-sm" onClick={close}><KeyRound className="h-3.5 w-3.5" /> {t('groups.permissions')}</Link>
          <Link to={`/permissions/channelclient/${c.cid}:${c.databaseId}`} className="btn btn-secondary btn-sm" onClick={close}><KeyRound className="h-3.5 w-3.5" /> {t('clients.permsInChannel')}</Link>
          <Link to={`/permissions/overview/${c.databaseId}/${c.cid}`} className="btn btn-secondary btn-sm" onClick={close}><Eye className="h-3.5 w-3.5" /> {t('perms.effective')}</Link>
          {canWrite && <>
          <Button size="sm" icon={Zap} onClick={() => setMode('poke')}>{t('clients.poke')}</Button>
          <Button size="sm" icon={MessageSquare} onClick={() => setMode('message')}>{t('clients.message')}</Button>
          <Button size="sm" icon={Move} onClick={() => { setCid(c.cid); setMode('move'); }}>{t('channel.move')}</Button>
          <Button size="sm" variant="warning" icon={LogOut} onClick={() => setMode('kick')}>{t('clients.kick')}</Button>
          </>}
          {canBan && <Button size="sm" variant="danger" icon={Ban} onClick={() => setMode('ban')}>{t('clients.ban')}</Button>}
        </div>
      ) : (
        <>
          <Button variant="ghost" onClick={() => setMode('info')}>{t('common.back')}</Button>
          <Button variant={mode === 'ban' ? 'danger' : mode === 'kick' ? 'warning' : 'primary'} loading={act.isPending} onClick={() => act.mutate()} disabled={(mode === 'poke' || mode === 'message') && !text.trim()}>
            {actionLabel}
          </Button>
        </>
      )}
    >
      {mode === 'groups' && <ClientGroups cldbid={c.databaseId} nickname={c.nickname} canWrite={canGroups} />}
      {mode === 'info' && (
        <KV items={[
          { k: t('clients.clientId'), v: c.clid },
          { k: t('clients.dbId'), v: c.databaseId },
          { k: t('clients.th.channel'), v: chName },
          { k: 'Unique ID', v: <span className="font-mono text-xs">{c.uid}</span> },
          { k: t('clients.ipAddress'), v: <span className="font-mono text-xs">{c.ip || '–'}</span> },
          { k: t('clients.th.country'), v: c.country ? `${countryFlag(c.country)} ${c.country}` : '–' },
          { k: t('clients.client'), v: `${c.version} (${c.platform})` },
          { k: 'Idle', v: formatDuration(Math.floor(c.idleTime / 1000)) },
          { k: t('clients.th.connectedSince'), v: formatDate(c.lastconnected) },
          { k: t('dash.created'), v: formatDate(c.created) },
          { k: t('clients.serverGroups'), v: c.servergroups.join(', ') || '–' },
          { k: t('clients.channelGroup'), v: c.channelGroupId },
          { k: 'Talk Power', v: String(c.talkPower) },
          { k: t('common.status'), v: <span className="flex justify-end gap-1">{c.away && <Badge tone="slate">{t('clients.away')}</Badge>}{c.inputMuted && <Badge tone="amber">{t('clients.micOff')}</Badge>}{c.outputMuted && <Badge tone="red">{t('clients.soundOff')}</Badge>}{!c.away && !c.inputMuted && !c.outputMuted && <Badge tone="green">{t('clients.activeState')}</Badge>}</span> },
        ]} />
      )}
      {mode === 'kick' && (
        <div className="space-y-4">
          <Field label={t('clients.scope')}>
            <div className="flex gap-2">
              <Button variant={scope === 'server' ? 'primary' : 'secondary'} onClick={() => setScope('server')}>{t('clients.fromServer')}</Button>
              <Button variant={scope === 'channel' ? 'primary' : 'secondary'} onClick={() => setScope('channel')}>{t('clients.fromChannel')}</Button>
            </div>
          </Field>
          <Field label={t('clients.reasonOptional')}><input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={80} autoFocus /></Field>
        </div>
      )}
      {(mode === 'poke' || mode === 'message') && (
        <Field label={mode === 'poke' ? t('clients.pokeMessage') : t('clients.privateMessage')}>
          <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={mode === 'poke' ? 100 : 1024} autoFocus />
        </Field>
      )}
      {mode === 'move' && (
        <Field label={t('clients.targetChannel')}>
          <select className="input" value={cid} onChange={(e) => setCid(e.target.value)}>
            {channels.map((ch) => <option key={ch.cid} value={ch.cid}>{'  '.repeat(ch.depth)}{ch.name}</option>)}
          </select>
        </Field>
      )}
      {mode === 'ban' && <BanForm time={time} setTime={setTime} customTime={customTime} setCustomTime={setCustomTime} reason={text} setReason={setText} />}
    </Modal>
  );
}

/** Servergruppen eines Clients anzeigen und (mit Schreibrecht) ändern. */
export function ClientGroups({ cldbid, nickname, canWrite, onChanged }: { cldbid: string; nickname: string; canWrite: boolean; onChanged?: () => void }) {
  const qc = useQueryClient();
  const { t } = useT();
  const [selected, setSelected] = useState('');
  const mine = useQuery({ queryKey: ['groups', 'client', cldbid], queryFn: () => api.get<{ groups: { sgid: string; name: string }[] }>(`/api/groups/client/${cldbid}`) });
  const all = useQuery({ queryKey: ['groups'], queryFn: () => api.get<GroupsResponse>('/api/groups'), enabled: canWrite });
  const inv = () => { qc.invalidateQueries({ queryKey: ['groups'] }); qc.invalidateQueries({ queryKey: ['clients'] }); onChanged?.(); };
  const add = useMutation({
    mutationFn: (sgid: string) => api.post(`/api/groups/server/${sgid}/members`, { cldbid }),
    onSuccess: () => { toast.success(t('clients.addedToGroup', { nickname })); setSelected(''); inv(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (sgid: string) => api.delete(`/api/groups/server/${sgid}/members/${cldbid}`),
    onSuccess: () => { toast.success(t('clients.removedFromGroup', { nickname })); inv(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const mineIds = new Set(mine.data?.groups.map((g) => g.sgid));
  const available = (all.data?.serverGroups ?? []).filter((g) => g.type === 1 && !mineIds.has(g.sgid));
  return (
    <div className="space-y-4">
      {mine.error && <ErrorBox error={mine.error} onRetry={() => mine.refetch()} compact />}
      {mine.data && (mine.data.groups.length === 0 ? <p className="text-sm text-slate-400">{t('clients.noServerGroups')}</p> : (
        <ul className="divide-y divide-slate-800/70 rounded-lg border border-slate-800">
          {mine.data.groups.map((g) => (
            <li key={g.sgid} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Shield className="h-4 w-4 text-indigo-400" />
              <span className="font-medium text-slate-100">{g.name}</span>
              <span className="ml-auto font-mono text-xs text-slate-500">#{g.sgid}</span>
              {canWrite && <Button size="sm" variant="ghost" icon={X} title={t('clients.removeFromGroup')} onClick={() => remove.mutate(g.sgid)} loading={remove.isPending && remove.variables === g.sgid} />}
            </li>
          ))}
        </ul>
      ))}
      {canWrite && (
        <Field label={t('clients.addToGroup')}>
          <div className="flex gap-2">
            <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">{t('clients.chooseGroup')}</option>
              {available.map((g) => <option key={g.sgid} value={g.sgid}>{g.name}</option>)}
            </select>
            <Button variant="primary" disabled={!selected} loading={add.isPending} onClick={() => add.mutate(selected)}>{t('groups.add')}</Button>
          </div>
        </Field>
      )}
    </div>
  );
}

export function BanForm({ time, setTime, customTime, setCustomTime, reason, setReason, children }: { time: number; setTime: (n: number) => void; customTime: string; setCustomTime: (s: string) => void; reason: string; setReason: (s: string) => void; children?: ReactNode }) {
  const { t } = useT();
  return (
    <div className="space-y-4">
      <Field label={t('clients.duration')}>
        <div className="flex flex-wrap gap-2">
          {durationPresets().map((p) => (
            <Button key={p.seconds} size="sm" variant={!customTime && time === p.seconds ? 'primary' : 'secondary'} onClick={() => { setTime(p.seconds); setCustomTime(''); }}>{p.label}</Button>
          ))}
        </div>
      </Field>
      <Field label={t('clients.customDuration')} hint={t('clients.customDurationHint')}>
        <input className="input" type="number" min={1} value={customTime} onChange={(e) => setCustomTime(e.target.value)} placeholder={t('clients.customDurationPlaceholder')} />
      </Field>
      <Field label={t('common.reason')}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t('clients.banReasonPlaceholder')} /></Field>
      {children}
    </div>
  );
}

function DbSearch({ canWrite }: { canWrite: boolean }) {
  const canHistory = useAuth().can('history.view');
  const { t } = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [target, setTarget] = useState<DbClient | null>(null);
  const [time, setTime] = useState(0);
  const [customTime, setCustomTime] = useState('');
  const [reason, setReason] = useState('');
  const [banIp, setBanIp] = useState(false);

  const result = useQuery({ queryKey: ['clients', 'db', submitted], queryFn: () => api.get<{ entries: DbClient[] }>(`/api/clients/db/search?q=${encodeURIComponent(submitted)}&limit=100`) });

  const ban = useMutation({
    mutationFn: () => api.post(`/api/clients/db/${target!.cldbid}/ban`, { time: customTime ? Number(customTime) * 60 : time, reason, banIp }),
    onSuccess: () => { toast.success(t('clients.banCreated')); setTarget(null); setReason(''); setBanIp(false); qc.invalidateQueries({ queryKey: ['bans'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <Card title={t('clients.dbTitle')} subtitle={t('clients.dbSubtitle')} noPadding>
        <form className="flex gap-2 border-b border-slate-800 p-4" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }}>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input className="input pl-9" placeholder={t('clients.dbPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button type="submit" variant="primary" loading={result.isFetching}>{t('common.search')}</Button>
        </form>
        {result.error && <div className="p-4"><ErrorBox error={result.error} onRetry={() => result.refetch()} /></div>}
        {result.data && (result.data.entries.length === 0 ? <EmptyState icon={Database} title={t('common.noMatches')} /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>DB-ID</th><th>Nickname</th><th>Unique ID</th><th>{t('clients.th.lastIp')}</th><th>{t('clients.th.lastOnline')}</th><th>{t('clients.th.connections')}</th><th>{t('dash.created')}</th>{canWrite && <th></th>}</tr></thead>
              <tbody>
                {result.data.entries.map((e) => (
                  <tr key={e.cldbid}>
                    <td className="font-mono text-xs">{e.cldbid}</td>
                    <td className="font-medium text-slate-100">{e.nickname}</td>
                    <td className="font-mono text-xs">{canHistory ? <Link to={`/history/${encodeURIComponent(e.uid)}`} className="hover:underline" title={t('common.profileTitle')}>{e.uid}</Link> : e.uid}</td>
                    <td className="font-mono text-xs">{e.lastIp || '–'}</td>
                    <td>{formatDate(e.lastconnected)}</td>
                    <td>{e.totalconnections}</td>
                    <td>{formatDate(e.created)}</td>
                    {canWrite && <td className="text-right"><Button size="sm" variant="danger" icon={UserMinus} onClick={() => setTarget(e)}>{t('clients.ban')}</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Card>
      <Modal open={Boolean(target)} onClose={() => setTarget(null)} title={t('clients.banTitle', { name: target?.nickname ?? '' })} size="md"
        footer={<><Button variant="ghost" onClick={() => setTarget(null)}>{t('common.cancel')}</Button><Button variant="danger" icon={Ban} loading={ban.isPending} onClick={() => ban.mutate()}>{t('clients.ban')}</Button></>}>
        <BanForm time={time} setTime={setTime} customTime={customTime} setCustomTime={setCustomTime} reason={reason} setReason={setReason}>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-600 bg-slate-900" checked={banIp} onChange={(e) => setBanIp(e.target.checked)} disabled={!target?.lastIp} />
            {t('clients.banAlsoIp')} {target?.lastIp && <span className="font-mono text-xs text-slate-500">({target.lastIp})</span>}
          </label>
          <p className="text-xs text-slate-500">{t('clients.banUidNote', { uid: target?.uid ?? '' })}</p>
        </BanForm>
      </Modal>
    </>
  );
}
