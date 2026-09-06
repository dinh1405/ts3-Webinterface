import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, Ban, Clock, Eye, Flag, Globe, History, KeyRound, LogIn, Move, Pencil, Shield, StickyNote, Tag, Trash2, UserX, Users } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { HistoryEvent, HistoryProfile, HistorySession } from '../api/types';
import { useAuth } from '../lib/auth';
import { banDuration, countryFlag, durationPresets, formatBytes, formatDate, formatDayMonth, formatDuration, formatDurationShort, formatRelative, formatShortDate } from '../lib/format';
import { td, useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, FullPageSpinner, KV, Modal, PageHeader, Stat, Toggle } from '../components/ui';
import { ClientGroups } from './Clients';

const EVENT_META: Record<HistoryEvent['type'], { tone: 'indigo' | 'slate' | 'amber' | 'red'; icon: typeof Tag }> = {
  nick: { tone: 'indigo', icon: Tag },
  move: { tone: 'slate', icon: Move },
  kick: { tone: 'amber', icon: UserX },
  ban: { tone: 'red', icon: Ban },
};

/** Trennungsgrund: Schlüssel nach reasonid, Fallback der gespeicherte Text. */
const reasonText = (s: HistorySession) => (s.reasonid === null || s.reasonid === undefined ? td('reason.unknown') : td(`reason.${s.reasonid}`, undefined, s.reason ?? ''));

