/**
 * Nächtliches Auto-Update: prüft TeamSpeak-Server und Webinterface auf neue Versionen und spielt sie ein.
 * Läuft unter der Wartungssperre `auto-update`; TS3-Update und Selbst-Update laufen darin verschachtelt.
 * Reihenfolge: erst TS3 (macht selbst ein Pre-Update-Backup), dann Webinterface – das beendet den Prozess,
 * deshalb werden Ergebnis, Audit und Benachrichtigung vorher geschrieben bzw. abgewartet.
 *
 * Ergebnis je Komponente: { skipped: <grund> } | { ok: true, from, to } | { ok: false, from, to, error }
 * Gründe: disabled, noDir, upToDate, clientsOnline, notPossible (reason), checkFailed (error), busy
 */
import { config } from '../config.js';
import { getSettings, updateSettings } from './settings.js';
import * as maintenance from './maintenance.js';
import { isControlBusy, isConfigured } from './process.js';
import { ts3 } from './ts3.js';
import { checkForUpdate, runUpdate } from './update.js';
import { checkSelfUpdate, runSelfUpdate, selfUpdateInfo } from './selfupdate.js';
import { notify } from './notify.js';
import { audit } from './audit.js';

const USERNAME = 'auto-update';
let running = null; // { startedAt, trigger, by, step }

export function autoUpdateRunning() {
  return running;
}

/** Echte Clients (ohne Query-Verbindungen) auf dem aktiven virtuellen Server; null = nicht ermittelbar. */
export async function realClientsOnline() {
  if (!ts3.connected) return null;
  try {
    const info = await ts3.get().serverInfo();
    const all = Number(info.virtualserverClientsonline) || 0;
    const query = Number(info.virtualserverQueryclientsonline) || 0;
    return Math.max(0, all - query);
  } catch {
    return null;
  }
}

async function updateTs3(settings, lease) {
  if (!config.ts3.dir) return { skipped: 'noDir' };
  if (!isConfigured()) return { skipped: 'notPossible', reason: 'noControl' };
  const sum = await checkForUpdate(true);
  if (sum.checkError) return { skipped: 'checkFailed', error: sum.checkError };
  if (!sum.updateAvailable) return { skipped: 'upToDate', current: sum.current };
  if (settings.onlyWhenEmpty) {
    const count = await realClientsOnline();
    // Nicht ermittelbar (Query getrennt) zählt wie „Server nicht erreichbar“ → kein Client wird gestört
    if (count !== null && count > 0) return { skipped: 'clientsOnline', count, from: sum.current, to: sum.latest };
  }
  try {
    const r = await runUpdate({ version: sum.latest, username: USERNAME, parent: lease.token });
    if (!r.ok) return { ok: false, state: r.state, from: r.from, to: r.to, seen: r.seen, error: r.error };
    return { ok: true, from: r.from, to: r.to };
  } catch (e) {
    return { ok: false, from: sum.current, to: sum.latest, error: e.message };
  }
}

async function updateSelf(lease) {
  const info = selfUpdateInfo();
  if (!info.canUpdate) return { skipped: 'notPossible', reason: info.reasons[0] };
  const sum = await checkSelfUpdate(true);
  if (sum.checkError) return { skipped: 'checkFailed', error: sum.checkError };
  if (!sum.updateAvailable) return { skipped: 'upToDate', current: sum.current };
  try {
    // restart:false – der Neustart wird hier gesteuert, nachdem Ergebnis und Benachrichtigung geschrieben sind
    const r = await runSelfUpdate({ version: sum.latest.version, username: USERNAME, restart: false, parent: lease.token, notifyDone: false });
    return { ok: true, from: r.from, to: r.to, restart: info.restartMode === 'systemd' };
  } catch (e) {
    return { ok: false, from: info.current, to: sum.latest?.version, error: e.message };
  }
}

/** Was ist erwähnenswert? (alles außer „nichts zu tun“) */
const notable = (c) => c && c.skipped && !['disabled', 'upToDate', 'noDir'].includes(c.skipped);

/**
 * Führt einen Auto-Update-Lauf aus. Gibt das Ergebnis zurück, das auch unter settings.lastAutoUpdate liegt.
 * Bei erfolgreichem Webinterface-Update unter systemd endet der Prozess ~1,5 s nach der Rückgabe.
 */
export async function runAutoUpdate({ trigger = 'schedule', username = 'system' } = {}) {
  const s = getSettings();
  const a = s.autoUpdate;
  const result = { at: new Date().toISOString(), trigger, by: username, ok: true, skipped: null, ts3: null, webinterface: null, restart: false };
  if (running) return { ...result, ok: false, skipped: 'running' };
  if (maintenance.isBusy() || isControlBusy()) {
    result.skipped = 'busy';
    result.ok = false;
    await updateSettings({ lastAutoUpdate: result });
    audit({ user: { username } }, 'autoupdate.run', { trigger, skipped: 'busy' }, false);
    await notify('autoUpdateSkipped', { result }).catch(() => {});
    return result;
  }
  running = { startedAt: result.at, trigger, by: username, step: 'ts3' };
  const lease = maintenance.acquire('auto-update', { by: username, detail: trigger });
  let keepLock = false;
  try {
    result.ts3 = a.ts3 ? await updateTs3(a, lease) : { skipped: 'disabled' };
    running.step = 'webinterface';
    result.webinterface = a.webinterface ? await updateSelf(lease) : { skipped: 'disabled' };
    result.ok = [result.ts3, result.webinterface].every((c) => c.ok !== false);
    result.restart = Boolean(result.webinterface?.ok && result.webinterface.restart);
    result.finishedAt = new Date().toISOString();
    await updateSettings({ lastAutoUpdate: result });
    audit({ user: { username } }, 'autoupdate.run', { trigger, ok: result.ok, ts3: result.ts3, webinterface: result.webinterface }, result.ok);
    const updated = [result.ts3, result.webinterface].some((c) => c.ok !== undefined);
    if (updated) await notify('autoUpdateDone', { result }).catch(() => {});
    else if ([result.ts3, result.webinterface].some(notable)) await notify('autoUpdateSkipped', { result }).catch(() => {});
    if (result.restart) {
      // Sperre bis zum Prozessende halten, damit in der Zwischenzeit nichts anderes startet
      keepLock = true;
      console.log('[autoupdate] webinterface updated – restarting service');
      setTimeout(() => process.exit(0), 1500).unref();
    }
    return result;
  } finally {
    running = null;
    if (!keepLock) maintenance.release(lease);
  }
}
