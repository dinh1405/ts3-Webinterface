import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { JsonStore } from './store.js';
import { HttpError } from './errors.js';
import { capabilitiesOf } from './capabilities.js';

export const ROLES = ['admin', 'operator', 'viewer'];

const store = new JsonStore(path.join(config.dataDir, 'users.json'), { users: [] });

// Dummy-Hash, damit ein Login-Versuch für unbekannte Benutzer genauso lange dauert
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

export function sanitizeUser(u) {
  if (!u) return null;
  // eslint-disable-next-line no-unused-vars
  const { passwordHash, tokenVersion, notifications, ...rest } = u;
  return { ...rest, language: u.language || null, capabilities: capabilitiesOf(u) };
}

export const DEFAULT_USER_NOTIFICATIONS = {
  discord: { enabled: false, webhookUrl: '' },
  telegram: { enabled: false, botToken: '', chatId: '' },
  webhook: { enabled: false, url: '', secret: '' },
  email: { enabled: false, to: '' },
  events: {},
};

/** Persönliche Benachrichtigungseinstellungen eines Benutzers (mit Defaults). */
export function getUserNotifications(id) {
  const u = getUser(id);
  const n = u?.notifications || {};
  return {
    discord: { ...DEFAULT_USER_NOTIFICATIONS.discord, ...(n.discord || {}) },
    telegram: { ...DEFAULT_USER_NOTIFICATIONS.telegram, ...(n.telegram || {}) },
    webhook: { ...DEFAULT_USER_NOTIFICATIONS.webhook, ...(n.webhook || {}) },
    email: { ...DEFAULT_USER_NOTIFICATIONS.email, ...(n.email || {}) },
    events: { ...(n.events || {}) },
  };
}

export async function setUserNotifications(id, notifications) {
  if (!getUser(id)) throw new HttpError(404, 'users.notFound');
  await store.update((d) => {
    const u = d.users.find((x) => x.id === id);
    u.notifications = notifications;
    u.updatedAt = new Date().toISOString();
  });
  return getUserNotifications(id);
}

/** Alle aktiven Benutzer mit ihren Benachrichtigungseinstellungen (für den Versand). */
export function usersWithNotifications() {
  return store.get().users.filter((u) => u.active && u.notifications).map((u) => ({ id: u.id, username: u.username, notifications: getUserNotifications(u.id) }));
}

export function listUsers() {
  return store.get().users.map(sanitizeUser);
}

export function hasUsers() {
  return store.get().users.length > 0;
}

export function getUser(id) {
  return store.get().users.find((u) => u.id === id) || null;
}

export function findByUsername(username) {
  const needle = String(username || '').trim().toLowerCase();
  return store.get().users.find((u) => u.username.toLowerCase() === needle) || null;
}

function validateUsername(username) {
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    throw new HttpError(400, 'users.invalidUsername');
  }
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'users.passwordTooShort');
  }
  if (password.length > 200) throw new HttpError(400, 'users.passwordTooLong');
}

export async function createUser({ username, password, role = 'viewer', displayName = '', language = null }) {
  username = String(username || '').trim();
  validateUsername(username);
  validatePassword(password);
  if (!ROLES.includes(role)) throw new HttpError(400, 'users.invalidRole');
  if (findByUsername(username)) throw new HttpError(409, 'users.taken');
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    username,
    displayName: String(displayName || '').trim().slice(0, 80),
    role,
    active: true,
    language: language || null,
    passwordHash: await bcrypt.hash(password, 12),
    tokenVersion: 0,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };
  await store.update((d) => {
    d.users.push(user);
  });
  return sanitizeUser(user);
}

export async function updateUser(id, patch) {
  const user = getUser(id);
  if (!user) throw new HttpError(404, 'users.notFound');
  if (patch.role !== undefined && !ROLES.includes(patch.role)) throw new HttpError(400, 'users.invalidRole');
  await store.update((d) => {
    const u = d.users.find((x) => x.id === id);
    if (patch.role !== undefined) u.role = patch.role;
    if (patch.active !== undefined) u.active = Boolean(patch.active);
    if (patch.displayName !== undefined) u.displayName = String(patch.displayName).trim().slice(0, 80);
    if (patch.language !== undefined) u.language = patch.language || null;
    // Rollenwechsel oder Deaktivierung beendet bestehende Sitzungen (Rechte werden bei jeder Anfrage neu geladen)
    if (patch.role !== undefined || patch.active === false) u.tokenVersion = (u.tokenVersion || 0) + 1;
    u.updatedAt = new Date().toISOString();
  });
  return sanitizeUser(getUser(id));
}

export async function setPassword(id, password) {
  validatePassword(password);
  const user = getUser(id);
  if (!user) throw new HttpError(404, 'users.notFound');
  const hash = await bcrypt.hash(password, 12);
  await store.update((d) => {
    const u = d.users.find((x) => x.id === id);
    u.passwordHash = hash;
    u.tokenVersion = (u.tokenVersion || 0) + 1;
    u.updatedAt = new Date().toISOString();
  });
  return getUser(id);
}

export async function deleteUser(id) {
  if (!getUser(id)) throw new HttpError(404, 'users.notFound');
  await store.update((d) => {
    d.users = d.users.filter((u) => u.id !== id);
  });
}

export function countActiveAdmins(excludeId = null) {
  return store.get().users.filter((u) => u.role === 'admin' && u.active && u.id !== excludeId).length;
}

export async function verifyLogin(username, password) {
  const user = findByUsername(username);
  const ok = await bcrypt.compare(String(password || ''), user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) return null;
  if (!user.active) throw new HttpError(403, 'users.disabled');
  await store.update((d) => {
    const u = d.users.find((x) => x.id === user.id);
    u.lastLoginAt = new Date().toISOString();
  });
  return getUser(user.id);
}
