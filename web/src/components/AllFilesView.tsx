import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, Download, File, FolderOpen, List, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { AllFilesResponse, AllFilesRow } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatBytes, formatDate, formatRelative } from '../lib/format';
import { useT } from '../i18n';
import { Button, Card, ConfirmDialog, EmptyState, ErrorBox, FullPageSpinner, Alert } from './ui';

type SortKey = 'name' | 'channelName' | 'path' | 'size' | 'datetime';

/** Alle Dateien aller Kanäle und der Server-Ablage in einer sortier- und durchsuchbaren Liste. */
export function AllFilesView() {
  const { t } = useT();
  const { can } = useAuth(); const canWrite = can('files.manage');
  const qc = useQueryClient();
  const [, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('datetime');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [del, setDel] = useState<AllFilesRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const list = useQuery({ queryKey: ['files', 'all'], queryFn: () => api.get<AllFilesResponse>('/api/files/all'), staleTime: 30000 });
  const refresh = async () => {
    setRefreshing(true);
    try { qc.setQueryData(['files', 'all'], await api.get<AllFilesResponse>('/api/files/all?refresh=1')); } catch (e) { toast.error(errorMessage(e)); } finally { setRefreshing(false); }
  };
  const remove = useMutation({
    mutationFn: (f: AllFilesRow) => api.delete(`/api/files?cid=${f.cid}&path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(f.name)}`),
    onSuccess: () => { toast.success(t('files.deleted')); setDel(null); refresh(); qc.invalidateQueries({ queryKey: ['files'], exact: false }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = (list.data?.rows ?? []).filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.path.toLowerCase().includes(needle) || r.channelName.toLowerCase().includes(needle));
    const mul = dir === 'asc' ? 1 : -1;
    return [...all].sort((a, b) => {
      const va = a[sort]; const vb = b[sort];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
      return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' }) * mul;
    });
  }, [list.data, q, sort, dir]);

  const toggleSort = (k: SortKey) => { if (sort === k) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir(k === 'size' || k === 'datetime' ? 'desc' : 'asc'); } };
  const openInBrowser = (r: AllFilesRow) => setParams({ tab: 'files', cid: r.cid, path: r.path });
  const location = (r: AllFilesRow) => (r.cid === '0' ? t('files.serverAvatars') : r.channelName);
  const sortIcon = (k: SortKey) => (sort === k ? (dir === 'asc' ? <ArrowUp className="ml-1 inline h-3 w-3" /> : <ArrowDown className="ml-1 inline h-3 w-3" />) : null);
  const d = list.data;

  return (
    <Card noPadding
      title={<span className="flex items-center gap-2"><List className="h-4 w-4 text-indigo-400" /> {t('files.all.title')}</span>}
      subtitle={d ? t('files.all.subtitle', { count: d.count, size: formatBytes(d.totalSize), channels: d.channels, when: formatRelative(d.cachedAt) }) : t('files.all.loading')}
      actions={<>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input className="input w-64 pl-9" placeholder={t('files.all.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Button size="sm" variant="ghost" icon={RefreshCw} loading={refreshing || list.isFetching} onClick={refresh}>{t('common.refresh')}</Button>
      </>}>
      {list.isLoading && <FullPageSpinner label={t('files.all.loading')} />}
      {list.error && <div className="p-4"><ErrorBox error={list.error} onRetry={() => list.refetch()} /></div>}
      {d && (d.truncated || d.errors.length > 0) && (
        <Alert tone="warning" compact className="m-4 mb-0">
          {d.truncated && <p>{t('files.all.truncated')}</p>}
          {d.errors.length > 0 && <p title={d.errors.map((e) => `${e.cid}:${e.path} – ${e.error}`).join('\n')}>{t('files.all.errors', { count: d.errors.length })}{d.errors.some((e) => /flood/i.test(e.error)) && ` ${t('files.all.flood')}`}</p>}
        </Alert>
      )}
      {d && (rows.length === 0 ? <EmptyState icon={File} title={q ? t('common.noMatches') : t('files.all.none')} /> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th><button type="button" className="hover:text-slate-100" onClick={() => toggleSort('name')}>{t('common.name')}{sortIcon('name')}</button></th>
                <th><button type="button" className="hover:text-slate-100" onClick={() => toggleSort('channelName')}>{t('files.location')}{sortIcon('channelName')}</button></th>
                <th><button type="button" className="hover:text-slate-100" onClick={() => toggleSort('path')}>{t('files.all.path')}{sortIcon('path')}</button></th>
                <th className="w-28"><button type="button" className="hover:text-slate-100" onClick={() => toggleSort('size')}>{t('files.th.size')}{sortIcon('size')}</button></th>
                <th className="w-44"><button type="button" className="hover:text-slate-100" onClick={() => toggleSort('datetime')}>{t('files.th.modified')}{sortIcon('datetime')}</button></th>
                <th className="w-32 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.cid}:${r.path}/${r.name}`}>
                  <td className="font-mono text-xs text-slate-100">{r.name}</td>
                  <td className={clsx('text-xs', r.cid === '0' ? 'text-slate-400' : 'text-slate-200')}>{location(r)}</td>
                  <td className="font-mono text-xs text-slate-400">{r.path}</td>
                  <td>{formatBytes(r.size)}</td>
                  <td className="text-xs text-slate-400">{formatDate(r.datetime)}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <a className="btn btn-ghost btn-sm" href={`/api/files/download?cid=${r.cid}&path=${encodeURIComponent(r.path)}&name=${encodeURIComponent(r.name)}`} title={t('files.downloadTitle')}><Download className="h-3.5 w-3.5" /></a>
                      <Button size="sm" variant="ghost" icon={FolderOpen} title={t('files.all.open')} onClick={() => openInBrowser(r)} />
                      {canWrite && <Button size="sm" variant="ghost" icon={Trash2} title={t('common.delete')} onClick={() => setDel(r)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">{t('files.all.footer', { count: rows.length, size: formatBytes(rows.reduce((a, r) => a + r.size, 0)) })}</p>
        </div>
      ))}
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} title={t('files.deleteFile')} message={<span className="font-mono text-xs">{del ? `${location(del)} · ${del.path === '/' ? '' : del.path}/${del.name}` : ''}</span>} confirmLabel={t('common.delete')} />
    </Card>
  );
}
