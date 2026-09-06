import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, ArrowDownToLine, ArrowUpFromLine, BarChart3, Clock, Users, Wifi } from 'lucide-react';
import { api } from '../api/client';
import type { StatsPoint, StatsResponse } from '../api/types';
import { formatBytes, formatDate, formatDayMonth, formatTime, weekdayNames } from '../lib/format';
import { useT } from '../i18n';
import { Card, EmptyState, ErrorBox, FullPageSpinner, PageHeader, Stat } from '../components/ui';

// Farben validiert (dunkle Fläche #0f172a): #6366f1 Clients · #059669 gesendet · #d97706 empfangen
const C_CLIENTS = '#6366f1';
const C_UP = '#059669';
const C_DOWN = '#d97706';
const C_PING = '#db2777';
const RANGES = ['6h', '24h', '7d', '30d'] as const;
const HEAT_DAYS = [7, 30, 90] as const;

export default function StatsPage() {
  const { t } = useT();
  const [range, setRange] = useState<'6h' | '24h' | '7d' | '30d'>('24h');
  const [heatDays, setHeatDays] = useState<(typeof HEAT_DAYS)[number]>(30);
  const q = useQuery({ queryKey: ['stats', range, heatDays], queryFn: () => api.get<StatsResponse>(`/api/stats?range=${range}&heatmapDays=${heatDays}`), refetchInterval: 60000 });

  const tickFmt = useMemo(() => {
    const short = range === '6h' || range === '24h';
    return (v: number) => (short ? formatTime(v, false) : formatDayMonth(v));
  }, [range]);

  if (q.isLoading) return <FullPageSpinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const s = d.summary;
  const hasData = d.points.some((p) => p.clients !== null);

  return (
    <div>
      <PageHeader title={t('stats.title')} description={t('stats.description', { tz: d.timezone, samples: s.samples })}
        actions={<div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-1">
          {RANGES.map((key) => <button key={key} onClick={() => setRange(key)} className={clsx('rounded-md px-3 py-1.5 text-sm font-medium transition', range === key ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-100')}>{t(`stats.range.${key}`)}</button>)}
        </div>} />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat label={t('stats.clientsNow')} value={s.currentClients ?? '–'} sub={s.avgClients !== null ? t('stats.avgInRange', { avg: s.avgClients }) : undefined} icon={Users} tone="indigo" />
        <Stat label={t('stats.peak')} value={s.peakClients ? s.peakClients.value : '–'} sub={s.peakClients ? formatDate(s.peakClients.t) : undefined} icon={BarChart3} tone="purple" />
        <Stat label={t('stats.availability')} value={s.uptimePct !== null ? `${s.uptimePct} %` : '–'} sub={s.queryUptimePct !== null ? t('stats.queryAvailability', { pct: s.queryUptimePct }) : undefined} icon={Clock} tone={s.uptimePct !== null && s.uptimePct < 99 ? 'amber' : 'green'} />
        <Stat label={t('stats.traffic')} value={s.trafficTx !== null ? formatBytes(s.trafficTx, 1) : '–'} sub={s.trafficRx !== null ? t('stats.trafficSub', { rx: formatBytes(s.trafficRx, 1), ping: s.avgPing ?? '–' }) : undefined} icon={Wifi} tone="blue" />
      </div>

      {!hasData ? (
        <Card className="mt-4"><EmptyState icon={Activity} title={t('stats.noData')} description={t('stats.noDataHint')} /></Card>
      ) : (
        <>
          <Card title={t('stats.clientsOnline')} subtitle={t('stats.clientsOnlineSub')} className="mt-4">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={d.points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs><linearGradient id="gClients" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C_CLIENTS} stopOpacity={0.35} /><stop offset="100%" stopColor={C_CLIENTS} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="var(--color-slate-800)" vertical={false} />
                <XAxis dataKey="t" tickFormatter={tickFmt} stroke="var(--color-slate-700)" tick={{ fill: 'var(--color-slate-400)', fontSize: 11 }} minTickGap={40} />
                <YAxis allowDecimals={false} stroke="var(--color-slate-700)" tick={{ fill: 'var(--color-slate-400)', fontSize: 11 }} width={40} />
                <Tooltip content={<ChartTip fmt={(p) => [[t('stats.clients'), p.clients !== null ? String(p.clients) : '–'], [t('stats.maximum'), p.clientsMax !== null ? String(p.clientsMax) : '–'], [t('stats.channels'), p.channels !== null ? String(p.channels) : '–']]} />} cursor={{ stroke: 'var(--color-slate-600)' }} />
                <Area type="monotone" dataKey="clients" stroke={C_CLIENTS} strokeWidth={2} fill="url(#gClients)" dot={false} connectNulls={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title={t('stats.bandwidth')} subtitle={t('stats.bandwidthSub')} actions={<Legend items={[[C_UP, t('stats.sent')], [C_DOWN, t('stats.received')]]} />}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={d.points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-slate-800)" vertical={false} />
                  <XAxis dataKey="t" tickFormatter={tickFmt} stroke="var(--color-slate-700)" tick={{ fill: 'var(--color-slate-400)', fontSize: 11 }} minTickGap={40} />
                  <YAxis tickFormatter={(v) => formatBytes(v, 0)} stroke="var(--color-slate-700)" tick={{ fill: 'var(--color-slate-400)', fontSize: 11 }} width={64} />
                  <Tooltip content={<ChartTip fmt={(p) => [[t('stats.sent'), p.up !== null ? `${formatBytes(p.up)}/s` : '–'], [t('stats.received'), p.down !== null ? `${formatBytes(p.down)}/s` : '–']]} />} cursor={{ stroke: 'var(--color-slate-600)' }} />
                  <Line type="monotone" dataKey="up" name={t('stats.sent')} stroke={C_UP} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="down" name={t('stats.received')} stroke={C_DOWN} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
            <Card title={t('stats.ping')} subtitle={t('stats.pingSub')}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={d.points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-slate-800)" vertical={false} />
                  <XAxis dataKey="t" tickFormatter={tickFmt} stroke="var(--color-slate-700)" tick={{ fill: 'var(--color-slate-400)', fontSize: 11 }} minTickGap={40} />
                  <YAxis stroke="var(--color-slate-700)" tick={{ fill: 'var(--color-slate-400)', fontSize: 11 }} width={40} />
                  <Tooltip content={<ChartTip fmt={(p) => [[t('stats.ping'), p.ping !== null ? `${p.ping} ms` : '–'], [t('stats.loss'), p.loss !== null ? `${p.loss} %` : '–']]} />} cursor={{ stroke: 'var(--color-slate-600)' }} />
                  <Line type="monotone" dataKey="ping" stroke={C_PING} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card title={t('stats.peakTimes')} subtitle={`${t('stats.peakTimesSub')} · ${t('stats.heatmapWindow', { days: d.heatmapWindowDays })}`} className="mt-4"
            actions={<div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/60 p-0.5">
              {HEAT_DAYS.map((n) => <button key={n} onClick={() => setHeatDays(n)} className={clsx('rounded-md px-2 py-1 text-xs font-medium transition', heatDays === n ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-100')}>{t('stats.days', { count: n })}</button>)}
            </div>}>
            <Heatmap data={d.heatmap} />
          </Card>

          <Card title={t('stats.availability')} subtitle={t('stats.availabilitySub')} className="mt-4">
            <div className="flex h-8 w-full overflow-hidden rounded-md">
              {d.points.map((p) => (
                <div key={p.t} className="flex-1" title={t('stats.availabilityTip', { time: formatDate(p.t), pct: p.running, clients: p.clients ?? '–' })} style={{ backgroundColor: p.running >= 100 ? '#059669' : p.running > 0 ? '#d97706' : '#dc2626', marginRight: 1 }} />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-slate-500"><span>{d.points[0] ? formatDate(d.points[0].t) : ''}</span><span>{d.points.length ? formatDate(d.points[d.points.length - 1].t) : ''}</span></div>
          </Card>

          <div className="mt-4 flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1"><ArrowUpFromLine className="h-3 w-3" /> {t('stats.sentLegend')}</span>
            <span className="flex items-center gap-1"><ArrowDownToLine className="h-3 w-3" /> {t('stats.receivedLegend')}</span>
          </div>
        </>
      )}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return <div className="flex items-center gap-3 text-xs text-slate-400">{items.map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c }} />{l}</span>)}</div>;
}

function ChartTip({ active, payload, fmt }: { active?: boolean; payload?: { payload: StatsPoint }[]; fmt: (p: StatsPoint) => [string, string][] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-slate-400">{formatDate(p.t)}</p>
      {fmt(p).map(([k, v]) => <p key={k} className="flex justify-between gap-4"><span className="text-slate-400">{k}</span><span className="font-medium text-slate-100">{v}</span></p>)}
    </div>
  );
}

function Heatmap({ data }: { data: (number | null)[][] }) {
  const { t } = useT();
  const weekdayShort = (() => { const n = weekdayNames('short'); return [...n.slice(1), n[0]]; })();
  const max = Math.max(1, ...data.flat().map((v) => v ?? 0));
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="mb-1 ml-8 grid grid-cols-24 text-[10px] text-slate-500">{Array.from({ length: 24 }, (_, h) => <span key={h} className={clsx('text-center', h % 3 !== 0 && 'invisible')}>{h}</span>)}</div>
        {data.map((row, wd) => (
          <div key={wd} className="mb-1 flex items-center gap-1">
            <span className="w-7 text-xs text-slate-400">{weekdayShort[wd]}</span>
            <div className="grid flex-1 grid-cols-24 gap-[2px]">
              {row.map((v, h) => (
                <div key={h} className="h-5 rounded-sm" title={t('stats.heatTip', { day: weekdayShort[wd], hour: h, value: v ?? '–' })} style={{ backgroundColor: v === null ? 'var(--color-slate-800)' : `rgba(99, 102, 241, ${0.12 + 0.88 * (v / max)})` }} />
              ))}
            </div>
          </div>
        ))}
        <div className="ml-8 mt-2 flex items-center gap-2 text-[11px] text-slate-500"><span>{t('stats.few')}</span><span className="h-2 w-24 rounded-sm" style={{ background: 'linear-gradient(90deg, rgba(99,102,241,0.12), rgba(99,102,241,1))' }} /><span>{t('stats.many', { max })}</span></div>
      </div>
    </div>
  );
}
