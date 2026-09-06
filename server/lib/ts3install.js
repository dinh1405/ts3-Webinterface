/**
 * Installation eines TeamSpeak-3-Servers aus dem Einrichtungsassistenten heraus (nur Linux x86_64):
 *   Download der aktuellen Version von teamspeak.com → SHA-256-Prüfung → Entpacken ins Zielverzeichnis →
 *   ini/Allowlist/Lizenzdatei anlegen → erster Start mit zufälligem serveradmin-Passwort → Login prüfen →
 *   Privilege-Key aus dem Log lesen → normaler Neustart (Passwort verschwindet aus der Prozessliste).
 *
 * Läuft als Job mit Schrittprotokoll (wie der serveradmin-Reset); das Passwort wird genau einmal herausgegeben.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { HttpError } from './errors.js';
import { fetchLatestRelease, downloadFile, sha256File, runCmd, RELEASE_URL } from './update.js';
import { ts3, probeQuery } from './ts3.js';
import { runCommand, pidAlive } from './process.js';
import * as watchdog from './watchdog.js';
import * as maintenance from './maintenance.js';
import { audit } from './audit.js';
import { currentUser } from './setup.js';

const IS_LINUX = process.platform === 'linux';
const ARCH_OK = process.arch === 'x64';
/** Unterhalb dieser Wurzeln darf nicht installiert werden (Systemverzeichnisse). */
const FORBIDDEN_PREFIXES = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/proc', '/run', '/sbin', '/sys', '/usr', '/var/lib/dpkg', '/var/lib/apt', '/snap'];
/** Diese Pfade selbst sind keine gültigen Ziele (nur Unterverzeichnisse davon). */
const FORBIDDEN_EXACT = ['/', '/home', '/opt', '/srv', '/var', '/var/lib', '/tmp', '/root', '/mnt', '/media'];

function which(bin) {
  const dirs = (process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* weiter */ }
  }
  return null;
}

function normalizeDir(dir) {
  if (typeof dir !== 'string' || !dir.startsWith('/') || dir.includes('\0')) return null;
  const p = path.posix.normalize(dir).replace(/\/+$/, '') || '/';
  if (FORBIDDEN_EXACT.includes(p)) return null;
  if (FORBIDDEN_PREFIXES.some((f) => p === f || p.startsWith(`${f}/`))) return null;
  return p;
}

async function dirStatus(dir) {
  const p = normalizeDir(dir);
  if (!p) return { path: dir, ok: false, reason: 'forbidden', exists: false, empty: false, parentWritable: false };
  let exists = false; let empty = true;
  try {
    const st = await fsp.stat(p);
    exists = true;
    if (!st.isDirectory()) return { path: p, ok: false, reason: 'notDir', exists, empty: false, parentWritable: false };
    empty = (await fsp.readdir(p)).length === 0;
  } catch { /* existiert nicht */ }
  // Erstes existierendes Elternverzeichnis auf Schreibrecht prüfen
  let parent = exists ? p : path.dirname(p);
  while (!fs.existsSync(parent) && parent !== '/') parent = path.dirname(parent);
  let parentWritable = false;
  try { await fsp.access(parent, fs.constants.W_OK); parentWritable = true; } catch { /* nicht beschreibbar */ }
  const reason = !parentWritable ? 'parentNotWritable' : exists && !empty ? 'notEmpty' : null;
  return { path: p, ok: !reason, reason, exists, empty, parentWritable, parent };
}

function tcpInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 800 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
}
function udpInUse(port) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', () => { try { sock.close(); } catch { /* ignore */ } resolve(true); });
    sock.bind(port, () => { sock.close(); resolve(false); });
  });
}

let latestCache = { at: 0, value: null, error: null };
async function latestRelease() {
  if (Date.now() - latestCache.at < 10 * 60 * 1000 && (latestCache.value || latestCache.error)) return latestCache;
  try {
    latestCache = { at: Date.now(), value: await fetchLatestRelease(), error: null };
  } catch (e) {
    latestCache = { at: Date.now(), value: null, error: e.message };
  }
  return latestCache;
}