export default function ClientProfilePage() {
  const { uid = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { t } = useT();
  const canManage = can('history.manage');
  const canBan = can('bans.manage');
  const canGroups = can('groups.manage');
  const [tab, setTab] = useState<'sessions' | 'events' | 'actions'>('sessions');
  const [banOpen, setBanOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [note, setNote] = useState('');

  const key = ['history', 'profile', uid];
  const profile = useQuery({ queryKey: key, queryFn: () => api.get<HistoryProfile>(`/api/history/${encodeURIComponent(uid)}`), enabled: Boolean(uid), refetchInterval: 30000 });

  const addNote = useMutation({
    mutationFn: () => api.post(`/api/history/${encodeURIComponent(uid)}/notes`, { text: note }),
    onSuccess: () => { toast.success(t('profile.noteSaved')); setNote(''); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeNote = useMutation({
    mutationFn: (id: string) => api.delete(`/api/history/${encodeURIComponent(uid)}/notes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const unban = useMutation({
    mutationFn: (banid: string) => api.delete(`/api/bans/${banid}`),
    onSuccess: () => { toast.success(t('profile.banLifted')); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['bans'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/history/${encodeURIComponent(uid)}`),
    onSuccess: () => { toast.success(t('profile.historyDeleted')); qc.invalidateQueries({ queryKey: ['history'] }); navigate('/history'); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const p = profile.data;
  const daily = useMemo(() => (p?.daily ?? []).map((d) => ({ ...d, label: formatDayMonth(new Date(`${d.day}T12:00:00`)), hours: Math.round((d.onlineSec / 3600) * 10) / 10 })), [p?.daily]);
  const hourMax = useMemo(() => Math.max(1, ...(p?.hours ?? [0])), [p?.hours]);

  if (profile.isLoading) return <FullPageSpinner />;
  if (profile.error || !p) return <div><Link to="/history" className="btn btn-ghost btn-sm mb-4"><ArrowLeft className="h-4 w-4" /> {t('profile.toHistory')}</Link><ErrorBox error={profile.error ?? new Error(t('profile.noProfile'))} onRetry={() => profile.refetch()} /></div>;

  const id = p.identity;
  const online = p.live.online;
  const country = id.countries[0]?.code || '';
  const groupCldbid = p.live.db?.cldbid ?? id.cldbid ?? null;

  return (
    <div className="space-y-6">
      <Link to="/history" className="btn btn-ghost btn-sm -ml-2"><ArrowLeft className="h-4 w-4" /> {t('history.title')}</Link>
      <PageHeader
        title={<span className="flex items-center gap-3">{id.nickname || t('profile.unknownClient')}{country && <span className="text-xl" title={country}>{countryFlag(country)}</span>}{online ? <Badge tone="green" dot pulse>online</Badge> : <Badge tone="slate">offline</Badge>}</span>}
        description={<span className="font-mono text-xs">{id.uid}{id.cldbid && <span className="ml-3 font-sans">DB-ID {id.cldbid}</span>}</span>}
        actions={<div className="flex flex-wrap gap-2">
          {online && <Link to="/clients" className="btn btn-secondary btn-sm"><Users className="h-3.5 w-3.5" /> {t('profile.inTree')}</Link>}
          {id.cldbid && <Link to={`/permissions/client/${id.cldbid}`} className="btn btn-secondary btn-sm"><KeyRound className="h-3.5 w-3.5" /> {t('groups.permissions')}</Link>}
          {id.cldbid && online && <Link to={`/permissions/overview/${id.cldbid}/${online.cid}`} className="btn btn-secondary btn-sm"><Eye className="h-3.5 w-3.5" /> {t('perms.effective')}</Link>}
          {canBan && id.cldbid && p.live.available && <Button size="sm" variant="danger" icon={Ban} onClick={() => setBanOpen(true)}>{t('clients.ban')}</Button>}
          {canManage && p.tracked !== false && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDeleteOpen(true)} title={t('profile.deleteHistoryTitle')}>{t('profile.deleteHistory')}</Button>}
        </div>}
      />

      {p.tracked === false && <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{t('profile.notTracked')}</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={t('profile.sessions')} value={id.sessions} sub={p.live.db ? t('profile.perDb', { count: p.live.db.totalconnections }) : undefined} icon={LogIn} />
        <Stat label={t('profile.onlineTime')} value={formatDurationShort(id.onlineSec)} sub={t('profile.sinceRecording')} icon={Clock} tone="green" />
        <Stat label={t('profile.firstSeen')} value={formatShortDate(id.firstSeen)} sub={p.live.db?.created ? t('profile.accountSince', { date: formatShortDate(p.live.db.created) }) : formatRelative(id.firstSeen)} icon={History} tone="blue" />
        <Stat label={t('profile.lastSeen')} value={online ? t('profile.now') : formatShortDate(id.lastSeen)} sub={online ? 'online' : formatRelative(id.lastSeen)} icon={Globe} tone="purple" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title={t('profile.dailyTitle')} subtitle={t('profile.dailySub')}>
            {daily.every((d) => d.onlineSec === 0) ? <EmptyState icon={Clock} title={t('profile.noDaily')} /> : (
              <div className="h-48">
                <ResponsiveContainer>
                  <BarChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-slate-800)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-slate-500)' }} interval={4} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-slate-500)' }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: 'var(--color-slate-800)', opacity: 0.4 }} contentStyle={{ background: 'var(--color-slate-900)', border: '1px solid var(--color-slate-800)', borderRadius: 8, fontSize: 12 }} formatter={(v) => [formatDuration(Number(v) * 3600), 'online']} />
                    <Bar dataKey="hours" fill="var(--color-indigo-500)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card noPadding
            title={<div className="flex gap-1">
              {([['sessions', t('profile.tab.sessions', { count: p.sessionsTotal })], ['events', t('profile.tab.events', { count: p.events.length })], ['actions', t('profile.tab.actions', { count: p.actions.length })]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={clsx('rounded-md px-2.5 py-1 text-sm font-medium transition', tab === k ? 'bg-indigo-500/12 text-indigo-300' : 'text-slate-400 hover:text-slate-100')}>{label}</button>
              ))}
            </div>}>
            {tab === 'sessions' && <SessionsTable sessions={p.sessions} />}
            {tab === 'events' && <EventsList events={p.events} />}
            {tab === 'actions' && (p.actions.length === 0 ? <EmptyState icon={History} title={t('profile.noActions')} description={t('profile.noActionsHint')} /> : (
              <ul className="divide-y divide-slate-800/60">
                {p.actions.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                    <Badge tone={a.action.includes('ban') ? 'red' : a.action.includes('kick') ? 'amber' : a.action.startsWith('group') ? 'purple' : 'indigo'}>{a.action}</Badge>
                    <span className="min-w-0 flex-1 truncate text-slate-300" title={JSON.stringify(a.details)}>{Object.entries(a.details).filter(([k, v]) => v !== '' && v !== null && v !== undefined && !['uid', 'cldbid', 'clid'].includes(k)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ') || '–'}</span>
                    <span className="whitespace-nowrap text-xs text-slate-500">{a.username} · {formatDate(a.ts)}</span>
                  </li>
                ))}
              </ul>
            ))}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title={t('profile.identity')}>
            <KV items={[
              { k: t('clients.dbId'), v: id.cldbid || '–' },
              { k: t('clients.th.country'), v: id.countries.length ? id.countries.map((c) => `${countryFlag(c.code)} ${c.code}`).join(', ') : '–' },
              { k: t('clients.client'), v: id.version ? `${id.version} (${id.platform})` : '–' },
              ...(p.live.db ? [
                { k: t('profile.accountCreated'), v: formatDate(p.live.db.created) },
                { k: t('profile.connectionsTs3'), v: String(p.live.db.totalconnections) },
                { k: t('profile.lastIpTs3'), v: <span className="font-mono text-xs">{p.live.db.lastIp || '–'}</span> },
                { k: t('profile.trafficTotal'), v: `↑ ${formatBytes(p.live.db.totalBytesUploaded)} · ↓ ${formatBytes(p.live.db.totalBytesDownloaded)}` },
                ...(p.live.db.description ? [{ k: t('channel.description'), v: p.live.db.description }] : []),
              ] : []),
              ...(online ? [
                { k: t('profile.currentChannel'), v: online.cid },
                { k: t('clients.th.connectedSince'), v: formatDate(online.lastconnected) },
                { k: 'Idle', v: formatDuration(Math.floor(online.idleTime / 1000)) },
              ] : []),
            ]} />
            {!p.live.available && <p className="mt-3 text-xs text-amber-300">{t('profile.liveUnavailable')}</p>}
          </Card>

          <Card title={t('profile.nicknames')} subtitle={t('profile.distinct', { count: id.nicknames.length })} noPadding>
            <ul className="max-h-64 divide-y divide-slate-800/60 overflow-y-auto">
              {id.nicknames.map((n) => (
                <li key={n.name} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                  <span className={clsx('truncate', n.name === id.nickname ? 'font-medium text-slate-100' : 'text-slate-300')}>{n.name}</span>
                  <span className="whitespace-nowrap text-xs text-slate-500" title={t('profile.firstLast', { first: formatDate(n.first), last: formatDate(n.last) })}>{formatRelative(n.last)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={t('profile.ips')} subtitle={t('profile.distinct', { count: id.ips.length })} noPadding>
            <ul className="max-h-64 divide-y divide-slate-800/60 overflow-y-auto">
              {id.ips.length === 0 && <li className="px-5 py-3 text-sm text-slate-500">{t('profile.noIp')}</li>}
              {id.ips.map((ip) => (
                <li key={ip.ip} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                  <Link to={`/history?q=${encodeURIComponent(ip.ip)}`} className="font-mono text-xs text-slate-200 hover:underline" title={t('profile.searchIp')}>{ip.ip}</Link>
                  <span className="whitespace-nowrap text-xs text-slate-500" title={t('profile.firstLast', { first: formatDate(ip.first), last: formatDate(ip.last) })}>{formatRelative(ip.last)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={t('profile.byHour')} subtitle={t('profile.last30')}>
            <div className="flex h-16 items-end gap-px">
              {p.hours.map((v, h) => (
                <div key={h} className="flex-1 rounded-t-sm bg-indigo-500/80" style={{ height: `${Math.max(2, (v / hourMax) * 100)}%`, opacity: v ? 1 : 0.15 }} title={t('profile.hourTip', { from: h, to: h + 1, duration: formatDuration(v) })} />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-500"><span>{t('profile.hour0')}</span><span>6</span><span>12</span><span>18</span><span>{t('profile.hour24')}</span></div>
          </Card>

          <Card title={t('clients.serverGroups')} subtitle={p.live.available && groupCldbid ? t('profile.groupsSub') : undefined} noPadding>
            {p.live.available && groupCldbid ? (
              <div className="space-y-3 px-5 py-3">
                <ClientGroups cldbid={groupCldbid} nickname={id.nickname} canWrite={canGroups} onChanged={() => qc.invalidateQueries({ queryKey: key })} />
                {p.live.groups.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{t('profile.groupPerms')}
                    {p.live.groups.map((g) => <Link key={g.sgid} to={`/permissions/servergroup/${g.sgid}`} className="badge bg-slate-500/15 text-slate-200 ring-1 ring-inset ring-slate-500/30 hover:ring-indigo-400"><Shield className="h-3 w-3" />{g.name}</Link>)}
                  </p>
                )}
              </div>
            ) : p.live.groups.length === 0 ? <p className="px-5 py-3 text-sm text-slate-500">{p.live.available ? t('profile.noGroups') : t('profile.unavailable')}</p> : (
              <ul className="flex flex-wrap gap-1.5 px-5 py-3">
                {p.live.groups.map((g) => <li key={g.sgid}><Link to={`/permissions/servergroup/${g.sgid}`} className="badge bg-slate-500/15 text-slate-200 ring-1 ring-inset ring-slate-500/30 hover:ring-indigo-400"><Shield className="h-3 w-3" />{g.name}</Link></li>)}
              </ul>
            )}
          </Card>

          <Card title={t('bans.title')} subtitle={t('profile.bansSub')} noPadding>
            {p.live.bans.length === 0 ? <p className="px-5 py-3 text-sm text-slate-500">{p.live.available ? t('profile.noBan') : t('profile.unavailable')}</p> : (
              <ul className="divide-y divide-slate-800/60">
                {p.live.bans.map((b) => (
                  <li key={b.banid} className="px-5 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge tone="red">{b.match === 'uid' ? 'UID' : b.match === 'ip' ? 'IP' : t('common.name')}</Badge>
                      <span className="min-w-0 flex-1 truncate text-slate-200">{b.reason || t('profile.noReason')}</span>
                      {canBan && <Button size="sm" variant="ghost" loading={unban.isPending && unban.variables === b.banid} onClick={() => unban.mutate(b.banid)}>{t('profile.lift')}</Button>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{t('profile.banLine', { duration: banDuration(b.duration), since: formatDate(b.created), by: b.invokername || '–' })}{b.enforcements ? t('profile.enforced', { count: b.enforcements }) : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('complaints.title')} noPadding>
            {p.live.complaints.length === 0 ? <p className="px-5 py-3 text-sm text-slate-500">{p.live.available ? t('profile.noComplaints') : t('profile.unavailable')}</p> : (
              <ul className="divide-y divide-slate-800/60">
                {p.live.complaints.map((c, i) => (
                  <li key={i} className="px-5 py-2.5 text-sm">
                    <div className="flex items-center gap-2"><Flag className="h-3.5 w-3.5 text-amber-400" /><span className="text-slate-300">{c.direction === 'about' ? <>{t('profile.complaintFrom')} <b className="text-slate-100">{c.fromName}</b></> : <>{t('profile.complaintAbout')} <b className="text-slate-100">{c.targetName}</b></>}</span><span className="ml-auto text-xs text-slate-500">{formatDate(c.timestamp)}</span></div>
                    <p className="mt-0.5 text-slate-400">{c.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('profile.notes')} subtitle={t('profile.notesSub')} noPadding>
            {canManage && p.tracked !== false && (
              <form className="border-b border-slate-800 p-4" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
                <textarea className="input min-h-16" placeholder={t('profile.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                <div className="mt-2 flex justify-end"><Button type="submit" size="sm" variant="primary" icon={Pencil} loading={addNote.isPending} disabled={!note.trim()}>{t('common.save')}</Button></div>
              </form>
            )}
            {id.notes.length === 0 ? <p className="px-5 py-3 text-sm text-slate-500">{t('profile.noNotes')}</p> : (
              <ul className="divide-y divide-slate-800/60">
                {id.notes.map((n) => (
                  <li key={n.id} className="px-5 py-2.5 text-sm">
                    <div className="flex items-start gap-2">
                      <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-slate-200">{n.text}</p>
                      {canManage && <button type="button" className="btn btn-ghost btn-icon" title={t('profile.deleteNote')} onClick={() => removeNote.mutate(n.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                    <p className="ml-5.5 mt-0.5 text-xs text-slate-500">{n.author} · {formatDate(n.ts)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {id.cldbid && <BanModal open={banOpen} onClose={() => setBanOpen(false)} cldbid={id.cldbid} nickname={id.nickname} hasIp={Boolean(p.live.db?.lastIp)} onDone={() => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['bans'] }); }} />}
      <ConfirmDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={() => remove.mutate()} loading={remove.isPending} title={t('profile.deleteConfirm')}
        message={t('profile.deleteMsg', { name: id.nickname || id.uid })} confirmLabel={t('common.delete')} />
    </div>
  );
}

function SessionsTable({ sessions }: { sessions: HistorySession[] }) {
  const { t } = useT();
  if (sessions.length === 0) return <EmptyState icon={LogIn} title={t('profile.noSessions')} />;
  return (
    <div className="max-h-[32rem] overflow-auto">
      <table className="table">
        <thead className="sticky top-0 bg-slate-900"><tr><th>{t('profile.th.connected')}</th><th>{t('profile.th.disconnected')}</th><th className="text-right">{t('bans.th.duration')}</th><th>Nickname</th><th>IP</th><th>{t('profile.th.end')}</th></tr></thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td className="whitespace-nowrap text-xs">{formatDate(s.connectedAt)}</td>
              <td className="whitespace-nowrap text-xs">{s.open ? <Badge tone="green" dot pulse>{t('profile.activeSession')}</Badge> : formatDate(s.disconnectedAt)}</td>
              <td className="whitespace-nowrap text-right text-xs">{formatDuration(s.durationSec)}</td>
              <td className="max-w-40 truncate">{s.nickname}</td>
              <td className="font-mono text-xs">{s.ip || '–'}</td>
              <td className="text-xs">
                {s.open ? <span className="text-slate-500">{t('profile.moves', { count: s.moves })}</span> : (
                  <span className={clsx(s.reasonid === 6 ? 'text-rose-300' : s.reasonid === 5 ? 'text-amber-300' : s.reasonid === 3 ? 'text-slate-400' : 'text-slate-300')} title={[s.reasonmsg, s.invoker && t('profile.by', { name: s.invoker })].filter(Boolean).join(' · ')}>
                    {reasonText(s)}{s.invoker && <span className="text-slate-500"> · {s.invoker}</span>}{s.reasonmsg && <span className="text-slate-500"> · {s.reasonmsg}</span>}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventsList({ events }: { events: HistoryEvent[] }) {
  const { t } = useT();
  const [showMoves, setShowMoves] = useState(false);
  const shown = showMoves ? events : events.filter((e) => e.type !== 'move');
  const moveCount = events.filter((e) => e.type === 'move').length;
  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-2 text-xs text-slate-400">
        <span>{t('profile.eventsIntro')}{showMoves ? t('profile.eventsIntroMoves') : ''}</span>
        <Toggle checked={showMoves} onChange={setShowMoves} label={t('profile.showMoves', { count: moveCount })} />
      </div>
      {shown.length === 0 ? <EmptyState icon={History} title={t('profile.noEvents')} /> : (
        <ul className="max-h-[32rem] divide-y divide-slate-800/60 overflow-y-auto">
          {shown.map((e, i) => {
            const meta = EVENT_META[e.type];
            return (
              <li key={`${e.t}-${i}`} className="flex items-center gap-3 px-5 py-2 text-sm">
                <Badge tone={meta.tone}><meta.icon className="h-3 w-3" />{t(`profile.event.${e.type}`)}</Badge>
                <span className="min-w-0 flex-1 truncate text-slate-300">
                  {e.type === 'nick' && <><span className="text-slate-500">{e.from || '–'}</span> → <span className="font-medium text-slate-100">{e.to}</span></>}
                  {e.type === 'move' && <>→ <span className="text-slate-100">{e.toName || t('profile.channelNum', { id: e.to ?? '' })}</span>{e.by && <span className="text-slate-500">{t('profile.movedBy', { name: e.by })}</span>}</>}
                  {(e.type === 'kick' || e.type === 'ban') && <>{e.by && <>{t('profile.by', { name: '' }).trim()} <span className="text-slate-100">{e.by}</span></>}{e.msg && <span className="text-slate-500"> · {e.msg}</span>}</>}
                </span>
                <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(e.t, true)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BanModal({ open, onClose, cldbid, nickname, hasIp, onDone }: { open: boolean; onClose: () => void; cldbid: string; nickname: string; hasIp: boolean; onDone: () => void }) {
  const { t } = useT();
  const [time, setTime] = useState(0);
  const [customTime, setCustomTime] = useState('');
  const [reason, setReason] = useState('');
  const [banIp, setBanIp] = useState(false);
  const ban = useMutation({
    mutationFn: () => api.post(`/api/clients/db/${cldbid}/ban`, { time: customTime ? Number(customTime) * 60 : time, reason, banIp }),
    onSuccess: () => { toast.success(t('clients.banCreated')); onClose(); setReason(''); setBanIp(false); onDone(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={t('clients.banTitle', { name: nickname })} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="danger" icon={Ban} loading={ban.isPending} onClick={() => ban.mutate()}>{t('clients.ban')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('clients.duration')}>
          <div className="flex flex-wrap gap-1.5">
            {durationPresets().map((d) => <button key={d.seconds} type="button" className={clsx('btn btn-sm', time === d.seconds && !customTime ? 'btn-primary' : 'btn-secondary')} onClick={() => { setTime(d.seconds); setCustomTime(''); }}>{d.label}</button>)}
          </div>
          <input className="input mt-2" type="number" min={1} placeholder={t('profile.customMinutes')} value={customTime} onChange={(e) => setCustomTime(e.target.value)} />
        </Field>
        <Field label={t('common.reason')}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t('common.optional')} /></Field>
        <Toggle checked={banIp} onChange={setBanIp} disabled={!hasIp} label={t('profile.banIpAlso')} description={hasIp ? t('profile.banIpHint') : t('profile.banIpMissing')} />
      </div>
    </Modal>
  );
}
