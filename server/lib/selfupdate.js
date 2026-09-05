/**
 * Selbst-Update des Webinterface aus GitHub-Releases – ohne Root-Rechte:
 *   Release-Feed abfragen → Paket laden und SHA-256 prüfen → entpacken → npm ci im Staging-Verzeichnis →
 *   aktuelle Dateien nach .previous/ verschieben, neue einsetzen → Marker .update-pending schreiben → Prozess beenden.
 * systemd (Restart=always) startet den Dienst mit dem neuen Code; server/index.js (Bootstrap) macht den Wechsel
 * rückgängig, wenn die neue Version zweimal nicht startet. Erfolgreicher Start löscht den Marker.
 *
 * Nur für Release-Installationen (VERSION-Datei vorhanden) unter Linux; im Entwicklungs-Checkout deaktiviert.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from '../config.js';
import { HttpError } from './errors.js';
import { appVersion } from '../version.js';
import { compareVersions, downloadFile, sha256File, runCmd, updateSummary as ts3UpdateSummary } from './update.js';
import { backupState } from './backup.js';
import { audit } from './audit.js';
import { ts } from './locale.js';

export const REPO = process.env.TS3WI_REPO || 'dinh1405/ts3-Webinterface';
const FEED_URL = process.env.TS3WI_UPDATE_FEED || `https://api.github.com/repos/${REPO}/releases/latest`;
const TAG_URL = (v) => (process.env.TS3WI_UPDATE_FEED ? null : `https://api.github.com/repos/${REPO}/releases/tags/v${v}`);
const VERSION_FILE = path.join(ROOT_DIR, 'VERSION');
const PREVIOUS_DIR = path.join(ROOT_DIR, '.previous');
const STAGE_DIR = path.join(ROOT_DIR, '.update-tmp');
const MARKER = path.join(ROOT_DIR, '.update-pending');
const LAST_FILE = path.join(ROOT_DIR, '.update-last.json');
/** Programmdateien, die beim Update getauscht werden (Daten, Backups und .env bleiben unberührt). */
export const ENTRIES = ['server', 'web', 'deploy', 'docs', 'node_modules', 'package.json', 'package-lock.json', 'VERSION', 'README.md', 'README.de.md', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', '.env.example'];

const state = { checkedAt: null, latest: null, checkError: null, running: null, lastResult: null };
const log = (msg) => {
  if (state.running) state.running.steps.push({ ts: new Date().toISOString(), msg });
  console.log(`[selfupdate] ${msg}`);
};

function which(bin) {
  const dirs = (process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin').split(path.delimiter);
  for (const d of dirs) { try { fs.accessSync(path.join(d, bin), fs.constants.X_OK); return path.join(d, bin); } catch { /* weiter */ } }
  return null;
}
const isRelease = () => fs.existsSync(VERSION_FILE);
const writable = (p) => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; } };

/** Voraussetzungen für ein Selbst-Update. */
export function selfUpdateInfo() {
  const reasons = [];
  if (process.platform !== 'linux') reasons.push('notLinux');
  if (!isRelease()) reasons.push('notRelease');
  if (!writable(ROOT_DIR)) reasons.push('notWritable');
  if (!which('npm')) reasons.push('npmMissing');
  if (!which('tar')) reasons.push('tarMissing');
  return {
    current: appVersion(),
    isRelease: isRelease(),
    canUpdate: reasons.length === 0,
    reasons,
    // Unter systemd (INVOCATION_ID gesetzt) startet der Dienst nach process.exit() automatisch neu
    restartMode: process.env.INVOCATION_ID ? 'systemd' : 'manual',
    rootDir: ROOT_DIR,
    repo: REPO,
  };
}

async function previousVersion() {
  try { return (await fsp.readFile(path.join(PREVIOUS_DIR, 'VERSION'), 'utf8')).trim() || null; } catch { return null; }
}
async function lastFromDisk() {
  try { return JSON.parse(await fsp.readFile(LAST_FILE, 'utf8')); } catch { return null; }
}

export async function selfUpdateSummary() {
  const info = selfUpdateInfo();
  const last = state.lastResult || (await lastFromDisk());
  return {
    ...info,
    checkedAt: state.checkedAt,
    latest: state.latest,
    updateAvailable: Boolean(state.latest && compareVersions(state.latest.version, info.current) > 0),
    checkError: state.checkError,
    running: state.running,
    lastResult: last,
    previousVersion: await previousVersion(),
    pending: fs.existsSync(MARKER),
  };
}

