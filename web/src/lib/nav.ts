import {
  Archive, Ban, BarChart3, ClipboardList, Cpu, Flag, FolderOpen, History, KeyRound, LayoutDashboard, Mail, ScrollText, Settings, Shield, Users, UserCog, type LucideIcon,
} from 'lucide-react';
import { useAuth } from './auth';
import { useT } from '../i18n';

export type NavGroupKey = 'overview' | 'clients' | 'server' | 'admin';
export interface NavItem { to: string; label: string; icon: LucideIcon; cap?: string; end?: boolean; /** Kurztaste nach „g“ */ key?: string }
export interface NavGroup { key: NavGroupKey; label: string; items: NavItem[] }

/** Navigationsgruppen, gefiltert nach den Rechten des angemeldeten Benutzers (Seitenleiste, Befehlspalette, Tastenkürzel). */
export function useNavGroups(): NavGroup[] {
  const { can } = useAuth();
  const { t } = useT();
  const all: NavGroup[] = [
    { key: 'overview', label: t('navGroup.overview'), items: [
      { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard, end: true, key: 'd' },
      { to: '/stats', label: t('nav.stats'), icon: BarChart3, key: 't' },
    ] },
    { key: 'clients', label: t('navGroup.clients'), items: [
      { to: '/clients', label: t('nav.clients'), icon: Users, key: 'c' },
      { to: '/history', label: t('nav.history'), icon: History, cap: 'history.view', key: 'h' },
      { to: '/groups', label: t('nav.groups'), icon: Shield, key: 'g' },
      { to: '/permissions', label: t('nav.permissions'), icon: KeyRound, key: 'p' },
      { to: '/bans', label: t('nav.bans'), icon: Ban },
      { to: '/complaints', label: t('nav.complaints'), icon: Flag },
      { to: '/messages', label: t('nav.messages'), icon: Mail, cap: 'messages.view', key: 'm' },
    ] },
    { key: 'server', label: t('navGroup.server'), items: [
      { to: '/files', label: t('nav.files'), icon: FolderOpen, cap: 'files.view', key: 'f' },
      { to: '/logs', label: t('nav.logs'), icon: ScrollText, cap: 'logs.view', key: 'l' },
      { to: '/settings', label: t('nav.settings'), icon: Settings, cap: 'settings.view', key: 'e' },
      { to: '/backups', label: t('nav.backups'), icon: Archive, cap: 'backups.view', key: 'b' },
      { to: '/system', label: t('nav.system'), icon: Cpu, cap: 'system.view', key: 's' },
    ] },
    { key: 'admin', label: t('navGroup.admin'), items: [
      { to: '/users', label: t('nav.users'), icon: UserCog, cap: 'users.manage', key: 'u' },
      { to: '/audit', label: t('nav.audit'), icon: ClipboardList, cap: 'audit.view', key: 'a' },
      { to: '/account', label: t('nav.account'), icon: KeyRound },
    ] },
  ];
  return all.map((g) => ({ ...g, items: g.items.filter((item) => !item.cap || can(item.cap)) })).filter((g) => g.items.length > 0);
}
