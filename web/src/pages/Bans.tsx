import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban as BanIcon, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { Ban } from '../api/types';
import { useAuth } from '../lib/auth';
import { banDuration, formatDate, formatRelative } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, FullPageSpinner, Modal, PageHeader } from '../components/ui';
import { BanForm } from './Clients';

export default function BansPage() {
  const { can } = useAuth(); const canWrite = can('bans.manage');
  const canHistory = can('history.view');
  const { t } = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteAll, setDeleteAll] = useState(false);

  const bans = useQuery({ queryKey: ['bans'], queryFn: () => api.get<{ bans: Ban[] }>('/api/bans'), refetchInterval: 30000 });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/api/bans/${id}`),
    onSuccess: () => { toast.success(t('bans.removed')); setDeleteId(null); qc.invalidateQueries({ queryKey: ['bans'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const delAll = useMutation({
    mutationFn: () => api.delete('/api/bans/all'),
    onSuccess: () => { toast.success(t('bans.allRemoved')); setDeleteAll(false); qc.invalidateQueries({ queryKey: ['bans'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const filtered = useMemo(() => {
    const list = bans.data?.bans ?? [];
    if (!q.trim()) return list;
    const n = q.toLowerCase();
    return list.filter((b) => [b.ip, b.name, b.uid, b.lastnickname, b.reason, b.invokername, b.mytsid].some((v) => v?.toLowerCase().includes(n)));
  }, [bans.data, q]);

  return (
    <div>
      <PageHeader
        title={t('bans.title')}
        description={bans.data ? t('bans.count', { count: bans.data.bans.length }) : t('bans.subtitle')}
        actions={<>
          <Button variant="ghost" icon={RefreshCw} onClick={() => bans.refetch()} loading={bans.isFetching}>{t('common.refresh')}</Button>
          {canWrite && <Button variant="danger" icon={Trash2} onClick={() => setDeleteAll(true)} disabled={!bans.data?.bans.length}>{t('common.deleteAll')}</Button>}
          {canWrite && <Button variant="primary" icon={Plus} onClick={() => setAddOpen(true)}>{t('bans.add')}</Button>}
        </>}
      />

      {bans.isLoading && <FullPageSpinner />}
      {bans.error && <ErrorBox error={bans.error} onRetry={() => bans.refetch()} />}
      {bans.data && (
        <Card noPadding>
          <div className="border-b border-slate-800 p-4">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input className="input pl-9" placeholder={t('bans.filterPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          {filtered.length === 0 ? <EmptyState icon={BanIcon} title={q ? t('common.noMatches') : t('bans.none')} /> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>ID</th><th>{t('bans.th.target')}</th><th>{t('bans.th.lastNick')}</th><th>{t('common.reason')}</th><th>{t('bans.th.created')}</th><th>{t('bans.th.duration')}</th><th>{t('bans.th.expires')}</th><th>{t('bans.th.by')}</th><th>{t('bans.th.hits')}</th>{canWrite && <th></th>}</tr></thead>
                <tbody>
                  {filtered.map((b) => {
                    const expires = b.duration ? (b.created + b.duration) * 1000 : null;
                    return (
                      <tr key={b.banid}>
                        <td className="font-mono text-xs">{b.banid}</td>
                        <td>
                          <div className="flex flex-col gap-1">
                            {b.ip && <span className="flex items-center gap-1.5"><Badge tone="blue">IP</Badge><span className="font-mono text-xs">{b.ip}</span></span>}
                            {b.name && <span className="flex items-center gap-1.5"><Badge tone="purple">{t('common.name')}</Badge><span className="text-xs">{b.name}</span></span>}
                            {b.uid && <span className="flex items-center gap-1.5"><Badge tone="indigo">UID</Badge>{canHistory ? <Link to={`/history/${encodeURIComponent(b.uid)}`} className="font-mono text-xs hover:underline" title={t('common.profileTitle')}>{b.uid}</Link> : <span className="font-mono text-xs">{b.uid}</span>}</span>}
                            {b.mytsid && <span className="flex items-center gap-1.5"><Badge tone="amber">myTS</Badge><span className="font-mono text-xs">{b.mytsid}</span></span>}
                          </div>
                        </td>
                        <td>{b.lastnickname || '–'}</td>
                        <td className="max-w-xs truncate" title={b.reason}>{b.reason || '–'}</td>
                        <td className="whitespace-nowrap">{formatDate(b.created)}</td>
                        <td>{b.duration ? banDuration(b.duration) : <Badge tone="red">{t('common.permanent')}</Badge>}</td>
                        <td className="whitespace-nowrap">{expires ? <span title={formatDate(expires)}>{formatRelative(expires)}</span> : '–'}</td>
                        <td>{b.invokername || '–'}</td>
                        <td>{b.enforcements}</td>
                        {canWrite && <td className="text-right"><Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDeleteId(b.banid)}>{t('bans.unban')}</Button></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <AddBanModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del.mutate(deleteId)} loading={del.isPending} title={t('bans.confirmRemove')} message={t('bans.confirmRemoveMsg', { id: deleteId ?? '' })} confirmLabel={t('bans.unban')} />
      <ConfirmDialog open={deleteAll} onClose={() => setDeleteAll(false)} onConfirm={() => delAll.mutate()} loading={delAll.isPending} title={t('bans.confirmAll')} message={t('bans.confirmAllMsg')} confirmLabel={t('common.deleteAll')} requireText="ALLE" />
    </div>
  );
}

function AddBanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { t } = useT();
  const [ip, setIp] = useState('');
  const [name, setName] = useState('');
  const [uid, setUid] = useState('');
  const [mytsid, setMytsid] = useState('');
  const [time, setTime] = useState(0);
  const [customTime, setCustomTime] = useState('');
  const [reason, setReason] = useState('');

  const add = useMutation({
    mutationFn: () => api.post('/api/bans', { ip, name, uid, mytsid, time: customTime ? Number(customTime) * 60 : time, reason }),
    onSuccess: () => { toast.success(t('bans.created')); qc.invalidateQueries({ queryKey: ['bans'] }); setIp(''); setName(''); setUid(''); setMytsid(''); setReason(''); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = [ip, name, uid, mytsid].some((v) => v.trim());

  return (
    <Modal open={open} onClose={onClose} title={t('bans.add')} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="danger" icon={BanIcon} loading={add.isPending} disabled={!valid} onClick={() => add.mutate()}>{t('bans.create')}</Button></>}>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('bans.ipLabel')} hint={t('bans.ipHint')}><input className="input font-mono" value={ip} onChange={(e) => setIp(e.target.value)} /></Field>
        <Field label={t('bans.nameLabel')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('bans.uidLabel')}><input className="input font-mono" value={uid} onChange={(e) => setUid(e.target.value)} /></Field>
        <Field label={t('bans.mytsLabel')} hint={t('bans.mytsHint')}><input className="input font-mono" value={mytsid} onChange={(e) => setMytsid(e.target.value)} /></Field>
      </div>
      <BanForm time={time} setTime={setTime} customTime={customTime} setCustomTime={setCustomTime} reason={reason} setReason={setReason} />
    </Modal>
  );
}
