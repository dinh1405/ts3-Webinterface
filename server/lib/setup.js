/**
 * Ersteinrichtung und Verbindungskonfiguration:
 *   - Setup-Zustand und Setup-Token (schützt den Assistenten, solange niemand angemeldet sein kann)
 *   - Erkennung der TeamSpeak-Installation (Prozesse, Pfade, systemd, Docker)
 *   - Prüfungen (Verzeichnis, Steuerung, ServerQuery, Backup-Ordner, Systemvoraussetzungen)
 *   - assistierter serveradmin-Passwort-Reset (nur Startskript/custom)
 *   - Anwenden der Konfiguration (data/config.json) ohne Neustart
 *
 * Alle Erkennungsfunktionen sind rein lesend und liefern auf Nicht-Linux-Systemen leere Ergebnisse statt Fehler.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { config, applyConfig, configSource, fileLayer, ROOT_DIR } from '../config.js';
import { HttpError } from './errors.js';
import { hasUsers, createUser, getUser } from './users.js';
import { getSettings, updateSettings } from './settings.js';
import { ts3, probeQuery } from './ts3.js';
import { buildCommand, runCommand, getProcessStatus, isConfigured, isControlBusy, pidAlive } from './process.js';
import * as watchdog from './watchdog.js';
import { audit } from './audit.js';
import { isLocale } from '../i18n/index.js';

const TOKEN_FILE = path.join(config.dataDir, 'setup-token');
const MAX_TOKEN_FAILURES = 10;
const IS_LINUX = process.platform === 'linux';

/* =========================== Zustand =========================== */

/** Kernkonfiguration vorhanden: Query-Passwort und (TS3-Verzeichnis oder Steuerung „none“). */
export function coreConfigured() {
  return Boolean(config.ts3.query.password) && (Boolean(config.ts3.dir) || config.ts3.controlMode === 'none');
}

export function needsSetup() {
  return !hasUsers() || !coreConfigured();
}

/* =========================== Setup-Token =========================== */

let token = null;
let tokenFailures = 0;

function writeTokenFile() {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  } catch (e) {
    console.warn('[setup] could not write setup token file:', e.message);
  }
}

/** Erzeugt (oder liest) das Setup-Token, solange die Einrichtung aussteht. */
export function ensureSetupToken() {
  if (!needsSetup()) return null;
  if (token) return token;
  try {
    const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (/^[a-f0-9]{48}$/.test(existing)) token = existing;
  } catch { /* neu erzeugen */ }
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    writeTokenFile();
  }
  console.log(`[setup] Setup pending. Open /setup in the browser and enter this setup token: ${token}`);
  console.log(`[setup] The token is also stored in ${TOKEN_FILE} (run "ts3web setup-token" or read the file as root).`);
  return token;
}

export function rotateSetupToken(reason = 'manual') {
  token = crypto.randomBytes(24).toString('hex');
  tokenFailures = 0;
  writeTokenFile();
  console.log(`[setup] Setup token rotated (${reason}). New token: ${token}`);
  return token;
}

export function clearSetupToken() {
  token = null;
  tokenFailures = 0;
  try { fs.rmSync(TOKEN_FILE, { force: true }); } catch { /* ignore */ }
}

export function verifySetupToken(candidate) {
  if (!token || typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate.trim());
  const b = Buffer.from(token);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    tokenFailures++;
    if (tokenFailures >= MAX_TOKEN_FAILURES) rotateSetupToken('too many failed attempts');
  } else tokenFailures = 0;
  return ok;
}

/** Middleware: solange Setup aussteht → Token-Pflicht (Header X-Setup-Token), danach → Recht system.manage. */
export function setupGuard(requireCap) {
  const capCheck = requireCap('system.manage');
  return (req, res, next) => {
    if (!needsSetup()) return capCheck(req, res, next);
    ensureSetupToken();
    if (!verifySetupToken(req.get('x-setup-token'))) return next(new HttpError(401, 'setup.tokenRequired'));
    req.setupMode = true;
    next();
  };
}

/* =========================== Hilfsfunktionen =========================== */

let passwdCache = null;
function uidName(uid) {
  if (uid === null || uid === undefined) return null;
  if (!passwdCache) {
    passwdCache = new Map();
    try {
      for (const line of fs.readFileSync('/etc/passwd', 'utf8').split('\n')) {
        const [name, , id] = line.split(':');
        if (name && id !== undefined) passwdCache.set(Number(id), name);
      }
    } catch { /* kein /etc/passwd */ }
  }
  return passwdCache.get(Number(uid)) || String(uid);
}

