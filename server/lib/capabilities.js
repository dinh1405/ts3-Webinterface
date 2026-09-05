/**
 * Feingranulare Rechte für Webinterface-Benutzer, konfigurierbar pro Rolle.
 * Administratoren haben immer alle Rechte (kein Aussperren möglich); die Rechte von
 * Operator und Beobachter werden in settings.json (roleCapabilities) gespeichert.
 */
import { getSettings, updateSettings } from './settings.js';
import { t } from '../i18n/index.js';

export const CAPABILITY_GROUPS = [
  {
    key: 'server', caps: [
      { key: 'server.control', danger: true },
      { key: 'server.message' },
    ],
  },
  {
    key: 'clients', caps: [
      { key: 'clients.manage' },
      { key: 'channels.manage' },
      { key: 'bans.manage' },
      { key: 'complaints.manage' },
      { key: 'history.view' },
      { key: 'history.manage' },
    ],
  },
  {
    key: 'groups', caps: [
      { key: 'groups.manage' },
      { key: 'permissions.manage', danger: true },
    ],
  },
  {
    key: 'files', caps: [
      { key: 'files.view' },
      { key: 'files.manage' },
    ],
  },
  {
    key: 'logs', caps: [
      { key: 'logs.view' },
      { key: 'settings.view' },
      { key: 'settings.manage' },
    ],
  },
  {
    key: 'backups', caps: [
      { key: 'backups.view' },
      { key: 'backups.manage' },
      { key: 'backups.download' },
      { key: 'backups.restore', danger: true },
    ],
  },
  {
    key: 'system', caps: [
      { key: 'system.view' },
      { key: 'system.manage' },
      { key: 'update.run', danger: true },
    ],
  },
  {
    key: 'admin', caps: [
      { key: 'users.manage', danger: true },
      { key: 'audit.view' },
    ],
  },
];

export const CAPABILITIES = CAPABILITY_GROUPS.flatMap((g) => g.caps.map((c) => c.key));

/** Katalog mit übersetzten Bezeichnungen für die Oberfläche. */
export function capabilityCatalog(locale) {
  return CAPABILITY_GROUPS.map((g) => ({ key: g.key, label: t(locale, `capGroup.${g.key}`), caps: g.caps.map((c) => ({ ...c, label: t(locale, `cap.${c.key}`) })) }));
}
const ALL = new Set(CAPABILITIES);

export const ROLE_DEFAULTS = {
  admin: [...CAPABILITIES],
  operator: CAPABILITIES.filter((c) => !['users.manage', 'audit.view', 'backups.restore', 'update.run', 'system.manage'].includes(c)),
  viewer: ['files.view', 'logs.view', 'settings.view', 'backups.view', 'system.view', 'history.view'],
};

/**
 * Rechte, die nach der ersten Version hinzugekommen sind. Gespeicherte Rollenkonfigurationen
 * ohne `catalog`-Feld kennen sie nicht; dort greifen für sie die Standardwerte.
 */
const ADDED_LATER = ['history.view', 'history.manage'];

export function isCapability(c) {
  return ALL.has(c);
}

/** Aktuell konfigurierte Rechte je Rolle. */
export function roleCapabilities() {
  const stored = getSettings().roleCapabilities || {};
  const known = new Set(stored.catalog || CAPABILITIES.filter((c) => !ADDED_LATER.includes(c)));
  const forRole = (role) => CAPABILITIES.filter((c) => {
    const list = stored[role];
    if (!Array.isArray(list) || !known.has(c)) return ROLE_DEFAULTS[role].includes(c);
    return list.includes(c);
  });
  return { admin: [...CAPABILITIES], operator: forRole('operator'), viewer: forRole('viewer') };
}

export async function setRoleCapabilities({ operator, viewer }) {
  const clean = (list, fallback) => (Array.isArray(list) ? CAPABILITIES.filter((c) => list.includes(c)) : fallback);
  const current = roleCapabilities();
  await updateSettings({ roleCapabilities: { operator: clean(operator, current.operator), viewer: clean(viewer, current.viewer), catalog: [...CAPABILITIES] } });
  return roleCapabilities();
}

/** Effektive Rechte eines Benutzers. */
export function capabilitiesOf(user) {
  if (!user) return [];
  return roleCapabilities()[user.role] || [];
}

export function can(user, cap) {
  return capabilitiesOf(user).includes(cap);
}

/** Rollen-Rangfolge: Beobachter < Operator < Administrator. */
export const ROLE_RANK = { viewer: 0, operator: 1, admin: 2 };
export const roleRank = (role) => ROLE_RANK[role] ?? -1;

/** Darf `actor` die Rolle `role` vergeben (nur bis zur eigenen Rolle)? */
export function canAssignRole(actor, role) {
  return roleRank(role) >= 0 && roleRank(role) <= roleRank(actor?.role);
}

/** Darf `actor` den Benutzer `target` verwalten (nur gleich- oder niedriger gestellte)? */
export function canManageUser(actor, target) {
  return roleRank(target?.role) <= roleRank(actor?.role);
}
