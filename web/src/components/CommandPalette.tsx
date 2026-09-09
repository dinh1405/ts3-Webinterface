import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Archive, Hash, Keyboard, Languages, LogOut, Monitor, Moon, Play, RotateCw, Square, Sun, User, UserPlus } from 'lucide-react';
import { api } from '../api/client';
import type { Channel, Client } from '../api/types';
import { useAuth } from '../lib/auth';
import { useEvents } from '../lib/events';
import { useNavGroups } from '../lib/nav';
import { useTheme } from '../lib/theme';
import { countryFlag } from '../lib/format';
import { LOCALES, LOCALE_NAMES, useT } from '../i18n';
import { Modal } from './ui';
import { modKey } from './ShortcutsDialog';

/**
 * Befehlspalette (Strg+K): Seiten, Aktionen, Clients online und Kanäle.
 * Clients/Kanäle werden erst beim Öffnen geladen (gleicher Query-Key wie Dashboard und Kanalbaum).
 */
export function CommandPalette({ open, onOpenChange, onShowShortcuts }: { open: boolean; onOpenChange: (o: boolean) => void; onShowShortcuts: () => void }) {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { can, logout, setLanguage, user } = useAuth();
  const { queryStatus } = useEvents();
  const { setPref } = useTheme();
  const groups = useNavGroups();
  const [search, setSearch] = useState('');
  useEffect(() => { if (!open) setSearch(''); }, [open]);

  const connected = queryStatus?.connected ?? false;
  const tree = useQuery({ queryKey: ['clients', 'tree'], queryFn: () => api.get<{ tree: Channel[]; clients: Client[] }>('/api/clients/tree'), enabled: open && connected, staleTime: 15000 });
  const channels = useMemo(() => {
    const out: { cid: string; name: string; depth: number }[] = [];
    const walk = (list: Channel[], depth: number) => { for (const c of list) { out.push({ cid: c.cid, name: c.name, depth }); walk(c.children, depth + 1); } };
    walk(tree.data?.tree ?? [], 0);
    return out;
  }, [tree.data]);
  const clients = useMemo(() => [...(tree.data?.clients ?? [])].sort((a, b) => a.nickname.localeCompare(b.nickname)), [tree.data]);
  const canHistory = can('history.view');

  const go = (to: string) => { onOpenChange(false); navigate(to); };
  const run = (fn: () => void) => { onOpenChange(false); fn(); };

  type Action = { id: string; label: string; icon: typeof Play; iconClass?: string; keywords?: string[]; onSelect: () => void; trailing?: ReactNode };
  const actions: Action[] = [
    ...(can('server.control') ? [
      { id: 'restart', label: t('palette.act.restart'), icon: RotateCw, iconClass: 'text-amber-300', keywords: [t('dash.action.restart')], onSelect: () => go('/?action=restart') },
      { id: 'start', label: t('palette.act.start'), icon: Play, iconClass: 'text-emerald-300', keywords: [t('dash.action.start')], onSelect: () => go('/?action=start') },
      { id: 'stop', label: t('palette.act.stop'), icon: Square, iconClass: 'text-rose-300', keywords: [t('dash.action.stop')], onSelect: () => go('/?action=stop') },
    ] : []),
    ...(can('backups.manage') ? [{ id: 'backup', label: t('palette.act.createBackup'), icon: Archive, keywords: [t('nav.backups')], onSelect: () => go('/backups?create=1') }] : []),
    ...(can('users.manage') ? [{ id: 'user', label: t('palette.act.createUser'), icon: UserPlus, keywords: [t('nav.users')], onSelect: () => go('/users?create=1') }] : []),
    { id: 'theme-light', label: t('palette.act.theme', { mode: t('theme.light') }), icon: Sun, keywords: [t('theme.label')], onSelect: () => run(() => setPref('light')) },
    { id: 'theme-dark', label: t('palette.act.theme', { mode: t('theme.dark') }), icon: Moon, keywords: [t('theme.label')], onSelect: () => run(() => setPref('dark')) },
    { id: 'theme-system', label: t('palette.act.theme', { mode: t('theme.system') }), icon: Monitor, keywords: [t('theme.label')], onSelect: () => run(() => setPref('system')) },
    ...LOCALES.map((l) => ({ id: `lang-${l}`, label: t('palette.act.language', { lang: LOCALE_NAMES[l] }), icon: Languages, keywords: [t('account.language'), LOCALE_NAMES[l]], onSelect: () => run(() => { void setLanguage(l); }) })),
    { id: 'shortcuts', label: t('palette.act.shortcuts'), icon: Keyboard, keywords: [t('shortcuts.title')], onSelect: () => run(onShowShortcuts), trailing: <kbd className="kbd ml-auto">?</kbd> },
    { id: 'logout', label: t('layout.logout'), icon: LogOut, onSelect: () => run(() => { void logout().then(() => navigate('/login')); }), trailing: user ? <span className="ml-auto text-xs text-slate-500">{user.username}</span> : undefined },
  ];

  return (
    <Modal open={open} onClose={() => onOpenChange(false)} size="lg" bare>
      <Command label={t('palette.title')} loop>
        <Command.Input value={search} onValueChange={setSearch} placeholder={t('palette.placeholder')} autoFocus />
        <Command.List>
          <Command.Empty>{t('palette.empty')}</Command.Empty>
          <Command.Group heading={t('palette.pages')}>
            {groups.flatMap((g) => g.items).map((p) => (
              <Command.Item key={p.to} value={`page:${p.to}`} keywords={[p.label]} onSelect={() => go(p.to)}>
                <p.icon className="h-4 w-4 text-slate-400" aria-hidden />
                <span className="flex-1">{p.label}</span>
                {p.key && <span className="flex items-center gap-1 text-2xs text-slate-500"><kbd className="kbd">G</kbd><kbd className="kbd">{p.key.toUpperCase()}</kbd></span>}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading={t('palette.actions')}>
            {actions.map((a) => (
              <Command.Item key={a.id} value={`action:${a.id}`} keywords={[a.label, ...(a.keywords ?? [])]} onSelect={a.onSelect}>
                <a.icon className={`h-4 w-4 ${a.iconClass ?? 'text-slate-400'}`} aria-hidden />
                <span className="flex-1">{a.label}</span>
                {a.trailing}
              </Command.Item>
            ))}
          </Command.Group>
          {clients.length > 0 && (
            <Command.Group heading={t('palette.clients')}>
              {clients.map((c) => (
                <Command.Item key={c.clid} value={`client:${c.clid}`} keywords={[c.nickname, c.uid]} onSelect={() => go(canHistory ? `/history/${encodeURIComponent(c.uid)}` : '/clients')}>
                  <User className="h-4 w-4 text-slate-400" aria-hidden />
                  <span className="flex-1 truncate">{c.nickname}</span>
                  {c.country && <span className="text-xs" aria-hidden>{countryFlag(c.country)}</span>}
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {channels.length > 0 && (
            <Command.Group heading={t('palette.channels')}>
              {channels.map((c) => (
                <Command.Item key={c.cid} value={`channel:${c.cid}`} keywords={[c.name]} onSelect={() => go(`/clients?cid=${encodeURIComponent(c.cid)}`)}>
                  <Hash className="h-4 w-4 text-slate-400" aria-hidden />
                  <span className="flex-1 truncate" style={{ paddingLeft: c.depth * 10 }}>{c.name}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        <div className="flex items-center gap-4 border-t border-slate-800 px-4 py-2 text-2xs text-slate-500">
          <span className="flex items-center gap-1"><kbd className="kbd">↑↓</kbd> {t('palette.hintNavigate')}</span>
          <span className="flex items-center gap-1"><kbd className="kbd">↵</kbd> {t('palette.open')}</span>
          <span className="flex items-center gap-1"><kbd className="kbd">Esc</kbd> {t('common.close')}</span>
          <span className="ml-auto flex items-center gap-1"><kbd className="kbd">{modKey(locale)}</kbd><kbd className="kbd">K</kbd></span>
        </div>
      </Command>
    </Modal>
  );
}
