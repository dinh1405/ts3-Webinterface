import crypto from 'node:crypto';
import { HttpError } from './errors.js';

/**
 * Zentrale Wartungssperre: Backup, Wiederherstellung, TS3-Update/-Rollback, Selbst-Update,
 * TS3-Installation und serveradmin-Reset schließen sich gegenseitig aus.
 *
 *   const lease = acquire('backup', { by: 'max' });      // wirft 409 maintenance.busy, wenn etwas läuft
 *   try { … } finally { release(lease); }
 *
 * Interne Teilschritte (z. B. das Sicherheits-Backup vor einer Wiederherstellung) laufen
 * verschachtelt mit dem Token des äußeren Vorgangs: acquire('backup', { parent: lease.token }).
 * Die Modulzustände (running/restoring/…) bleiben für Fortschrittsanzeigen bestehen,
 * entscheiden aber nicht mehr über die Zulässigkeit.
 */
export const KINDS = ['backup', 'restore', 'ts3-update', 'ts3-rollback', 'self-update', 'ts3-install', 'serveradmin-reset', 'auto-update'];

let active = null; // { token, kind, by, startedAt, detail }

export function acquire(kind, { by = 'system', detail = '', parent = null } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown maintenance kind: ${kind}`);
  if (parent) {
    if (!active || active.token !== parent) throw new HttpError(409, 'maintenance.parentMismatch', { kind });
    return { token: parent, kind, nested: true };
  }
  if (active) throw new HttpError(409, 'maintenance.busy', { kind: active.kind, by: active.by, since: active.startedAt });
  active = { token: crypto.randomUUID(), kind, by, startedAt: new Date().toISOString(), detail };
  return { token: active.token, kind, nested: false };
}

export function release(lease) {
  if (!lease || lease.nested) return;
  if (active && active.token === lease.token) active = null;
}

/** Führt fn unter der Sperre aus und gibt sie in jedem Fall wieder frei. */
export async function withLock(kind, opts, fn) {
  const lease = acquire(kind, opts);
  try {
    return await fn(lease);
  } finally {
    release(lease);
  }
}

export function status() {
  return { active: active ? { kind: active.kind, by: active.by, startedAt: active.startedAt, detail: active.detail } : null };
}

export function isBusy() {
  return Boolean(active);
}

/** Nur für Tests. */
export function _reset() {
  active = null;
}
