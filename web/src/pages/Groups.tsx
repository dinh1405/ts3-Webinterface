import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { Copy, Hash, KeyRound, Pencil, Plus, RefreshCw, Search, Shield, Trash2, UserPlus, Users, X } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { Channel, ChannelGroup, ChannelGroupAssignment, DbClient, GroupMember, GroupsResponse, ServerGroup } from '../api/types';
import { useAuth } from '../lib/auth';
import { td, useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, FullPageSpinner, Modal, PageHeader, Spinner } from '../components/ui';

type Kind = 'server' | 'channel';
const TYPE_TONE: Record<number, 'slate' | 'green' | 'blue'> = { 0: 'slate', 1: 'green', 2: 'blue' };
const typeLabel = (type: number) => td(`groups.type.${type}`, undefined, String(type));

export function useGroups() {
  return useQuery({ queryKey: ['groups'], queryFn: () => api.get<GroupsResponse>('/api/groups'), refetchInterval: 60000 });
}

export default function GroupsPage() {
  const { can } = useAuth(); const canWrite = can('groups.manage');
  const { t } = useT();
  const [kind, setKind] = useState<Kind>('server');
  const groups = useGroups();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div>
      <PageHeader
        title={t('groups.title')}
        description={t('groups.description')}
        actions={<>
          <Button variant="ghost" icon={RefreshCw} onClick={() => groups.refetch()} loading={groups.isFetching}>{t('common.refresh')}</Button>
          {canWrite && <Button variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>{kind === 'server' ? t('groups.createServer') : t('groups.createChannel')}</Button>}
        </>}
      />
      <div className="mb-4 flex w-fit gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
        {([['server', t('groups.serverGroups'), Shield], ['channel', t('groups.channelGroups'), Hash]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setKind(key)} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition', kind === key ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-100')}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>
      {groups.isLoading && <FullPageSpinner />}
      {groups.error && <ErrorBox error={groups.error} onRetry={() => groups.refetch()} />}
      {groups.data && (kind === 'server' ? <ServerGroupsTable data={groups.data} canWrite={canWrite} /> : <ChannelGroupsTable data={groups.data} canWrite={canWrite} />)}
      <GroupFormModal open={createOpen} onClose={() => setCreateOpen(false)} kind={kind} mode="create" />
    </div>
  );
}

