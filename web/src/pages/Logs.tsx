import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Download, FileText, Pause, Play, RefreshCw, ScrollText, Search, Terminal } from 'lucide-react';
import { api } from '../api/client';
import type { LogFile, LogLine } from '../api/types';
import { formatBytes, formatDate } from '../lib/format';
import { useT } from '../i18n';
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Spinner, Toggle } from '../components/ui';

type Tab = 'query' | 'files';
const LEVELS = ['', 'ERROR', 'WARNING', 'INFO', 'DEBUG', 'DEVELOP'];

export default function LogsPage() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('query');
  return (
    <div>
      <PageHeader title={t('logs.title')} description={t('logs.description')} />
      <div className="mb-4 flex w-fit gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
        {([['query', t('logs.tab.query'), Terminal], ['files', t('logs.tab.files'), FileText]] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)} className={clsx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition', tab === key ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-100')}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>
      {tab === 'query' ? <QueryLog /> : <FileLogs />}
    </div>
  );
}

function levelTone(level: string): 'red' | 'amber' | 'blue' | 'slate' | 'green' {
  switch (level.toUpperCase()) {
    case 'ERROR': case 'CRITICAL': return 'red';
    case 'WARNING': return 'amber';
    case 'INFO': return 'blue';
    case 'DEBUG': case 'DEVELOP': return 'slate';
    default: return 'slate';
  }
}

function LogView({ lines, loading, emptyText }: { lines: LogLine[]; loading?: boolean; emptyText?: string }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  if (!lines.length && !loading) return <EmptyState icon={ScrollText} title={emptyText || t('logs.noLines')} />;
  return (
    <div ref={ref} className="max-h-[65vh] overflow-auto bg-slate-950/70 font-mono text-[12px] leading-5">
      {lines.map((l, i) => (
        <div key={i} className="log-line flex gap-3 border-b border-slate-800/40 px-4 py-0.5 hover:bg-slate-800/40">
          <span className="w-44 shrink-0 text-slate-500">{l.ts ? l.ts.slice(0, 19) : ''}</span>
          <span className="w-16 shrink-0"><Badge tone={levelTone(l.level)} className="px-1.5 py-0 text-[10px]">{l.level || '·'}</Badge></span>
          <span className="w-28 shrink-0 truncate text-indigo-300/80" title={l.channel}>{l.channel}</span>
          <span className={clsx('whitespace-pre-wrap break-all', l.level === 'ERROR' ? 'text-rose-200' : l.level === 'WARNING' ? 'text-amber-100' : 'text-slate-200')}>{l.msg}</span>
        </div>
      ))}
      {loading && <div className="flex items-center gap-2 px-4 py-2 text-slate-500"><Spinner /> {t('logs.loading')}</div>}
    </div>
  );
}

