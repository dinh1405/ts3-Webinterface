import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Headphones, KeyRound, LogOut, Menu as MenuIcon, Monitor, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search, Sun, Wrench, X } from 'lucide-react';
import { api } from '../api/client';
import type { MaintenanceStatus, Overview, ServerStatus } from '../api/types';
import { useAuth } from '../lib/auth';
import { useEvents } from '../lib/events';
import { useNavGroups } from '../lib/nav';
import { useTheme, type ThemePref } from '../lib/theme';
import { UnsavedGuard } from '../lib/unsaved';
import { useT } from '../i18n';
import { Alert, Menu, PageSkeleton, Tip } from './ui';
import { formatTime } from '../lib/format';
import { CommandPalette } from './CommandPalette';
import { modKey, ShortcutsDialog } from './ShortcutsDialog';
import { StatusChips } from './StatusChips';

const SIDEBAR_KEY = 'ts3wi-sidebar';
function readCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'; } catch { return false; }
}

function ThemeMenu() {
  const { pref, mode, setPref } = useTheme();
  const { t } = useT();
  const Icon = pref === 'system' ? Monitor : mode === 'dark' ? Moon : Sun;
  return (
    <Menu
      label={t('theme.label')}
      trigger={<button type="button" className="btn btn-ghost btn-icon" title={t('theme.label')} aria-label={t('theme.toggle')}><Icon className="h-4 w-4" /></button>}
      items={[{ type: 'radio', label: t('theme.label'), value: pref, onChange: (v) => setPref(v as ThemePref), options: [
        { value: 'light', label: t('theme.light'), icon: Sun },
        { value: 'dark', label: t('theme.dark'), icon: Moon },
        { value: 'system', label: t('theme.system'), icon: Monitor },
      ] }]}
    />
  );
}

/** Globale Tastenkürzel: Strg/⌘+K Befehlspalette, „?“ Übersicht, „g“ + Buchstabe Navigation. */
function useGlobalShortcuts({ onPalette, onHelp, goto }: { onPalette: () => void; onHelp: () => void; goto: (key: string) => boolean }) {
  const pending = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = Boolean(target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)));
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); onPalette(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === '?') { e.preventDefault(); onHelp(); return; }
      if (pending.current !== null) {
        window.clearTimeout(pending.current); pending.current = null;
        if (goto(e.key.toLowerCase())) e.preventDefault();
        return;
      }
      if (e.key === 'g') pending.current = window.setTimeout(() => { pending.current = null; }, 1200);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (pending.current) window.clearTimeout(pending.current); };
  }, [onPalette, onHelp, goto]);
}