/* ---------------- Servergruppen ---------------- */
function ServerGroupsTable({ data, canWrite }: { data: GroupsResponse; canWrite: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [members, setMembers] = useState<ServerGroup | null>(null);
  const [rename, setRename] = useState<ServerGroup | null>(null);
  const [copy, setCopy] = useState<ServerGroup | null>(null);
  const [del, setDel] = useState<ServerGroup | null>(null);
  const [showAll, setShowAll] = useState(false);
  const remove = useMutation({
    mutationFn: (g: ServerGroup) => api.delete(`/api/groups/server/${g.sgid}?force=1`),
    onSuccess: () => { toast.success(t('groups.serverDeleted')); setDel(null); qc.invalidateQueries({ queryKey: ['groups'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = data.serverGroups.filter((g) => showAll || g.type === 1);
  return (
    <>
      <Card noPadding title={t('groups.serverCount', { count: list.length })} actions={<label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" className="h-3.5 w-3.5" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> {t('groups.showTemplatesQuery')}</label>}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>{t('common.name')}</th><th>ID</th><th>{t('groups.th.type')}</th><th>{t('groups.members')}</th><th className="text-right">{t('common.actions')}</th></tr></thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.sgid}>
                  <td className="font-medium text-slate-100">{g.name} {g.sgid === data.defaults.serverGroup && <Badge tone="indigo" className="ml-1">{t('groups.default')}</Badge>}</td>
                  <td className="font-mono text-xs">{g.sgid}</td>
                  <td><Badge tone={TYPE_TONE[g.type] || 'slate'}>{typeLabel(g.type)}</Badge></td>
                  <td>{g.type === 1 ? (g.memberCount === null ? <span className="text-xs text-slate-500" title={t('groups.allOthersHint')}>{t('groups.allOthers')}</span> : <button className="btn btn-ghost btn-sm" onClick={() => setMembers(g)}><Users className="h-3.5 w-3.5" /> {g.memberCount}</button>) : '–'}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={Users} onClick={() => setMembers(g)}>{t('groups.members')}</Button>
                      <Link to={`/permissions/servergroup/${g.sgid}`} className="btn btn-ghost btn-sm"><KeyRound className="h-3.5 w-3.5" /> {t('groups.permissions')}</Link>
                      {canWrite && <>
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setRename(g)} title={t('files.rename')} />
                        <Button size="sm" variant="ghost" icon={Copy} onClick={() => setCopy(g)} title={t('groups.copy')} />
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(g)} title={t('common.delete')} disabled={g.sgid === data.defaults.serverGroup} />
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <MembersModal group={members} onClose={() => setMembers(null)} canWrite={canWrite} />
      <GroupFormModal open={Boolean(rename)} onClose={() => setRename(null)} kind="server" mode="rename" group={rename ? { id: rename.sgid, name: rename.name } : undefined} />
      <GroupFormModal open={Boolean(copy)} onClose={() => setCopy(null)} kind="server" mode="copy" group={copy ? { id: copy.sgid, name: copy.name } : undefined} />
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} title={t('groups.deleteServerConfirm')} confirmLabel={t('common.delete')}
        message={t('groups.deleteServerMsg', { name: del?.name ?? '', members: del?.memberCount ? t('groups.membersLose', { count: del.memberCount }) : '' })} />
    </>
  );
}

function MembersModal({ group, onClose, canWrite }: { group: ServerGroup | null; onClose: () => void; canWrite: boolean }) {
  const { t } = useT();
  const canHistory = useAuth().can('history.view');
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const members = useQuery({ queryKey: ['groups', 'members', group?.sgid], queryFn: () => api.get<{ members: GroupMember[]; isDefault?: boolean; note?: string }>(`/api/groups/server/${group!.sgid}/members`), enabled: Boolean(group) });
  const search = useQuery({ queryKey: ['clients', 'db', submitted], queryFn: () => api.get<{ entries: DbClient[] }>(`/api/clients/db/search?q=${encodeURIComponent(submitted)}&limit=30`), enabled: Boolean(group) && submitted.length > 0 });
  const inv = () => { qc.invalidateQueries({ queryKey: ['groups'] }); };
  const add = useMutation({
    mutationFn: (cldbid: string) => api.post(`/api/groups/server/${group!.sgid}/members`, { cldbid }),
    onSuccess: () => { toast.success(t('groups.clientAdded')); inv(); qc.invalidateQueries({ queryKey: ['clients'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (cldbid: string) => api.delete(`/api/groups/server/${group!.sgid}/members/${cldbid}`),
    onSuccess: () => { toast.success(t('groups.clientRemoved')); inv(); qc.invalidateQueries({ queryKey: ['clients'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const memberIds = new Set(members.data?.members.map((m) => m.cldbid));
  return (
    <Modal open={Boolean(group)} onClose={() => { setQ(''); setSubmitted(''); onClose(); }} title={<span>{t('groups.membersOf', { name: group?.name ?? '' })}</span>} size="lg">
      {members.isLoading && <div className="py-6 text-center"><Spinner className="mx-auto" /></div>}
      {members.error && <ErrorBox error={members.error} onRetry={() => members.refetch()} compact />}
      {members.data && (members.data.members.length === 0 ? <EmptyState icon={Users} title={members.data.isDefault ? t('groups.defaultServerGroup') : t('groups.noMembers')} description={members.data.note} /> : (
        <ul className="max-h-64 divide-y divide-slate-800/70 overflow-y-auto rounded-lg border border-slate-800">
          {members.data.members.map((m) => (
            <li key={m.cldbid} className="flex items-center gap-3 px-3 py-2 text-sm">
              {canHistory ? <Link to={`/history/${encodeURIComponent(m.uid)}`} className="font-medium text-slate-100 hover:underline" title={t('common.profileTitle')}>{m.nickname}</Link> : <span className="font-medium text-slate-100">{m.nickname}</span>}
              <span className="truncate font-mono text-[11px] text-slate-500">{m.uid}</span>
              <span className="ml-auto font-mono text-xs text-slate-500">#{m.cldbid}</span>
              {canWrite && <Button size="sm" variant="ghost" icon={X} onClick={() => remove.mutate(m.cldbid)} loading={remove.isPending && remove.variables === m.cldbid} title={t('perms.remove')} />}
            </li>
          ))}
        </ul>
      ))}
      {canWrite && !members.data?.isDefault && (
        <div className="mt-5">
          <p className="label">{t('groups.addClient')}</p>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }}>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input className="input pl-9" placeholder={t('groups.searchClient')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Button type="submit" loading={search.isFetching}>{t('common.search')}</Button>
          </form>
          {search.data && (
            <ul className="mt-2 max-h-48 divide-y divide-slate-800/70 overflow-y-auto rounded-lg border border-slate-800">
              {search.data.entries.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">{t('common.noMatches')}</li>}
              {search.data.entries.map((c) => (
                <li key={c.cldbid} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="text-slate-100">{c.nickname}</span>
                  <span className="truncate font-mono text-[11px] text-slate-500">{c.uid}</span>
                  <span className="ml-auto">
                    {memberIds.has(c.cldbid) ? <Badge tone="green">{t('groups.member')}</Badge> : <Button size="sm" variant="primary" icon={UserPlus} onClick={() => add.mutate(c.cldbid)} loading={add.isPending && add.variables === c.cldbid}>{t('groups.add')}</Button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Kanalgruppen ---------------- */
function ChannelGroupsTable({ data, canWrite }: { data: GroupsResponse; canWrite: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [assign, setAssign] = useState<ChannelGroup | null>(null);
  const [rename, setRename] = useState<ChannelGroup | null>(null);
  const [copy, setCopy] = useState<ChannelGroup | null>(null);
  const [del, setDel] = useState<ChannelGroup | null>(null);
  const [showAll, setShowAll] = useState(false);
  const remove = useMutation({
    mutationFn: (g: ChannelGroup) => api.delete(`/api/groups/channel/${g.cgid}?force=1`),
    onSuccess: () => { toast.success(t('groups.channelDeleted')); setDel(null); qc.invalidateQueries({ queryKey: ['groups'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = data.channelGroups.filter((g) => showAll || g.type === 1);
  return (
    <>
      <Card noPadding title={t('groups.channelCount', { count: list.length })} actions={<label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" className="h-3.5 w-3.5" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> {t('groups.showTemplates')}</label>}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>{t('common.name')}</th><th>ID</th><th>{t('groups.th.type')}</th><th className="text-right">{t('common.actions')}</th></tr></thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.cgid}>
                  <td className="font-medium text-slate-100">{g.name}
                    {g.cgid === data.defaults.channelGroup && <Badge tone="indigo" className="ml-1">{t('groups.default')}</Badge>}
                    {g.cgid === data.defaults.channelAdminGroup && <Badge tone="amber" className="ml-1">{t('groups.channelAdmin')}</Badge>}
                  </td>
                  <td className="font-mono text-xs">{g.cgid}</td>
                  <td><Badge tone={TYPE_TONE[g.type] || 'slate'}>{typeLabel(g.type)}</Badge></td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={Users} onClick={() => setAssign(g)}>{t('groups.assignments')}</Button>
                      <Link to={`/permissions/channelgroup/${g.cgid}`} className="btn btn-ghost btn-sm"><KeyRound className="h-3.5 w-3.5" /> {t('groups.permissions')}</Link>
                      {canWrite && <>
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setRename(g)} title={t('files.rename')} />
                        <Button size="sm" variant="ghost" icon={Copy} onClick={() => setCopy(g)} title={t('groups.copy')} />
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(g)} title={t('common.delete')} disabled={g.cgid === data.defaults.channelGroup || g.cgid === data.defaults.channelAdminGroup} />
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <AssignmentsModal group={assign} defaults={data.defaults} channelGroups={data.channelGroups} onClose={() => setAssign(null)} canWrite={canWrite} />
      <GroupFormModal open={Boolean(rename)} onClose={() => setRename(null)} kind="channel" mode="rename" group={rename ? { id: rename.cgid, name: rename.name } : undefined} />
      <GroupFormModal open={Boolean(copy)} onClose={() => setCopy(null)} kind="channel" mode="copy" group={copy ? { id: copy.cgid, name: copy.name } : undefined} />
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} title={t('groups.deleteChannelConfirm')} confirmLabel={t('common.delete')} message={t('groups.deleteChannelMsg', { name: del?.name ?? '' })} />
    </>
  );
}

function AssignmentsModal({ group, defaults, channelGroups, onClose, canWrite }: { group: ChannelGroup | null; defaults: GroupsResponse['defaults']; channelGroups: ChannelGroup[]; onClose: () => void; canWrite: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [cid, setCid] = useState('');
  const assignments = useQuery({ queryKey: ['groups', 'assignments', group?.cgid], queryFn: () => api.get<{ assignments: ChannelGroupAssignment[] }>(`/api/groups/channel/${group!.cgid}/assignments`), enabled: Boolean(group) });
  const tree = useQuery({ queryKey: ['clients', 'tree'], queryFn: () => api.get<{ tree: Channel[] }>('/api/clients/tree'), enabled: Boolean(group) && canWrite });
  const search = useQuery({ queryKey: ['clients', 'db', submitted], queryFn: () => api.get<{ entries: DbClient[] }>(`/api/clients/db/search?q=${encodeURIComponent(submitted)}&limit=30`), enabled: Boolean(group) && submitted.length > 0 });
  const channels = useMemo(() => {
    const out: { cid: string; name: string; depth: number }[] = [];
    const walk = (list: Channel[], depth: number) => { for (const c of list) { out.push({ cid: c.cid, name: c.name, depth }); walk(c.children, depth + 1); } };
    walk(tree.data?.tree ?? [], 0);
    return out;
  }, [tree.data]);
  const inv = () => qc.invalidateQueries({ queryKey: ['groups', 'assignments'] });
  const set = useMutation({
    mutationFn: (body: { cgid: string; cid: string; cldbid: string }) => api.post('/api/groups/channel/assign', body),
    onSuccess: () => { toast.success(t('groups.assignmentSaved')); inv(); qc.invalidateQueries({ queryKey: ['clients'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const isDefault = group?.cgid === defaults.channelGroup;
  const defaultName = channelGroups.find((g) => g.cgid === defaults.channelGroup)?.name || t('groups.defaultGroup');
  return (
    <Modal open={Boolean(group)} onClose={() => { setQ(''); setSubmitted(''); setCid(''); onClose(); }} title={<span>{t('groups.assignmentsOf', { name: group?.name ?? '' })}</span>} size="lg">
      {assignments.isLoading && <div className="py-6 text-center"><Spinner className="mx-auto" /></div>}
      {assignments.error && <ErrorBox error={assignments.error} onRetry={() => assignments.refetch()} compact />}
      {assignments.data && (assignments.data.assignments.length === 0 ? <EmptyState icon={Users} title={isDefault ? t('groups.defaultNotAssigned') : t('groups.noAssignments')} /> : (
        <ul className="max-h-64 divide-y divide-slate-800/70 overflow-y-auto rounded-lg border border-slate-800">
          {assignments.data.assignments.map((a) => (
            <li key={`${a.cid}-${a.cldbid}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium text-slate-100">{a.nickname}</span>
              <span className="text-slate-400">{t('groups.in')}</span>
              <span className="truncate text-slate-200">{a.channelName}</span>
              <span className="ml-auto font-mono text-xs text-slate-500">#{a.cldbid}</span>
              {canWrite && !isDefault && <Button size="sm" variant="ghost" icon={X} title={t('groups.resetTo', { name: defaultName })} onClick={() => set.mutate({ cgid: defaults.channelGroup, cid: a.cid, cldbid: a.cldbid })} />}
            </li>
          ))}
        </ul>
      ))}
      {canWrite && !isDefault && (
        <div className="mt-5 space-y-3">
          <p className="label">{t('groups.addAssignment')}</p>
          <Field label={t('files.channel')}>
            <select className="input" value={cid} onChange={(e) => setCid(e.target.value)}>
              <option value="">{t('groups.chooseChannel')}</option>
              {channels.map((ch) => <option key={ch.cid} value={ch.cid}>{'  '.repeat(ch.depth)}{ch.name}</option>)}
            </select>
          </Field>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }}>
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input className="input pl-9" placeholder={t('groups.searchClient')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Button type="submit" loading={search.isFetching}>{t('common.search')}</Button>
          </form>
          {search.data && (
            <ul className="max-h-48 divide-y divide-slate-800/70 overflow-y-auto rounded-lg border border-slate-800">
              {search.data.entries.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">{t('common.noMatches')}</li>}
              {search.data.entries.map((c) => (
                <li key={c.cldbid} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="text-slate-100">{c.nickname}</span>
                  <span className="truncate font-mono text-[11px] text-slate-500">{c.uid}</span>
                  <span className="ml-auto"><Button size="sm" variant="primary" icon={UserPlus} disabled={!cid} title={cid ? '' : t('groups.chooseChannelFirst')} onClick={() => set.mutate({ cgid: group!.cgid, cid, cldbid: c.cldbid })} loading={set.isPending && set.variables?.cldbid === c.cldbid}>{t('files.assign')}</Button></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Anlegen / Umbenennen / Kopieren ---------------- */
function GroupFormModal({ open, onClose, kind, mode, group }: { open: boolean; onClose: () => void; kind: Kind; mode: 'create' | 'rename' | 'copy'; group?: { id: string; name: string } }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState(1);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = `${mode}-${group?.id ?? 'new'}`;
  if (open && loadedFor !== key) { setName(mode === 'rename' ? group?.name ?? '' : mode === 'copy' ? t('groups.copyName', { name: group?.name ?? '' }) : ''); setType(1); setLoadedFor(key); }
  const close = () => { setLoadedFor(null); onClose(); };
  const base = kind === 'server' ? '/api/groups/server' : '/api/groups/channel';
  const save = useMutation({
    mutationFn: () => {
      if (mode === 'create') return api.post(base, { name, type });
      if (mode === 'copy') return api.post(`${base}/${group!.id}/copy`, { name, type });
      return api.patch(`${base}/${group!.id}`, { name });
    },
    onSuccess: () => { toast.success(mode === 'create' ? t('groups.created') : mode === 'copy' ? t('groups.copied') : t('groups.renamed')); qc.invalidateQueries({ queryKey: ['groups'] }); close(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const title = mode === 'create' ? (kind === 'server' ? t('groups.createServer') : t('groups.createChannel')) : mode === 'rename' ? t('groups.renameTitle', { name: group?.name ?? '' }) : t('groups.copyTitle', { name: group?.name ?? '' });
  return (
    <Modal open={open} onClose={close} title={title} size="sm" footer={<><Button variant="ghost" onClick={close}>{t('common.cancel')}</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>{mode === 'rename' ? t('files.rename') : mode === 'copy' ? t('groups.copy') : t('files.create')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('common.name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus /></Field>
        {mode !== 'rename' && (
          <Field label={t('groups.th.type')} hint={t('groups.typeHint')}>
            <select className="input" value={type} onChange={(e) => setType(Number(e.target.value))}>
              <option value={1}>{t('groups.type.1')}</option>
              <option value={0}>{t('groups.type.0')}</option>
            </select>
          </Field>
        )}
        {mode === 'copy' && <p className="text-xs text-slate-500">{t('groups.copyNote')}</p>}
      </div>
    </Modal>
  );
}
