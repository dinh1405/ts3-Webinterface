/**
 * Client-Historie: verfolgt Sitzungen, Nicknames, IPs und Kanalwechsel je Identität (UID).
 *
 * Datenhaltung in data/history/:
 *   identities.json        – ein Datensatz je UID (Nicknames, IPs, Länder, Summen, Notizen)
 *   open.json              – aktuell offene Sitzungen (überlebt einen Neustart des Webinterfaces)
 *   sessions-YYYY-MM.jsonl – abgeschlossene Sitzungen (append-only, monatsweise)
 *   events-YYYY-MM.jsonl   – Nickname-Wechsel, Kanalwechsel, Kicks/Bans (append-only)
 *
 * Quelle sind die ServerQuery-Ereignisse (connect/disconnect/moved) plus ein Abgleich
 * mit der Clientliste alle 60 s, der verpasste Ereignisse und Nickname-Änderungen nachträgt.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { ts3 } from './ts3.js';
import { getSettings } from './settings.js';

const dir = path.join(config.dataDir, 'history');
const identitiesFile = path.join(dir, 'identities.json');
const openFile = path.join(dir, 'open.json');
const RECONCILE_MS = 60 * 1000;
const FLUSH_MS = 5000;
const MAX_NOTES = 200;
const MAX_VARIANTS = 100; // Nicknames/IPs je Identität

const REASONS = {
  0: 'disconnected', 1: 'moved', 3: 'connection lost', 4: 'kicked from channel', 5: 'kicked from server', 6: 'banned',
  8: 'disconnected', 10: 'server shutdown', 11: 'server stopped',
};

const monthKey = (t) => new Date(t).toISOString().slice(0, 7);
const sessionsFile = (t) => path.join(dir, `sessions-${monthKey(t)}.jsonl`);
const eventsFile = (t) => path.join(dir, `events-${monthKey(t)}.jsonl`);

/** @type {Map<string, object>} uid → Identität */
let identities = new Map();
/** @type {Map<string, object>} clid → offene Sitzung */
let open = new Map();
let dirty = false;
let started = false;
let reconciling = false;
let appendQueue = Promise.resolve();

/* ---------- Persistenz ---------- */

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

async function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    await writeAtomic(identitiesFile, { savedAt: Date.now(), identities: [...identities.values()] });
    await writeAtomic(openFile, { savedAt: Date.now(), sessions: [...open.values()] });
  } catch (e) {
    dirty = true;
    console.warn('[history] save failed:', e.message);
  }
}

function appendLine(file, row) {
  appendQueue = appendQueue.then(() => fsp.appendFile(file, `${JSON.stringify(row)}\n`)).catch((e) => console.warn('[history] append failed:', e.message));
  return appendQueue;
}

async function readJsonl(prefix, sinceMonth) {
  const rows = [];
  const files = (await fsp.readdir(dir).catch(() => []))
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.jsonl') && (!sinceMonth || f.slice(prefix.length + 1, prefix.length + 8) >= sinceMonth))
    .sort();
  for (const f of files) {
    const text = await fsp.readFile(path.join(dir, f), 'utf8').catch(() => '');
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { rows.push(JSON.parse(line)); } catch { /* defekte Zeile */ }
    }
  }
  return rows;
}

/* ---------- Identitäten ---------- */

function touchVariant(map, key, t) {
  if (!key) return;
  const cur = map[key];
  if (cur) {
    cur.last = t;
    cur.count += 1;
  } else {
    if (Object.keys(map).length >= MAX_VARIANTS) {
      // Ältesten Eintrag verdrängen
      const oldest = Object.entries(map).sort((a, b) => a[1].last - b[1].last)[0];
      if (oldest) delete map[oldest[0]];
    }
    map[key] = { first: t, last: t, count: 1 };
  }
}

function identityFor(uid, t) {
  let id = identities.get(uid);
  if (!id) {
    id = { uid, cldbid: null, nickname: '', nicknames: {}, ips: {}, countries: {}, firstSeen: t, lastSeen: t, sessions: 0, onlineSec: 0, version: '', platform: '', notes: [] };
    identities.set(uid, id);
  }
  return id;
}