/** Voraussetzungen, Vorschlag für das Zielverzeichnis, Status eines gewünschten Verzeichnisses und der Ports. */
export async function installInfo({ dir, ports } = {}) {
  const me = currentUser();
  const isRoot = me.uid === 0;
  const tools = { tar: Boolean(which('tar')), bzip2: Boolean(which('bzip2')) };
  const reasons = [];
  if (!IS_LINUX) reasons.push('notLinux');
  if (!ARCH_OK) reasons.push('arch');
  if (!tools.tar) reasons.push('tar');
  if (!tools.bzip2) reasons.push('bzip2');
  let defaultDir = path.join(me.home || '/opt', 'teamspeak3-server');
  if (IS_LINUX) {
    try { await fsp.access('/opt', fs.constants.W_OK); defaultDir = '/opt/teamspeak3-server'; } catch { /* /opt nicht beschreibbar */ }
  }
  const latest = IS_LINUX && ARCH_OK ? await latestRelease() : { value: null, error: null };
  const out = { platform: process.platform, arch: process.arch, canInstall: reasons.length === 0, reasons, me, isRoot, defaultDir, tools, latest: latest.value, latestError: latest.error, running: Boolean(job && !job.done) };
  if (dir) out.dir = await dirStatus(dir);
  if (ports && typeof ports === 'object') {
    out.ports = {};
    for (const [name, port] of Object.entries(ports)) {
      const n = Number(port);
      if (!Number.isInteger(n) || n < 1 || n > 65535) continue;
      out.ports[name] = name === 'voice' ? await udpInUse(n) : await tcpInUse(n);
    }
  }
  return out;
}

/* =========================== Installations-Job =========================== */

let job = null;
export function installJobState(id) {
  if (!job || (id && job.id !== id)) return null;
  const { result, ...rest } = job;
  return { ...rest, result: result ? { ...result, password: undefined, passwordAvailable: Boolean(result.password) } : null };
}
export function takeInstallPassword(id) {
  if (!job || job.id !== id || !job.result?.password) return null;
  const pw = job.result.password;
  job.result.password = null;
  return pw;
}

function genPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(24), (b) => alphabet[b % alphabet.length]).join('');
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const s = net.connect({ host, port, timeout: 1500 });
      s.once('connect', () => { s.destroy(); resolve(true); });
      const retry = () => { s.destroy(); if (Date.now() > deadline) resolve(false); else setTimeout(attempt, 1000); };
      s.once('error', retry);
      s.once('timeout', retry);
    };
    attempt();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function iniContent({ voicePort, queryPort, filetransferPort }) {
  return [
    'machine_id=',
    `default_voice_port=${voicePort}`,
    'voice_ip=',
    'licensepath=',
    `filetransfer_port=${filetransferPort}`,
    'filetransfer_ip=',
    `query_port=${queryPort}`,
    'query_ip=',
    'query_ssh_port=10022',
    'query_ssh_ip=',
    'query_protocols=raw',
    'query_timeout=300',
    'query_ssh_rsa_host_key=ssh_host_rsa_key',
    'query_ip_allowlist=query_ip_allowlist.txt',
    'query_ip_denylist=query_ip_denylist.txt',
    'dbplugin=ts3db_sqlite3',
    'dbpluginparameter=',
    'dbsqlpath=sql/',
    'dbsqlcreatepath=create_sqlite/',
    'dbconnections=10',
    'dbclientkeepdays=30',
    'logpath=logs',
    'logquerycommands=0',
    'logappend=0',
    'query_skipbruteforcecheck=0',
    '',
  ].join('\n');
}

