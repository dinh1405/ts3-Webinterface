/**
 * Täglicher Versionscheck mit Benachrichtigung „Update verfügbar“ (einmal je neuer Version und Komponente),
 * unabhängig davon, ob der Auto-Update aktiv ist. Läuft 5 Minuten nach dem Start und danach alle 24 h.
 */
import { config } from '../config.js';
import { getSettings, updateSettings } from './settings.js';
import { checkForUpdate, compareVersions } from './update.js';
import { checkSelfUpdate } from './selfupdate.js';
import { notify } from './notify.js';

let timer = null;
let running = false;
const INITIAL_DELAY_MS = 5 * 60 * 1000;
const INTERVAL_MS = 24 * 3600 * 1000;

/** Führt den Check aus; liefert, was neu gemeldet wurde. */
export async function runUpdateCheck({ force = false } = {}) {
  if (running) return { skipped: 'running' };
  running = true;
  const notified = { ...(getSettings().updateNotified || {}) };
  const found = [];
  try {
    if (config.ts3.dir) {
      try {
        const s = await checkForUpdate(true);
        if (s.updateAvailable && (force || !notified.ts3 || compareVersions(s.latest, notified.ts3) > 0)) {
          found.push({ component: 'ts3', current: s.current || '?', latest: s.latest, url: 'https://www.teamspeak.com/en/downloads/#server' });
          notified.ts3 = s.latest;
        }
      } catch (e) {
        console.warn('[updatecheck] ts3:', e.message);
      }
    }
    try {
      const s = await checkSelfUpdate(true);
      if (s.updateAvailable && (force || !notified.webinterface || compareVersions(s.latest.version, notified.webinterface) > 0)) {
        found.push({ component: 'webinterface', current: s.current, latest: s.latest.version, url: s.latest.url || `https://github.com/${s.repo}/releases` });
        notified.webinterface = s.latest.version;
      }
    } catch (e) {
      console.warn('[updatecheck] webinterface:', e.message);
    }
    for (const f of found) await notify('updateAvailable', f).catch(() => {});
    if (found.length) await updateSettings({ updateNotified: notified });
    return { found };
  } finally {
    running = false;
  }
}

export function startUpdateCheck() {
  stopUpdateCheck();
  const tick = () => runUpdateCheck().catch((e) => console.warn('[updatecheck]', e.message));
  timer = setTimeout(() => {
    tick();
    timer = setInterval(tick, INTERVAL_MS);
    timer.unref?.();
  }, INITIAL_DELAY_MS);
  timer.unref?.();
}

export function stopUpdateCheck() {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
}