async function fetchRelease(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'ts3-webinterface', Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const r = await res.json();
  const version = String(r.tag_name || r.name || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(ts('selfupdate.log.feedFormat'));
  const assets = Array.isArray(r.assets) ? r.assets : [];
  const pkg = assets.find((a) => a.name === `ts3-webinterface-${version}.tar.gz`) || assets.find((a) => a.name === 'ts3-webinterface-latest.tar.gz');
  const sha = pkg ? assets.find((a) => a.name === `${pkg.name}.sha256`) : null;
  return {
    version,
    name: r.name || `v${version}`,
    notes: typeof r.body === 'string' ? r.body.slice(0, 6000) : '',
    publishedAt: r.published_at || null,
    url: r.html_url || null,
    assetUrl: pkg?.browser_download_url || null,
    shaUrl: sha?.browser_download_url || null,
    size: pkg?.size || null,
  };
}

export async function checkSelfUpdate(force = false) {
  if (force || !state.checkedAt || Date.now() - state.checkedAt > 3600 * 1000) {
    try {
      state.latest = await fetchRelease(FEED_URL);
      state.checkError = null;
    } catch (e) {
      state.checkError = ts('selfupdate.log.checkFailed', { error: e.message });
    }
    state.checkedAt = Date.now();
  }
  return selfUpdateSummary();
}

/** Nach erfolgreichem Start: Update-Marker entfernen und Ergebnis festhalten. */
export async function confirmStartup() {
  if (!fs.existsSync(MARKER)) return;
  let marker = null;
  try { marker = JSON.parse(await fsp.readFile(MARKER, 'utf8')); } catch { /* ignore */ }
  await fsp.rm(MARKER, { force: true });
  if (marker) {
    const last = { ...marker, ok: true, confirmedAt: new Date().toISOString(), version: appVersion() };
    await fsp.writeFile(LAST_FILE, JSON.stringify(last, null, 2)).catch(() => {});
    console.log(`[selfupdate] update ${marker.from} → ${appVersion()} confirmed`);
  }
}

async function moveEntries(fromDir, toDir, names) {
  const moved = [];
  for (const name of names) {
    const src = path.join(fromDir, name);
    if (!fs.existsSync(src)) continue;
    await fsp.rename(src, path.join(toDir, name));
    moved.push(name);
  }
  return moved;
}

/**
 * Führt das Selbst-Update aus (asynchron, Fortschritt in selfUpdateSummary().running.steps).
 * Beendet den Prozess am Ende, damit systemd ihn mit der neuen Version neu startet.
 */
export async function runSelfUpdate({ version, username = 'system', restart } = {}) {
  const info = selfUpdateInfo();
  if (!info.canUpdate) throw new HttpError(400, `selfupdate.${info.reasons[0]}`);
  if (state.running) throw new HttpError(409, 'selfupdate.running');
  if ((await ts3UpdateSummary()).running) throw new HttpError(409, 'update.running');
  const b = backupState();
  if (b.running || b.restoring) throw new HttpError(409, 'backup.running');

  await checkSelfUpdate(false);
  let release = state.latest;
  const wanted = String(version || '').replace(/^v/, '').trim();
  if (wanted && wanted !== release?.version) {
    const url = TAG_URL(wanted);
    if (!url) throw new HttpError(400, 'selfupdate.badVersion');
    release = await fetchRelease(url).catch((e) => { throw new HttpError(404, 'selfupdate.releaseNotFound', { version: wanted, error: e.message }); });
  }
  if (!release?.assetUrl) throw new HttpError(404, 'selfupdate.noAsset', { version: release?.version || wanted || '?' });
  if (compareVersions(release.version, info.current) === 0) throw new HttpError(400, 'selfupdate.sameVersion', { version: release.version });
  const doRestart = restart ?? info.restartMode === 'systemd';

  state.running = { version: release.version, from: info.current, startedAt: new Date().toISOString(), steps: [], by: username, restart: doRestart };
  let swapped = false;
  let movedOut = [];
  let movedIn = [];
  try {
    log(ts('selfupdate.log.started', { from: info.current, to: release.version, user: username }));
    await fsp.rm(STAGE_DIR, { recursive: true, force: true });
    await fsp.mkdir(STAGE_DIR, { recursive: true });
    const archive = path.join(STAGE_DIR, 'package.tar.gz');
    log(ts('update.log.downloading', { url: release.assetUrl }));
    const size = await downloadFile(release.assetUrl, archive, { minBytes: 100 * 1024 });
    log(ts('update.log.downloaded', { mb: (size / 1048576).toFixed(1) }));
    if (release.shaUrl) {
      const shaFile = path.join(STAGE_DIR, 'package.sha256');
      const res = await fetch(release.shaUrl, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'ts3-webinterface' } });
      if (!res.ok) throw new Error(ts('update.log.downloadFailed', { status: res.status }));
      await fsp.writeFile(shaFile, await res.text());
      const expected = (await fsp.readFile(shaFile, 'utf8')).trim().split(/\s+/)[0];
      const actual = await sha256File(archive);
      if (!expected || expected.toLowerCase() !== actual.toLowerCase()) throw new Error(ts('update.log.checksumMismatch', { expected: expected || '?', got: actual }));
      log(ts('update.log.checksumOk'));
    } else {
      log(ts('update.log.noChecksum'));
    }
    const extractDir = path.join(STAGE_DIR, 'x');
    await fsp.mkdir(extractDir);
    await runCmd('tar', ['-xzf', archive, '-C', extractDir]);
    const inner = (await fsp.readdir(extractDir)).find((n) => fs.existsSync(path.join(extractDir, n, 'server', 'index.js')));
    if (!inner) throw new Error(ts('selfupdate.log.badPackage'));
    const newDir = path.join(extractDir, inner);
    const newVersion = (await fsp.readFile(path.join(newDir, 'VERSION'), 'utf8').catch(() => release.version)).trim();
    log(ts('selfupdate.log.extracted', { version: newVersion }));

    log(ts('selfupdate.log.npm'));
    const npmEnv = { ...process.env, npm_config_cache: path.join(STAGE_DIR, 'npm-cache'), HOME: process.env.HOME || STAGE_DIR };
    await runCmd(which('npm'), ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: newDir, env: npmEnv });
    if (!fs.existsSync(path.join(newDir, 'node_modules'))) throw new Error(ts('selfupdate.log.npmFailed'));
    log(ts('selfupdate.log.npmDone'));

    // Tausch: alte Dateien nach .previous/, neue aus dem Staging an ihren Platz (gleiches Dateisystem → rename)
    log(ts('selfupdate.log.swapping'));
    await fsp.rm(PREVIOUS_DIR, { recursive: true, force: true });
    await fsp.mkdir(PREVIOUS_DIR, { recursive: true });
    movedOut = await moveEntries(ROOT_DIR, PREVIOUS_DIR, ENTRIES);
    swapped = true;
    movedIn = await moveEntries(newDir, ROOT_DIR, await fsp.readdir(newDir));
    for (const exe of ['deploy/install.sh', 'deploy/ts3web']) await fsp.chmod(path.join(ROOT_DIR, exe), 0o755).catch(() => {});
    const marker = { from: info.current, to: newVersion, at: new Date().toISOString(), by: username, attempts: 0 };
    await fsp.writeFile(MARKER, JSON.stringify(marker));
    await fsp.rm(STAGE_DIR, { recursive: true, force: true });
    log(ts('selfupdate.log.installed', { version: newVersion, dir: '.previous/' }));

    state.lastResult = { ok: true, from: info.current, to: newVersion, finishedAt: new Date().toISOString(), steps: state.running.steps, restart: doRestart };
    await fsp.writeFile(LAST_FILE, JSON.stringify({ ...state.lastResult, steps: undefined }, null, 2)).catch(() => {});
    audit({ user: { username } }, 'selfupdate.run', { from: info.current, to: newVersion }, true);
    if (doRestart) {
      log(ts('selfupdate.log.restarting'));
      setTimeout(() => process.exit(0), 1500).unref();
    } else {
      log(ts('selfupdate.log.restartManually'));
    }
    return state.lastResult;
  } catch (e) {
    log(ts('update.log.error', { error: e.message }));
    if (swapped) {
      try {
        // Zurück: neue Dateien entfernen, alte aus .previous/ wiederherstellen
        for (const name of movedIn) await fsp.rm(path.join(ROOT_DIR, name), { recursive: true, force: true });
        await moveEntries(PREVIOUS_DIR, ROOT_DIR, movedOut);
        await fsp.rm(PREVIOUS_DIR, { recursive: true, force: true });
        await fsp.rm(MARKER, { force: true });
        log(ts('update.log.oldRestored'));
      } catch (re) {
        log(ts('update.log.rollbackFailed', { error: re.message }));
      }
    }
    await fsp.rm(STAGE_DIR, { recursive: true, force: true }).catch(() => {});
    state.lastResult = { ok: false, from: info.current, to: release.version, error: e.message, finishedAt: new Date().toISOString(), steps: state.running.steps };
    audit({ user: { username } }, 'selfupdate.run', { from: info.current, to: release.version, error: e.message }, false);
    throw e;
  } finally {
    if (!(state.lastResult?.ok && state.lastResult?.restart)) state.running = null;
  }
}