function QueryLog() {
  const { t } = useT();
  const [instance, setInstance] = useState<0 | 1>(0);
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const [auto, setAuto] = useState(true);
  const [older, setOlder] = useState<LogLine[]>([]);
  const [lastPos, setLastPos] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const latest = useQuery({
    queryKey: ['logs', 'query', instance],
    queryFn: () => api.get<{ lines: LogLine[]; lastPos: number; fileSize: number }>(`/api/logs/query?lines=100&reverse=1&instance=${instance}`),
    refetchInterval: auto ? 5000 : false,
  });

  useEffect(() => { setOlder([]); setLastPos(null); }, [instance]);

  const all = useMemo(() => {
    const merged = [...older, ...(latest.data?.lines ?? [])];
    const seen = new Set<string>();
    const dedup = merged.filter((l) => { if (seen.has(l.raw)) return false; seen.add(l.raw); return true; });
    dedup.sort((a, b) => a.ts.localeCompare(b.ts));
    return dedup.filter((l) => (!level || l.level.toUpperCase() === level) && (!q || l.raw.toLowerCase().includes(q.toLowerCase())));
  }, [older, latest.data, level, q]);

  const currentPos = lastPos ?? latest.data?.lastPos ?? 0;
  async function loadOlder() {
    if (!currentPos) return;
    setLoadingOlder(true);
    try {
      const res = await api.get<{ lines: LogLine[]; lastPos: number }>(`/api/logs/query?lines=100&reverse=1&instance=${instance}&beginPos=${currentPos}`);
      setOlder((prev) => [...res.lines, ...prev]);
      setLastPos(res.lastPos);
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <Card noPadding
      title={<span className="flex items-center gap-2">{instance ? t('logs.instanceLog') : t('logs.serverLog')} {latest.isFetching && <Spinner className="h-3 w-3 text-slate-500" />}</span>}
      subtitle={latest.data ? t('logs.sizeLines', { size: formatBytes(latest.data.fileSize), count: all.length }) : undefined}
      actions={<>
        <select className="input w-auto" value={instance} onChange={(e) => setInstance(Number(e.target.value) as 0 | 1)}>
          <option value={0}>{t('logs.virtualServer')}</option>
          <option value={1}>{t('logs.instance')}</option>
        </select>
        <select className="input w-auto" value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVELS.map((l) => <option key={l} value={l}>{l || t('logs.allLevels')}</option>)}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input className="input w-48 pl-9" placeholder={t('logs.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button variant="ghost" icon={auto ? Pause : Play} onClick={() => setAuto(!auto)}>{auto ? t('logs.live') : t('logs.paused')}</Button>
        <Button variant="ghost" icon={RefreshCw} onClick={() => latest.refetch()} />
      </>}
    >
      {latest.error ? <div className="p-4"><ErrorBox error={latest.error} onRetry={() => latest.refetch()} /></div> : (
        <>
          <div className="border-b border-slate-800 px-4 py-2">
            <Button size="sm" variant="ghost" onClick={loadOlder} loading={loadingOlder} disabled={!currentPos}>{currentPos ? t('logs.loadOlder') : t('logs.startReached')}</Button>
          </div>
          <LogView lines={all} loading={latest.isLoading} />
        </>
      )}
    </Card>
  );
}

function FileLogs() {
  const { t } = useT();
  const files = useQuery({ queryKey: ['logs', 'files'], queryFn: () => api.get<{ dir: string; files: LogFile[] }>('/api/logs/files') });
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState(500);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('');
  const [auto, setAuto] = useState(false);
  const name = selected ?? files.data?.files[0]?.name ?? null;

  const content = useQuery({
    queryKey: ['logs', 'file', name, lines, q, level],
    queryFn: () => api.get<{ lines: LogLine[]; size: number; mtime: string; truncated: boolean; totalMatching: number }>(`/api/logs/files/${encodeURIComponent(name!)}?lines=${lines}&q=${encodeURIComponent(q)}&level=${level}`),
    enabled: Boolean(name),
    refetchInterval: auto ? 5000 : false,
  });

  if (files.error) return <ErrorBox error={files.error} onRetry={() => files.refetch()} />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
      <Card title={t('logs.files')} subtitle={files.data?.dir} className="lg:col-span-1" noPadding>
        {files.isLoading ? <div className="p-4"><Spinner /></div> : files.data?.files.length === 0 ? <EmptyState icon={FileText} title={t('logs.noFiles')} /> : (
          <ul className="max-h-[70vh] overflow-y-auto">
            {files.data!.files.map((f) => (
              <li key={f.name}>
                <button onClick={() => setSelected(f.name)} className={clsx('flex w-full flex-col gap-0.5 border-b border-slate-800/60 px-4 py-2.5 text-left hover:bg-slate-800/40', name === f.name && 'bg-indigo-500/10')}>
                  <span className="flex items-center gap-2">
                    <Badge tone={f.kind === 'instance' ? 'indigo' : f.kind === 'server' ? 'blue' : 'slate'}>{f.kind === 'instance' ? t('logs.kind.instance') : f.kind === 'server' ? t('logs.kind.server', { sid: String(f.sid) }) : t('logs.kind.other')}</Badge>
                    <span className="truncate font-mono text-[11px] text-slate-300">{f.name}</span>
                  </span>
                  <span className="text-[11px] text-slate-500">{formatBytes(f.size)} · {formatDate(f.mtime)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="lg:col-span-3" noPadding
        title={<span className="truncate font-mono text-xs">{name || '–'}</span>}
        subtitle={content.data ? `${t('logs.matching', { count: content.data.totalMatching, size: formatBytes(content.data.size) })}${content.data.truncated ? t('logs.truncated') : ''}` : undefined}
        actions={<>
          <select className="input w-auto" value={lines} onChange={(e) => setLines(Number(e.target.value))}>
            {[200, 500, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{t('logs.nLines', { count: n })}</option>)}
          </select>
          <select className="input w-auto" value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => <option key={l} value={l}>{l || t('logs.allLevels')}</option>)}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input className="input w-44 pl-9" placeholder={t('logs.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Toggle checked={auto} onChange={setAuto} label={t('logs.auto')} />
          {name && <a className="btn btn-secondary btn-sm" href={`/api/logs/files/${encodeURIComponent(name)}/download`}><Download className="h-3.5 w-3.5" /> {t('logs.download')}</a>}
        </>}
      >
        {content.error ? <div className="p-4"><ErrorBox error={content.error} onRetry={() => content.refetch()} /></div> : <LogView lines={content.data?.lines ?? []} loading={content.isLoading} emptyText={name ? t('logs.noMatchingLines') : t('logs.noFileSelected')} />}
      </Card>
    </div>
  );
}
