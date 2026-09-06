import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import { ts3 } from './ts3.js';
import { getProcessStatus, controlServer } from './process.js';
import { createBackup } from './backup.js';
import * as watchdog from './watchdog.js';
import * as maintenance from './maintenance.js';
import { notify } from './notify.js';
import { audit } from './audit.js';
import { ts } from './locale.js';

const VERSIONS_URL = 'https://www.teamspeak.com/versions/server.json';
export const RELEASE_URL = (v) => `https://files.teamspeak-services.com/releases/server/${v}/teamspeak3-server_linux_amd64-${v}.tar.bz2`;
const PREVIOUS_DIR = '.previous-version';
// Dateien/Ordner, die zur Server-Software gehören (nicht zu Daten/Konfiguration)
const SOFTWARE_ENTRIES = ['ts3server', 'libts3_ssh.so', 'libts3db_mariadb.so', 'libts3db_postgresql.so', 'libts3db_sqlite3.so', 'redist', 'sql', 'serverquerydocs', 'doc', 'tsdns', 'CHANGELOG', 'LICENSE', '3RD_PARTY_LICENSES', 'ts3server_minimal_runscript.sh', 'ts3server_startscript.sh'];

const state = { checkedAt: null, current: null, latest: null, latestUrl: null, checksum: null, checkError: null, running: null, lastResult: null };

const log = (msg) => {
  if (state.running) state.running.steps.push({ ts: new Date().toISOString(), msg });
  console.log(`[update] ${msg}`);
};

function ts3Dir() {
  if (!config.ts3.dir || !fs.existsSync(config.ts3.dir)) throw new HttpError(400, 'update.noDir');
  return config.ts3.dir;
}

export function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export async function currentVersion() {
  try {
    const v = await ts3.get().version(true);
    if (v?.version) return String(v.version);
  } catch { /* offline → Changelog */ }
  try {
    const text = await fsp.readFile(path.join(ts3Dir(), 'CHANGELOG'), 'utf8');
    const m = text.match(/Server Release\s+(\d+(?:\.\d+)+)/);
    if (m) return m[1];
  } catch { /* ignore */ }
  return null;
}

