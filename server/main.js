import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { config, reconfigureHooks } from './config.js';
import { createApp } from './app.js';
import { ts3 } from './lib/ts3.js';
import { applySchedule } from './lib/scheduler.js';
import { hasUsers } from './lib/users.js';
import { startWatchdog } from './lib/watchdog.js';
import { startStats } from './lib/stats.js';
import { startHistory, stopHistory } from './lib/history.js';
import { applyWatchdog } from './lib/watchdog.js';
import { ensureSetupToken, needsSetup } from './lib/setup.js';
import { appVersion } from './version.js';
import { ts } from './lib/locale.js';
import { notify, setServerNameProvider } from './lib/notify.js';
import { confirmStartup } from './lib/selfupdate.js';

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.backupDir, { recursive: true });
// Startprüfung: Ist das Datenverzeichnis beschreibbar? Sonst gehen Einstellungen, Benutzer und Audit verloren.
try {
  const probe = `${config.dataDir}/.write-test`;
  fs.writeFileSync(probe, String(Date.now()));
  fs.rmSync(probe, { force: true });
} catch (e) {
  console.error(`[startup] WARNING: data directory ${config.dataDir} is not writable (${e.message}). Settings, users and audit entries cannot be saved!`);
}

ts3.on('log', (msg) => log(`[ts3] ${msg}`));

// Konfigurationsänderungen zur Laufzeit (Setup-Assistent / Admin-Seite)
reconfigureHooks.add(async (cfg, changed) => {
  if (changed.some((k) => k.startsWith('ts3.query'))) await ts3.reconfigure();
  if (changed.some((k) => k.startsWith('ts3.') && !k.startsWith('ts3.query'))) applyWatchdog();
  if (changed.includes('backupDir')) await fsp.mkdir(cfg.backupDir, { recursive: true }).catch(() => {});
  if (changed.length) log(`[config] changed: ${changed.filter((k) => !k.includes('password')).join(', ') || '(password)'}`);
});

// Benachrichtigungen aus TS3-Ereignissen
let serverName = null;
setServerNameProvider(() => serverName || ts('notify.unknownServer'));
ts3.on('status', async (s) => {
  if (s.connected) {
    try {
      serverName = (await ts3.get().serverInfo()).virtualserverName || serverName;
    } catch { /* ignore */ }
  }
});
ts3.on('event', (e) => {
  if (e.type === 'client.banned') notify('clientBanned', e.params || {});
  else if (e.type === 'client.kicked') notify('clientKicked', e.params || {});
  else if (e.type === 'query.disconnected' && !ts3.expectingDisconnect) notify('queryLost', { error: ts3.lastError || '?' });
});

ts3.start();
applySchedule();
startWatchdog();
startStats();
startHistory();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  log(`TS3 Webinterface ${appVersion()} listening on http://${config.host}:${config.port}`);
  log(`TS3 directory: ${config.ts3.dir || '(not set)'} · control: ${config.ts3.controlMode} · backups: ${config.backupDir}`);
  if (needsSetup()) {
    log(!hasUsers() ? 'No users yet – the setup wizard is available at /setup.' : 'TS3 connection not configured yet – the setup wizard is available at /setup.');
    ensureSetupToken();
  } else if (!config.ts3.query.password) log('WARNING: ServerQuery password missing – no connection possible.');
  // Nach einem Selbst-Update: Start gelungen → Marker entfernen (sonst würde der Bootstrap zurückrollen)
  confirmStartup().catch((e) => log(`[selfupdate] could not confirm startup: ${e.message}`));
});
server.keepAliveTimeout = 65000;

async function shutdown(signal) {
  log(`${signal} received – shutting down …`);
  server.close();
  await stopHistory();
  await ts3.stop();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
