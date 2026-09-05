import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { ChevronRight, Download, File, Folder, FolderPlus, Image, Link2, Pencil, RefreshCw, Trash2, Upload } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { Channel, FileEntry, GroupsResponse, IconEntry } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatBytes, formatDate } from '../lib/format';
import { useT } from '../i18n';
import { Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, FullPageSpinner, Modal, PageHeader } from '../components/ui';

type Tab = 'files' | 'icons';

export default function FilesPage() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'files';
  const setTab = (v: Tab) => { const p = new URLSearchParams(params); p.set('tab', v); setParams(p); };
  return (
    <div>
      <PageHeader title={t('files.title')} description={t('files.description')} />
      <div className="mb-4 flex w-fit gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
        {([['files', t('files.tab.files'), Folder], ['icons', t('files.tab.icons'), Image]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition', tab === key ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-100')}><Icon className="h-4 w-4" />{label}</button>
        ))}
      </div>
      {tab === 'files' ? <FileBrowser /> : <IconManager />}
    </div>
  );
}

function useFlatChannels(enabled = true) {
  const tree = useQuery({ queryKey: ['clients', 'tree'], queryFn: () => api.get<{ tree: Channel[] }>('/api/clients/tree'), enabled });
  const flat = useMemo(() => {
    const out: { cid: string; name: string; depth: number }[] = [];
    const walk = (list: Channel[], depth: number) => { for (const c of list) { out.push({ cid: c.cid, name: c.name, depth }); walk(c.children, depth + 1); } };
    walk(tree.data?.tree ?? [], 0);
    return out;
  }, [tree.data]);
  return { flat, loading: tree.isLoading };
}

