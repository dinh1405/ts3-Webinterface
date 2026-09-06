import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ZipArchive } from 'archiver';
import extract from 'extract-zip';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import { controlServer, getProcessStatus } from './process.js';
import { ts3 } from './ts3.js';
import * as watchdog from './watchdog.js';
import * as maintenance from './maintenance.js';
import { ts, systemLocale } from './locale.js';

const CONFIG_FILES = [
  'ts3server.ini',
  'licensekey.dat',
  'query_ip_allowlist.txt',
  'query_ip_denylist.txt',
  'query_ip_whitelist.txt',
  'query_ip_blacklist.txt',
  'ssh_host_rsa_key',
  '.ts3server_license_accepted',
];

let running = null; // { id, startedAt, trigger }
let restoring = null; // { id, startedAt, steps }

export function backupState() {
  return { running, restoring };
}

function ts3Dir() {
  if (!config.ts3.dir) throw new HttpError(400, 'backup.noDir');
  if (!fs.existsSync(config.ts3.dir)) throw new HttpError(404, 'backup.dirMissing', { dir: config.ts3.dir });
  return config.ts3.dir;
}

export function backupDir() {
  fs.mkdirSync(config.backupDir, { recursive: true });
  return config.backupDir;
}

function snapshotDir() {
  const dir = path.join(config.backupDir, 'snapshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function safeId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(id) || id.includes('..')) {
    throw new HttpError(400, 'errors.invalidBackupId');
  }
  return id;
}

const pad = (n) => String(n).padStart(2, '0');
export function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

