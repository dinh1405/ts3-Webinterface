import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, GitCompare, KeyRound, LayoutTemplate, Pencil, Play, Shield, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { GroupsResponse, PermPreset, PermPresetFull, PermResult } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import { useT } from '../i18n';
import { downloadJson, safeFileName } from '../lib/download';
import { PERM_EXPORT_FORMAT } from '../lib/permdiff';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, Modal, PageHeader, Alert } from '../components/ui';
import { SubjectPicker, subjectKey, type SubjectRef } from '../components/SubjectPicker';
import { isSensitiveSubject, summarizeResults } from '../components/PermTools';

/** Einstieg in den Rechte-Editor: Gruppen, Vergleich zweier Objekte und Vorlagen. */
export default function PermissionsHomePage() {
  const { t } = useT();
  const { can } = useAuth(); const canWrite = can('permissions.manage');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<GroupsResponse>('/api/groups'), staleTime: 60000 });
  const presets = useQuery({ queryKey: ['permissions', 'presets'], queryFn: () => api.get<{ presets: PermPreset[] }>('/api/permissions/presets') });
  const [a, setA] = useState<SubjectRef | null>(null);
  const [b, setB] = useState<SubjectRef | null>(null);
  const [applyPreset, setApplyPreset] = useState<PermPreset | null>(null);
  const [target, setTarget] = useState<SubjectRef | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [rename, setRename] = useState<PermPreset | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deleteP, setDeleteP] = useState<PermPreset | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['permissions', 'presets'] });

  const apply = useMutation({
    mutationFn: () => api.post<{ ok: boolean; results: PermResult[]; removed: string[] }>(`/api/permissions/presets/${applyPreset!.id}/apply`, { kind: target!.kind, id: target!.id, mode }),
    onSuccess: (r) => { summarizeResults(t, r.results, r.removed); setApplyPreset(null); setTarget(null); setMode('merge'); qc.invalidateQueries({ queryKey: ['permissions', target!.kind, target!.id] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const save = useMutation({
    mutationFn: () => api.put(`/api/permissions/presets/${rename!.id}`, { name: name.trim(), description: description.trim() }),
    onSuccess: () => { toast.success(t('common.saved')); setRename(null); inv(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/api/permissions/presets/${deleteP!.id}`),
    onSuccess: () => { toast.success(t('perms.preset.deleted')); setDeleteP(null); inv(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const exportPreset = async (p: PermPreset) => {
    try {
      const full = await api.get<{ preset: PermPresetFull }>(`/api/permissions/presets/${p.id}`);
      downloadJson(`preset_${safeFileName(p.name)}.json`, { format: PERM_EXPORT_FORMAT, exportedAt: new Date().toISOString(), subject: { kind: p.kind ?? 'preset', id: p.id, name: p.name }, perms: full.preset.perms });
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const sensitiveTarget = target && target.kind === 'servergroup' ? isSensitiveSubject({ kind: 'servergroup', id: target.id, name: target.name ?? '', type: groups.data?.serverGroups.find((g) => g.sgid === target.id)?.type }) : false;

  return (
    <div className="space-y-6">
      <PageHeader title={<span className="flex items-center gap-3"><KeyRound className="h-6 w-6 text-indigo-400" /> {t('perms.home.title')}</span>} description={t('perms.home.description')} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={t('groups.serverGroups')} noPadding className="xl:col-span-1">
          {groups.error && <div className="p-4"><ErrorBox error={groups.error} onRetry={() => groups.refetch()} compact /></div>}
          <ul className="max-h-80 divide-y divide-slate-800/60 overflow-y-auto">
            {groups.data?.serverGroups.filter((g) => g.type !== 0).map((g) => (
              <li key={g.sgid} className="flex items-center justify-between gap-2 px-4 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2"><Shield className="h-3.5 w-3.5 shrink-0 text-slate-500" /><span className="truncate">{g.name}</span>{g.type === 2 && <Badge tone="neutral">Query</Badge>}</span>
                <Link to={`/permissions/servergroup/${g.sgid}`} className="btn btn-ghost btn-sm"><KeyRound className="h-3.5 w-3.5" /></Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('groups.channelGroups')} noPadding className="xl:col-span-1">
          <ul className="max-h-80 divide-y divide-slate-800/60 overflow-y-auto">
            {groups.data?.channelGroups.filter((g) => g.type !== 0).map((g) => (
              <li key={g.cgid} className="flex items-center justify-between gap-2 px-4 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-2"><Shield className="h-3.5 w-3.5 shrink-0 text-slate-500" /><span className="truncate">{g.name}</span></span>
                <Link to={`/permissions/channelgroup/${g.cgid}`} className="btn btn-ghost btn-sm"><KeyRound className="h-3.5 w-3.5" /></Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={<span className="flex items-center gap-2"><GitCompare className="h-4 w-4 text-indigo-400" /> {t('perms.compare.title')}</span>} subtitle={t('perms.home.compareSub')} className="xl:col-span-1">
          <div className="space-y-3">
            <div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">A</p><SubjectPicker value={a} onChange={setA} exclude={b} /></div>
            <div><p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">B</p><SubjectPicker value={b} onChange={setB} exclude={a} /></div>
            <Button variant="primary" icon={GitCompare} disabled={!a || !b} onClick={() => navigate(`/permissions/compare?a=${encodeURIComponent(subjectKey(a))}&b=${encodeURIComponent(subjectKey(b))}`)}>{t('perms.tools.compare')}</Button>
          </div>
        </Card>
      </div>

      <Card title={<span className="flex items-center gap-2"><LayoutTemplate className="h-4 w-4 text-indigo-400" /> {t('perms.preset.many')}</span>} subtitle={t('perms.home.presetsSub')} noPadding>
        {presets.error && <div className="p-4"><ErrorBox error={presets.error} onRetry={() => presets.refetch()} compact /></div>}
        {presets.data && (presets.data.presets.length === 0 ? <EmptyState icon={LayoutTemplate} title={t('perms.preset.none')} description={t('perms.preset.noneHint')} /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>{t('common.name')}</th><th>{t('perms.preset.kind')}</th><th>{t('perms.th.permission')}</th><th>{t('bans.th.created')}</th><th className="text-right">{t('common.actions')}</th></tr></thead>
              <tbody>
                {presets.data.presets.map((p) => (
                  <tr key={p.id}>
                    <td><p className="font-medium text-slate-100">{p.name}</p>{p.description && <p className="text-xs text-slate-500">{p.description}</p>}</td>
                    <td>{p.kind ? <Badge tone="accent">{t(`perms.kind.${p.kind}`)}</Badge> : <Badge tone="neutral">{t('perms.preset.anyKind')}</Badge>}</td>
                    <td>{t('perms.entries', { count: p.count })}</td>
                    <td className="whitespace-nowrap text-xs text-slate-400">{formatDate(p.createdAt)}<p className="text-slate-500">{p.createdBy}</p></td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={Download} title={t('perms.tools.export')} onClick={() => exportPreset(p)} />
                        {canWrite && <>
                          <Button size="sm" variant="primary" icon={Play} onClick={() => { setApplyPreset(p); setTarget(null); setMode('merge'); }}>{t('perms.tools.applyNow')}</Button>
                          <Button size="sm" variant="ghost" icon={Pencil} title={t('common.edit')} onClick={() => { setRename(p); setName(p.name); setDescription(p.description); }} />
                          <Button size="sm" variant="ghost" icon={Trash2} title={t('common.delete')} onClick={() => setDeleteP(p)} />
                        </>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Card>

      <Modal open={Boolean(applyPreset)} onClose={() => setApplyPreset(null)} title={t('perms.preset.applyTitle', { name: applyPreset?.name ?? '' })} size="sm"
        footer={<><Button variant="ghost" onClick={() => setApplyPreset(null)}>{t('common.cancel')}</Button><Button variant={mode === 'replace' ? 'warning' : 'primary'} disabled={!target} loading={apply.isPending} onClick={() => apply.mutate()}>{t('perms.tools.applyNow')}</Button></>}>
        <div className="space-y-4">
          <div><p className="mb-2 text-sm text-slate-400">{t('perms.preset.applyTarget')}</p><SubjectPicker value={target} onChange={setTarget} /></div>
          <Field label={t('perms.tools.mode')}>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}>
              <option value="merge">{t('perms.tools.modeMerge')}</option>
              <option value="replace">{t('perms.tools.modeReplace')}</option>
            </select>
          </Field>
          <p className="text-xs text-slate-500">{mode === 'merge' ? t('perms.tools.modeMergeHint') : t('perms.tools.modeReplaceHint')}</p>
          {mode === 'replace' && sensitiveTarget && <Alert tone="warning" compact>{t('perms.tools.sensitiveWarning', { name: target?.name ?? '' })}</Alert>}
        </div>
      </Modal>

      <Modal open={Boolean(rename)} onClose={() => setRename(null)} title={t('perms.preset.edit')} size="sm"
        footer={<><Button variant="ghost" onClick={() => setRename(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></>}>
        <div className="space-y-4">
          <Field label={t('common.name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus /></Field>
          <Field label={t('perms.preset.description')}><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></Field>
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(deleteP)} onClose={() => setDeleteP(null)} onConfirm={() => del.mutate()} loading={del.isPending} title={t('perms.preset.deleteConfirm')} message={<span>{deleteP?.name}</span>} confirmLabel={t('common.delete')} />
    </div>
  );
}
