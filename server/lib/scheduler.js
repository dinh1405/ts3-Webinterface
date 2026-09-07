import * as cron from 'node-cron';
import { getSettings, updateSettings } from './settings.js';
import { createBackup, applyRetention } from './backup.js';
import { runAutoUpdate } from './autoupdate.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { ts } from './locale.js';

/** Alle Cron-Tasks nach Namen: backup, autoupdate. */
const tasks = new Map();
let runningNow = false;

export function scheduleToCron(s) {
  const [h, m] = String(s.time || '03:30').split(':').map((x) => parseInt(x, 10));
  const hour = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 3;
  const minute = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 30;
  if (s.frequency === 'weekly') return `${minute} ${hour} * * ${Math.min(6, Math.max(0, s.weekday | 0))}`;
  return `${minute} ${hour} * * *`;
}

export function clearTask(name) {
  const t = tasks.get(name);
  if (!t) return;
  try { t.destroy(); } catch { /* ignore */ }
  tasks.delete(name);
}

export function setTask(name, expr, fn, timezone) {
  clearTask(name);
  tasks.set(name, cron.schedule(expr, fn, { timezone: timezone || 'Europe/Berlin' }));
  console.log(`[scheduler] ${name} schedule active: "${expr}" (${timezone})`);
  return expr;
}

/** Nächste Ausführung eines Tasks (ISO) oder null. */
export function taskNextRun(name) {
  try {
    return tasks.get(name)?.getNextRun?.()?.toISOString() ?? null;
  } catch {
    return null;
  }
}

export function applyBackupSchedule() {
  clearTask('backup');
  const s = getSettings();
  if (!s.backupSchedule.enabled) return null;
  return setTask('backup', scheduleToCron(s.backupSchedule), () => runScheduledBackup(), s.timezone);
}

export function applyAutoUpdateSchedule() {
  clearTask('autoupdate');
  const s = getSettings();
  const a = s.autoUpdate;
  if (!a?.enabled || (!a.ts3 && !a.webinterface)) return null;
  return setTask('autoupdate', scheduleToCron(a), () => runAutoUpdate({ trigger: 'schedule' }).catch((e) => console.error('[scheduler] auto-update failed:', e.message)), s.timezone);
}

/** Alle Zeitpläne aus den Einstellungen (neu) anlegen. */
export function applySchedule() {
  const backup = applyBackupSchedule();
  applyAutoUpdateSchedule();
  return backup;
}

export async function runScheduledBackup(trigger = 'schedule') {
  if (runningNow) return { ok: false, error: ts('scheduler.running') };
  runningNow = true;
  const s = getSettings();
  let result;
  try {
    const meta = await createBackup({ includeLogs: s.backupSchedule.includeLogs, includeSnapshot: Boolean(s.backupSchedule.includeSnapshot), trigger, username: 'system' });
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
  return { ...s.backupSchedule, timezone: s.timezone, cron: s.backupSchedule.enabled ? scheduleToCron(s.backupSchedule) : null, nextRun: taskNextRun('backup'), lastRun: s.lastScheduledBackup, running: runningNow };
}

/** Nur für Tests: alle Tasks entfernen, damit der Prozess enden kann. */
export function _clearAll() {
  for (const name of [...tasks.keys()]) clearTask(name);
}