function execSimple(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, timeoutMs);
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Exit-Code ${code}`));
    });
  });
}

/* ---------------- SQLite ---------------- */

let nodeSqlite; // Modul, false = nicht verfügbar (Node < 22.16)
async function loadNodeSqlite() {
  if (nodeSqlite !== undefined) return nodeSqlite;
  try {
    const m = await import('node:sqlite');
    nodeSqlite = typeof m.backup === 'function' && typeof m.DatabaseSync === 'function' ? m : false;
  } catch {
    nodeSqlite = false;
  }
  return nodeSqlite;
}

/** Welche Sicherungsmethoden stehen zur Verfügung? (für Systemcheck und Tests) */
export async function sqliteBackupMethods() {
  const out = { nodeSqlite: Boolean(await loadNodeSqlite()), sqlite3: false };
  try {
    await execSimple(config.ts3.sqlite3Bin, ['-version'], 5000);
    out.sqlite3 = true;
  } catch { /* nicht installiert */ }
  return out;
}

async function backupWithNodeSqlite(db, dest) {
  const m = await loadNodeSqlite();
  if (!m) throw new Error('node:sqlite not available');
  const src = new m.DatabaseSync(db, { readOnly: true });
  try {
    await m.backup(src, dest);
  } finally {
    src.close();
  }
}

/** WAL der Kopie in die Hauptdatei überführen und leere -wal/-shm-Reste entfernen (Kopie = eine Datei). */
async function tidyWal(dest) {
  const m = await loadNodeSqlite();
  if (m) {
    try {
      const db = new m.DatabaseSync(dest);
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
    } catch { /* Kopie bleibt wie sie ist */ }
  }
  for (const suffix of ['-wal', '-shm']) {
    const p = dest + suffix;
    try {
      if ((await fsp.stat(p)).size === 0) await fsp.rm(p, { force: true });
    } catch { /* nicht vorhanden */ }
  }
}

/** PRAGMA integrity_check auf der Kopie: 'ok' | 'failed' | 'unchecked'. */
async function checkIntegrity(file, notes) {
  const m = await loadNodeSqlite();
  try {
    if (m) {
      const db = new m.DatabaseSync(file, { readOnly: true });
      try {
        const row = db.prepare('PRAGMA integrity_check').get();
        const result = String(row?.integrity_check ?? Object.values(row || {})[0] ?? '');
        if (result === 'ok') return 'ok';
        notes.push(ts('backup.note.integrityFailed', { detail: result.slice(0, 200) }));
        return 'failed';
      } finally {
        db.close();
      }
    }
    const out = await execCapture(config.ts3.sqlite3Bin, [file, 'PRAGMA integrity_check;'], 120000);
    if (out.trim() === 'ok') return 'ok';
    notes.push(ts('backup.note.integrityFailed', { detail: out.trim().slice(0, 200) }));
    return 'failed';
  } catch {
    return 'unchecked';
  }
}

function execCapture(cmd, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timeout')); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error(stderr.trim() || `Exit-Code ${code}`)); });
  });
}

export const DB_METHODS = ['node-sqlite', 'sqlite3', 'file-copy'];

/**
 * Konsistente Kopie der SQLite-Datenbank. Reihenfolge:
 *   1. node:sqlite Backup-API (Node ≥ 22.16, WAL-sicher, ohne Zusatzprogramm)
 *   2. sqlite3 .backup (CLI)
 *   3. Dateikopie – nur wenn der TS3-Prozess nachweislich nicht läuft; bei laufendem Server wäre die
 *      Kopie von db/-wal/-shm nacheinander nicht konsistent → Backup schlägt kontrolliert fehl.
 */
async function copySqlite(dest, notes, methods = DB_METHODS) {
  const db = config.ts3.dbFile;
  if (!db || !fs.existsSync(db)) {
    notes.push(ts('backup.note.noSqlite'));
    return 'none';
  }
  const errors = [];
  if (methods.includes('node-sqlite')) {
    try {
      await backupWithNodeSqlite(db, dest);
      const st = await fsp.stat(dest);
      if (st.size === 0) throw new Error('empty copy');
      return 'node-sqlite';
    } catch (e) {
      errors.push(`node:sqlite: ${e.message}`);
      await fsp.rm(dest, { force: true });
    }
  }
  if (methods.includes('sqlite3')) {
    try {
      await execSimple(config.ts3.sqlite3Bin, [db, `.backup "${dest.replace(/\\/g, '/')}"`]);
      const st = await fsp.stat(dest);
      if (st.size === 0) throw new Error('empty copy');
      return 'sqlite3-backup';
    } catch (e) {
      errors.push(`sqlite3: ${e.message}`);
      await fsp.rm(dest, { force: true });
    }
  }
  if (methods.includes('file-copy')) {
    const status = await getProcessStatus();
    if (status.running !== false) throw new HttpError(500, 'backup.dbInconsistent', { errors: errors.join('; ') || '-' });
    notes.push(ts('backup.note.sqliteFallback', { error: errors.join('; ') || '-' }));
    await fsp.copyFile(db, dest);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(db + suffix)) await fsp.copyFile(db + suffix, dest + suffix);
    }
    return 'file-copy';
  }
  throw new HttpError(500, 'backup.dbInconsistent', { errors: errors.join('; ') || '-' });
}

/**
 * Erstellt ein ZIP-Backup des TS3-Servers.
 */
export async function createBackup({ includeLogs = false, label = '', trigger = 'manual', username = 'system', parent = null, dbMethods = DB_METHODS } = {}) {
  if (running) throw new HttpError(409, 'backup.running');
  const dir = ts3Dir();
  const out = backupDir();
  const lease = maintenance.acquire('backup', { by: username, detail: trigger, parent });
  const labelSlug = slug(label);
  const id = `ts3-backup_${stamp()}${trigger === 'schedule' ? '_auto' : ''}${labelSlug ? `_${labelSlug}` : ''}`;
  const zipPath = path.join(out, `${id}.zip`);
  const metaPath = path.join(out, `${id}.json`);
  running = { id, startedAt: new Date().toISOString(), trigger };
  const started = Date.now();
  const notes = [];
  const contents = [];
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ts3bak-'));
  try {
    const dbCopy = path.join(tmp, 'ts3server.sqlitedb');
    const dbMethod = await copySqlite(dbCopy, notes, dbMethods);
    const dbIntegrity = dbMethod === 'none' ? null : await checkIntegrity(dbCopy, notes);
    if (dbMethod === 'node-sqlite' || dbMethod === 'sqlite3-backup') await tidyWal(dbCopy);
    const info = {
      id,
      createdAt: new Date().toISOString(),
      trigger,
      createdBy: username,
      label: String(label || '').slice(0, 80),
      includeLogs,
      dbMethod,
      dbIntegrity,
      ts3Dir: dir,
      ts3Version: null,
      contents,
      notes,
    };
    try {
      const v = await ts3.get().version();
      info.ts3Version = `${v.version} (${v.platform}, Build ${v.build})`;
    } catch {
      // Server offline – kein Problem
    }

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.on('warning', (w) => notes.push(ts('backup.note.warning', { message: w.message })));
      archive.pipe(output);

      if (dbMethod !== 'none') {
        archive.file(dbCopy, { name: 'ts3server.sqlitedb' });
        contents.push('ts3server.sqlitedb');
        for (const suffix of ['-wal', '-shm']) {
          if (fs.existsSync(dbCopy + suffix)) {
            archive.file(dbCopy + suffix, { name: `ts3server.sqlitedb${suffix}` });
            contents.push(`ts3server.sqlitedb${suffix}`);
          }
        }
      }
      for (const f of CONFIG_FILES) {
        const p = path.join(dir, f);
        if (fs.existsSync(p)) {
          archive.file(p, { name: f });
          contents.push(f);
        }
      }
      const filesDir = path.join(dir, 'files');
      if (fs.existsSync(filesDir)) {
        archive.directory(filesDir, 'files');
        contents.push('files/');
      }
      if (includeLogs && config.ts3.logDir && fs.existsSync(config.ts3.logDir)) {
        archive.directory(config.ts3.logDir, 'logs');
        contents.push('logs/');
      }
      archive.append(JSON.stringify(info, null, 2), { name: 'backup-info.json' });
      archive.finalize();
    });

    const st = await fsp.stat(zipPath);
    const meta = { ...info, size: st.size, durationMs: Date.now() - started };
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  } catch (e) {
    await fsp.rm(zipPath, { force: true });
    await fsp.rm(metaPath, { force: true });
    throw e;
  } finally {
    running = null;
    maintenance.release(lease);
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

export async function listBackups() {
  const out = backupDir();
  const names = (await fsp.readdir(out)).filter((n) => n.endsWith('.zip'));
  const backups = await Promise.all(
    names.map(async (name) => {
      const id = name.slice(0, -4);
      const zipPath = path.join(out, name);
      const st = await fsp.stat(zipPath);
      let meta = null;
      try {
        meta = JSON.parse(await fsp.readFile(path.join(out, `${id}.json`), 'utf8'));
      } catch {
        // kein Meta → z. B. manuell abgelegtes ZIP
      }
      return {
        id,
        size: st.size,
        createdAt: meta?.createdAt || st.mtime.toISOString(),
        trigger: meta?.trigger || 'unknown',
        createdBy: meta?.createdBy || '',
        label: meta?.label || '',
        includeLogs: Boolean(meta?.includeLogs),
        dbMethod: meta?.dbMethod || null,
        dbIntegrity: meta?.dbIntegrity || null,
        ts3Version: meta?.ts3Version || null,
        contents: meta?.contents || [],
        notes: meta?.notes || [],
        durationMs: meta?.durationMs ?? null,
      };
    }),
  );
  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return backups;
}

export function backupPath(id) {
  safeId(id);
  const p = path.join(backupDir(), `${id}.zip`);
  if (!fs.existsSync(p)) throw new HttpError(404, 'backup.notFound');
  return p;
}

export async function deleteBackup(id) {
  const p = backupPath(id);
  await fsp.rm(p, { force: true });
  await fsp.rm(path.join(backupDir(), `${id}.json`), { force: true });
}

/** Löscht die ältesten automatischen Backups, sodass höchstens `keep` übrig bleiben. */
export async function applyRetention(keep) {
  if (!keep || keep < 1) return [];
  const auto = (await listBackups()).filter((b) => b.trigger === 'schedule');
  const toDelete = auto.slice(keep);
  for (const b of toDelete) await deleteBackup(b.id);
  return toDelete.map((b) => b.id);
}

/** Registriert eine hochgeladene ZIP-Datei als Backup. */
export async function registerUploadedBackup(tmpFile, originalName, username) {
  const fh = await fsp.open(tmpFile, 'r');
  const head = Buffer.alloc(4);
  await fh.read(head, 0, 4, 0);
  await fh.close();
  if (head.toString('latin1', 0, 2) !== 'PK') {
    await fsp.rm(tmpFile, { force: true });
    throw new HttpError(400, 'backup.notZip');
  }
  const base = slug(path.basename(originalName || 'upload', '.zip')) || 'upload';
  const id = `ts3-backup_${stamp()}_upload_${base}`;
  const out = backupDir();
  await fsp.rename(tmpFile, path.join(out, `${id}.zip`));
  const st = await fsp.stat(path.join(out, `${id}.zip`));
  const meta = { id, createdAt: new Date().toISOString(), trigger: 'upload', createdBy: username, label: originalName, size: st.size, contents: [], notes: ['Hochgeladenes Backup'] };
  await fsp.writeFile(path.join(out, `${id}.json`), JSON.stringify(meta, null, 2));
  return meta;
}

/**
 * Stellt ein Backup wieder her: Sicherheitskopie → Server stoppen → Dateien zurückspielen → Server starten.
 */
export async function restoreBackup(id, { username = 'system' } = {}) {
  if (restoring) throw new HttpError(409, 'backup.restoring');
  if (running) throw new HttpError(409, 'backup.runningWait');
  const zipPath = backupPath(id);
  const dir = ts3Dir();
  const lease = maintenance.acquire('restore', { by: username, detail: id });
  const steps = [];
  const log = (msg) => steps.push({ ts: new Date().toISOString(), msg });
  restoring = { id, startedAt: new Date().toISOString(), steps };
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ts3restore-'));
  let wasRunning = false;
  watchdog.hold();
  try {
    log(ts('backup.log.extract', { id }));
    await extract(zipPath, { dir: tmp });
    const hasDb = fs.existsSync(path.join(tmp, 'ts3server.sqlitedb'));
    const hasFiles = fs.existsSync(path.join(tmp, 'files'));
    if (!hasDb && !hasFiles) throw new HttpError(400, 'backup.emptyArchive');

    log(ts('backup.log.safety'));
    const safety = await createBackup({ label: 'pre-restore', trigger: 'pre-restore', username, parent: lease.token });
    log(ts('backup.log.safetyDone', { id: safety.id }));

    const status = await getProcessStatus();
    wasRunning = status.running === true;
    if (wasRunning) {
      log(ts('backup.log.stopping'));
      ts3.expectDisconnect();
      const r = await controlServer('stop');
      if (!r.ok) throw new HttpError(500, 'backup.stopFailed', { output: r.output });
      log(ts('backup.log.stopped'));
    } else {
      log(ts('backup.log.notRunning'));
    }

    if (hasDb) {
      log(ts('backup.log.restoreDb'));
      const target = config.ts3.dbFile || path.join(dir, 'ts3server.sqlitedb');
      await fsp.copyFile(path.join(tmp, 'ts3server.sqlitedb'), target);
      for (const suffix of ['-wal', '-shm']) {
        await fsp.rm(target + suffix, { force: true });
        if (fs.existsSync(path.join(tmp, `ts3server.sqlitedb${suffix}`))) {
          await fsp.copyFile(path.join(tmp, `ts3server.sqlitedb${suffix}`), target + suffix);
        }
      }
    }
    if (hasFiles) {
      log(ts('backup.log.restoreFiles'));
      await fsp.cp(path.join(tmp, 'files'), path.join(dir, 'files'), { recursive: true, force: true });
    }
    for (const f of CONFIG_FILES) {
      const src = path.join(tmp, f);
      if (fs.existsSync(src)) {
        await fsp.copyFile(src, path.join(dir, f));
        log(ts('backup.log.restoredFile', { file: f }));
      }
    }

    if (wasRunning) {
      log(ts('backup.log.starting'));
      const r = await controlServer('start');
      if (!r.ok) throw new HttpError(500, 'backup.startFailed', { output: r.output });
      ts3.connectSoon(3000);
      log(ts('backup.log.started'));
    }
    log(ts('backup.log.done'));
    return { ok: true, steps, safetyBackup: safety.id, restartedServer: wasRunning };
  } catch (e) {
    log(ts('backup.log.error', { error: e.localized ? e.localized(systemLocale()) : e.message }));
    e.steps = steps;
    throw e;
  } finally {
    restoring = null;
    maintenance.release(lease);
    watchdog.release();
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

/* ---------------- ServerQuery-Snapshots (virtueller Server) ---------------- */

export async function createSnapshot({ username = 'system' } = {}) {
  const ts = ts3.get();
  const res = await ts.createSnapshot();
  let serverName = '';
  try {
    serverName = (await ts.serverInfo()).virtualserverName;
  } catch { /* ignore */ }
  const id = `snapshot_${stamp()}`;
  const data = {
    id,
    createdAt: new Date().toISOString(),
    createdBy: username,
    serverName,
    version: res.version ?? null,
    salt: res.salt ?? null,
    snapshot: res.snapshot,
  };
  await fsp.writeFile(path.join(snapshotDir(), `${id}.json`), JSON.stringify(data, null, 2));
  return snapshotMeta(data, JSON.stringify(data).length);
}

function snapshotMeta(d, size) {
  return { id: d.id, createdAt: d.createdAt, createdBy: d.createdBy, serverName: d.serverName, version: d.version, size };
}

export async function listSnapshots() {
  const dir = snapshotDir();
  const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json'));
  const list = [];
  for (const n of names) {
    try {
      const st = await fsp.stat(path.join(dir, n));
      const d = JSON.parse(await fsp.readFile(path.join(dir, n), 'utf8'));
      list.push(snapshotMeta(d, st.size));
    } catch { /* defekte Datei ignorieren */ }
  }
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list;
}

export function snapshotPath(id) {
  safeId(id);
  const p = path.join(snapshotDir(), `${id}.json`);
  if (!fs.existsSync(p)) throw new HttpError(404, 'backup.snapshotNotFound');
  return p;
}

export async function deleteSnapshot(id) {
  await fsp.rm(snapshotPath(id), { force: true });
}

export async function deploySnapshot({ id, data }) {
  const ts = ts3.get();
  let payload = data;
  if (!payload && id) payload = JSON.parse(await fsp.readFile(snapshotPath(id), 'utf8'));
  if (!payload?.snapshot) throw new HttpError(400, 'backup.noSnapshot');
  await ts.deploySnapshot(
    payload.snapshot,
    payload.salt || undefined,
    undefined,
    undefined,
    payload.version !== undefined && payload.version !== null ? String(payload.version) : undefined,
  );
}