function observe(uid, info, t) {
  const id = identityFor(uid, t);
  id.lastSeen = Math.max(id.lastSeen || 0, t);
  if (info.cldbid) id.cldbid = String(info.cldbid);
  if (info.nickname && info.nickname !== id.nickname) {
    id.nickname = info.nickname;
    touchVariant(id.nicknames, info.nickname, t);
  } else if (info.nickname && !id.nicknames[info.nickname]) touchVariant(id.nicknames, info.nickname, t);
  if (info.ip) {
    if (!id.ips[info.ip]) touchVariant(id.ips, info.ip, t); else id.ips[info.ip].last = t;
  }
  if (info.country) id.countries[info.country] = (id.countries[info.country] || 0) + 1;
  if (info.version) id.version = info.version;
  if (info.platform) id.platform = info.platform;
  dirty = true;
  return id;
}

/* ---------- Sitzungen ---------- */

function clientFields(c) {
  return {
    clid: String(c.clid),
    uid: c.uniqueIdentifier || c.uid,
    cldbid: c.databaseId != null ? String(c.databaseId) : null,
    nickname: c.nickname,
    ip: c.connectionClientIp || c.ip || '',
    country: c.country || '',
    version: c.version || '',
    platform: c.platform || '',
    cid: c.cid != null ? String(c.cid) : null,
  };
}

function openSession(f, connectedAt) {
  if (!f.uid || open.has(f.clid)) return;
  const t = Date.now();
  const s = { id: crypto.randomUUID(), clid: f.clid, uid: f.uid, cldbid: f.cldbid, nickname: f.nickname, ip: f.ip, country: f.country, version: f.version, platform: f.platform, connectedAt: connectedAt || t, cid: f.cid, moves: 0 };
  open.set(f.clid, s);
  observe(f.uid, f, t);
  dirty = true;
}

async function closeSession(clid, { at = Date.now(), reasonid = null, reasonmsg = '', invoker = '' } = {}) {
  const s = open.get(clid);
  if (!s) return;
  open.delete(clid);
  const durationSec = Math.max(0, Math.round((at - s.connectedAt) / 1000));
  const reason = reasonid === null || reasonid === undefined ? 'unknown' : (REASONS[reasonid] || `reason ${reasonid}`);
  const row = { id: s.id, uid: s.uid, cldbid: s.cldbid, nickname: s.nickname, ip: s.ip, country: s.country, version: s.version, platform: s.platform, connectedAt: s.connectedAt, disconnectedAt: at, durationSec, reasonid, reason, reasonmsg: reasonmsg || '', invoker: invoker || '', lastCid: s.cid, moves: s.moves };
  const id = identities.get(s.uid);
  if (id) {
    id.sessions += 1;
    id.onlineSec += durationSec;
    id.lastSeen = Math.max(id.lastSeen || 0, at);
  }
  dirty = true;
  await appendLine(sessionsFile(at), row);
  if (reasonid === 5 || reasonid === 6) {
    await appendLine(eventsFile(at), { t: at, uid: s.uid, type: reasonid === 6 ? 'ban' : 'kick', nickname: s.nickname, by: invoker || '', msg: reasonmsg || '' });
  }
}

/* ---------- Ereignisse ---------- */

function onConnect(ev) {
  const c = ev?.client;
  if (!c || Number(c.type) === 1) return;
  const f = clientFields(c);
  const connectedAt = c.lastconnected ? Number(c.lastconnected) * 1000 : Date.now();
  openSession(f, Math.min(connectedAt, Date.now()));
}

function onDisconnect(ev) {
  const clid = String(ev?.event?.clid ?? ev?.client?.clid ?? '');
  if (!clid) return;
  const e = ev.event || {};
  closeSession(clid, { reasonid: e.reasonid !== undefined ? Number(e.reasonid) : 8, reasonmsg: e.reasonmsg || '', invoker: e.invokername || '' });
}