async function readPrivilegeKey(dir, output, attempts = 10) {
  const fromText = (text) => text.match(/token=([A-Za-z0-9+/=_-]{20,})/)?.[1] || null;
  for (let i = 0; i < attempts; i++) {
    const direct = fromText(output || '');
    if (direct) return direct;
    try {
      const files = (await fsp.readdir(path.join(dir, 'logs'))).filter((f) => /^ts3server_.*_1\.log$/.test(f)).sort();
      for (const f of files) {
        const key = fromText(await fsp.readFile(path.join(dir, 'logs', f), 'utf8'));
        if (key) return key;
      }
    } catch { /* noch keine Logs */ }
    await sleep(1500);
  }
  return null;
}

async function stopViaScript(dir, script, pidFile) {
  try { await runCommand({ cmd: '/bin/sh', args: [script, 'stop'], cwd: dir }, 60000); } catch { /* ignore */ }
  let pid = null;
  try { pid = parseInt(await fsp.readFile(pidFile, 'utf8'), 10) || null; } catch { /* keine PID-Datei */ }
  const deadline = Date.now() + 30000;
  while (pid && pidAlive(pid) && Date.now() < deadline) await sleep(1000);
  return !(pid && pidAlive(pid));
}

/**
 * Startet die Installation. Wirft bei ungültigen Voraussetzungen sofort; danach läuft alles asynchron im Job.
 */
