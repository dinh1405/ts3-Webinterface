/**
 * Kompakte Übersicht für die Kopfleiste und die Dashboard-Kacheln: Sparklines der letzten Stunde,
 * letztes Backup (nur mit backups.view) und verfügbare Updates (nur mit system.view, aus dem Cache der
 * Update-Prüfungen – kein Netzwerkzugriff).
 */
import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { can } from '../lib/capabilities.js';
import { recentSamples } from '../lib/stats.js';
import { listBackups } from '../lib/backup.js';
import { updateSummary } from '../lib/update.js';
import { selfUpdateSummary } from '../lib/selfupdate.js';

const router = Router();
const BACKUP_CACHE_MS = 30 * 1000;
let backupCache = { at: 0, value: null };

async function lastBackup() {
  if (Date.now() - backupCache.at < BACKUP_CACHE_MS) return backupCache.value;
  let value = null;
  try {
    const b = (await listBackups())[0];
    if (b) value = { id: b.id, createdAt: b.createdAt, trigger: b.trigger, ok: b.dbIntegrity !== 'failed' };
  } catch {
    value = null;
  }
  backupCache = { at: Date.now(), value };
  return value;
}

/** Cache zurücksetzen (nach Backup-Erstellung/-Löschung). */
export function invalidateOverview() {
  backupCache = { at: 0, value: null };
}

async function updates() {
  const [u, s] = await Promise.all([updateSummary(), selfUpdateSummary()]);
  return {
    ts3: { available: Boolean(u.updateAvailable), latest: u.latest || null },
    webinterface: { available: Boolean(s.updateAvailable), latest: s.latest?.version || null },
  };
}

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const [spark, backup, upd] = await Promise.all([
    recentSamples(60),
    can(req.user, 'backups.view') ? lastBackup() : Promise.resolve(undefined),
    can(req.user, 'system.view') ? updates() : Promise.resolve(undefined),
  ]);
  res.json({ spark, lastBackup: backup ?? null, updates: upd ?? null });
}));

export default router;