async function previousVersion() {
  try {
    return (await fsp.readFile(path.join(ts3Dir(), PREVIOUS_DIR, 'VERSION'), 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

export async function updateSummary() {
  return {
    checkedAt: state.checkedAt,
    current: state.current,
    latest: state.latest,
    latestUrl: state.latestUrl,
    updateAvailable: Boolean(state.latest && state.current && compareVersions(state.latest, state.current) > 0),
    checkError: state.checkError,
    running: state.running,
    lastResult: state.lastResult,
    previousVersion: await previousVersion(),
    ts3Dir: config.ts3.dir,
  };
}

export async function checkForUpdate(force = false) {
  if (force || !state.checkedAt || Date.now() - state.checkedAt > 3600 * 1000) {
    state.current = await currentVersion();
    try {
      const latest = await fetchLatestRelease();
      state.latest = latest.version;
      state.checksum = latest.checksum;
      state.latestUrl = latest.url;
      state.checkError = null;
    } catch (e) {
      state.checkError = ts('update.log.checkFailed', { error: e.message });
    }
    state.checkedAt = Date.now();
  } else if (!state.current) {
    state.current = await currentVersion();
  }
  return updateSummary();
}

/** Neueste Linux-x86_64-Version laut TeamSpeak-Feed (Version, Download-URL, SHA-256). */
export async function fetchLatestRelease() {
  const res = await fetch(VERSIONS_URL, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'ts3-webinterface' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const entry = data?.linux?.x86_64;
  if (!entry?.version) throw new Error(ts('update.log.feedFormat'));
  const version = String(entry.version);
  return { version, checksum: entry.checksum || null, url: Object.values(entry.mirrors || {})[0] || RELEASE_URL(version) };
}

export function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], ...opts });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} Exit ${code}: ${stderr.trim()}`))));
  });
}

export async function downloadFile(url, dest, { minBytes = 1024 * 1024 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000), headers: { 'User-Agent': 'ts3-webinterface' } });
  if (!res.ok || !res.body) throw new Error(ts('update.log.downloadFailed', { status: res.status }));
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  const st = await fsp.stat(dest);
  if (st.size < minBytes) throw new Error(ts('update.log.downloadSmall', { bytes: st.size }));
  return st.size;
}

export async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function copyEntries(fromDir, toDir, entries, logPrefix) {
  for (const name of entries) {
    const src = path.join(fromDir, name);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(toDir, name);
    await fsp.rm(dst, { recursive: true, force: true });
    await fsp.cp(src, dst, { recursive: true, force: true });
  }
  for (const exe of ['ts3server', 'ts3server_startscript.sh', 'ts3server_minimal_runscript.sh']) {
    const p = path.join(toDir, exe);
    if (fs.existsSync(p)) await fsp.chmod(p, 0o755);
  }
  if (logPrefix) log(ts('update.log.entries', { prefix: logPrefix, count: entries.length }));
}

/**
 * Bewertet das Ergebnis nach dem Neustart: 'ok' nur, wenn der Server läuft, die Query verbunden ist
 * und die gemeldete Version dem Ziel entspricht; sonst 'mismatch' (andere Version) oder 'unverified'.
 */
export function classifyVersion(seen, target) {
  if (!seen) return 'unverified';
  return String(seen) === String(target) ? 'ok' : 'mismatch';
}

async function waitForVersion(expected, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (ts3.connected) {
      try {
        const v = await ts3.get().version(true);
        return String(v.version);
      } catch { /* noch nicht bereit */ }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

/**
 * Führt das Update aus. Läuft asynchron; Fortschritt über updateSummary().running.steps.
 */
export async function runUpdate({ version, username = 'system' }) {
  if (state.running) throw new HttpError(409, 'update.running');
  const dir = ts3Dir();
  const target = String(version || state.latest || '').trim();
  if (!/^\d+(\.\d+)+$/.test(target)) throw new HttpError(400, 'update.badVersion');
  const url = target === state.latest && state.latestUrl ? state.latestUrl : RELEASE_URL(target);
  const checksum = target === state.latest ? state.checksum : null;
  const lease = maintenance.acquire('ts3-update', { by: username, detail: target });
  state.running = { version: target, startedAt: new Date().toISOString(), steps: [], by: username };
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ts3update-'));
  let stopped = false;
  let copied = false;
  const oldVersion = state.current || (await currentVersion()) || 'unknown';
  try {
    log(ts('update.log.started', { from: oldVersion, to: target, user: username }));
    const archive = path.join(tmp, 'server.tar.bz2');
    log(ts('update.log.downloading', { url }));
    const size = await downloadFile(url, archive);
    log(ts('update.log.downloaded', { mb: (size / 1048576).toFixed(1) }));
    if (checksum) {
      const sum = await sha256File(archive);
      if (sum.toLowerCase() !== String(checksum).toLowerCase()) throw new Error(ts('update.log.checksumMismatch', { expected: checksum, got: sum }));
      log(ts('update.log.checksumOk'));
    } else {
      log(ts('update.log.noChecksum'));
    }
    const extractDir = path.join(tmp, 'x');
    await fsp.mkdir(extractDir);
    await runCmd('tar', ['-xjf', archive, '-C', extractDir]);
    const inner = (await fsp.readdir(extractDir)).find((n) => n.startsWith('teamspeak3-server'));
    if (!inner || !fs.existsSync(path.join(extractDir, inner, 'ts3server'))) throw new Error(ts('update.log.noBinary'));
    const newDir = path.join(extractDir, inner);
    log(ts('update.log.extracted'));

    const backup = await createBackup({ label: `pre-update-${oldVersion}`, trigger: 'pre-update', username, parent: lease.token });
    log(ts('update.log.backupDone', { id: backup.id }));

    await watchdog.withHold(async () => {
      const st = await getProcessStatus();
      if (st.running === true) {
        log(ts('update.log.stopping'));
        ts3.expectDisconnect();
        const r = await controlServer('stop');
        if (!r.ok) throw new Error(ts('update.log.stopFailed', { output: r.output }));
        stopped = true;
      }
      const prev = path.join(dir, PREVIOUS_DIR);
      await fsp.rm(prev, { recursive: true, force: true });
      await fsp.mkdir(prev, { recursive: true });
      await copyEntries(dir, prev, SOFTWARE_ENTRIES, ts('update.log.oldSaved', { version: oldVersion, dir: PREVIOUS_DIR }));
      await fsp.writeFile(path.join(prev, 'VERSION'), `${oldVersion}\n`);
      await copyEntries(newDir, dir, SOFTWARE_ENTRIES, ts('update.log.newInstalled', { version: target }));
      copied = true;
      log(ts('update.log.starting'));
      const r = await controlServer('start');
      if (!r.ok) throw new Error(ts('update.log.startFailed', { output: r.output }));
      ts3.connectSoon(3000);
      stopped = false;
    });

    const seen = await waitForVersion(target);
    const verdict = classifyVersion(seen, target);
    if (verdict === 'mismatch') log(ts('update.log.versionMismatch', { seen, target }));
    else if (verdict === 'unverified') log(ts('update.log.versionUnconfirmed'));
    else log(ts('update.log.runningVersion', { version: seen }));
    state.current = seen || state.current;
    if (verdict !== 'ok') {
      // Erst nach erfolgreicher Prüfung als Erfolg melden – sonst bleibt das Ergebnis „ungeprüft“ mit Rollback-Angebot
      log(ts('update.log.verifyFailed'));
      state.lastResult = { ok: false, state: verdict, seen, from: oldVersion, to: target, error: ts(verdict === 'mismatch' ? 'update.log.versionMismatch' : 'update.log.versionUnconfirmed', { seen: seen || '?', target }), finishedAt: new Date().toISOString(), steps: state.running.steps };
      audit(null, 'update.run', { by: username, from: oldVersion, to: target, state: verdict, seen }, false);
      notify('updateUnverified', { from: oldVersion, to: target, seen: seen || '?', user: username, backup: backup.id });
      return state.lastResult;
    }
    state.lastResult = { ok: true, state: 'ok', seen, from: oldVersion, to: target, finishedAt: new Date().toISOString(), steps: state.running.steps };
    audit(null, 'update.run', { by: username, from: oldVersion, to: target }, true);
    notify('updateDone', { from: oldVersion, to: target, user: username, backup: backup.id });
    return state.lastResult;
  } catch (e) {
    log(ts('update.log.error', { error: e.message }));
    if (copied) {
      try {
        log(ts('update.log.rollbackTry'));
        await copyEntries(path.join(dir, PREVIOUS_DIR), dir, SOFTWARE_ENTRIES, ts('update.log.oldRestored'));
      } catch (re) {
        log(ts('update.log.rollbackFailed', { error: re.message }));
      }
    }
    if (stopped) {
      try {
        const r = await controlServer('start');
        log(r.ok ? ts('update.log.startedAgain') : ts('update.log.startError', { error: r.output }));
        if (r.ok) ts3.connectSoon(3000);
      } catch (se) {
        log(ts('update.log.startError', { error: se.message }));
      }
    }
    state.lastResult = { ok: false, from: oldVersion, to: target, error: e.message, finishedAt: new Date().toISOString(), steps: state.running.steps };
    audit(null, 'update.run', { by: username, from: oldVersion, to: target, error: e.message }, false);
    notify('updateFailed', { to: target, error: e.message });
    throw e;
  } finally {
    state.running = null;
    maintenance.release(lease);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

export async function rollback({ username = 'system' }) {
  if (state.running) throw new HttpError(409, 'update.running');
  const dir = ts3Dir();
  const prevVersion = await previousVersion();
  if (!prevVersion) throw new HttpError(404, 'update.noPrevious');
  const lease = maintenance.acquire('ts3-rollback', { by: username, detail: prevVersion });
  state.running = { version: prevVersion, startedAt: new Date().toISOString(), steps: [], by: username, rollback: true };
  let stopped = false;
  try {
    log(ts('update.log.rollbackStarted', { version: prevVersion, user: username }));
    await watchdog.withHold(async () => {
      const st = await getProcessStatus();
      if (st.running === true) {
        ts3.expectDisconnect();
        const r = await controlServer('stop');
        if (!r.ok) throw new Error(ts('update.log.stopFailed', { output: r.output }));
        stopped = true;
        log(ts('update.log.stopped'));
      }
      await copyEntries(path.join(dir, PREVIOUS_DIR), dir, SOFTWARE_ENTRIES, ts('update.log.versionRestored', { version: prevVersion }));
      await fsp.rm(path.join(dir, PREVIOUS_DIR), { recursive: true, force: true });
      const r = await controlServer('start');
      if (!r.ok) throw new Error(ts('update.log.startFailed', { output: r.output }));
      ts3.connectSoon(3000);
      stopped = false;
      log(ts('update.log.startedOk'));
    });
    const seen = await waitForVersion(prevVersion);
    const verdict = classifyVersion(seen, prevVersion);
    if (verdict === 'mismatch') log(ts('update.log.versionMismatch', { seen, target: prevVersion }));
    else if (verdict === 'unverified') log(ts('update.log.versionUnconfirmed'));
    else log(ts('update.log.runningVersion', { version: seen }));
    state.current = seen || state.current;
    if (verdict !== 'ok') {
      log(ts('update.log.verifyFailed'));
      state.lastResult = { ok: false, state: verdict, seen, rollback: true, to: prevVersion, error: ts(verdict === 'mismatch' ? 'update.log.versionMismatch' : 'update.log.versionUnconfirmed', { seen: seen || '?', target: prevVersion }), finishedAt: new Date().toISOString(), steps: state.running.steps };
      audit(null, 'update.rollback', { by: username, to: prevVersion, state: verdict, seen }, false);
      notify('updateUnverified', { from: state.current || '?', to: prevVersion, seen: seen || '?', user: username, backup: '-' });
      return state.lastResult;
    }
    state.lastResult = { ok: true, state: 'ok', seen, rollback: true, to: prevVersion, finishedAt: new Date().toISOString(), steps: state.running.steps };
    audit(null, 'update.rollback', { by: username, to: prevVersion }, true);
    return state.lastResult;
  } catch (e) {
    log(ts('update.log.error', { error: e.message }));
    if (stopped) { try { await controlServer('start'); ts3.connectSoon(3000); } catch { /* ignore */ } }
    state.lastResult = { ok: false, rollback: true, to: prevVersion, error: e.message, finishedAt: new Date().toISOString(), steps: state.running.steps };
    audit(null, 'update.rollback', { by: username, to: prevVersion, error: e.message }, false);
    throw e;
  } finally {
    state.running = null;
    maintenance.release(lease);
  }
}