export async function startInstall({ dir, version, acceptLicense, voicePort = 9987, queryPort = 10011, filetransferPort = 30033, username = 'setup' } = {}) {
  if (!IS_LINUX) throw new HttpError(400, 'setup.linuxOnly');
  if (!ARCH_OK) throw new HttpError(400, 'setup.install.archUnsupported', { arch: process.arch });
  if (acceptLicense !== true) throw new HttpError(400, 'setup.install.licenseRequired');
  for (const tool of ['tar', 'bzip2']) if (!which(tool)) throw new HttpError(400, 'setup.install.toolMissing', { tool });
  if (job && !job.done) throw new HttpError(409, 'setup.busy');
  if (version && !/^\d+(\.\d+)+$/.test(String(version))) throw new HttpError(400, 'setup.install.badVersion');
  const status = await dirStatus(dir);
  if (status.reason === 'forbidden' || status.reason === 'notDir') throw new HttpError(400, 'setup.install.badDir');
  if (status.reason === 'notEmpty') throw new HttpError(400, 'setup.install.dirNotEmpty');
  if (status.reason === 'parentNotWritable') throw new HttpError(400, 'setup.install.parentNotWritable', { dir: status.parent });
  // Belegte Ports vorab ablehnen: sonst würde der Login-Test gegen einen fremden Server laufen (und dort als Fehlversuch zählen)
  for (const [name, port] of [['query', queryPort], ['filetransfer', filetransferPort]]) {
    if (await tcpInUse(Number(port))) throw new HttpError(409, 'setup.install.portInUse', { name, port });
  }
  if (await udpInUse(Number(voicePort))) throw new HttpError(409, 'setup.install.portInUse', { name: 'voice', port: voicePort });
  const target = status.path;
  const password = genPassword();
  const startScript = path.join(target, 'ts3server_startscript.sh');
  const pidFile = path.join(target, 'ts3server.pid');
  const me = currentUser();

  const lease = maintenance.acquire('ts3-install', { by: username, detail: target });
  job = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), done: false, ok: null, steps: [], result: null, dir: target };
  const current = job;
  const step = (key, detail = '') => current.steps.push({ ts: new Date().toISOString(), key, detail });
  const createdDir = !status.exists;
  let started = false;

  (async () => {
    watchdog.hold();
    await ts3.pause();
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ts3install-'));
    try {
      step('resolve');
      const release = version ? { version: String(version), url: RELEASE_URL(version), checksum: null } : await fetchLatestRelease();
      current.steps[current.steps.length - 1].detail = release.version;

      step('prepare', target);
      await fsp.mkdir(target, { recursive: true, mode: 0o755 });

      step('download', release.url);
      const archive = path.join(tmp, 'server.tar.bz2');
      const size = await downloadFile(release.url, archive);
      current.steps[current.steps.length - 1].detail = `${(size / 1048576).toFixed(1)} MB`;

      if (release.checksum) {
        step('verify');
        const sum = await sha256File(archive);
        if (sum.toLowerCase() !== String(release.checksum).toLowerCase()) throw new Error(`checksum mismatch (expected ${release.checksum}, got ${sum})`);
      } else {
        step('noChecksum');
      }

      step('extract');
      const extractDir = path.join(tmp, 'x');
      await fsp.mkdir(extractDir);
      await runCmd('tar', ['-xjf', archive, '-C', extractDir]);
      const inner = (await fsp.readdir(extractDir)).find((n) => n.startsWith('teamspeak3-server'));
      if (!inner || !fs.existsSync(path.join(extractDir, inner, 'ts3server'))) throw new Error('archive does not contain ts3server');

      step('install', target);
      for (const name of await fsp.readdir(path.join(extractDir, inner))) {
        await fsp.cp(path.join(extractDir, inner, name), path.join(target, name), { recursive: true, force: true });
      }
      for (const exe of ['ts3server', 'ts3server_startscript.sh', 'ts3server_minimal_runscript.sh', 'tsdns/tsdnsserver']) {
        const p = path.join(target, exe);
        if (fs.existsSync(p)) await fsp.chmod(p, 0o755);
      }

      step('configure');
      await fsp.writeFile(path.join(target, '.ts3server_license_accepted'), '');
      await fsp.writeFile(path.join(target, 'ts3server.ini'), iniContent({ voicePort, queryPort, filetransferPort }), { mode: 0o640 });
      await fsp.writeFile(path.join(target, 'query_ip_allowlist.txt'), '127.0.0.1\n::1\n');
      await fsp.writeFile(path.join(target, 'query_ip_denylist.txt'), '');
      await fsp.mkdir(path.join(target, 'logs'), { recursive: true });

      step('firstStart');
      const child = spawn('/bin/sh', [startScript, 'start', 'inifile=ts3server.ini', `serveradmin_password=${password}`], { cwd: target, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TS3SERVER_LICENSE: 'accept' } });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      await new Promise((resolve) => { child.on('exit', resolve); child.on('error', resolve); setTimeout(resolve, 60000); });
      started = true;

      step('waitQuery', `127.0.0.1:${queryPort}`);
      const up = await waitForPort('127.0.0.1', queryPort, 90000);
      if (!up) throw new Error(`ServerQuery port not reachable. ${out.slice(0, 400)}`);
      await sleep(3000);

      step('login');
      const probe = await probeQuery({ host: '127.0.0.1', port: queryPort, protocol: 'raw', username: 'serveradmin', password });
      if (!probe.ok) throw new Error(`login failed: ${probe.error.message}`);

      step('privilegeKey');
      const privilegeKey = await readPrivilegeKey(target, out);
      if (!privilegeKey) step('privilegeKeyMissing');

      step('restartPlain');
      await stopViaScript(target, startScript, pidFile);
      await runCommand({ cmd: '/bin/sh', args: [startScript, 'start', 'inifile=ts3server.ini'], cwd: target }, 60000);
      await waitForPort('127.0.0.1', queryPort, 60000);

      current.result = { dir: target, version: probe.version?.version || release.version, voicePort, queryPort, filetransferPort, password, privilegeKey, servers: probe.servers, startScript, pidFile, user: me.name };
      current.ok = true;
      step('done');
      audit({ user: { username } }, 'setup.install-ts3', { dir: target, version: release.version }, true);
    } catch (e) {
      current.ok = false;
      step('failed', e.message);
      audit({ user: { username } }, 'setup.install-ts3', { dir: target, error: e.message }, false);
      if (started) await stopViaScript(target, startScript, pidFile);
      if (createdDir) {
        step('cleanup', target);
        try { await fsp.rm(target, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    } finally {
      current.done = true;
      current.finishedAt = new Date().toISOString();
      maintenance.release(lease);
      watchdog.release();
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  })();
  return current.id;
}