function FileBrowser() {
  const { can } = useAuth(); const canWrite = can('files.manage');
  const { t } = useT();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const cid = params.get('cid') || '0';
  const path = params.get('path') || '/';
  const setLoc = (c: string, p: string) => { const n = new URLSearchParams(params); n.set('cid', c); n.set('path', p); setParams(n); };
  const { flat } = useFlatChannels();
  const list = useQuery({ queryKey: ['files', cid, path], queryFn: () => api.get<{ entries: FileEntry[] }>(`/api/files?cid=${cid}&path=${encodeURIComponent(path)}`) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [dirName, setDirName] = useState('');
  const [rename, setRename] = useState<FileEntry | null>(null);
  const [newName, setNewName] = useState('');
  const [del, setDel] = useState<FileEntry | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['files', cid, path] });

  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      for (const f of Array.from(files)) {
        setUploading(f.name);
        const fd = new FormData(); fd.append('cid', cid); fd.append('path', path); fd.append('file', f);
        await api.post('/api/files/upload', fd);
      }
    },
    onSuccess: () => { toast.success(t('files.uploadDone')); setUploading(null); inv(); },
    onError: (e) => { toast.error(errorMessage(e)); setUploading(null); inv(); },
  });
  const mkdir = useMutation({ mutationFn: () => api.post('/api/files/mkdir', { cid, path, name: dirName }), onSuccess: () => { toast.success(t('files.dirCreated')); setMkdirOpen(false); setDirName(''); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const doRename = useMutation({ mutationFn: () => api.post('/api/files/rename', { cid, path, oldName: rename!.name, newName }), onSuccess: () => { toast.success(t('files.renamed')); setRename(null); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (f: FileEntry) => api.delete(`/api/files?cid=${cid}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(f.name)}`), onSuccess: () => { toast.success(t('files.deleted')); setDel(null); inv(); }, onError: (e) => toast.error(errorMessage(e)) });

  const crumbs = path === '/' ? [] : path.split('/').filter(Boolean);
  const locName = cid === '0' ? t('files.serverAvatars') : flat.find((c) => c.cid === cid)?.name || t('files.channelNum', { cid });
  const isImage = (n: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n) || /^avatar_/.test(n);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      <Card title={t('files.location')} className="lg:col-span-1" noPadding>
        <ul className="max-h-[70vh] overflow-y-auto py-1">
          <li><button onClick={() => setLoc('0', '/')} className={clsx('flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-slate-800/40', cid === '0' && 'bg-indigo-500/10 text-indigo-200')}><Image className="h-4 w-4" /> {t('files.serverAvatars')}</button></li>
          {flat.map((c) => (
            <li key={c.cid}><button onClick={() => setLoc(c.cid, '/')} className={clsx('flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-slate-800/40', cid === c.cid && 'bg-indigo-500/10 text-indigo-200')} style={{ paddingLeft: `${16 + c.depth * 14}px` }}><Folder className="h-3.5 w-3.5 shrink-0 text-slate-500" /><span className="truncate">{c.name}</span></button></li>
          ))}
        </ul>
      </Card>
      <Card className="lg:col-span-3" noPadding
        title={<span className="flex items-center gap-1 text-sm"><button className="text-indigo-300 hover:underline" onClick={() => setLoc(cid, '/')}>{locName}</button>{crumbs.map((c, i) => <span key={i} className="flex items-center gap-1"><ChevronRight className="h-3.5 w-3.5 text-slate-600" /><button className="text-slate-300 hover:underline" onClick={() => setLoc(cid, `/${crumbs.slice(0, i + 1).join('/')}`)}>{c}</button></span>)}</span>}
        actions={<>
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => list.refetch()} loading={list.isFetching} />
          {canWrite && <>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) upload.mutate(e.target.files); e.target.value = ''; }} />
            <Button size="sm" icon={FolderPlus} onClick={() => setMkdirOpen(true)}>{t('files.folder')}</Button>
            <Button size="sm" variant="primary" icon={Upload} loading={upload.isPending} onClick={() => fileRef.current?.click()}>{uploading ? t('files.uploading', { name: uploading }) : t('files.upload')}</Button>
          </>}
        </>}>
        {list.isLoading && <FullPageSpinner />}
        {list.error && <div className="p-4"><ErrorBox error={list.error} onRetry={() => list.refetch()} /></div>}
        {list.data && (list.data.entries.length === 0 ? <EmptyState icon={Folder} title={t('files.emptyFolder')} description={canWrite ? t('files.emptyFolderHint') : undefined} /> : (
          <table className="table">
            <thead><tr><th>{t('common.name')}</th><th className="w-28">{t('files.th.size')}</th><th className="w-44">{t('files.th.modified')}</th><th className="w-40 text-right"></th></tr></thead>
            <tbody>
              {list.data.entries.map((f) => (
                <tr key={f.name}>
                  <td>
                    <button className="flex items-center gap-2 text-left" onClick={() => f.type === 'dir' && setLoc(cid, path === '/' ? `/${f.name}` : `${path}/${f.name}`)}>
                      {f.type === 'dir' ? <Folder className="h-4 w-4 text-amber-400" /> : isImage(f.name) ? <img src={`/api/files/preview?cid=${cid}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(f.name)}`} alt="" className="h-6 w-6 rounded object-cover" loading="lazy" /> : <File className="h-4 w-4 text-slate-500" />}
                      <span className={clsx('font-mono text-xs', f.type === 'dir' ? 'text-slate-100 hover:underline' : 'text-slate-200')}>{f.name}</span>
                    </button>
                  </td>
                  <td>{f.type === 'file' ? formatBytes(f.size) : '–'}</td>
                  <td className="text-xs text-slate-400">{formatDate(f.datetime)}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {f.type === 'file' && <a className="btn btn-ghost btn-sm" href={`/api/files/download?cid=${cid}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(f.name)}`} title={t('files.downloadTitle')}><Download className="h-3.5 w-3.5" /></a>}
                      {canWrite && <Button size="sm" variant="ghost" icon={Pencil} title={t('files.rename')} onClick={() => { setRename(f); setNewName(f.name); }} />}
                      {canWrite && <Button size="sm" variant="ghost" icon={Trash2} title={t('common.delete')} onClick={() => setDel(f)} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </Card>
      <Modal open={mkdirOpen} onClose={() => setMkdirOpen(false)} title={t('files.createFolder')} size="sm" footer={<><Button variant="ghost" onClick={() => setMkdirOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={mkdir.isPending} disabled={!dirName.trim()} onClick={() => mkdir.mutate()}>{t('files.create')}</Button></>}>
        <Field label={t('common.name')}><input className="input" value={dirName} onChange={(e) => setDirName(e.target.value)} autoFocus /></Field>
      </Modal>
      <Modal open={Boolean(rename)} onClose={() => setRename(null)} title={t('files.rename')} size="sm" footer={<><Button variant="ghost" onClick={() => setRename(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={doRename.isPending} disabled={!newName.trim() || newName === rename?.name} onClick={() => doRename.mutate()}>{t('files.rename')}</Button></>}>
        <Field label={t('files.newName')}><input className="input font-mono" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus /></Field>
      </Modal>
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} title={del?.type === 'dir' ? t('files.deleteFolder') : t('files.deleteFile')} message={<span className="font-mono text-xs">{del?.name}</span>} confirmLabel={t('common.delete')} />
    </div>
  );
}

function IconManager() {
  const { can } = useAuth(); const canWrite = can('files.manage');
  const { t } = useT();
  const qc = useQueryClient();
  const icons = useQuery({ queryKey: ['icons'], queryFn: () => api.get<{ icons: IconEntry[] }>('/api/files/icons') });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.get<GroupsResponse>('/api/groups'), enabled: canWrite });
  const { flat } = useFlatChannels(canWrite);
  const fileRef = useRef<HTMLInputElement>(null);
  const [assign, setAssign] = useState<IconEntry | null>(null);
  const [kind, setKind] = useState<'servergroup' | 'channelgroup' | 'channel'>('servergroup');
  const [targetId, setTargetId] = useState('');
  const [del, setDel] = useState<IconEntry | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ['icons'] });
  const upload = useMutation({
    mutationFn: async (files: FileList) => { for (const f of Array.from(files)) { const fd = new FormData(); fd.append('file', f); await api.post('/api/files/icons', fd); } },
    onSuccess: () => { toast.success(t('files.iconUploaded')); inv(); }, onError: (e) => { toast.error(errorMessage(e)); inv(); },
  });
  const doAssign = useMutation({ mutationFn: () => api.post('/api/files/icons/assign', { iconId: assign!.id, kind, targetId }), onSuccess: () => { toast.success(t('files.iconAssigned')); setAssign(null); qc.invalidateQueries({ queryKey: ['groups'] }); qc.invalidateQueries({ queryKey: ['clients'] }); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (i: IconEntry) => api.delete(`/api/files/icons/${i.id}`), onSuccess: () => { toast.success(t('files.iconDeleted')); setDel(null); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const targets = kind === 'servergroup' ? (groups.data?.serverGroups ?? []).filter((g) => g.type === 1).map((g) => ({ id: g.sgid, name: g.name })) : kind === 'channelgroup' ? (groups.data?.channelGroups ?? []).filter((g) => g.type === 1).map((g) => ({ id: g.cgid, name: g.name })) : flat.map((c) => ({ id: c.cid, name: `${'  '.repeat(c.depth)}${c.name}` }));
  return (
    <Card title={t('files.iconsCount', { count: icons.data?.icons.length ?? 0 })} subtitle={t('files.iconsSub')}
      actions={canWrite && <><input ref={fileRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.length) upload.mutate(e.target.files); e.target.value = ''; }} /><Button variant="primary" icon={Upload} loading={upload.isPending} onClick={() => fileRef.current?.click()}>{t('files.uploadIcon')}</Button></>}>
      {icons.isLoading && <FullPageSpinner />}
      {icons.error && <ErrorBox error={icons.error} onRetry={() => icons.refetch()} />}
      {icons.data && (icons.data.icons.length === 0 ? <EmptyState icon={Image} title={t('files.noIcons')} /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {icons.data.icons.map((i) => (
            <div key={i.id} className="group flex flex-col items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
              <img src={`/api/files/icons/${i.id}`} alt={`Icon ${i.id}`} className="h-8 w-8 object-contain" style={{ imageRendering: 'pixelated' }} />
              <span className="font-mono text-[11px] text-slate-300">{i.id}</span>
              <span className="text-[10px] text-slate-500">{formatBytes(i.size, 0)}</span>
              {canWrite && <div className="flex gap-1"><Button size="sm" variant="ghost" icon={Link2} title={t('files.assign')} onClick={() => { setAssign(i); setTargetId(''); }} /><Button size="sm" variant="ghost" icon={Trash2} title={t('common.delete')} onClick={() => setDel(i)} /></div>}
            </div>
          ))}
        </div>
      ))}
      <Modal open={Boolean(assign)} onClose={() => setAssign(null)} title={t('files.assignTitle', { id: assign?.id ?? '' })} size="sm" footer={<><Button variant="ghost" onClick={() => setAssign(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={doAssign.isPending} disabled={!targetId} onClick={() => doAssign.mutate()}>{t('files.assign')}</Button></>}>
        <div className="space-y-4">
          <div className="flex items-center gap-3"><img src={`/api/files/icons/${assign?.id}`} alt="" className="h-8 w-8" /><span className="font-mono text-xs text-slate-400">i_icon_id = {assign?.id}</span></div>
          <Field label={t('files.targetType')}><select className="input" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setTargetId(''); }}><option value="servergroup">{t('files.serverGroup')}</option><option value="channelgroup">{t('files.channelGroup')}</option><option value="channel">{t('files.channel')}</option></select></Field>
          <Field label={t('files.target')}><select className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}><option value="">{t('files.choose')}</option>{targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        </div>
      </Modal>
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} title={t('files.deleteIcon', { id: del?.id ?? '' })} message={t('files.deleteIconMsg')} confirmLabel={t('common.delete')} />
    </Card>
  );
}
