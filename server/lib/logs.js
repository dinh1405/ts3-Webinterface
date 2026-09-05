import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError } from './errors.js';

const MAX_READ_BYTES = 8 * 1024 * 1024; // beim Tail höchstens die letzten 8 MB lesen

function logDir() {
  const dir = config.ts3.logDir;
  if (!dir) throw new HttpError(400, 'logs.noDir');
  if (!fs.existsSync(dir)) throw new HttpError(404, 'logs.dirMissing', { dir });
  return dir;
}

export function safeLogPath(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+\.log$/.test(name) || name.includes('..')) {
    throw new HttpError(400, 'errors.invalidFileName');
  }
  const dir = logDir();
  const full = path.join(dir, name);
  if (path.dirname(full) !== dir) throw new HttpError(400, 'errors.invalidPath');
  if (!fs.existsSync(full)) throw new HttpError(404, 'logs.fileNotFound');
  return full;
}

function classify(name) {
  const m = name.match(/_(\d+)\.log$/);
  if (!m) return { kind: 'other', sid: null };
  const sid = parseInt(m[1], 10);
  return { kind: sid === 0 ? 'instance' : 'server', sid };
}

export async function listLogFiles() {
  const dir = logDir();
  const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.log'));
  const files = await Promise.all(
    names.map(async (name) => {
      const st = await fsp.stat(path.join(dir, name));
      return { name, size: st.size, mtime: st.mtime.toISOString(), ...classify(name) };
    }),
  );
  files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return { dir, files };
}

/**
 * TS3-Logzeile: "2026-08-22 15:20:10.692013|INFO    |ServerLibPriv |   |Nachricht"
 */
export function parseLogLine(line) {
  const parts = line.split('|');
  if (parts.length >= 5 && /^\d{4}-\d{2}-\d{2} /.test(parts[0])) {
    return {
      ts: parts[0].trim(),
      level: parts[1].trim(),
      channel: parts[2].trim(),
      sid: parts[3].trim(),
      msg: parts.slice(4).join('|').trim(),
      raw: line,
    };
  }
  return { ts: '', level: '', channel: '', sid: '', msg: line, raw: line };
}

export async function readLogTail(name, { lines = 500, q = '', level = '' } = {}) {
  const full = safeLogPath(name);
  const st = await fsp.stat(full);
  const start = Math.max(0, st.size - MAX_READ_BYTES);
  const fh = await fsp.open(full, 'r');
  let text;
  try {
    const buf = Buffer.alloc(st.size - start);
    await fh.read(buf, 0, buf.length, start);
    text = buf.toString('utf8');
  } finally {
    await fh.close();
  }
  let all = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (start > 0) all = all.slice(1); // erste (angeschnittene) Zeile verwerfen
  const truncated = start > 0;
  let parsed = all.map(parseLogLine);
  if (level) parsed = parsed.filter((l) => l.level.toUpperCase() === level.toUpperCase());
  if (q) {
    const needle = q.toLowerCase();
    parsed = parsed.filter((l) => l.raw.toLowerCase().includes(needle));
  }
  const totalMatching = parsed.length;
  parsed = parsed.slice(-lines);
  return { name, size: st.size, mtime: st.mtime.toISOString(), truncated, totalMatching, lines: parsed };
}
