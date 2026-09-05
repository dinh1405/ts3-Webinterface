import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ClipboardList, Search } from 'lucide-react';
import { api } from '../api/client';
import type { AuditEntry } from '../api/types';
import { formatDate } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, EmptyState, ErrorBox, FullPageSpinner, PageHeader } from '../components/ui';

const LIMIT = 50;

export default function AuditPage() {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [ok, setOk] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
  if (q) params.set('q', q);
  if (action) params.set('action', action);
  if (ok) params.set('ok', ok);
  const data = useQuery({ queryKey: ['audit', params.toString()], queryFn: () => api.get<{ total: number; entries: AuditEntry[]; actions: string[] }>(`/api/audit?${params}`), refetchInterval: 15000 });

  const groups = [...new Set((data.data?.actions ?? []).map((a) => a.split('.')[0]))];

  return (
    <div>
      <PageHeader title={t('audit.title')} description={t('audit.description')} />
      <Card noPadding>
        <div className="flex flex-wrap gap-2 border-b border-slate-800 p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input className="input pl-9" placeholder={t('audit.searchPlaceholder')} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
          </div>
          <select className="input w-auto" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }}>
            <option value="">{t('audit.allActions')}</option>
            {groups.map((g) => <optgroup key={g} label={g}>{(data.data?.actions ?? []).filter((a) => a.startsWith(`${g}.`)).map((a) => <option key={a} value={a}>{a}</option>)}</optgroup>)}
          </select>
          <select className="input w-auto" value={ok} onChange={(e) => { setOk(e.target.value); setOffset(0); }}>
            <option value="">{t('audit.okAll')}</option>
            <option value="true">{t('audit.okOnly')}</option>
            <option value="false">{t('audit.failOnly')}</option>
          </select>
        </div>
        {data.isLoading && <FullPageSpinner />}
        {data.error && <div className="p-4"><ErrorBox error={data.error} onRetry={() => data.refetch()} /></div>}
        {data.data && (data.data.entries.length === 0 ? <EmptyState icon={ClipboardList} title={t('audit.none')} /> : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>{t('audit.th.time')}</th><th>{t('common.user')}</th><th>{t('audit.th.action')}</th><th>{t('common.status')}</th><th>IP</th><th>{t('common.details')}</th></tr></thead>
                <tbody>
                  {data.data.entries.map((e) => {
                    const summary = Object.entries(e.details).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
                    return (
                      <tr key={e.id} className="cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)}>
                        <td className="whitespace-nowrap text-xs text-slate-400">{formatDate(e.ts, true)}</td>
                        <td className="font-medium text-slate-100">{e.username}</td>
                        <td><Badge tone={e.action.startsWith('auth') ? 'blue' : e.action.startsWith('server') ? 'amber' : e.action.includes('ban') || e.action.includes('kick') ? 'red' : e.action.startsWith('backup') || e.action.startsWith('snapshot') ? 'green' : e.action.startsWith('user') ? 'purple' : 'indigo'}>{e.action}</Badge></td>
                        <td><Badge tone={e.ok ? 'green' : 'red'} dot>{e.ok ? t('common.ok') : t('common.error')}</Badge></td>
                        <td className="font-mono text-xs text-slate-400">{e.ip || '–'}</td>
                        <td className="max-w-md">
                          {open === e.id ? <pre className="whitespace-pre-wrap break-all rounded bg-slate-950/70 p-2 font-mono text-[11px] text-slate-300">{JSON.stringify(e.details, null, 2)}</pre> : <span className="block truncate text-xs text-slate-400" title={summary}>{summary || '–'}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
              <span>{t('common.rangeOf', { from: offset + 1, to: Math.min(offset + LIMIT, data.data.total), total: data.data.total })}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>{t('common.back')}</Button>
                <Button size="sm" variant="ghost" icon={ChevronRight} disabled={offset + LIMIT >= data.data.total} onClick={() => setOffset(offset + LIMIT)}>{t('common.next')}</Button>
              </div>
            </div>
          </>
        ))}
      </Card>
    </div>
  );
}
