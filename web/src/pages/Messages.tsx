import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { Inbox, Mail, MailOpen, PenSquare, RefreshCw, Search, Send, Trash2, User } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import type { DbClient, OfflineMessage, OfflineMessageDetail } from '../api/types';
import { useAuth } from '../lib/auth';
import { formatDate, formatRelative } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Field, FullPageSpinner, Modal, PageHeader } from '../components/ui';

/** Offline-Nachrichten: Posteingang des Query-Kontos lesen, Nachrichten an (auch offline) Clients schreiben. */
export default function MessagesPage() {
  const { t } = useT();
  const { can } = useAuth(); const canWrite = can('messages.manage'); const canHistory = can('history.view');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);

  const list = useQuery({ queryKey: ['messages'], queryFn: () => api.get<{ messages: OfflineMessage[]; unread: number; account: string }>('/api/messages'), refetchInterval: 60000 });
  const detail = useQuery({ queryKey: ['messages', selected], queryFn: () => api.get<OfflineMessageDetail>(`/api/messages/${selected}`), enabled: Boolean(selected) });
  const inv = () => { qc.invalidateQueries({ queryKey: ['messages'] }); };

  // Gelesen markieren, sobald eine ungelesene Nachricht geöffnet wird
  const markRead = useMutation({ mutationFn: ({ id, read }: { id: string; read: boolean }) => api.post(`/api/messages/${id}/read`, { read }), onSuccess: inv, onError: (e) => toast.error(errorMessage(e)) });
  useEffect(() => {
    if (!selected || !list.data) return;
    const m = list.data.messages.find((x) => x.id === selected);
    if (m && !m.read && !markRead.isPending) markRead.mutate({ id: selected, read: true });
  }, [selected, list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/api/messages/${id}`), onSuccess: () => { toast.success(t('messages.deleted')); setDeleteId(null); if (selected === deleteId) setSelected(null); inv(); }, onError: (e) => toast.error(errorMessage(e)) });

  useEffect(() => { if (params.get('compose') === '1') setCompose(true); }, [params]);
  const closeCompose = () => { setCompose(false); if (params.has('compose')) { const p = new URLSearchParams(params); p.delete('compose'); p.delete('to'); p.delete('nick'); setParams(p, { replace: true }); } };

  const d = list.data;
  const current = d?.messages.find((m) => m.id === selected) ?? null;

  return (
    <div>
      <PageHeader title={t('messages.title')} description={d?.account ? t('messages.descriptionAccount', { account: d.account }) : t('messages.description')}
        actions={<>
          <Button variant="ghost" icon={RefreshCw} onClick={() => list.refetch()} loading={list.isFetching}>{t('common.refresh')}</Button>
          {canWrite && <Button variant="primary" icon={PenSquare} onClick={() => setCompose(true)}>{t('messages.compose')}</Button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2" noPadding title={<span className="flex items-center gap-2"><Inbox className="h-4 w-4 text-indigo-400" /> {t('messages.inbox')}{d && d.unread > 0 && <Badge tone="accent">{t('messages.unread', { count: d.unread })}</Badge>}</span>}>
          {list.isLoading && <FullPageSpinner />}
          {list.error && <div className="p-4"><ErrorBox error={list.error} onRetry={() => list.refetch()} /></div>}
          {d && (d.messages.length === 0 ? <EmptyState icon={Inbox} title={t('messages.none')} description={t('messages.noneHint')} /> : (
            <ul className="max-h-[70vh] divide-y divide-slate-800/60 overflow-y-auto">
              {d.messages.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => setSelected(m.id)} className={clsx('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-800/40', selected === m.id && 'bg-indigo-500/10')}>
                    {m.read ? <MailOpen className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /> : <Mail className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2"><span className={clsx('truncate text-sm', m.read ? 'text-slate-300' : 'font-semibold text-slate-100')}>{m.nickname || m.uid}</span><span className="shrink-0 text-[11px] text-slate-500" title={formatDate(m.timestamp, true)}>{formatRelative(m.timestamp)}</span></span>
                      <span className={clsx('block truncate text-xs', m.read ? 'text-slate-500' : 'text-slate-300')}>{m.subject || t('messages.noSubject')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </Card>

        <Card className="lg:col-span-3" title={current ? (current.subject || t('messages.noSubject')) : t('messages.detail')}
          subtitle={current ? <span className="flex flex-wrap items-center gap-2"><User className="h-3.5 w-3.5" />{canHistory ? <Link to={`/history/${encodeURIComponent(current.uid)}`} className="hover:underline">{current.nickname || current.uid}</Link> : (current.nickname || current.uid)}<span className="text-slate-500">·</span>{formatDate(current.timestamp, true)}</span> : undefined}
          actions={current && <div className="flex gap-1">
            <Button size="sm" variant="ghost" icon={current.read ? Mail : MailOpen} onClick={() => markRead.mutate({ id: current.id, read: !current.read })} title={current.read ? t('messages.markUnread') : t('messages.markRead')} />
            {canWrite && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDeleteId(current.id)} title={t('common.delete')} />}
          </div>}>
          {!selected && <EmptyState icon={MailOpen} title={t('messages.selectOne')} />}
          {selected && detail.isLoading && <FullPageSpinner />}
          {selected && detail.error && <ErrorBox error={detail.error} onRetry={() => detail.refetch()} />}
          {detail.data && selected === detail.data.id && (
            <div className="space-y-4">
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-950/60 p-4 font-sans text-sm text-slate-200">{detail.data.message}</pre>
              <p className="font-mono text-[11px] text-slate-500">{detail.data.uid}</p>
              {canWrite && <Button size="sm" icon={PenSquare} onClick={() => { const p = new URLSearchParams(params); p.set('compose', '1'); p.set('to', detail.data!.uid); p.set('nick', detail.data!.nickname || ''); setParams(p, { replace: true }); }}>{t('messages.reply')}</Button>}
            </div>
          )}
        </Card>
      </div>

      {compose && <ComposeDialog to={params.get('to') || ''} nick={params.get('nick') || ''} onClose={closeCompose} onSent={() => { closeCompose(); inv(); }} />}
      <ConfirmDialog open={deleteId !== null} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del.mutate(deleteId)} loading={del.isPending} title={t('messages.deleteConfirm')} confirmLabel={t('common.delete')} />
    </div>
  );
}

function ComposeDialog({ to, nick, onClose, onSent }: { to: string; nick: string; onClose: () => void; onSent: () => void }) {
  const { t } = useT();
  const [uid, setUid] = useState(to);
  const [nickname, setNickname] = useState(nick);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(h); }, [q]);
  const search = useQuery({ queryKey: ['clients', 'db', debounced], queryFn: () => api.get<{ entries: DbClient[] }>(`/api/clients/db/search?q=${encodeURIComponent(debounced)}&limit=20`), enabled: !uid && debounced.length >= 2 });
  const send = useMutation({
    mutationFn: () => api.post<{ ok: boolean; nickname: string }>('/api/messages', { uid, subject: subject.trim(), message: message.trim() }),
    onSuccess: (r) => { toast.success(t('messages.sent', { name: r.nickname || nickname || uid })); onSent(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title={t('messages.compose')} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" icon={Send} loading={send.isPending} disabled={!uid || !subject.trim() || !message.trim()} onClick={() => send.mutate()}>{t('dash.send')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('messages.recipient')} hint={t('messages.recipientHint')}>
          {uid ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
              <span className="min-w-0"><span className="font-medium text-slate-100">{nickname || t('common.unknown')}</span><span className="ml-2 break-all font-mono text-[11px] text-slate-500">{uid}</span></span>
              <Button size="sm" variant="ghost" onClick={() => { setUid(''); setNickname(''); }}>{t('common.change')}</Button>
            </div>
          ) : (
            <div>
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input className="input pl-9" placeholder={t('clients.dbPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
              {search.data && (
                <ul className="mt-2 max-h-48 divide-y divide-slate-800/60 overflow-y-auto rounded-lg border border-slate-800">
                  {search.data.entries.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">{t('common.noMatches')}</li>}
                  {search.data.entries.map((c) => <li key={c.cldbid}><button type="button" className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-800/40" onClick={() => { setUid(c.uid); setNickname(c.nickname); }}><span>{c.nickname}</span><span className="font-mono text-[11px] text-slate-500">#{c.cldbid}</span></button></li>)}
                </ul>
              )}
            </div>
          )}
        </Field>
        <Field label={t('messages.subject')}><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} /><p className="mt-1 text-right text-[11px] text-slate-500">{subject.length}/200</p></Field>
        <Field label={t('messages.text')}><textarea className="input min-h-32" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4096} /><p className="mt-1 text-right text-[11px] text-slate-500">{message.length}/4096</p></Field>
        <p className="text-xs text-slate-500">{t('messages.offlineNote')}</p>
      </div>
    </Modal>
  );
}