export function currentUser() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  let name = null;
  try { name = os.userInfo().username; } catch { name = uidName(uid); }
  return { uid, name, home: os.homedir() };
}

async function ownerInfo(p) {
  try {
    const st = await fsp.stat(p);
    const me = currentUser();
    return { uid: st.uid, gid: st.gid, name: uidName(st.uid), sameUser: me.uid === null ? null : st.uid === me.uid, mode: (st.mode & 0o777).toString(8) };
  } catch {
    return null;
  }
}

async function access(p, mode) {
  try { await fsp.access(p, mode); return true; } catch { return false; }
}
async function isFile(p) { try { return (await fsp.stat(p)).isFile(); } catch { return false; } }
async function isDir(p) { try { return (await fsp.stat(p)).isDirectory(); } catch { return false; } }

function which(bin) {
  const dirs = (process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* weiter */ }
  }
  return null;
}

async function run(cmd, args, timeoutMs = 8000) {
  if (!which(cmd) && !cmd.startsWith('/')) return { ok: false, stdout: '', stderr: `${cmd}: not found`, code: -1 };
  return runCommand({ cmd, args }, timeoutMs);
}

/** Einfache Glob-Erweiterung: nur `*` als ganzes Pfadsegment, begrenzte Trefferzahl. */
async function expandGlob(pattern, limit = 3000) {
  const segs = pattern.split('/').filter(Boolean);
  let paths = ['/'];
  for (const seg of segs) {
    const next = [];
    for (const base of paths) {
      if (seg === '*') {
        let entries = [];
        try { entries = await fsp.readdir(base, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith('.')) next.push(path.join(base, e.name));
          if (next.length > limit) break;
        }
      } else {
        const p = path.join(base, seg);
        if (await isDir(p)) next.push(p);
      }
    }
    paths = next;
    if (!paths.length) break;
  }
  return paths;
}

/* =========================== ini =========================== */

