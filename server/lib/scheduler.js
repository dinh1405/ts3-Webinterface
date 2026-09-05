import * as cron from 'node-cron';
import { getSettings, updateSettings } from './settings.js';
import { createBackup, applyRetention } from './backup.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { ts } from './locale.js';

let task = null;
let runningNow = false;

export function scheduleToCron(s) {
  const [h, m] = String(s.time || '03:30').split(':').map((x) => parseInt(x, 10));
  const hour = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 3;
  const minute = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 30;
  if (s.frequency === 'weekly') return `${minute} ${hour} * * ${Math.min(6, Math.max(0, s.weekday | 0))}`;
  return `${minute} ${hour} * * *`;
}

export function applySchedule() {
  if (task) {
    try { task.destroy(); } catch { /* ignore */ }
    task = null;
  }
  const s = getSettings();
  if (!s.backupSchedule.enabled) return null;
  const expr = scheduleToCron(s.backupSchedule);
  task = cron.schedule(expr, () => runScheduledBackup(), { timezone: s.timezone || 'Europe/Berlin' });
  console.log(`[scheduler] backup schedule active: "${expr}" (${s.timezone})`);
  return expr;
}

export async function runScheduledBackup(trigger = 'schedule') {
  if (runningNow) return { ok: false, error: ts('scheduler.running') };
  runningNow = true;
  const s = getSettings();
  let result;
  try {
    const meta = await createBackup({ includeLogs: s.backupSchedule.includeLogs, trigger, username: 'system' });
    const deleted = await applyRetention(s.backupSchedule.keep);
    result = { at: new Date().toISOString(), ok: true, backupId: meta.id, size: meta.size, deleted, error: null };
    audit(null, 'backup.scheduled', { backupId: meta.id, size: meta.size, deleted }, true);
    notify('backupDone', { id: meta.id, size: (meta.size / 1048576).toFixed(1), deletedList: deleted.join(', ') });
  } catch (e) {
    result = { at: new Date().toISOString(), ok: false, backupId: null, size: 0, deleted: [], error: e.message };
    audit(null, 'backup.scheduled', { error: e.message }, false);
    console.error('[scheduler] scheduled backup failed:', e.message);
    notify('backupFailed', { error: e.message });
  } finally {
    runningNow = false;
  }
  await updateSettings({ lastScheduledBackup: result });
  return result;
}

export function getScheduleInfo() {
  const s = getSettings();
  let nextRun = null;
  try {
    nextRun = task?.getNextRun?.()?.toISOString() ?? null;
  } catch { /* ignore */ }
  return { ...s.backupSchedule, timezone: s.timezone, cron: s.backupSchedule.enabled ? scheduleToCron(s.backupSchedule) : null, nextRun, lastRun: s.lastScheduledBackup, running: runningNow };
}
