import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '../api/client';
import type { Channel, DbClient, GroupsResponse, PermKind } from '../api/types';
import { useT } from '../i18n';

export interface SubjectRef { kind: PermKind; id: string; name?: string }
type PickKind = Exclude<PermKind, 'channelclient'>;
const KINDS: PickKind[] = ['servergroup', 'channelgroup', 'channel', 'client'];

export const subjectKey = (s: SubjectRef | null | undefined) => (s ? `${s.kind}:${s.id}` : '');
export function parseSubjectKey(v: string | null | undefined): SubjectRef | null {
  if (!v) return null;
  const i = v.indexOf(':');
  if (i < 0) return null;
  const kind = v.slice(0, i) as PermKind;
  const id = v.slice(i + 1);
  if (!['servergroup', 'channelgroup', 'channel', 'client', 'channelclient'].includes(kind) || !id) return null;
  return { kind, id };
}

/**
 * Auswahl eines Rechte-Subjekts: Art (Servergruppe, Kanalgruppe, Kanal, Client) plus Objekt.
 * Gruppen und Kanäle als Auswahlliste, Clients über die Datenbanksuche.
 */
export function SubjectPicker({ value, onChange, exclude, kinds = KINDS, compact }: { value: SubjectRef | null; onChange: (s: SubjectRef | null) => void; exclude?: SubjectRef | null; kinds?: PickKind[]; compact?: boolean }) {
  const { t } = useT();
  const [kind, setKind] = useState<PickKind>((value?.kind as PickKind) && kinds.includes(value!.kind as PickKind) ? (value!.kind as PickKind) : kinds[0]);
  const [q, setQ] = useState('');
  useEffect(() => { if (value?.kind && value.kind !== kind && kinds.includes(value.kind as PickKind)) setKind(value.kind as PickKind); }, [value?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<GroupsResponse>('/api/groups'), enabled: kind === 'servergroup' || kind === 'channelgroup', staleTime: 60000 });
  const tree = useQuery({ queryKey: ['clients', 'tree'], queryFn: () => api.get<{ tree: Channel[] }>('/api/clients/tree'), enabled: kind === 'channel', staleTime: 30000 });
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  const clients = useQuery({ queryKey: ['clients', 'db', debounced], queryFn: () => api.get<{ entries: DbClient[] }>(`/api/clients/db/search?q=${encodeURIComponent(debounced)}&limit=30`), enabled: kind === 'client' });

  const options = useMemo<{ id: string; name: string; depth?: number; disabled?: boolean }[]>(() => {
    const isExcluded = (k: PermKind, id: string) => Boolean(exclude && exclude.kind === k && exclude.id === id);
    if (kind === 'servergroup') return (groups.data?.serverGroups ?? []).map((g) => ({ id: g.sgid, name: `${g.name}${g.type === 2 ? ' (Query)' : g.type === 0 ? ' (Template)' : ''}`, disabled: isExcluded('servergroup', g.sgid) }));
    if (kind === 'channelgroup') return (groups.data?.channelGroups ?? []).map((g) => ({ id: g.cgid, name: g.name, disabled: isExcluded('channelgroup', g.cgid) }));
    if (kind === 'channel') {
      const out: { id: string; name: string; depth: number; disabled?: boolean }[] = [];
      const walk = (list: Channel[], depth: number) => { for (const c of list) { out.push({ id: c.cid, name: c.name, depth, disabled: isExcluded('channel', c.cid) }); walk(c.children, depth + 1); } };
      walk(tree.data?.tree ?? [], 0);
      return out;
    }
    return (clients.data?.entries ?? []).map((c) => ({ id: c.cldbid, name: `${c.nickname} (#${c.cldbid})`, disabled: isExcluded('client', c.cldbid) }));
  }, [kind, groups.data, tree.data, clients.data, exclude]);

  const selectedId = value && value.kind === kind ? value.id : '';
  const pick = (id: string) => {
    const o = options.find((x) => x.id === id);
    onChange(id ? { kind, id, name: o?.name } : null);
  };

  return (
    <div className={compact ? 'flex flex-wrap gap-2' : 'space-y-2'}>
      <select className={compact ? 'input w-auto' : 'input'} value={kind} onChange={(e) => { setKind(e.target.value as PickKind); onChange(null); }} aria-label={t('perms.picker.kind')}>
        {kinds.map((k) => <option key={k} value={k}>{t(`perms.kind.${k}`)}</option>)}
      </select>
      {kind === 'client' && (
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input className="input pl-9" placeholder={t('perms.picker.clientSearch')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      <select className={compact ? 'input w-auto min-w-48' : 'input'} value={selectedId} onChange={(e) => pick(e.target.value)} aria-label={t('perms.picker.object')}>
        <option value="">{(kind === 'client' ? clients : kind === 'channel' ? tree : groups).isLoading ? t('common.loading') : t('perms.picker.choose')}</option>
        {options.map((o) => <option key={o.id} value={o.id} disabled={o.disabled}>{' '.repeat((o.depth ?? 0) * 2)}{o.name}</option>)}
      </select>
    </div>
  );
}