function onMoved(ev) {
  const c = ev?.client;
  if (!c) return;
  const clid = String(c.clid);
  const s = open.get(clid);
  const toCid = ev.channel?.cid != null ? String(ev.channel.cid) : null;
  if (!s) {
    if (Number(c.type) !== 1) openSession(clientFields(c), c.lastconnected ? Number(c.lastconnected) * 1000 : Date.now());
    return;
  }
  const from = s.cid;
  s.cid = toCid;
  s.moves += 1;
  dirty = true;
  const invoker = ev.invoker?.nickname || '';
  appendLine(eventsFile(Date.now()), { t: Date.now(), uid: s.uid, type: 'move', nickname: s.nickname, from, to: toCid, toName: ev.channel?.name || '', by: invoker, reasonid: ev.reasonid !== undefined ? Number(ev.reasonid) : null });
}

/** Abgleich mit der Clientliste: verpasste Verbindungen/Trennungen und Nickname-Wechsel nachtragen. */
async function reconcile(initial = false) {
  if (reconciling || !ts3.connected) return;
  reconciling = true;
  try {
    const list = await ts3.get().clientList({ clientType: 0 });
    const now = Date.now();
    const seen = new Set();
    for (const c of list) {
      const f = clientFields(c);
      if (!f.uid) continue;
      seen.add(f.clid);
      const s = open.get(f.clid);
      if (!s) {
        openSession(f, c.lastconnected ? Number(c.lastconnected) * 1000 : now);
        continue;
      }
      if (s.uid !== f.uid) {
        // clid wurde wiederverwendet: alte Sitzung schließen, neue öffnen
        await closeSession(f.clid, { at: now, reasonid: null });
        openSession(f, c.lastconnected ? Number(c.lastconnected) * 1000 : now);
        continue;
      }
      if (f.nickname && f.nickname !== s.nickname) {
        await appendLine(eventsFile(now), { t: now, uid: s.uid, type: 'nick', from: s.nickname, to: f.nickname });
        s.nickname = f.nickname;
        observe(s.uid, { nickname: f.nickname }, now);
      }
      if (f.ip && f.ip !== s.ip) { s.ip = f.ip; observe(s.uid, { ip: f.ip }, now); }
      if (f.cid && f.cid !== s.cid) s.cid = f.cid;
      if (!s.cldbid && f.cldbid) { s.cldbid = f.cldbid; observe(s.uid, { cldbid: f.cldbid }, now); }
      const id = identities.get(s.uid);
      if (id) { id.lastSeen = now; dirty = true; }
    }
    for (const clid of [...open.keys()]) {
      if (!seen.has(clid)) await closeSession(clid, { at: initial ? (open.get(clid).lastSavedAt || now) : now, reasonid: initial ? null : 8 });
    }
  } catch (e) {
    console.warn('[history] reconcile failed:', e.message);
  } finally {
    reconciling = false;
  }
}

/* ---------- Start / Aufräumen ---------- */

export function startHistory() {
  if (started) return;
  started = true;
  fs.mkdirSync(dir, { recursive: true });
  const saved = loadJson(identitiesFile, { identities: [] });
  identities = new Map((saved.identities || []).map((i) => [i.uid, { notes: [], ...i }]));
  const savedOpen = loadJson(openFile, { savedAt: 0, sessions: [] });
  // Beim letzten Lauf offene Sitzungen: Endzeitpunkt bestenfalls der letzte Speicherzeitpunkt
  open = new Map((savedOpen.sessions || []).map((s) => [s.clid, { ...s, lastSavedAt: savedOpen.savedAt || s.connectedAt }]));

  ts3.on('raw', (name, ev) => {
    if (name === 'clientconnect') onConnect(ev);
    else if (name === 'clientdisconnect') onDisconnect(ev);
    else if (name === 'clientmoved') onMoved(ev);
  });
  ts3.on('status', (s) => {
    if (s.connected) setTimeout(() => reconcile(true), 1500).unref?.();
  });
  if (ts3.connected) setTimeout(() => reconcile(true), 1500).unref?.();
  else if (open.size) {
    // Query aktuell getrennt: Altlasten schließen, sobald wieder verbunden (siehe status-Handler)
  }
  setInterval(() => reconcile(false), RECONCILE_MS).unref?.();
  setInterval(() => flush(), FLUSH_MS).unref?.();
  setInterval(() => cleanup().catch(() => {}), 12 * 3600 * 1000).unref?.();
  cleanup().catch(() => {});
}

export async function stopHistory() {
  await flush();
}

