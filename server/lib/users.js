import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { JsonStore } from './store.js';
import { HttpError } from './errors.js';
import { capabilitiesOf } from './capabilities.js';
import { validatePassword as checkPolicy } from './passwords.js';
import { generateSecret, otpauthUrl, verifyTotp, generateRecoveryCodes, hashRecoveryCode } from './totp.js';

export const ROLES = ['admin', 'operator', 'viewer'];

const store = new JsonStore(path.join(config.dataDir, 'users.json'), { users: [] });

// Dummy-Hash, damit ein Login-Versuch für unbekannte Benutzer genauso lange dauert
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

export function sanitizeUser(u) {
  if (!u) return null;
  const { passwordHash, tokenVersion, notifications, totp, passkeys, ...rest } = u;
  return { ...rest, language: u.language || null, capabilities: capabilitiesOf(u), totpEnabled: Boolean(totp?.enabled), recoveryCodesLeft: totp?.enabled ? (totp.recoveryCodes || []).length : 0, passkeyCount: (passkeys || []).length };
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

/** Gemeinsame Passwortregel (server/lib/passwords.js). */
export function validatePassword(password, opts = {}) {
  checkPolicy(password, opts);
}

export async function createUser({ username, password, role = 'viewer', displayName = '', language = null }) {
  username = String(username || '').trim();
  validateUsername(username);
  validatePassword(password, { username });
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
  const user = getUser(id);
  if (!user) throw new HttpError(404, 'users.notFound');
  validatePassword(password, { username: user.username });
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

/* =========================== Zweiter Faktor (TOTP) =========================== */

const pendingTotp = new Map(); // userId → { secret, createdAt }
const PENDING_TTL_MS = 15 * 60 * 1000;
export const TOTP_ISSUER = 'TS3 Webinterface';

/** Einrichtung beginnen: neues Geheimnis (noch nicht aktiv), otpauth-URL für den QR-Code. */
export function startTotpSetup(id) {
  const user = getUser(id);
  if (!user) throw new HttpError(404, 'users.notFound');
  const secret = generateSecret();
  pendingTotp.set(id, { secret, createdAt: Date.now() });
  return { secret, otpauth: otpauthUrl({ issuer: TOTP_ISSUER, account: user.username, secret }) };
}

/** Einrichtung abschließen: Code gegen das vorgemerkte Geheimnis prüfen, Wiederherstellungscodes erzeugen (einmalig sichtbar). */
export async function enableTotp(id, code) {
  const p = pendingTotp.get(id);
  if (!p || Date.now() - p.createdAt > PENDING_TTL_MS) throw new HttpError(400, 'auth.totpSetupExpired');
  if (verifyTotp(p.secret, code) === null) throw new HttpError(400, 'auth.totpCodeInvalid');
  const codes = generateRecoveryCodes(10);
  await store.update((d) => {
    const u = d.users.find((x) => x.id === id);
    u.totp = { enabled: true, secret: p.secret, recoveryCodes: codes.map(hashRecoveryCode), enabledAt: new Date().toISOString(), lastCounter: null };
    u.updatedAt = new Date().toISOString();
  });
  pendingTotp.delete(id);
  return codes;
}

export async function disableTotp(id) {
  if (!getUser(id)) throw new HttpError(404, 'users.notFound');
  await store.update((d) => {
    const u = d.users.find((x) => x.id === id);
    delete u.totp;
    u.updatedAt = new Date().toISOString();
  });
  pendingTotp.delete(id);
}

/** Neue Wiederherstellungscodes (alte verfallen). */
export async function regenerateRecoveryCodes(id) {
  const user = getUser(id);
  if (!user?.totp?.enabled) throw new HttpError(400, 'auth.totpNotEnabled');
  const codes = generateRecoveryCodes(10);
  await store.update((d) => {
    const u = d.users.find((x) => x.id === id);
    u.totp.recoveryCodes = codes.map(hashRecoveryCode);
  });
  return codes;
}

/**
 * Prüft einen TOTP-Code oder Wiederherstellungscode. Liefert 'totp' | 'recovery' | null.
 * Ein TOTP-Zeitfenster gilt nur einmal (Replay-Schutz); ein Wiederherstellungscode wird verbraucht.
 */
export async function verifyUserTotp(id, code) {
  const user = getUser(id);
  if (!user?.totp?.enabled) return null;
  const raw = String(code || '').trim();
  const counter = verifyTotp(user.totp.secret, raw);
  if (counter !== null) {
    if (user.totp.lastCounter !== null && user.totp.lastCounter !== undefined && counter <= user.totp.lastCounter) return null;
    await store.update((d) => { d.users.find((x) => x.id === id).totp.lastCounter = counter; });
    return 'totp';
  }
  const h = hashRecoveryCode(raw);
  if (raw.replace(/[^a-z0-9]/gi, '').length >= 10 && (user.totp.recoveryCodes || []).includes(h)) {
    await store.update((d) => {
      const u = d.users.find((x) => x.id === id);
      u.totp.recoveryCodes = u.totp.recoveryCodes.filter((c) => c !== h);
    });
    return 'recovery';
  }
  return null;
}

export function totpStatus(id) {
  const u = getUser(id);
  return { enabled: Boolean(u?.totp?.enabled), enabledAt: u?.totp?.enabledAt || null, recoveryCodesLeft: u?.totp?.enabled ? (u.totp.recoveryCodes || []).length : 0 };
}

/* =========================== Passkeys (WebAuthn) =========================== */

const MAX_PASSKEYS = 10;
const publicPasskey = ({ id, name, createdAt, lastUsedAt, deviceType, backedUp, transports }) => ({ id, name, createdAt, lastUsedAt, deviceType, backedUp, transports });

/** Vollständige Einträge (mit öffentlichem Schlüssel und Zähler) – nur für lib/passkeys.js. */
export function listPasskeysRaw(id) {
  return [...(getUser(id)?.passkeys || [])];
}

export function listPasskeys(id) {
  return listPasskeysRaw(id).map(publicPasskey);
}

export async function addPasskey(id, passkey) {
  const user = getUser(id);
  if (!user) throw new HttpError(404, 'users.notFound');
  if ((user.passkeys || []).length >= MAX_PASSKEYS) throw new HttpError(400, 'auth.passkeyLimit', { max: MAX_PASSKEYS });
  await store.update((d) => {
    const u = d.users.find((x) => x.id === id);
    u.passkeys = [...(u.passkeys || []).filter((p) => p.id !== passkey.id), passkey];
    u.updatedAt = new Date().toISOString();
  });
  return publicPasskey(passkey);
}

export async function removePasskey(id, credentialId) {
  const user = getUser(id);
  if (!user) throw new HttpError(404, 'users.notFound');
  if (!(user.passkeys || []).some((p) => p.id === credentialId)) throw new HttpError(404, 'auth.passkeyNotFound');
  await store.update((d) => {
    const u = d.users.find((x) => x.id === id);
    u.passkeys = (u.passkeys || []).filter((p) => p.id !== credentialId);
    u.updatedAt = new Date().toISOString();
  });
}

export async function renamePasskey(id, credentialId, name) {
  const user = getUser(id);
  if (!user || !(user.passkeys || []).some((p) => p.id === credentialId)) throw new HttpError(404, 'auth.passkeyNotFound');
  await store.update((d) => {
    const p = d.users.find((x) => x.id === id).passkeys.find((x) => x.id === credentialId);
    p.name = String(name || '').trim().slice(0, 60) || p.name;
  });
  return listPasskeys(id);
}

export async function clearPasskeys(id) {
  if (!getUser(id)) throw new HttpError(404, 'users.notFound');
  await store.update((d) => {
    const u = d.users.find((x) => x.id === id);
    delete u.passkeys;
    u.updatedAt = new Date().toISOString();
  });
}

/** Benutzer und Passkey zu einer Credential-ID (base64url) – für die Anmeldung ohne Benutzernamen. */
export function findUserByCredential(credentialId) {
  for (const u of store.get().users) {
    const passkey = (u.passkeys || []).find((p) => p.id === credentialId);
    if (passkey) return { user: u, passkey };
  }
  return null;
}

/** Zeitpunkt der letzten Anmeldung setzen (Passkey-Anmeldung läuft nicht über verifyLogin). */
export async function touchLogin(id) {
  await store.update((d) => {
    const u = d.users.find((x) => x.id === id);
    if (u) u.lastLoginAt = new Date().toISOString();
  });
}

export async function bumpPasskey(id, credentialId, counter) {
  await store.update((d) => {
    const p = d.users.find((x) => x.id === id)?.passkeys?.find((x) => x.id === credentialId);
    if (p) { p.counter = counter; p.lastUsedAt = new Date().toISOString(); }
  });
}
