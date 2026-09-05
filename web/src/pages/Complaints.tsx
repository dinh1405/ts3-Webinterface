import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Flag, RefreshCw, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { Complaint } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatDate, formatRelative } from '../lib/format';
import { useT } from '../i18n';
import { Button, Card, ConfirmDialog, EmptyState, ErrorBox, FullPageSpinner, Modal, PageHeader } from '../components/ui';
import { BanForm } from './Clients';

export default function ComplaintsPage() {
  const { can } = useAuth(); const canWrite = can('complaints.manage'); const canBan = can('bans.manage');
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['complaints'], queryFn: () => api.get<{ complaints: Complaint[] }>('/api/complaints'), refetchInterval: 30000 });
  const [del, setDel] = useState<Complaint | null>(null);
  const [delAll, setDelAll] = useState<Complaint | null>(null);
  const [ban, setBan] = useState<Complaint | null>(null);
  const [time, setTime] = useState(0);
  const [customTime, setCustomTime] = useState('');
  const [reason, setReason] = useState('');
  const inv = () => qc.invalidateQueries({ queryKey: ['complaints'] });
  const remove = useMutation({ mutationFn: (c: Complaint) => api.delete(`/api/complaints/${c.targetCldbid}/${c.fromCldbid}`), onSuccess: () => { toast.success(t('complaints.deleted')); setDel(null); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const removeAll = useMutation({ mutationFn: (c: Complaint) => api.delete(`/api/complaints/${c.targetCldbid}`), onSuccess: () => { toast.success(t('complaints.allDeleted')); setDelAll(null); inv(); }, onError: (e) => toast.error(errorMessage(e)) });
  const doBan = useMutation({
    mutationFn: () => api.post(`/api/clients/db/${ban!.targetCldbid}/ban`, { time: customTime ? Number(customTime) * 60 : time, reason: reason || t('complaints.reasonPrefix', { message: ban!.message }).slice(0, 200), banIp: true }),
    onSuccess: () => { toast.success(t('complaints.banned')); setBan(null); setReason(''); qc.invalidateQueries({ queryKey: ['bans'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = q.data?.complaints ?? [];
  const byTarget = new Map<string, number>();
  for (const c of list) byTarget.set(c.targetCldbid, (byTarget.get(c.targetCldbid) || 0) + 1);

  return (
    <div>
      <PageHeader title={t('complaints.title')} description={q.data ? t('complaints.count', { count: list.length, targets: byTarget.size }) : t('complaints.subtitle')} actions={<Button variant="ghost" icon={RefreshCw} onClick={() => q.refetch()} loading={q.isFetching}>{t('common.refresh')}</Button>} />
      {q.isLoading && <FullPageSpinner />}
      {q.error && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <Card noPadding>
          {list.length === 0 ? <EmptyState icon={Flag} title={t('complaints.none')} description={t('complaints.noneHint')} /> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>{t('complaints.th.about')}</th><th>{t('complaints.th.from')}</th><th>{t('complaints.th.message')}</th><th>{t('complaints.th.time')}</th>{(canWrite || canBan) && <th className="text-right">{t('common.actions')}</th>}</tr></thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={`${c.targetCldbid}-${c.fromCldbid}-${c.timestamp}`}>
                      <td><p className="font-medium text-slate-100">{c.targetName}</p><p className="font-mono text-[11px] text-slate-500">#{c.targetCldbid} · {t('complaints.perTarget', { count: byTarget.get(c.targetCldbid) ?? 0 })}</p></td>
                      <td><p className="text-slate-200">{c.fromName}</p><p className="font-mono text-[11px] text-slate-500">#{c.fromCldbid}</p></td>
                      <td className="max-w-md whitespace-pre-wrap text-slate-300">{c.message || '–'}</td>
                      <td className="whitespace-nowrap" title={formatDate(c.timestamp, true)}>{formatRelative(c.timestamp)}</td>
                      {(canWrite || canBan) && (
                        <td>
                          <div className="flex justify-end gap-1">
                            {canBan && <Button size="sm" variant="danger" icon={Ban} onClick={() => { setBan(c); setReason(''); }}>{t('complaints.ban')}</Button>}
                            {canWrite && <Button size="sm" variant="ghost" icon={Trash2} title={t('complaints.deleteOne')} onClick={() => setDel(c)} />}
                            {canWrite && (byTarget.get(c.targetCldbid) || 0) > 1 && <Button size="sm" variant="ghost" title={t('complaints.deleteAllTitle')} onClick={() => setDelAll(c)}>{t('common.all')}</Button>}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} loading={remove.isPending} title={t('complaints.confirmDelete')} message={t('complaints.confirmDeleteMsg', { from: del?.fromName ?? '', target: del?.targetName ?? '' })} confirmLabel={t('common.delete')} />
      <ConfirmDialog open={Boolean(delAll)} onClose={() => setDelAll(null)} onConfirm={() => delAll && removeAll.mutate(delAll)} loading={removeAll.isPending} title={t('complaints.confirmAll')} message={t('complaints.confirmAllMsg', { target: delAll?.targetName ?? '' })} confirmLabel={t('common.deleteAll')} />
      <Modal open={Boolean(ban)} onClose={() => setBan(null)} title={t('complaints.banTitle', { name: ban?.targetName ?? '' })} size="md" footer={<><Button variant="ghost" onClick={() => setBan(null)}>{t('common.cancel')}</Button><Button variant="danger" icon={Ban} loading={doBan.isPending} onClick={() => doBan.mutate()}>{t('complaints.ban')}</Button></>}>
        <BanForm time={time} setTime={setTime} customTime={customTime} setCustomTime={setCustomTime} reason={reason} setReason={setReason}>
          <p className="text-xs text-slate-500">{t('complaints.banNote')}</p>
        </BanForm>
      </Modal>
    </div>
  );
}