async function cleanup() {
  const keepDays = Math.max(30, Number(getSettings().historyRetentionDays) || 365);
  const cutoff = monthKey(Date.now() - keepDays * 86400 * 1000);
  const files = await fsp.readdir(dir).catch(() => []);
  for (const f of files) {
    const m = f.match(/^(sessions|events)-(\d{4}-\d{2})\.jsonl$/);
    if (m && m[2] < cutoff) await fsp.rm(path.join(dir, f), { force: true });
  }
}

/* ---------- Abfragen ---------- */

const summarize = (id) => ({
  uid: id.uid,
  cldbid: id.cldbid,
  nickname: id.nickname,
  nicknames: Object.keys(id.nicknames).length,
  ips: Object.keys(id.ips).length,
  lastIp: Object.entries(id.ips).sort((a, b) => b[1].last - a[1].last)[0]?.[0] || '',
  country: Object.entries(id.countries).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
  firstSeen: id.firstSeen,
  lastSeen: id.lastSeen,
  sessions: id.sessions + (isOnline(id.uid) ? 1 : 0),
  onlineSec: id.onlineSec + currentOnlineSec(id.uid),
  online: isOnline(id.uid),
  notes: id.notes?.length || 0,
  platform: id.platform,
});

function isOnline(uid) {
  for (const s of open.values()) if (s.uid === uid) return true;
  return false;
}
function currentOnlineSec(uid) {
  let sum = 0;
  for (const s of open.values()) if (s.uid === uid) sum += Math.max(0, Math.round((Date.now() - s.connectedAt) / 1000));
  return sum;
}

export function listIdentities({ q = '', sort = 'lastSeen', limit = 50, offset = 0, online = false } = {}) {
  let list = [...identities.values()];
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter((id) => id.uid.toLowerCase().includes(needle) || String(id.cldbid || '') === needle || Object.keys(id.nicknames).some((n) => n.toLowerCase().includes(needle)) || Object.keys(id.ips).some((ip) => ip.includes(needle)));
  }
  let rows = list.map(summarize);
  if (online) rows = rows.filter((r) => r.online);
  const key = ['lastSeen', 'firstSeen', 'onlineSec', 'sessions', 'nickname'].includes(sort) ? sort : 'lastSeen';
  rows.sort((a, b) => (key === 'nickname' ? a.nickname.localeCompare(b.nickname, getSettings().language === 'de' ? 'de' : 'en') : (b[key] || 0) - (a[key] || 0)));
  return { total: rows.length, entries: rows.slice(offset, offset + limit) };
}

export async function historySummary() {
  const now = Date.now();
  const dayAgo = now - 86400 * 1000;
  const weekAgo = now - 7 * 86400 * 1000;
  const monthAgo = now - 30 * 86400 * 1000;
  const sessions = (await readJsonl('sessions', monthKey(monthAgo))).filter((s) => s.disconnectedAt >= monthAgo);
  const uniq = (since) => new Set([...sessions.filter((s) => s.disconnectedAt >= since).map((s) => s.uid), ...[...open.values()].map((s) => s.uid)]).size;
  const online = new Map();
  for (const s of sessions) online.set(s.uid, (online.get(s.uid) || 0) + s.durationSec);
  for (const s of open.values()) online.set(s.uid, (online.get(s.uid) || 0) + Math.max(0, Math.round((now - s.connectedAt) / 1000)));
  const top = [...online.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([uid, sec]) => {
    const id = identities.get(uid);
    return { uid, nickname: id?.nickname || uid, onlineSec: sec, online: isOnline(uid), country: id ? Object.entries(id.countries).sort((a, b) => b[1] - a[1])[0]?.[0] || '' : '' };
  });
  const newIdentities = [...identities.values()].filter((i) => i.firstSeen >= weekAgo).length;
  return {
    identities: identities.size,
    onlineNow: new Set([...open.values()].map((s) => s.uid)).size,
    uniqueToday: uniq(dayAgo),
    uniqueWeek: uniq(weekAgo),
    uniqueMonth: uniq(monthAgo),
    sessionsMonth: sessions.length,
    newIdentitiesWeek: newIdentities,
    top,
    retentionDays: Math.max(30, Number(getSettings().historyRetentionDays) || 365),
  };
}

