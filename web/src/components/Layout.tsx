import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  Activity, Archive, Ban, BarChart3, ClipboardList, Cpu, Flag, FolderOpen, History, KeyRound, LayoutDashboard, LogOut, Menu, Monitor, Moon, ScrollText, Settings, Shield, Sun, Users, UserCog, Wrench, X, Headphones,
} from 'lucide-react';
import { api } from '../api/client';
import type { MaintenanceStatus, ServerStatus } from '../api/types';
import { useAuth } from '../lib/auth';
import { useEvents } from '../lib/events';
import { useTheme, type ThemePref } from '../lib/theme';
import { useT } from '../i18n';
import { Badge, FullPageSpinner } from './ui';
import { formatTime } from '../lib/format';

function ThemeSwitch() {
  const { pref, setPref } = useTheme();
  const { t } = useT();
  const options: { value: ThemePref; icon: typeof Sun; title: string }[] = [
    { value: 'light', icon: Sun, title: t('theme.light') },
    { value: 'dark', icon: Moon, title: t('theme.dark') },
    { value: 'system', icon: Monitor, title: t('theme.system') },
  ];
  return (
    <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-0.5" role="radiogroup" aria-label={t('theme.label')}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={pref === o.value} title={o.title} onClick={() => setPref(o.value)}
          className={clsx('flex flex-1 items-center justify-center rounded-md py-1 transition', pref === o.value ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300')}>
          <o.icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

export function Layout() {
  const { user, logout, can } = useAuth();
  const { t, td, locale } = useT();
  const { queryStatus, streamConnected } = useEvents();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const status = useQuery({
    queryKey: ['status'],
    queryFn: () => api.get<ServerStatus>('/api/server/status'),
    refetchInterval: 10000,
  });

  const maintenance = useQuery({
    queryKey: ['maintenance'],
    queryFn: () => api.get<MaintenanceStatus>('/api/system/maintenance'),
    refetchInterval: (query) => (query.state.data?.active ? 5000 : 15000),
  });
  const mt = maintenance.data?.active ?? null;

  useEffect(() => { setOpen(false); }, [location.pathname]);

  type NavItem = { to: string; label: string; icon: typeof Users; cap?: string; end?: boolean };
  const allGroups: { key: 'overview' | 'clients' | 'server' | 'admin'; items: NavItem[] }[] = [
    { key: 'overview', items: [
      { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard, end: true },
      { to: '/stats', label: t('nav.stats'), icon: BarChart3 },
    ] },
    { key: 'clients', items: [
      { to: '/clients', label: t('nav.clients'), icon: Users },
      { to: '/history', label: t('nav.history'), icon: History, cap: 'history.view' },
      { to: '/groups', label: t('nav.groups'), icon: Shield },
      { to: '/bans', label: t('nav.bans'), icon: Ban },
      { to: '/complaints', label: t('nav.complaints'), icon: Flag },
    ] },
    { key: 'server', items: [
      { to: '/files', label: t('nav.files'), icon: FolderOpen, cap: 'files.view' },
      { to: '/logs', label: t('nav.logs'), icon: ScrollText, cap: 'logs.view' },
      { to: '/settings', label: t('nav.settings'), icon: Settings, cap: 'settings.view' },
      { to: '/backups', label: t('nav.backups'), icon: Archive, cap: 'backups.view' },
      { to: '/system', label: t('nav.system'), icon: Cpu, cap: 'system.view' },
    ] },
    { key: 'admin', items: [
      { to: '/users', label: t('nav.users'), icon: UserCog, cap: 'users.manage' },
      { to: '/audit', label: t('nav.audit'), icon: ClipboardList, cap: 'audit.view' },
      { to: '/account', label: t('nav.account'), icon: KeyRound },
    ] },
  ];
  const navGroups = allGroups.map((g) => ({ ...g, items: g.items.filter((item) => !item.cap || can(item.cap)) })).filter((g) => g.items.length > 0);

  const s = status.data;
  const procRunning = s?.process.running;
  const queryConnected = queryStatus?.connected ?? s?.query.connected ?? false;
  const online = s?.current?.virtualserverClientsonline;

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-slate-800 bg-slate-900">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500 text-white"><Headphones className="h-5 w-5" /></div>
        <div>
          <p className="text-sm font-semibold text-slate-50">{t('layout.appName')}</p>
          <p className="text-[11px] text-slate-500">{s?.current?.virtualserverName ? String(s.current.virtualserverName) : t('layout.defaultServer')}</p>
        </div>
        <button className="btn btn-ghost btn-icon ml-auto lg:hidden" onClick={() => setOpen(false)} aria-label={t('layout.closeMenu')}><X className="h-4 w-4" /></button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3">
        {navGroups.map((g, gi) => (
          <div key={g.key} className={clsx('space-y-0.5', gi > 0 && 'mt-2')}>
            <p className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t(`navGroup.${g.key}`)}</p>
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-1 text-sm font-medium transition', isActive ? 'bg-indigo-500/12 text-indigo-300' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100')}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-800 p-3">
        <div className="mb-3"><ThemeSwitch /></div>
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">{t('layout.process')}</span>
            <Badge tone={procRunning ? 'green' : procRunning === false ? 'red' : 'slate'} dot pulse={procRunning === true}>{procRunning ? t('layout.running') : procRunning === false ? t('layout.stopped') : t('common.unknown')}</Badge>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-slate-400">{t('layout.query')}</span>
            <Badge tone={queryConnected ? 'green' : 'amber'} dot>{queryConnected ? t('layout.connected') : t('layout.disconnected')}</Badge>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-slate-400">{t('layout.stream')}</span>
            <Badge tone={streamConnected ? 'blue' : 'slate'} dot>{streamConnected ? t('layout.streamOn') : t('layout.streamOff')}</Badge>
          </div>
          {online !== undefined && (
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-slate-400">{t('layout.online')}</span>
              <span className="font-medium text-slate-200">{String(online)} / {String(s?.current?.virtualserverMaxclients ?? '–')}</span>
            </div>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 px-1">
          <button className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-slate-800/70" title={t('layout.accountHint')} onClick={() => navigate('/account')}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold uppercase text-slate-200">{(user?.displayName || user?.username || '?').slice(0, 2)}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-100">{user?.displayName || user?.username}</p>
              <p className="truncate text-[11px] text-slate-500">{td(`role.${user?.role}`, undefined, user?.role)} · {t('nav.account')}</p>
            </div>
          </button>
          <button className="btn btn-ghost btn-icon" title={t('layout.logout')} onClick={() => logout().then(() => navigate('/login'))}><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full">
      <div className="hidden lg:block">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative z-10 h-full">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3 lg:hidden">
          <button className="btn btn-ghost btn-icon" onClick={() => setOpen(true)} aria-label={t('layout.openMenu')}><Menu className="h-5 w-5" /></button>
          <span className="text-sm font-semibold">{t('layout.appName')}</span>
          <span className="ml-auto flex items-center gap-2 text-xs text-slate-400"><Activity className={clsx('h-3.5 w-3.5', queryConnected ? 'text-emerald-400' : 'text-amber-400')} />{queryConnected ? t('layout.connected') : t('layout.disconnected')}</span>
        </header>
        {mt && (
          <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200 sm:px-6 lg:px-8" role="status">
            <Wrench className="h-3.5 w-3.5 shrink-0" />
            <span>{t('maintenance.banner', { kind: td(`maintenance.kind.${mt.kind}`, undefined, mt.kind), by: mt.by, since: formatTime(mt.startedAt, false) })}</span>
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {/* Seiteninhalt bei Sprachwechsel neu aufbauen, damit auch memoisierte Formatierungen aktualisiert werden */}
            <Suspense fallback={<FullPageSpinner />}>
              <Outlet key={locale} />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
