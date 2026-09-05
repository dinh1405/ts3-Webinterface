/**
 * Konfiguration in drei Schichten: data/config.json (vom Setup-Assistenten geschrieben)
 * > .env (Umgebung) > eingebaute Standardwerte.
 *
 * `config` ist ein veränderliches Objekt, das bei `applyConfig()` **in place** aktualisiert wird,
 * damit alle Module, die `config` importiert haben, sofort die neuen Werte sehen.
 * Nur per .env setzbar (werden beim Start gebunden): HOST, PORT, JWT_SECRET, SESSION_HOURS,
 * LOGIN_RATE_*, DATA_DIR.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { JsonStore } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

dotenv.config({ path: process.env.ENV_FILE || path.join(ROOT_DIR, '.env'), quiet: true });

const env = (key) => {
  const v = process.env[key];
  return v === undefined || v === '' ? undefined : v;
};
const envBool = (key) => {
  const v = env(key);
  return v === undefined ? undefined : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};
const envInt = (key) => {
  const v = parseInt(env(key), 10);
  return Number.isFinite(v) ? v : undefined;
};

/* ---------- nur per Umgebung ---------- */
let jwtSecret = env('JWT_SECRET');
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(48).toString('hex');
  console.warn('[config] JWT_SECRET is not set – using a random secret; all sessions expire on every restart.');
}
const dataDir = path.resolve(ROOT_DIR, env('DATA_DIR') || 'data');

/* ---------- Standardwerte (Schicht 3) ---------- */
export const CONFIG_DEFAULTS = Object.freeze({
  publicUrl: '',
  trustProxy: false,
  mailFrom: null, // null = aus publicUrl ableiten
  backupDir: 'backups',
  ts3: {
    dir: '',
    controlMode: 'script', // script | systemd | docker | custom | none
    startScript: null, // null = <dir>/ts3server_startscript.sh
    startArgs: ['inifile=ts3server.ini'],
    pidFile: null, // null = <dir>/ts3server.pid
    systemdUnit: 'teamspeak3',
    dockerContainer: 'teamspeak',
    useSudo: false,
    customCmd: { start: '', stop: '', restart: '', status: '' },
    logDir: null, // null = <dir>/logs
    dbFile: null, // null = <dir>/ts3server.sqlitedb
    sqlite3Bin: 'sqlite3',
    query: {
      host: '127.0.0.1',
      port: 10011,
      protocol: 'raw', // raw | ssh
      username: 'serveradmin',
      password: '',
      nickname: 'Webinterface',
      serverPort: 9987,
      serverId: 0,
    },
  },
});

/* ---------- Umgebung (Schicht 2) ---------- */
function readEnvLayer() {
  const args = env('TS3_START_ARGS');
  return {
    publicUrl: env('PUBLIC_URL'),
    trustProxy: envBool('TRUST_PROXY'),
    mailFrom: env('MAIL_FROM'),
    backupDir: env('BACKUP_DIR'),
    ts3: {
      dir: env('TS3_DIR'),
      controlMode: env('TS3_CONTROL_MODE'),
      startScript: env('TS3_START_SCRIPT'),
      startArgs: args === undefined ? undefined : args.split(/\s+/).filter(Boolean),
      pidFile: env('TS3_PID_FILE'),
      systemdUnit: env('TS3_SYSTEMD_UNIT'),
      dockerContainer: env('TS3_DOCKER_CONTAINER'),
      useSudo: envBool('TS3_USE_SUDO'),
      customCmd: { start: env('TS3_CMD_START'), stop: env('TS3_CMD_STOP'), restart: env('TS3_CMD_RESTART'), status: env('TS3_CMD_STATUS') },
      logDir: env('TS3_LOG_DIR'),
      dbFile: env('TS3_DB_FILE'),
      sqlite3Bin: env('SQLITE3_BIN'),
      query: {
        host: env('TS3_QUERY_HOST'),
        port: envInt('TS3_QUERY_PORT'),
        protocol: env('TS3_QUERY_PROTOCOL'),
        username: env('TS3_QUERY_USER'),
        password: env('TS3_QUERY_PASSWORD'),
        nickname: env('TS3_QUERY_NICKNAME'),
        serverPort: envInt('TS3_SERVER_PORT'),
        serverId: envInt('TS3_SERVER_ID'),
      },
    },
  };
}

/* ---------- Datei (Schicht 1) ---------- */
export const CONFIG_FILE = path.join(dataDir, 'config.json');
const fileStore = new JsonStore(CONFIG_FILE, {});

function readFileLayer() {
  try {
    const d = fileStore.get();
    return d && typeof d === 'object' ? d : {};
  } catch (e) {
    console.warn(`[config] ${CONFIG_FILE} could not be read: ${e.message}`);
    return {};
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Wert und Quelle für einen Pfad ("ts3.query.port") ermitteln. */
function pick(pathKey, layers) {
  const parts = pathKey.split('.');
  for (const [name, layer] of layers) {
    let cur = layer;
    for (const p of parts) cur = isObj(cur) ? cur[p] : undefined;
    if (cur !== undefined && cur !== null) return { value: cur, source: name };
    if (cur === null && name === 'default') return { value: null, source: name };
  }
  return { value: undefined, source: 'default' };
}

function leafPaths(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isObj(v) && !Array.isArray(v)) out.push(...leafPaths(v, p));
    else out.push(p);
  }
  return out;
}

