import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { ArrowLeft, ArrowRight, GitCompare, KeyRound } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { GroupPermission, PermKind, PermResult } from '../api/types';
import { useAuth } from '../lib/auth';
import { useT } from '../i18n';
import { diffPerms, type DiffStatus } from '../lib/permdiff';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, FullPageSpinner, PageHeader, Toggle } from '../components/ui';
import { SubjectPicker, parseSubjectKey, subjectKey, type SubjectRef } from '../components/SubjectPicker';
import { fmt, isSensitiveSubject } from '../components/PermTools';
import { CategoryFilter, categoryOf } from './Permissions';

interface SubjectResponse { subject: { id: string; kind: PermKind; name: string; type?: number }; permissions: GroupPermission[] }
const STATUS_TONE: Record<DiffStatus, 'green' | 'red' | 'amber' | 'slate'> = { added: 'green', removed: 'red', changed: 'amber', same: 'slate' };

/** Zwei Rechte-Subjekte nebeneinander: Unterschiede hervorgehoben, optional A → B übernehmen. */
export default function PermissionComparePage() {
  const { t } = useT();
  const { can } = useAuth(); const canWrite = can('permissions.manage');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const a = parseSubjectKey(params.get('a'));
  const b = parseSubjectKey(params.get('b'));
  const setSide = (side: 'a' | 'b', s: SubjectRef | null) => { const p = new URLSearchParams(params); if (s) p.set(side, subjectKey(s)); else p.delete(side); setParams(p); };
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [confirm, setConfirm] = useState<'merge' | 'replace' | null>(null);

  const qa = useQuery({ queryKey: ['permissions', a?.kind, a?.id], queryFn: () => api.get<SubjectResponse>(`/api/permissions/${a!.kind}/${encodeURIComponent(a!.id)}`), enabled: Boolean(a) });
  const qb = useQuery({ queryKey: ['permissions', b?.kind, b?.id], queryFn: () => api.get<SubjectResponse>(`/api/permissions/${b!.kind}/${encodeURIComponent(b!.id)}`), enabled: Boolean(b) });

  const diff = useMemo(() => (qa.data && qb.data ? diffPerms(qa.data.permissions, qb.data.permissions) : null), [qa.data, qb.data]);
  const rows = useMemo(() => {
    if (!diff) return [];
    const needle = q.trim().toLowerCase();
    return diff.rows.filter((r) => !onlyDiff || r.status !== 'same').filter((r) => !category || categoryOf(r.name) === category).filter((r) => !needle || r.name.includes(needle));
  }, [diff, q, category, onlyDiff]);

  const copy = useMutation({
    mutationFn: (mode: 'merge' | 'replace') => api.post<{ ok: boolean; results: PermResult[]; removed: string[] }>(`/api/permissions/${b!.kind}/${encodeURIComponent(b!.id)}/copy-from`, { sourceKind: a!.kind, sourceId: a!.id, mode }),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) toast.warning(t('perms.savedPartial', { ok: r.results.length - failed.length, failed: failed.length }), { description: failed.map((f) => `${f.name}: ${f.error}`).join('\n') });
      else toast.success(t('perms.tools.appliedRemoved', { count: r.results.length, removed: r.removed.length }));
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ['permissions', b!.kind, b!.id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const nameA = qa.data?.subject.name ?? (a ? `${t(`perms.kind.${a.kind}`)} #${a.id}` : 'A');
  const nameB = qb.data?.subject.name ?? (b ? `${t(`perms.kind.${b.kind}`)} #${b.id}` : 'B');
  const sensitive = qb.data ? isSensitiveSubject({ ...qb.data.subject }) : false;

  return (
    <div>
      <PageHeader title={<span className="flex items-center gap-3"><GitCompare className="h-6 w-6 text-indigo-400" /> {t('perms.compare.title')}</span>} description={t('perms.compare.description')}
        actions={<Link to="/permissions" className="btn btn-ghost"><ArrowLeft className="h-4 w-4" /> {t('common.back')}</Link>} />

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title={<span>A · {nameA}</span>} actions={a && <Link to={`/permissions/${a.kind}/${encodeURIComponent(a.id)}`} className="btn btn-ghost btn-sm"><KeyRound className="h-3.5 w-3.5" /> {t('groups.permissions')}</Link>}>
          <SubjectPicker value={a} onChange={(s) => setSide('a', s)} exclude={b} compact />
        </Card>
        <Card title={<span>B · {nameB}</span>} actions={b && <Link to={`/permissions/${b.kind}/${encodeURIComponent(b.id)}`} className="btn btn-ghost btn-sm"><KeyRound className="h-3.5 w-3.5" /> {t('groups.permissions')}</Link>}>
          <SubjectPicker value={b} onChange={(s) => setSide('b', s)} exclude={a} compact />
        </Card>
      </div>

      {(qa.error || qb.error) && <div className="mb-4"><ErrorBox error={qa.error || qb.error} onRetry={() => { qa.refetch(); qb.refetch(); }} /></div>}
      {(!a || !b) && <EmptyState icon={GitCompare} title={t('perms.compare.pickBoth')} />}
      {a && b && (qa.isLoading || qb.isLoading) && <FullPageSpinner />}
      {diff && (
        <Card noPadding
          title={<span className="flex flex-wrap items-center gap-2">{t('perms.compare.result')}<Badge tone="green">{t('perms.compare.added', { count: diff.added })}</Badge><Badge tone="red">{t('perms.compare.removed', { count: diff.removed })}</Badge><Badge tone="amber">{t('perms.compare.changed', { count: diff.changed })}</Badge><Badge tone="slate">{t('perms.compare.same', { count: diff.same })}</Badge></span>}
          subtitle={t('perms.compare.legend', { a: nameA, b: nameB })}
          actions={<CategoryFilter q={q} setQ={setQ} category={category} setCategory={setCategory} extra={<Toggle checked={onlyDiff} onChange={setOnlyDiff} label={t('perms.compare.onlyDiff')} />} />}>
          {rows.length === 0 ? <EmptyState icon={GitCompare} title={onlyDiff && diff.added + diff.removed + diff.changed === 0 ? t('perms.compare.identical') : t('common.noMatches')} /> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>{t('perms.th.permission')}</th><th className="w-40">A · {nameA}</th><th className="w-40">B · {nameB}</th><th className="w-32">{t('perms.compare.status')}</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name} className={clsx(r.status === 'added' && 'bg-emerald-500/5', r.status === 'removed' && 'bg-rose-500/5', r.status === 'changed' && 'bg-amber-500/5')}>
                      <td className="font-mono text-xs text-slate-100">{r.name}</td>
                      <td className="font-mono text-xs">{r.a ? fmt(r.a) : <span className="text-slate-600">–</span>}</td>
                      <td className="font-mono text-xs">{r.b ? fmt(r.b) : <span className="text-slate-600">–</span>}</td>
                      <td><Badge tone={STATUS_TONE[r.status]}>{t(`perms.compare.st.${r.status}`)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canWrite && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-5 py-3">
              <p className="text-xs text-slate-500">{t('perms.compare.applyHint', { a: nameA, b: nameB })}</p>
              <div className="flex gap-2">
                <Button size="sm" icon={ArrowRight} onClick={() => setConfirm('merge')} disabled={diff.added + diff.changed + diff.removed === 0 && diff.same === 0}>{t('perms.compare.applyMerge')}</Button>
                <Button size="sm" variant="warning" icon={ArrowRight} onClick={() => setConfirm('replace')}>{t('perms.compare.applyReplace')}</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} onConfirm={() => confirm && copy.mutate(confirm)} loading={copy.isPending} tone={confirm === 'replace' ? 'warning' : 'primary'}
        title={t('perms.compare.confirmTitle', { a: nameA, b: nameB })} confirmLabel={t('perms.tools.copyNow')} requireText={confirm === 'replace' && sensitive ? 'REPLACE' : undefined}
        message={<div className="space-y-2">
          <p>{confirm === 'replace' ? t('perms.tools.modeReplaceHint') : t('perms.tools.modeMergeHint')}</p>
          {confirm === 'replace' && sensitive && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">{t('perms.tools.sensitiveWarning', { name: nameB })}</p>}
          <Field label={t('perms.compare.summary')}><p className="text-xs text-slate-400">{t('perms.compare.willSet', { count: (qa.data?.permissions.length ?? 0) })}{confirm === 'replace' && ` · ${t('perms.compare.willRemoveCount', { count: diff?.added ?? 0 })}`}</p></Field>
        </div>} />
    </div>
  );
}
