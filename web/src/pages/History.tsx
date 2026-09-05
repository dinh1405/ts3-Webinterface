import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, Clock, History, Search, StickyNote, UserPlus, Users } from 'lucide-react';
import { api } from '../api/client';
import type { HistoryIdentitySummary, HistorySummary } from '../api/types';
import { countryFlag, formatDate, formatDuration, formatRelative } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, EmptyState, ErrorBox, FullPageSpinner, PageHeader, Stat } from '../components/ui';

const LIMIT = 50;
type Sort = 'lastSeen' | 'firstSeen' | 'onlineSec' | 'sessions' | 'nickname';

export const profileLink = (uid: string) => `/history/${encodeURIComponent(uid)}`;

export default function HistoryPage() {
  const { t } = useT();
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') ?? '');
  const [sort, setSort] = useState<Sort>('lastSeen');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset), sort, online: onlineOnly ? '1' : '0' });
  if (q.trim()) params.set('q', q.trim());
  const list = useQuery({ queryKey: ['history', 'list', params.toString()], queryFn: () => api.get<{ total: number; entries: HistoryIdentitySummary[] }>(`/api/history?${params}`), refetchInterval: 30000, placeholderData: (prev) => prev });
  const summary = useQuery({ queryKey: ['history', 'summary'], queryFn: () => api.get<HistorySummary>('/api/history/summary'), refetchInterval: 60000 });

  const s = summary.data;

  return (
    <div className="space-y-6">
      <PageHeader title={t('history.title')} description={t('history.description')} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={t('history.identities')} value={s?.identities ?? '–'} sub={s ? t('history.newWeek', { count: s.newIdentitiesWeek }) : undefined} icon={Users} />
        <Stat label={t('history.seenToday')} value={s?.uniqueToday ?? '–'} sub={s ? t('history.onlineNow', { count: s.onlineNow }) : undefined} icon={Clock} tone="green" />
        <Stat label={t('history.last7')} value={s?.uniqueWeek ?? '–'} sub={t('history.distinctClients')} icon={UserPlus} tone="blue" />
        <Stat label={t('history.last30')} value={s?.uniqueMonth ?? '–'} sub={s ? t('history.sessionsCount', { count: s.sessionsMonth }) : undefined} icon={History} tone="purple" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" noPadding>
          <div className="flex flex-wrap gap-2 border-b border-slate-800 p-4">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input className="input pl-9" placeholder={t('history.searchPlaceholder')} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
            </div>
            <select className="input w-auto" value={sort} onChange={(e) => { setSort(e.target.value as Sort); setOffset(0); }}>
              <option value="lastSeen">{t('history.sort.lastSeen')}</option>
              <option value="firstSeen">{t('history.sort.firstSeen')}</option>
              <option value="onlineSec">{t('history.sort.onlineSec')}</option>
              <option value="sessions">{t('history.sort.sessions')}</option>
              <option value="nickname">{t('history.sort.nickname')}</option>
            </select>
            <button type="button" className={clsx('btn', onlineOnly ? 'btn-primary' : 'btn-secondary')} onClick={() => { setOnlineOnly(!onlineOnly); setOffset(0); }}>{t('history.onlineOnly')}</button>
          </div>
          {list.isLoading && <FullPageSpinner />}
          {list.error && <div className="p-4"><ErrorBox error={list.error} onRetry={() => list.refetch()} /></div>}
          {list.data && (list.data.entries.length === 0 ? (
            <EmptyState icon={History} title={t('audit.none')} description={q ? t('history.noMatch') : t('history.noneYet')} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Client</th><th>{t('history.th.lastIp')}</th><th>{t('history.sort.lastSeen')}</th><th>{t('history.sort.firstSeen')}</th><th className="text-right">{t('history.sort.sessions')}</th><th className="text-right">{t('history.sort.onlineSec')}</th><th></th></tr></thead>
                  <tbody>
                    {list.data.entries.map((e) => (
                      <tr key={e.uid}>
                        <td>
                          <Link to={profileLink(e.uid)} className="flex items-center gap-2 hover:underline">
                            <span className={clsx('h-2 w-2 shrink-0 rounded-full', e.online ? 'bg-emerald-400' : 'bg-slate-600')} />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-100">{e.nickname || <span className="font-mono text-xs">{e.uid}</span>}{e.country && <span className="ml-1.5 text-xs" title={e.country}>{countryFlag(e.country)}</span>}</span>
                              <span className="block truncate font-mono text-[11px] text-slate-500">{e.uid}</span>
                            </span>
                          </Link>
                        </td>
                        <td className="font-mono text-xs">{e.lastIp || '–'}{e.ips > 1 && <span className="ml-1 text-slate-500">+{e.ips - 1}</span>}</td>
                        <td className="whitespace-nowrap text-xs" title={formatDate(e.lastSeen, true)}>{e.online ? <Badge tone="green" dot pulse>online</Badge> : formatRelative(e.lastSeen)}</td>
                        <td className="whitespace-nowrap text-xs text-slate-400">{formatDate(e.firstSeen)}</td>
                        <td className="text-right">{e.sessions}</td>
                        <td className="whitespace-nowrap text-right text-xs">{formatDuration(e.onlineSec)}</td>
                        <td className="text-right">
                          <span className="flex items-center justify-end gap-1.5">
                            {e.nicknames > 1 && <Badge tone="indigo" className="whitespace-nowrap">{t('history.namesCount', { count: e.nicknames })}</Badge>}
                            {e.notes > 0 && <Badge tone="amber"><StickyNote className="h-3 w-3" />{e.notes}</Badge>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
                <span>{t('common.rangeOf', { from: offset + 1, to: Math.min(offset + LIMIT, list.data.total), total: list.data.total })}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>{t('common.back')}</Button>
                  <Button size="sm" variant="ghost" icon={ChevronRight} disabled={offset + LIMIT >= list.data.total} onClick={() => setOffset(offset + LIMIT)}>{t('common.next')}</Button>
                </div>
              </div>
            </>
          ))}
        </Card>

        <Card title={t('history.topClients')} subtitle={t('history.topSubtitle')} noPadding>
          {summary.isLoading && <FullPageSpinner />}
          {summary.error && <div className="p-4"><ErrorBox error={summary.error} compact /></div>}
          {s && (s.top.length === 0 ? <EmptyState icon={Clock} title={t('dash.noData')} /> : (
            <ol className="divide-y divide-slate-800/60">
              {s.top.map((x, i) => {
                const pct = s.top[0].onlineSec ? Math.round((x.onlineSec / s.top[0].onlineSec) * 100) : 0;
                return (
                  <li key={x.uid} className="px-5 py-2.5 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="w-5 text-right text-xs tabular-nums text-slate-500">{i + 1}.</span>
                      <Link to={profileLink(x.uid)} className="min-w-0 flex-1 truncate font-medium text-slate-100 hover:underline">{x.nickname}{x.country && <span className="ml-1.5 text-xs">{countryFlag(x.country)}</span>}</Link>
                      {x.online && <span className="h-2 w-2 rounded-full bg-emerald-400" title="online" />}
                      <span className="whitespace-nowrap text-xs text-slate-400">{formatDuration(x.onlineSec)}</span>
                    </div>
                    <div className="ml-8 mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} /></div>
                  </li>
                );
              })}
            </ol>
          ))}
          {s && <p className="border-t border-slate-800 px-5 py-2 text-[11px] text-slate-500">{t('history.retention', { days: s.retentionDays })}</p>}
        </Card>
      </div>
    </div>
  );
}