export function Layout() {
  const { user, logout, can } = useAuth();
  const { t, td, locale } = useT();
  const { queryStatus } = useEvents();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const navGroups = useNavGroups();

  const status = useQuery({ queryKey: ['status'], queryFn: () => api.get<ServerStatus>('/api/server/status'), refetchInterval: 10000 });
  const unread = useQuery({ queryKey: ['messages', 'unread'], queryFn: () => api.get<{ count: number }>('/api/messages/unread-count'), enabled: can('messages.view'), refetchInterval: 60000, retry: false });
  const maintenance = useQuery({ queryKey: ['maintenance'], queryFn: () => api.get<MaintenanceStatus>('/api/system/maintenance'), refetchInterval: (query) => (query.state.data?.active ? 5000 : 15000) });
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/overview'), refetchInterval: 60000 });
  const mt = maintenance.data?.active ?? null;

  useEffect(() => { setOpen(false); }, [location.pathname]);
  const toggleCollapsed = () => setCollapsed((c) => { const next = !c; try { localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'open'); } catch { /* privat */ } return next; });

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const openHelp = useCallback(() => setHelpOpen(true), []);
  const goto = useCallback((key: string) => {
    const item = navGroups.flatMap((g) => g.items).find((i) => i.key === key);
    if (!item) return false;
    navigate(item.to);
    return true;
  }, [navGroups, navigate]);
  useGlobalShortcuts({ onPalette: openPalette, onHelp: openHelp, goto });

  const s = status.data;
  const queryConnected = queryStatus?.connected ?? s?.query.connected ?? false;
  const badgeFor = (to: string) => (to === '/messages' ? unread.data?.count || 0 : 0);
  const serverName = s?.current?.virtualserverName ? String(s.current.virtualserverName) : t('layout.defaultServer');

  const sidebar = (mini: boolean) => (
    <aside className={clsx('flex h-full flex-col border-r border-slate-800/80 bg-slate-900/60 backdrop-blur-md transition-[width] duration-200', mini ? 'w-16' : 'w-[232px]')}>
      <div className={clsx('flex items-center gap-3 py-5', mini ? 'justify-center px-0' : 'px-5')}>
        <Tip content={mini ? t('layout.appName') : undefined} side="right">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-glow" style={{ backgroundImage: 'var(--accent-gradient)' }}><Headphones className="h-5 w-5" aria-hidden /></div>
        </Tip>
        {!mini && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-50">{t('layout.appName')}</p>
            <p className="truncate text-2xs text-slate-500">{serverName}</p>
          </div>
        )}
        {!mini && <button className="btn btn-ghost btn-icon btn-sm ml-auto lg:hidden" onClick={() => setOpen(false)} aria-label={t('layout.closeMenu')}><X className="h-4 w-4" /></button>}
      </div>
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3" aria-label={t('layout.mainNav')}>
        {navGroups.map((g, gi) => (
          <div key={g.key} className={clsx('space-y-0.5', gi > 0 && (mini ? 'mt-2 border-t border-slate-800/80 pt-2' : 'mt-3'))}>
            {!mini && <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">{g.label}</p>}
            {g.items.map((item) => {
              const badge = badgeFor(item.to);
              const link = (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => clsx('nav-item', mini && 'justify-center px-0', isActive && 'active')} aria-label={mini ? item.label : undefined}>
                  <span className="relative shrink-0">
                    <item.icon className="h-4 w-4" aria-hidden />
                    {mini && badge ? <span className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-indigo-400 ring-2 ring-slate-900" /> : null}
                  </span>
                  {!mini && <span className="flex-1 truncate">{item.label}</span>}
                  {!mini && badge ? <span className="rounded-full px-1.5 text-[10px] font-semibold leading-[18px] text-white" style={{ backgroundImage: 'var(--accent-gradient)' }}>{badge}</span> : null}
                </NavLink>
              );
              return mini ? <Tip key={item.to} content={item.label} side="right"><span className="block">{link}</span></Tip> : link;
            })}
          </div>
        ))}
      </nav>
      <div className={clsx('border-t border-slate-800/80 p-3', mini && 'flex flex-col items-center gap-2')}>
        <Menu
          label={t('layout.userMenu')}
          align={mini ? 'start' : 'end'}
          side={mini ? 'right' : 'top'}
          trigger={(
            <button className={clsx('flex items-center gap-3 rounded-control text-left transition-colors hover:bg-slate-800/70', mini ? 'h-9 w-9 justify-center' : 'w-full px-2 py-1.5')} title={mini ? (user?.displayName || user?.username) : undefined}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-slate-800 text-xs font-semibold uppercase text-slate-100">{(user?.displayName || user?.username || '?').slice(0, 2)}</div>
              {!mini && (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-100">{user?.displayName || user?.username}</p>
                    <p className="truncate text-2xs text-slate-500">{td(`role.${user?.role}`, undefined, user?.role)}</p>
                  </div>
                  <MoreHorizontal className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                </>
              )}
            </button>
          )}
          items={[
            { type: 'label', label: user?.username ?? '' },
            { label: t('nav.account'), icon: KeyRound, onSelect: () => navigate('/account') },
            { type: 'separator' },
            { label: t('layout.logout'), icon: LogOut, onSelect: () => { void logout().then(() => navigate('/login')); }, danger: true },
          ]}
        />
        <div className={clsx('hidden lg:flex', mini ? 'justify-center' : 'mt-1 justify-end')}>
          <Tip content={mini ? t('layout.expand') : t('layout.collapse')} side={mini ? 'right' : 'top'}>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={toggleCollapsed} aria-label={mini ? t('layout.expand') : t('layout.collapse')} aria-expanded={!mini}>
              {mini ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </Tip>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full">
      <div className="hidden lg:block">{sidebar(collapsed)}</div>
      {open && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative z-10 h-full">{sidebar(false)}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-800/80 px-4 sm:px-6 lg:px-7">
          <button className="btn btn-ghost btn-icon lg:hidden" onClick={() => setOpen(true)} aria-label={t('layout.openMenu')}><MenuIcon className="h-5 w-5" /></button>
          <button type="button" onClick={openPalette} className="flex h-9 items-center gap-2.5 rounded-control border border-slate-400/15 bg-slate-900/70 px-3 text-sm text-slate-500 transition-colors hover:border-slate-700 hover:text-slate-300 sm:w-[300px] xl:w-[340px]" aria-label={t('palette.title')} aria-keyshortcuts="Control+K">
            <Search className="h-4 w-4" aria-hidden />
            <span className="hidden flex-1 truncate text-left sm:inline">{t('layout.searchHint')}</span>
            <span className="ml-auto hidden items-center gap-1 sm:flex"><kbd className="kbd">{modKey(locale)}</kbd><kbd className="kbd">K</kbd></span>
          </button>
          <div className="flex-1" />
          <div className="hidden xl:block"><StatusChips status={s} queryConnected={queryConnected} overview={overview.data} canBackups={can('backups.view')} canSystem={can('system.view')} /></div>
          <div className="xl:hidden"><StatusChips status={s} queryConnected={queryConnected} overview={overview.data} canBackups={can('backups.view')} canSystem={can('system.view')} compact /></div>
          <ThemeMenu />
        </header>
        {mt && (
          <Alert tone="warning" compact icon={Wrench} className="rounded-none border-x-0 border-t-0 px-4 sm:px-6 lg:px-8">
            {t('maintenance.banner', { kind: td(`maintenance.kind.${mt.kind}`, undefined, mt.kind), by: mt.by, since: formatTime(mt.startedAt, false) })}
          </Alert>
        )}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-7">
            {/* Seiteninhalt bei Sprachwechsel neu aufbauen, damit auch memoisierte Formatierungen aktualisiert werden */}
            <Suspense fallback={<PageSkeleton />}>
              <Outlet key={locale} />
            </Suspense>
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onShowShortcuts={openHelp} />
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <UnsavedGuard />
    </div>
  );
}
