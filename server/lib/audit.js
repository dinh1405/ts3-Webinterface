import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { JsonStore } from './store.js';

const MAX_ENTRIES = 5000;
const store = new JsonStore(path.join(config.dataDir, 'audit.json'), { entries: [] });

/**
 * Protokolliert eine Aktion. `req` darf null sein (z. B. Zeitplan → "system").
 */
export function audit(req, action, details = {}, ok = true) {
  const entry = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    userId: req?.user?.id || null,
    username: req?.user?.username || (req === null ? 'system' : 'anonym'),
    ip: req?.ip || null,
    action,
    details,
    ok,
  };
  store.update((d) => {
    d.entries.unshift(entry);
    if (d.entries.length > MAX_ENTRIES) d.entries.length = MAX_ENTRIES;
  });
  return entry;
}

export function listAudit({ limit = 100, offset = 0, username, action, q, ok } = {}) {
  let entries = store.get().entries;
  if (username) entries = entries.filter((e) => e.username === username);
  if (action) entries = entries.filter((e) => e.action.startsWith(action));
  if (ok === 'true' || ok === 'false') entries = entries.filter((e) => e.ok === (ok === 'true'));
  if (q) {
    const needle = q.toLowerCase();
    entries = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(needle));
  }
  const total = entries.length;
  return { total, entries: entries.slice(offset, offset + limit) };
}

export function auditActions() {
  return [...new Set(store.get().entries.map((e) => e.action))].sort();
}