export async function parseIni(dir) {
  const file = path.join(dir, 'ts3server.ini');
  const out = { file, exists: false, values: {} };
  try {
    const text = await fsp.readFile(file, 'utf8');
    out.exists = true;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      out.values[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch { /* keine ini */ }
  const v = out.values;
  const protocols = (v.query_protocols || 'raw,ssh').split(',').map((s) => s.trim()).filter(Boolean);
  const logPath = v.logpath ? path.resolve(dir, v.logpath) : path.join(dir, 'logs');
  return {
    ...out,
    queryPort: parseInt(v.query_port, 10) || 10011,
    querySshPort: parseInt(v.query_ssh_port, 10) || 10022,
    queryProtocols: protocols,
    queryIp: v.query_ip || '0.0.0.0',
    voicePort: parseInt(v.default_voice_port, 10) || 9987,
    dbPlugin: v.dbplugin || 'ts3db_sqlite3',
    dbSqlPath: v.dbsqlpath || '',
    logPath,
    machineId: v.machine_id || '',
    skipBruteforceCheck: v.query_skipbruteforcecheck === '1',
  };
}

/* =========================== Erkennung =========================== */

async function readProcTs3() {
  if (!IS_LINUX) return [];
  const out = [];
  let pids = [];
  try { pids = (await fsp.readdir('/proc')).filter((n) => /^\d+$/.test(n)); } catch { return out; }
  for (const pid of pids) {
    let cmdline;
    try { cmdline = await fsp.readFile(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
    const argv = cmdline.split('\0').filter(Boolean);
    if (!argv.length || path.basename(argv[0]) !== 'ts3server') continue;
    const info = { pid: Number(pid), argv, uid: null, user: null, cwd: null, exe: null, unit: null, container: null };
    try {
      const status = await fsp.readFile(`/proc/${pid}/status`, 'utf8');
      const m = status.match(/^Uid:\s+(\d+)/m);
      if (m) { info.uid = Number(m[1]); info.user = uidName(info.uid); }
    } catch { /* ignore */ }
    try { info.cwd = await fsp.readlink(`/proc/${pid}/cwd`); } catch { /* EACCES bei fremdem Benutzer */ }
    try { info.exe = await fsp.readlink(`/proc/${pid}/exe`); } catch { /* ignore */ }
    if (!info.cwd && info.exe) info.cwd = path.dirname(info.exe);
    if (!info.cwd && path.isAbsolute(argv[0])) info.cwd = path.dirname(argv[0]);
    try {
      const cg = await fsp.readFile(`/proc/${pid}/cgroup`, 'utf8');
      const unit = cg.match(/\/([\w@.-]+\.service)/);
      if (unit && !/^(user|session|ssh|cron)/.test(unit[1])) info.unit = unit[1];
      const docker = cg.match(/docker[-/]([0-9a-f]{12,64})/);
      if (docker) info.container = docker[1].slice(0, 12);
    } catch { /* ignore */ }
    info.args = Object.fromEntries(argv.slice(1).filter((a) => a.includes('=')).map((a) => a.split('=')).map(([k, ...v]) => [k, v.join('=')]));
    if (info.args.serveradmin_password) info.args.serveradmin_password = '***';
    out.push(info);
  }
  return out;
}

async function detectSystemdUnits() {
  if (!IS_LINUX || !which('systemctl')) return [];
  const units = new Map();
  const r = await run('systemctl', ['list-units', '--type=service', '--all', '--plain', '--no-legend', '--no-pager']);
  if (r.ok) {
    for (const line of r.stdout.split('\n')) {
      const name = line.trim().split(/\s+/)[0];
      if (name && /teamspeak|ts3/i.test(name)) units.set(name, { name, active: /\bactive\b/.test(line) && !/inactive/.test(line) });
    }
  }
  // Unit-Dateien, die ts3server starten (auch wenn der Name nicht danach klingt)
  for (const dir of ['/etc/systemd/system', '/lib/systemd/system', '/usr/lib/systemd/system']) {
    let files = [];
    try { files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.service')); } catch { continue; }
    for (const f of files) {
      try {
        const text = await fsp.readFile(path.join(dir, f), 'utf8');
        if (!/ts3server/.test(text)) continue;
        const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() || null;
        const entry = units.get(f) || { name: f, active: null };
        Object.assign(entry, { file: path.join(dir, f), execStart: get('ExecStart'), workingDirectory: get('WorkingDirectory'), user: get('User') });
        units.set(f, entry);
      } catch { /* ignore */ }
    }
  }
  for (const u of units.values()) {
    const s = await run('systemctl', ['show', u.name, '-p', 'ActiveState,MainPID,User,WorkingDirectory,ExecStart']);
    if (s.ok) {
      const props = Object.fromEntries(s.stdout.split('\n').map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));
      u.active = props.ActiveState === 'active';
      u.pid = parseInt(props.MainPID, 10) || null;
      u.user = u.user || props.User || null;
      u.workingDirectory = u.workingDirectory || props.WorkingDirectory || null;
      if (!u.dir && props.ExecStart) {
        const m = props.ExecStart.match(/path=([^ ;]+)/);
        if (m) u.dir = path.dirname(m[1]);
      }
    }
    if (!u.dir && u.workingDirectory) u.dir = u.workingDirectory;
    if (!u.dir && u.execStart) {
      const m = u.execStart.match(/(\/\S+)\/(?:ts3server_startscript\.sh|ts3server_minimal_runscript\.sh|ts3server)\b/);
      if (m) u.dir = m[1];
    }
  }
  return [...units.values()];
}

async function detectDockerContainers() {
  if (!IS_LINUX || !which('docker')) return { available: false, containers: [] };
  const r = await run('docker', ['ps', '-a', '--format', '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}']);
  if (!r.ok) return { available: true, error: r.stderr.split('\n')[0] || 'docker not accessible', containers: [] };
  const containers = [];
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const [id, name, image, status] = line.split('|');
    if (!/teamspeak|ts3/i.test(`${image} ${name}`)) continue;
    const c = { id, name, image, status, running: /^Up/.test(status), mounts: [] };
    const m = await run('docker', ['inspect', '-f', '{{range .Mounts}}{{.Source}}:{{.Destination}};{{end}}', id]);
    if (m.ok) c.mounts = m.stdout.split(';').filter(Boolean).map((x) => { const [source, destination] = x.split(':'); return { source, destination }; });
    c.dataDir = c.mounts.find((x) => x.destination === '/var/ts3server')?.source || null;
    containers.push(c);
  }
  return { available: true, containers };
}

const SCAN_PATTERNS = ['/opt/*', '/opt/*/*', '/home/*', '/home/*/*', '/home/*/*/*', '/srv/*', '/srv/*/*', '/usr/local/*', '/var/lib/*', '/root/*'];

async function scanDirs() {
  if (!IS_LINUX) return [];
  const found = new Set();
  const home = os.homedir();
  const candidates = new Set([home, path.join(home, 'teamspeak3-server_linux_amd64')]);
  for (const p of SCAN_PATTERNS) for (const d of await expandGlob(p)) candidates.add(d);
  for (const d of candidates) {
    if (await isFile(path.join(d, 'ts3server'))) found.add(d);
  }
  return [...found];
}

/** Sammelt Kandidaten für das TS3-Verzeichnis aus Prozessen, systemd, Docker und Pfad-Scan. */
export async function detectInstallations() {
  const [processes, units, docker, scanned] = await Promise.all([readProcTs3(), detectSystemdUnits(), detectDockerContainers(), scanDirs()]);
  const byDir = new Map();
  const add = (dir, patch) => {
    if (!dir) return;
    const key = path.resolve(dir);
    const cur = byDir.get(key) || { dir: key, sources: [], running: false, pid: null, unit: null, container: null, user: null };
    Object.assign(cur, patch, { sources: [...new Set([...cur.sources, ...(patch.sources || [])])] });
    byDir.set(key, cur);
  };
  for (const p of processes) add(p.cwd, { sources: ['process'], running: true, pid: p.pid, user: p.user, unit: p.unit, container: p.container, args: p.args });
  for (const u of units) add(u.dir, { sources: ['systemd'], unit: u.name, running: u.active === true || undefined, user: u.user || undefined });
  for (const c of docker.containers) add(c.dataDir, { sources: ['docker'], container: c.name, running: c.running });
  for (const d of scanned) add(d, { sources: ['scan'] });
  const me = currentUser();
  const candidates = [];
  for (const c of byDir.values()) {
    const owner = await ownerInfo(c.dir);
    candidates.push({ ...c, owner, sameUser: owner ? owner.sameUser : null, exists: await isDir(c.dir) });
  }
  candidates.sort((a, b) => Number(b.running) - Number(a.running) || b.sources.length - a.sources.length || a.dir.localeCompare(b.dir));
  return { candidates, processes, units, docker, me, platform: process.platform };
}

/** Prüft ein TS3-Verzeichnis im Detail. */
export async function inspectDir(dir) {
  if (!path.isAbsolute(dir)) throw new HttpError(400, 'setup.absolutePath');
  const checks = [];
  const check = async (key, fn, { required = true } = {}) => {
    let r;
    try { r = await fn(); } catch (e) { r = { ok: false, detail: e.message }; }
    const entry = { key, required, ok: Boolean(r?.ok), detail: r?.detail ?? '' };
    checks.push(entry);
    return entry.ok;
  };
  const exists = await isDir(dir);
  if (!exists) return { dir, valid: false, exists: false, checks: [{ key: 'dirExists', required: true, ok: false, detail: '' }] };
  const owner = await ownerInfo(dir);
  const me = currentUser();
  const bin = path.join(dir, 'ts3server');
  await check('binary', async () => ({ ok: await isFile(bin) && await access(bin, fs.constants.X_OK), detail: bin }));
  await check('startScript', async () => ({ ok: await isFile(path.join(dir, 'ts3server_startscript.sh')) }), { required: false });
  const ini = await parseIni(dir);
  await check('ini', async () => ({ ok: ini.exists, detail: ini.exists ? `query ${ini.queryPort}, voice ${ini.voicePort}, ${ini.dbPlugin}` : '' }), { required: false });
  await check('logs', async () => ({ ok: await isDir(ini.logPath) && await access(ini.logPath, fs.constants.R_OK), detail: ini.logPath }), { required: false });
  const sqlite = ini.dbPlugin === 'ts3db_sqlite3';
  // Die SQLite-Datenbank liegt immer im Arbeitsverzeichnis des Servers (dbsqlpath enthält nur die SQL-Skripte).
  const dbFile = sqlite ? path.join(dir, 'ts3server.sqlitedb') : null;
  await check('database', async () => ({ ok: sqlite ? await isFile(dbFile) : true, detail: sqlite ? dbFile : ini.dbPlugin }), { required: false });
  let pid = null;
  try { pid = parseInt(await fsp.readFile(path.join(dir, 'ts3server.pid'), 'utf8'), 10) || null; } catch { /* keine pid */ }
  const running = pid ? pidAlive(pid) : false;
  await check('pid', async () => ({ ok: running, detail: pid ? String(pid) : '' }), { required: false });
  let allowlistHasLocal = null;
  for (const name of ['query_ip_allowlist.txt', 'query_ip_whitelist.txt']) {
    try {
      const text = await fsp.readFile(path.join(dir, name), 'utf8');
      allowlistHasLocal = /^\s*(127\.0\.0\.1|::1)\s*$/m.test(text);
      break;
    } catch { /* nächste */ }
  }
  await check('allowlist', async () => ({ ok: allowlistHasLocal !== false, detail: allowlistHasLocal === null ? 'missing' : '' }), { required: false });
  await check('writable', async () => ({ ok: await access(dir, fs.constants.W_OK) }), { required: false });
  await check('licenseAccepted', async () => ({ ok: await isFile(path.join(dir, '.ts3server_license_accepted')) }), { required: false });
  let version = null;
  try {
    const m = (await fsp.readFile(path.join(dir, 'CHANGELOG'), 'utf8')).match(/Server Release\s+(\d+(?:\.\d+)+)/);
    if (m) version = m[1];
  } catch { /* ignore */ }
  const valid = checks.filter((c) => c.required).every((c) => c.ok);
  return {
    dir, exists: true, valid, checks, version, owner, me,
    sameUser: owner ? owner.sameUser : null,
    running, pid,
    ini: { exists: ini.exists, queryPort: ini.queryPort, querySshPort: ini.querySshPort, queryProtocols: ini.queryProtocols, queryIp: ini.queryIp, voicePort: ini.voicePort, dbPlugin: ini.dbPlugin, logPath: ini.logPath, skipBruteforceCheck: ini.skipBruteforceCheck },
    suggested: {
      startScript: path.join(dir, 'ts3server_startscript.sh'),
      pidFile: path.join(dir, 'ts3server.pid'),
      logDir: ini.logPath,
      dbFile,
      queryHost: ini.queryIp && !['0.0.0.0', '::', ''].includes(ini.queryIp) ? ini.queryIp : '127.0.0.1',
      queryPort: ini.queryPort,
      serverPort: ini.voicePort,
    },
  };
}

/* =========================== Systemcheck =========================== */

async function diskFree(p) {
  try {
    const st = await fsp.statfs(p);
    return { free: Number(st.bavail) * Number(st.bsize), total: Number(st.blocks) * Number(st.bsize) };
  } catch {
    return null;
  }
}

export async function systemCheck() {
  const me = currentUser();
  const tools = {};
  for (const bin of ['sqlite3', 'tar', 'bzip2', 'sendmail', 'systemctl', 'docker', 'sudo', 'nginx', 'apache2', 'httpd']) tools[bin] = which(bin) || (bin === 'sendmail' && which('/usr/sbin/sendmail')) || null;
  const sudo = { available: Boolean(tools.sudo), rules: [] };
  if (tools.sudo && IS_LINUX) {
    const r = await run('sudo', ['-n', '-l'], 5000);
    if (r.ok) sudo.rules = r.stdout.split('\n').filter((l) => /NOPASSWD/.test(l)).map((l) => l.trim());
    else sudo.error = (r.stderr || r.stdout).split('\n')[0];
  }
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  const dirs = {};
  for (const [key, p] of [['dataDir', config.dataDir], ['backupDir', config.backupDir], ['ts3Dir', config.ts3.dir || null]]) {
    dirs[key] = p ? { path: p, exists: await isDir(p), writable: await access(p, fs.constants.W_OK), owner: await ownerInfo(p), disk: await diskFree(p) } : null;
  }
  return {
    platform: process.platform,
    os: IS_LINUX ? await osRelease() : { name: `${os.type()} ${os.release()}` },
    node: { version: process.versions.node, ok: nodeMajor >= 20 },
    user: me,
    isRoot: me.uid === 0,
    tools,
    sudo,
    dirs,
    plesk: IS_LINUX && fs.existsSync('/usr/local/psa/version'),
    configFile: { path: path.join(config.dataDir, 'config.json'), exists: fs.existsSync(path.join(config.dataDir, 'config.json')) },
    rootDir: ROOT_DIR,
  };
}

async function osRelease() {
  try {
    const text = await fsp.readFile('/etc/os-release', 'utf8');
    const get = (k) => text.match(new RegExp(`^${k}="?([^"\n]*)"?$`, 'm'))?.[1] || '';
    return { name: get('PRETTY_NAME') || get('NAME'), id: get('ID'), like: get('ID_LIKE') };
  } catch {
    return { name: 'Linux' };
  }
}

/* =========================== Prüfungen =========================== */

const controlModeSchema = z.enum(['script', 'systemd', 'docker', 'custom', 'none']);
const cmdSchema = z.string().max(500);
const absPath = z.string().max(500).refine((p) => p === '' || path.isAbsolute(p), 'setup.absolutePath');

export const draftSchema = z.object({
  publicUrl: z.string().max(300).optional(),
  trustProxy: z.boolean().optional(),
  mailFrom: z.string().max(200).nullable().optional(),
  backupDir: z.string().max(500).optional(),
  ts3: z.object({
    dir: absPath.optional(),
    controlMode: controlModeSchema.optional(),
    startScript: absPath.nullable().optional(),
    startArgs: z.array(z.string().regex(/^[A-Za-z0-9_=./:@,-]+$/)).max(20).optional(),
    pidFile: absPath.nullable().optional(),
    systemdUnit: z.string().max(100).regex(/^[\w@.-]*$/).optional(),
    dockerContainer: z.string().max(100).regex(/^[\w.-]*$/).optional(),
    useSudo: z.boolean().optional(),
    customCmd: z.object({ start: cmdSchema, stop: cmdSchema, restart: cmdSchema, status: cmdSchema }).partial().optional(),
    logDir: absPath.nullable().optional(),
    dbFile: absPath.nullable().optional(),
    sqlite3Bin: z.string().max(200).optional(),
    query: z.object({
      host: z.string().max(200).optional(),
      port: z.coerce.number().int().min(1).max(65535).optional(),
      protocol: z.enum(['raw', 'ssh']).optional(),
      username: z.string().max(100).optional(),
      password: z.string().max(200).optional(),
      nickname: z.string().max(30).optional(),
      serverPort: z.coerce.number().int().min(0).max(65535).optional(),
      serverId: z.coerce.number().int().min(0).optional(),
    }).partial().optional(),
  }).partial().optional(),
}).partial();

const MASK = '***';

/** Entwurf mit der aktiven Konfiguration zusammenführen (für Tests, ohne zu speichern). */
export function mergedTs3(draft = {}) {
  const t = structuredClone({ ...config.ts3, customCmd: { ...config.ts3.customCmd }, query: { ...config.ts3.query } });
  const d = draft.ts3 || {};
  for (const k of ['dir', 'controlMode', 'startScript', 'startArgs', 'pidFile', 'systemdUnit', 'dockerContainer', 'useSudo', 'logDir', 'dbFile', 'sqlite3Bin']) if (d[k] !== undefined && d[k] !== null) t[k] = d[k];
  Object.assign(t.customCmd, d.customCmd || {});
  Object.assign(t.query, d.query || {});
  if (t.query.password === MASK) t.query.password = config.ts3.query.password;
  const inTs3 = (name) => (t.dir ? path.join(t.dir, name) : '');
  if (!d.startScript && !configSource['ts3.startScript'].match(/file|env/)) t.startScript = inTs3('ts3server_startscript.sh');
  if (!d.pidFile && !configSource['ts3.pidFile'].match(/file|env/)) t.pidFile = inTs3('ts3server.pid');
  if (!d.logDir && !configSource['ts3.logDir'].match(/file|env/)) t.logDir = inTs3('logs');
  if (!d.dbFile && !configSource['ts3.dbFile'].match(/file|env/)) t.dbFile = inTs3('ts3server.sqlitedb');
  return t;
}

/** Aktuelle Konfiguration ohne Geheimnisse, mit Herkunft je Wert. */
export function maskedConfig() {
  return {
    publicUrl: config.publicUrl,
    trustProxy: config.trustProxy,
    mailFrom: config.mailFrom,
    backupDir: config.backupDir,
    ts3: {
      ...config.ts3,
      customCmd: { ...config.ts3.customCmd },
      query: { ...config.ts3.query, password: config.ts3.query.password ? MASK : '', passwordSet: Boolean(config.ts3.query.password) },
    },
    source: { ...configSource },
    envOnly: { host: config.host, port: config.port, dataDir: config.dataDir, sessionHours: config.sessionHours },
  };
}

export async function testControl(draft) {
  const t = mergedTs3(draft);
  const configured = isConfigured(t);
  const hints = [];
  const me = currentUser();
  const dirOwner = t.dir ? await ownerInfo(t.dir) : null;
  if (t.controlMode === 'script') {
    if (!(await isFile(t.startScript))) hints.push('startScriptMissing');
    if (dirOwner && dirOwner.sameUser === false) hints.push('scriptNeedsSameUser');
    if (!IS_LINUX) hints.push('linuxOnly');
  }
  if ((t.controlMode === 'systemd' || t.controlMode === 'docker') && me.uid !== 0 && !t.useSudo) hints.push(t.controlMode === 'docker' ? 'dockerNeedsGroupOrSudo' : 'systemdNeedsSudo');
  if (t.useSudo && IS_LINUX) {
    const r = await run('sudo', ['-n', '-l'], 5000);
    if (!r.ok) hints.push('sudoNotAllowed');
  }
  if (t.controlMode === 'none') hints.push('controlDisabled');
  const status = configured ? await getProcessStatus(t) : null;
  const command = buildCommand('start', t);
  return { configured, status, hints, command: command ? [command.cmd, ...command.args].join(' ') : null, me, dirOwner };
}

let lastProbeAt = 0;
export async function testQuery(query) {
  // Manager pausieren, damit kein paralleler Login-Versuch die TS3-Sperre auslöst
  await ts3.pause();
  // Schutz vor schnellen Wiederholungen (TS3 zählt fehlgeschlagene Logins)
  const since = Date.now() - lastProbeAt;
  if (since < 2000) await new Promise((r) => setTimeout(r, 2000 - since));
  lastProbeAt = Date.now();
  const q = { ...config.ts3.query, ...query };
  if (q.password === MASK) q.password = config.ts3.query.password;
  const result = await probeQuery(q);
  if (!result.ok && result.error.code === 'banned') throw new HttpError(429, 'setup.queryBanned', { seconds: result.error.retryAfterSec || 600 }, { code: 'banned', retryAfterSec: result.error.retryAfterSec });
  return result;
}

export async function testBackupDir(dir) {
  const p = path.resolve(ROOT_DIR, dir || 'backups');
  const exists = await isDir(p);
  let writable = false;
  let created = false;
  if (!exists) {
    try { await fsp.mkdir(p, { recursive: true }); created = true; } catch { /* nicht anlegbar */ }
  }
  if (await isDir(p)) {
    const probe = path.join(p, `.write-test-${process.pid}`);
    try { await fsp.writeFile(probe, 'ok'); await fsp.rm(probe, { force: true }); writable = true; } catch { writable = false; }
  }
  return { path: p, exists: exists || created, created, writable, disk: await diskFree(p), owner: await ownerInfo(p) };
}

/** Sucht das serveradmin-Passwort aus dem ersten Start im ältesten Instanz-Log. */
export async function findInitialPassword(dir) {
  const ini = await parseIni(dir);
  let files = [];
  try { files = (await fsp.readdir(ini.logPath)).filter((f) => /^ts3server_.*_0\.log$/.test(f)).sort(); } catch { /* keine Logs */ }
  for (const f of files.slice(0, 5)) {
    try {
      const text = await fsp.readFile(path.join(ini.logPath, f), 'utf8');
      const m = text.match(/loginname=\s*"([^"]+)",\s*password=\s*"([^"]+)"/);
      if (m) return { found: true, loginname: m[1], password: m[2], logFile: path.join(ini.logPath, f) };
    } catch { /* weiter */ }
  }
  return { found: false, searched: files.length, logPath: ini.logPath };
}

/* =========================== serveradmin-Reset =========================== */

let resetJob = null;
export function resetJobState(id) {
  if (!resetJob || (id && resetJob.id !== id)) return null;
  const { result, ...rest } = resetJob;
  return { ...rest, result: result ? { ...result, password: undefined, passwordAvailable: Boolean(result.password) } : null };
}
/** Das neue Passwort wird genau einmal herausgegeben (beim Übernehmen in den Entwurf). */
export function takeResetPassword(id) {
  if (!resetJob || resetJob.id !== id || !resetJob.result?.password) return null;
  const pw = resetJob.result.password;
  resetJob.result.password = null;
  return pw;
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const s = net.connect({ host, port, timeout: 1500 });
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => { s.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(attempt, 1000); });
      s.once('timeout', () => { s.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(attempt, 1000); });
    };
    attempt();
  });
}

function genPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(24), (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Startet den TS3-Server mit serveradmin_password=<neu> neu (nur Startskript-Modus), prüft den Login
 * und startet optional noch einmal normal, damit das Passwort nicht in der Prozessliste steht.
 */
export function startServerAdminReset(draft, { newPassword, restartToHide = true, username = 'system' } = {}) {
  const t = mergedTs3(draft);
  if (!IS_LINUX) throw new HttpError(400, 'setup.linuxOnly');
  if (t.controlMode !== 'script') throw new HttpError(400, 'setup.resetOnlyScript');
  if (!isConfigured(t)) throw new HttpError(400, 'setup.controlNotConfigured');
  if (isControlBusy()) throw new HttpError(409, 'setup.busy');
  if (resetJob && !resetJob.done) throw new HttpError(409, 'setup.busy');
  const password = newPassword || genPassword();
  if (!/^[A-Za-z0-9._-]{12,64}$/.test(password)) throw new HttpError(400, 'setup.badPassword');
  const job = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), done: false, ok: null, steps: [], result: null };
  resetJob = job;
  const step = (key, detail = '') => job.steps.push({ ts: new Date().toISOString(), key, detail });

  (async () => {
    watchdog.hold();
    await ts3.pause();
    ts3.expectDisconnect();
    try {
      step('stop');
      const stop = await runCommand(buildCommand('stop', t), 60000);
      if (!stop.ok) step('stopWarning', (stop.stderr || stop.stdout).slice(0, 300));
      let pid = null;
      try { pid = parseInt(await fsp.readFile(t.pidFile, 'utf8'), 10) || null; } catch { /* ignore */ }
      const deadline = Date.now() + 30000;
      while (pid && pidAlive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
      if (pid && pidAlive(pid)) throw new Error('process still running after stop');
      step('start');
      const child = spawn('/bin/sh', [t.startScript, 'start', ...t.startArgs, `serveradmin_password=${password}`], { cwd: t.dir || undefined, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      await new Promise((resolve) => { child.on('exit', resolve); child.on('error', resolve); setTimeout(resolve, 60000); });
      step('waitQuery', `${t.query.host}:${t.query.port}`);
      const up = await waitForPort(t.query.host || '127.0.0.1', Number(t.query.port) || 10011, 60000);
      if (!up) throw new Error(`ServerQuery port not reachable. ${out.slice(0, 300)}`);
      await new Promise((r) => setTimeout(r, 2000));
      step('verify');
      const probe = await probeQuery({ ...t.query, username: 'serveradmin', password });
      if (!probe.ok) throw new Error(`login with new password failed: ${probe.error.message}`);
      if (restartToHide) {
        step('restartPlain');
        await runCommand(buildCommand('stop', t), 60000);
        const d2 = Date.now() + 30000;
        let p2 = null;
        try { p2 = parseInt(await fsp.readFile(t.pidFile, 'utf8'), 10) || null; } catch { /* ignore */ }
        while (p2 && pidAlive(p2) && Date.now() < d2) await new Promise((r) => setTimeout(r, 1000));
        await runCommand(buildCommand('start', t), 60000);
        await waitForPort(t.query.host || '127.0.0.1', Number(t.query.port) || 10011, 60000);
      }
      job.result = { password, servers: probe.servers, version: probe.version };
      job.ok = true;
      step('done');
      audit({ user: { username } }, 'setup.reset-serveradmin', { restartToHide }, true);
    } catch (e) {
      job.ok = false;
      step('failed', e.message);
      audit({ user: { username } }, 'setup.reset-serveradmin', { error: e.message }, false);
      // Server nach Möglichkeit wieder normal starten
      try { await runCommand(buildCommand('start', t), 60000); } catch { /* ignore */ }
    } finally {
      job.done = true;
      job.finishedAt = new Date().toISOString();
      watchdog.release();
    }
  })();
  return job.id;
}

/* =========================== Anwenden =========================== */

/** Konfiguration (und beim ersten Mal Admin-Konto) übernehmen. */
export async function applySetup({ language, timezone, config: draft = {}, admin, actor } = {}) {
  const first = needsSetup();
  const clean = draftSchema.parse(draft);
  if (clean.ts3?.query?.password === MASK) delete clean.ts3.query.password;
  if (clean.ts3?.startArgs) clean.ts3.startArgs = clean.ts3.startArgs.filter(Boolean);
  const merged = mergedTs3(clean);
  if (first) {
    if (!merged.query.password) throw new HttpError(400, 'setup.passwordRequired');
    if (merged.controlMode !== 'none' && !merged.dir) throw new HttpError(400, 'setup.dirRequired');
  }
  let user = null;
  if (!hasUsers()) {
    if (!admin) throw new HttpError(400, 'setup.adminRequired');
    const created = await createUser({ username: admin.username, password: admin.password, displayName: admin.displayName, role: 'admin' });
    user = getUser(created.id);
  }
  const settingsPatch = {};
  if (language && isLocale(language)) settingsPatch.language = language;
  if (timezone && isValidTimezone(timezone)) settingsPatch.timezone = timezone;
  if (Object.keys(settingsPatch).length) await updateSettings(settingsPatch);
  if (first) clean.setup = { completedAt: new Date().toISOString(), completedBy: user?.username || actor || 'admin', wizardVersion: 1 };
  const { changed } = await applyConfig(clean);
  ts3.resume();
  if (changed.some((k) => k.startsWith('ts3.query'))) await ts3.reconfigure();
  if (!needsSetup()) clearSetupToken();
  return { user, changed, settings: getSettings() };
}

export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Kopiert die .env-Werte des TS3-Bereichs in config.json (Migration bestehender Installationen). */
export async function migrateEnvToFile() {
  const patch = { publicUrl: config.publicUrl, trustProxy: config.trustProxy, backupDir: path.relative(ROOT_DIR, config.backupDir) || 'backups', ts3: { ...config.ts3, customCmd: { ...config.ts3.customCmd }, query: { ...config.ts3.query } } };
  if (configSource.mailFrom !== 'default') patch.mailFrom = config.mailFrom;
  return applyConfig(patch);
}

export { fileLayer };