function setPath(obj, pathKey, value) {
  const parts = pathKey.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (!isObj(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function defaultMailFrom(publicUrl) {
  try {
    const host = new URL(publicUrl).hostname;
    if (/^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return `ts3@${host || 'localhost'}`;
    const parts = host.split('.');
    const domain = parts.length > 2 ? parts.slice(1).join('.') : host; // ts.example.org → example.org
    return `ts3@${domain}`;
  } catch {
    return `ts3@${process.env.HOSTNAME || 'localhost'}`;
  }
}

/** Herkunft jedes Konfigurationswerts: 'file' | 'env' | 'default' (Pfad → Quelle). */
export const configSource = {};

function build() {
  const layers = [['file', readFileLayer()], ['env', readEnvLayer()], ['default', CONFIG_DEFAULTS]];
  const out = {};
  for (const p of leafPaths(CONFIG_DEFAULTS)) {
    const { value, source } = pick(p, layers);
    setPath(out, p, value);
    configSource[p] = source;
  }
  // Abgeleitete Werte
  const inTs3 = (name) => (out.ts3.dir ? path.join(out.ts3.dir, name) : '');
  if (!out.ts3.startScript) out.ts3.startScript = inTs3('ts3server_startscript.sh');
  if (!out.ts3.pidFile) out.ts3.pidFile = inTs3('ts3server.pid');
  if (!out.ts3.logDir) out.ts3.logDir = inTs3('logs');
  if (!out.ts3.dbFile) out.ts3.dbFile = inTs3('ts3server.sqlitedb');
  if (!out.mailFrom) out.mailFrom = defaultMailFrom(out.publicUrl);
  out.backupDir = path.resolve(ROOT_DIR, out.backupDir || 'backups');
  if (!Array.isArray(out.ts3.startArgs)) out.ts3.startArgs = String(out.ts3.startArgs || '').split(/\s+/).filter(Boolean);
  return out;
}

/** Zusammengeführte Konfiguration – wird in place aktualisiert, Referenzen bleiben gültig. */
export const config = {
  host: env('HOST') || '127.0.0.1',
  port: envInt('PORT') ?? 8088,
  jwtSecret,
  sessionHours: envInt('SESSION_HOURS') ?? 12,
  dataDir,
  webDist: path.join(ROOT_DIR, 'web', 'dist'),
  loginRateLimit: {
    windowMs: (envInt('LOGIN_RATE_WINDOW_MIN') ?? 15) * 60 * 1000,
    max: envInt('LOGIN_RATE_MAX') ?? 10,
  },
  // Schichtwerte (werden von assign() gefüllt)
  publicUrl: '',
  trustProxy: false,
  mailFrom: '',
  backupDir: '',
  ts3: { customCmd: {}, query: {} },
};

function assign(next) {
  const { ts3: nextTs3, ...top } = next;
  Object.assign(config, top);
  const { customCmd, query, ...ts3Top } = nextTs3;
  Object.assign(config.ts3, ts3Top);
  Object.assign(config.ts3.customCmd, customCmd);
  Object.assign(config.ts3.query, query);
}
assign(build());

/** Hooks, die nach einer Änderung mit (config, geänderte Pfade) aufgerufen werden. */
export const reconfigureHooks = new Set();

/** Momentaufnahme aller Blattwerte (für Änderungserkennung). */
function snapshot() {
  const out = {};
  for (const p of leafPaths(CONFIG_DEFAULTS)) out[p] = pick(p, [['cfg', config]]).value;
  out['ts3.startArgs'] = JSON.stringify(config.ts3.startArgs);
  return out;
}

/**
 * Schreibt Änderungen in data/config.json, baut die Konfiguration neu auf und benachrichtigt Hooks.
 * `patch` hat die Form der Datei (Teilbaum), `null` löscht einen Wert (fällt auf .env/Default zurück).
 */
export async function applyConfig(patch) {
  const before = snapshot();
  await fileStore.update((d) => merge(d, patch));
  assign(build());
  const after = snapshot();
  const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  for (const hook of reconfigureHooks) {
    try {
      await hook(config, changed);
    } catch (e) {
      console.warn('[config] reconfigure hook failed:', e.message);
    }
  }
  return { changed };
}

function merge(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null) delete target[k];
    else if (isObj(v)) {
      if (!isObj(target[k])) target[k] = {};
      merge(target[k], v);
    } else target[k] = v;
  }
  return target;
}

/** Aktuelle Dateischicht (wie gespeichert, inkl. Passwort). */
export function fileLayer() {
  return structuredClone(readFileLayer());
}

export function configFileExists() {
  return fs.existsSync(CONFIG_FILE);
}

export default config;
