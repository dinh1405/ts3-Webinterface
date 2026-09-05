import path from 'node:path';
import { config } from '../config.js';
import { JsonStore } from './store.js';

export const DEFAULT_SETTINGS = {
  // systemweite Sprache: de | en (Benutzer können sie persönlich überschreiben); Startwert aus UI_LANGUAGE (Installer), sonst Englisch
  language: ['de', 'en'].includes(process.env.UI_LANGUAGE) ? process.env.UI_LANGUAGE : 'en',
  timezone: 'Europe/Berlin',
  backupSchedule: {
    enabled: false,
    frequency: 'daily', // daily | weekly
    time: '03:30',
    weekday: 0, // 0 = Sonntag
    keep: 7,
    includeLogs: false,
  },
  lastScheduledBackup: null,
  watchdog: {
    enabled: false,
    intervalSec: 30,
    maxRestartsPerHour: 3,
    startOnBoot: true,
    suspended: false, // true, wenn der Server bewusst über das Interface gestoppt wurde
  },
  notifications: {
    discord: { enabled: false, webhookUrl: '' },
    telegram: { enabled: false, botToken: '', chatId: '' },
    webhook: { enabled: false, url: '', secret: '' },
    email: { enabled: false, to: '', from: '', sendmailPath: '/usr/sbin/sendmail' },
    events: {
      serverDown: true,
      serverRestarted: true,
      watchdogGaveUp: true,
      backupFailed: true,
      backupDone: false,
      updateDone: true,
      updateFailed: true,
      clientBanned: true,
      clientKicked: false,
      loginBlocked: true,
      queryLost: false,
    },
  },
  statsRetentionDays: 90,
  historyRetentionDays: 365,
  roleCapabilities: null, // null = Standardwerte aus lib/capabilities.js
};

const store = new JsonStore(path.join(config.dataDir, 'settings.json'), DEFAULT_SETTINGS);

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge(defaults, value) {
  if (!isObj(defaults)) return value === undefined ? defaults : value;
  const out = { ...defaults };
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) out[k] = isObj(defaults[k]) ? deepMerge(defaults[k], v) : v;
  }
  return out;
}

export function getSettings() {
  return deepMerge(DEFAULT_SETTINGS, store.get());
}

/** Flaches Patch auf oberster Ebene (verschachtelte Objekte werden komplett ersetzt). */
export async function updateSettings(patch) {
  await store.update((d) => {
    Object.assign(d, patch);
  });
  return getSettings();
}
