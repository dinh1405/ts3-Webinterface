import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { ArrowLeft, Eye, KeyRound, RotateCcw, Save, Search, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { GroupPermission, PermissionDef, PermKind, PermOverviewEntry } from '../api/types';
import { useAuth } from '../lib/auth';
import { useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, FullPageSpinner, PageHeader, Toggle } from '../components/ui';

interface Edit { value: number; skip: boolean; negate: boolean }
interface SubjectResponse { subject: { id: string; kind: PermKind; name: string; type?: number; uid?: string; cid?: string; cldbid?: string }; permissions: GroupPermission[] }

const CATEGORIES: { key: 'instance' | 'virtualserver' | 'channel' | 'group' | 'client' | 'ft' | 'needed' | 'icon'; test: (n: string) => boolean }[] = [
  { key: 'instance', test: (n) => /^[bi]_serverinstance|^b_serverquery|^i_serverquery/.test(n) },
  { key: 'virtualserver', test: (n) => /^[bi]_virtualserver/.test(n) },
  { key: 'channel', test: (n) => /^[bi]_channel/.test(n) },
  { key: 'group', test: (n) => /^[bi]_group|^i_permission_modify_power|^b_permission/.test(n) },
  { key: 'client', test: (n) => /^[bi]_client/.test(n) },
  { key: 'ft', test: (n) => /^[bi]_ft/.test(n) },
  { key: 'needed', test: (n) => /^i_needed/.test(n) },
  { key: 'icon', test: (n) => /^i_icon|^b_icon|^i_max|^i_permission|^b_permission_modify/.test(n) },
];
const categoryOf = (name: string) => CATEGORIES.find((c) => c.test(name))?.key ?? 'other';
const isBool = (name: string) => name.startsWith('b_');

export function CategoryFilter({ q, setQ, category, setCategory, extra }: { q: string; setQ: (v: string) => void; category: string; setCategory: (v: string) => void; extra?: ReactNode }) {
  const { t } = useT();
  return (
    <>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input className="input w-64 pl-9" placeholder={t('perms.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">{t('perms.allCategories')}</option>
        {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{t(`perms.cat.${c.key}`)}</option>)}
        <option value="other">{t('perms.cat.other')}</option>
      </select>
      {extra}
    </>
  );
}

export default function PermissionsPage() {
  const params = useParams<{ kind: string; id: string }>();
  const kind = (params.kind || 'servergroup') as PermKind;
  const id = params.id || '';
  const { can } = useAuth(); const canWrite = can('permissions.manage');
  const { t } = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [onlySet, setOnlySet] = useState(true);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [removeName, setRemoveName] = useState<string | null>(null);

  const defs = useQuery({ queryKey: ['permissions', 'definitions'], queryFn: () => api.get<{ permissions: PermissionDef[] }>('/api/permissions/definitions'), staleTime: 3600_000 });
  const perms = useQuery({ queryKey: ['permissions', kind, id], queryFn: () => api.get<SubjectResponse>(`/api/permissions/${kind}/${encodeURIComponent(id)}`), enabled: Boolean(id) });

  const setMap = useMemo(() => new Map((perms.data?.permissions ?? []).map((p) => [p.name, p])), [perms.data]);

  const rows = useMemo(() => {
    const all = (defs.data?.permissions ?? []).filter((d) => !onlySet || setMap.has(d.name) || edits[d.name]);
    const extra: PermissionDef[] = [...setMap.keys()].filter((n) => !defs.data?.permissions.some((d) => d.name === n)).map((n) => ({ id: 0, name: n, desc: '' }));
    const needle = q.trim().toLowerCase();
    return [...all, ...extra]
      .filter((d) => !category || categoryOf(d.name) === category)
      .filter((d) => !needle || d.name.includes(needle) || d.desc.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [defs.data, setMap, onlySet, edits, q, category]);

  const changed = useMemo(() => Object.entries(edits).filter(([name, e]) => {
    const cur = setMap.get(name);
    return !cur || cur.value !== e.value || cur.skip !== e.skip || cur.negate !== e.negate;
  }), [edits, setMap]);

  const save = useMutation({
    mutationFn: () => api.put<{ ok: boolean; results: { name: string; ok: boolean; error?: string }[] }>(`/api/permissions/${kind}/${encodeURIComponent(id)}`, { perms: changed.map(([name, e]) => ({ name, ...e })) }),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) toast.warning(t('perms.savedPartial', { ok: r.results.length - failed.length, failed: failed.length }), { description: failed.map((f) => `${f.name}: ${f.error}`).join('\n') });
      else toast.success(t('perms.saved', { count: r.results.length }));
      setEdits({});
      qc.invalidateQueries({ queryKey: ['permissions', kind, id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (name: string) => api.delete(`/api/permissions/${kind}/${encodeURIComponent(id)}/${name}`),
    onSuccess: (_, name) => { toast.success(t('perms.removed', { name })); setRemoveName(null); setEdits((e) => { const n = { ...e }; delete n[name]; return n; }); qc.invalidateQueries({ queryKey: ['permissions', kind, id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const edit = (name: string, patch: Partial<Edit>) => {
    setEdits((prev) => {
      const base: Edit = prev[name] ?? (setMap.get(name) ? { value: setMap.get(name)!.value, skip: setMap.get(name)!.skip, negate: setMap.get(name)!.negate } : { value: isBool(name) ? 1 : 0, skip: false, negate: false });
      return { ...prev, [name]: { ...base, ...patch } };
    });
  };
  const current = (name: string): Edit | undefined => edits[name] ?? setMap.get(name);

  if (perms.isLoading || defs.isLoading) return <FullPageSpinner />;
  if (perms.error) return <ErrorBox error={perms.error} onRetry={() => perms.refetch()} />;
  if (defs.error) return <ErrorBox error={defs.error} onRetry={() => defs.refetch()} />;
  const s = perms.data!.subject;
  const backTo = kind === 'servergroup' || kind === 'channelgroup' ? '/groups' : '/clients';
  const supportsFlags = kind !== 'channelclient';

  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-3"><KeyRound className="h-6 w-6 text-indigo-400" /> {t('perms.title', { name: s.name })}</span>}
        description={t('perms.description', { kind: t(`perms.kind.${kind}`), id: kind === 'channelclient' ? '' : `#${s.id}`, set: perms.data!.permissions.length, total: defs.data!.permissions.length })}
        actions={<>
          {kind === 'client' && <Link to={`/permissions/overview/${s.id}/0`} className="btn btn-secondary"><Eye className="h-4 w-4" /> {t('perms.effective')}</Link>}
          <Link to={backTo} className="btn btn-ghost"><ArrowLeft className="h-4 w-4" /> {t('common.back')}</Link>
        </>}
      />

      <Card noPadding
        actions={<CategoryFilter q={q} setQ={setQ} category={category} setCategory={setCategory} extra={<Toggle checked={onlySet} onChange={setOnlySet} label={t('perms.onlySet')} />} />}
        title={<span>{t('perms.entries', { count: rows.length })}</span>}
      >
        {rows.length === 0 ? <EmptyState icon={KeyRound} title={onlySet ? t('perms.noneSet') : t('common.noMatches')} description={onlySet ? t('perms.noneSetHint') : undefined} /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>{t('perms.th.permission')}</th><th className="w-40">{t('perms.th.value')}</th>{supportsFlags && <th className="w-16">{t('perms.th.skip')}</th>}{supportsFlags && <th className="w-20">{t('perms.th.negate')}</th>}<th className="w-24 text-right"></th></tr></thead>
              <tbody>
                {rows.map((d) => {
                  const cur = current(d.name);
                  const isSet = setMap.has(d.name);
                  const isChanged = changed.some(([n]) => n === d.name);
                  const bool = isBool(d.name);
                  return (
                    <tr key={d.name} className={clsx(isChanged && 'bg-amber-500/5', !isSet && !edits[d.name] && 'opacity-70')}>
                      <td>
                        <p className="font-mono text-xs text-slate-100">{d.name} {isChanged && <Badge tone="amber" className="ml-1">{t('perms.changed')}</Badge>}{!isSet && !isChanged && <span className="ml-1 text-[10px] uppercase text-slate-500">{t('perms.notSet')}</span>}</p>
                        {d.desc && <p className="max-w-xl text-xs text-slate-500">{d.desc}</p>}
                      </td>
                      <td>
                        {bool ? (
                          <Toggle checked={(cur?.value ?? 0) > 0} disabled={!canWrite} onChange={(v) => edit(d.name, { value: v ? 1 : 0 })} label={(cur?.value ?? 0) > 0 ? t('perms.allowed') : t('perms.denied')} />
                        ) : (
                          <input type="number" className="input font-mono" value={cur?.value ?? ''} placeholder="–" disabled={!canWrite} onChange={(e) => edit(d.name, { value: e.target.value === '' ? 0 : Number(e.target.value) })} />
                        )}
                      </td>
                      {supportsFlags && <td><input type="checkbox" className="h-4 w-4" checked={cur?.skip ?? false} disabled={!canWrite} onChange={(e) => edit(d.name, { skip: e.target.checked })} /></td>}
                      {supportsFlags && <td><input type="checkbox" className="h-4 w-4" checked={cur?.negate ?? false} disabled={!canWrite} onChange={(e) => edit(d.name, { negate: e.target.checked })} /></td>}
                      <td className="text-right">
                        {canWrite && isSet && <Button size="sm" variant="ghost" icon={Trash2} title={t('perms.removeTitle')} onClick={() => setRemoveName(d.name)} />}
                        {canWrite && !isSet && !edits[d.name] && <Button size="sm" variant="ghost" onClick={() => edit(d.name, {})}>{t('perms.set')}</Button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canWrite && (
        <div className="sticky bottom-4 z-10 mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur">
          <span className="text-sm text-slate-300">{changed.length === 0 ? t('perms.noUnsaved') : <><Badge tone="amber">{changed.length}</Badge> {t('perms.changedCount', { count: changed.length })}</>}</span>
          <div className="flex gap-2">
            <Button variant="ghost" icon={RotateCcw} onClick={() => setEdits({})} disabled={changed.length === 0 || save.isPending}>{t('common.discard')}</Button>
            <Button variant="primary" icon={Save} onClick={() => save.mutate()} loading={save.isPending} disabled={changed.length === 0}>{t('common.save')}</Button>
          </div>
        </div>
      )}

      <ConfirmDialog open={removeName !== null} onClose={() => setRemoveName(null)} onConfirm={() => removeName && remove.mutate(removeName)} loading={remove.isPending} title={t('perms.removeConfirm')} confirmLabel={t('perms.remove')}
        message={<span>{t('perms.removeMsg', { name: removeName ?? '', subject: s.name })}</span>} />
    </div>
  );
}

/** Effektive Rechte eines Clients (permoverview) – nur lesend. */
export function PermissionOverviewPage() {
  const { cldbid = '', cid = '0' } = useParams<{ cldbid: string; cid: string }>();
  const { t } = useT();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const data = useQuery({ queryKey: ['permissions', 'overview', cldbid, cid], queryFn: () => api.get<{ client: { cldbid: string; name?: string; uid?: string }; channel: { cid: string; name: string }; permissions: PermOverviewEntry[] }>(`/api/permissions/overview?cldbid=${cldbid}&cid=${cid}`) });
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data.data?.permissions ?? []).filter((d) => !category || categoryOf(d.name) === category).filter((d) => !needle || d.name.includes(needle) || d.desc.toLowerCase().includes(needle) || d.source.toLowerCase().includes(needle));
  }, [data.data, q, category]);
  if (data.isLoading) return <FullPageSpinner />;
  if (data.error) return <ErrorBox error={data.error} onRetry={() => data.refetch()} />;
  const d = data.data!;
  const TONE: Record<number, 'indigo' | 'purple' | 'blue' | 'amber' | 'green'> = { 0: 'indigo', 1: 'purple', 2: 'blue', 3: 'amber', 4: 'green' };
  return (
    <div>
      <PageHeader title={<span className="flex items-center gap-3"><Eye className="h-6 w-6 text-indigo-400" /> {t('perms.overviewTitle', { name: d.client.name || `#${cldbid}` })}</span>}
        description={t('perms.overviewDescription', { channel: d.channel.name, count: d.permissions.length })}
        actions={<><Link to={`/permissions/client/${cldbid}`} className="btn btn-secondary"><KeyRound className="h-4 w-4" /> {t('perms.editClient')}</Link><Link to="/clients" className="btn btn-ghost"><ArrowLeft className="h-4 w-4" /> {t('common.back')}</Link></>} />
      <Card noPadding title={t('perms.entries', { count: rows.length })} actions={<CategoryFilter q={q} setQ={setQ} category={category} setCategory={setCategory} />}>
        {rows.length === 0 ? <EmptyState icon={Eye} title={t('audit.none')} /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>{t('perms.th.permission')}</th><th className="w-28">{t('perms.th.value')}</th><th className="w-14">{t('perms.th.skip')}</th><th className="w-16">{t('perms.th.negate')}</th><th>{t('perms.th.source')}</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={`${p.name}-${p.sourceType}`}>
                    <td><p className="font-mono text-xs text-slate-100">{p.name}</p>{p.desc && <p className="max-w-xl text-xs text-slate-500">{p.desc}</p>}</td>
                    <td className="font-mono">{isBool(p.name) ? (p.value > 0 ? <Badge tone="green">{t('perms.allowed')}</Badge> : <Badge tone="red">{t('perms.denied')}</Badge>) : p.value}</td>
                    <td>{p.skip ? '✓' : ''}</td>
                    <td>{p.negate ? '✓' : ''}</td>
                    <td><Badge tone={TONE[p.sourceType] || 'slate'}>{p.source}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