export async function getProfile(uid) {
  const id = identities.get(uid);
  if (!id) return null;
  const now = Date.now();
  const closed = (await readJsonl('sessions')).filter((s) => s.uid === uid);
  const current = [...open.values()].filter((s) => s.uid === uid).map((s) => ({ ...s, disconnectedAt: null, durationSec: Math.max(0, Math.round((now - s.connectedAt) / 1000)), reason: null, open: true }));
  const sessions = [...current, ...closed.sort((a, b) => b.connectedAt - a.connectedAt)];
  const events = (await readJsonl('events')).filter((e) => e.uid === uid).sort((a, b) => b.t - a.t).slice(0, 300);

  // Onlinezeit je Tag (letzte 30 Tage) und je Stunde in der konfigurierten Zeitzone;
  // Sitzungen werden in Stundenblöcke zerlegt und anteilig zugeordnet.
  const tz = getSettings().timezone || 'Europe/Berlin';
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
  const daily = new Map();
  const hours = Array(24).fill(0);
  const since = now - 30 * 86400 * 1000;
  const HOUR = 3600 * 1000;
  for (const s of sessions) {
    let a = Math.max(s.connectedAt, since);
    const b = s.disconnectedAt || now;
    while (a < b) {
      const end = Math.min(b, a - (a % HOUR) + HOUR);
      const d = new Date(a);
      const sec = (end - a) / 1000;
      daily.set(dayFmt.format(d), (daily.get(dayFmt.format(d)) || 0) + sec);
      hours[Number(hourFmt.format(d)) % 24] += sec;
      a = end;
    }
  }
  const dailyRows = [];
  for (let i = 29; i >= 0; i--) {
    const day = dayFmt.format(new Date(now - i * 86400 * 1000));
    dailyRows.push({ day, onlineSec: Math.round(daily.get(day) || 0) });
  }

  return {
    identity: {
      ...summarize(id),
      nicknames: Object.entries(id.nicknames).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.last - a.last),
      ips: Object.entries(id.ips).map(([ip, v]) => ({ ip, ...v })).sort((a, b) => b.last - a.last),
      countries: Object.entries(id.countries).map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
      version: id.version,
      platform: id.platform,
      notes: [...(id.notes || [])].sort((a, b) => b.ts.localeCompare(a.ts)),
    },
    sessions: sessions.slice(0, 200),
    sessionsTotal: sessions.length,
    events,
    daily: dailyRows,
    hours: hours.map((v) => Math.round(v)),
  };
}

export function findIdentityByCldbid(cldbid) {
  for (const id of identities.values()) if (String(id.cldbid) === String(cldbid)) return id;
  return null;
}

export function addNote(uid, { text, author }) {
  const id = identities.get(uid);
  if (!id) return null;
  const note = { id: crypto.randomUUID(), ts: new Date().toISOString(), author, text };
  id.notes = [note, ...(id.notes || [])].slice(0, MAX_NOTES);
  dirty = true;
  return note;
}

export function deleteNote(uid, noteId) {
  const id = identities.get(uid);
  if (!id) return false;
  const before = id.notes?.length || 0;
  id.notes = (id.notes || []).filter((n) => n.id !== noteId);
  dirty = true;
  return id.notes.length !== before;
}

/** Löscht alle gespeicherten Daten zu einer Identität (Datenschutz). Offene Sitzungen bleiben aktiv, werden aber nicht mehr zugeordnet gespeichert. */
export async function deleteIdentity(uid) {
  if (!identities.has(uid)) return false;
  identities.delete(uid);
  for (const [clid, s] of open) if (s.uid === uid) open.delete(clid);
  dirty = true;
  await flush();
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => /^(sessions|events)-\d{4}-\d{2}\.jsonl$/.test(f));
  for (const f of files) {
    const p = path.join(dir, f);
    const text = await fsp.readFile(p, 'utf8').catch(() => '');
    const kept = text.split('\n').filter((line) => line && !line.includes(`"uid":${JSON.stringify(uid)}`));
    await writeAtomic(p, null).catch(() => {});
    await fsp.writeFile(p, kept.length ? `${kept.join('\n')}\n` : '');
  }
  return true;
}

/** Für Tests/Diagnose. */
export function historyState() {
  return { identities: identities.size, open: open.size };
}
