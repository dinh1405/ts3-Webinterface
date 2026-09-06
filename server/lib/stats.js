import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { ts3 } from './ts3.js';
import { getProcessStatus } from './process.js';
import { getSettings } from './settings.js';

const dir = path.join(config.dataDir, 'stats');
const SAMPLE_MS = 60 * 1000;
let sampling = false;

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const fileFor = (t) => path.join(dir, `${dayKey(t)}.jsonl`);

export function startStats() {
  fs.mkdirSync(dir, { recursive: true });
  setTimeout(() => sample(), 5000).unref?.();
  setInterval(() => sample(), SAMPLE_MS).unref?.();
  setInterval(() => cleanup().catch(() => {}), 6 * 3600 * 1000).unref?.();
  cleanup().catch(() => {});
}

async function sample() {
  if (sampling) return;
  sampling = true;
  try {
    const t = Date.now();
    const proc = await getProcessStatus();
    const row = { t, running: proc.running === true, c: null, q: null, ch: null, up: null, dn: null, ping: null, loss: null, tx: null, rx: null };
    if (ts3.connected) {
      try {
        const info = await ts3.get().serverInfo();
        const total = Number(info.virtualserverClientsonline) || 0;
        const query = Number(info.virtualserverQueryclientsonline) || 0;
        row.c = Math.max(0, total - query);
        row.q = query;
        row.ch = Number(info.virtualserverChannelsonline) || 0;
        row.up = Number(info.connectionBandwidthSentLastMinuteTotal) || 0;
        row.dn = Number(info.connectionBandwidthReceivedLastMinuteTotal) || 0;
        row.ping = Number(info.virtualserverTotalPing) || 0;
        row.loss = Number(info.virtualserverTotalPacketlossTotal) || 0;
        row.tx = Number(info.connectionBytesSentTotal) || 0;
        row.rx = Number(info.connectionBytesReceivedTotal) || 0;
      } catch {
        // Server gerade nicht abfragbar
      }
    }
    await fsp.appendFile(fileFor(t), `${JSON.stringify(row)}\n`);
  } catch (e) {
    console.warn('[stats] sample failed:', e.message);
  } finally {
    sampling = false;
  }
}

async function cleanup() {
  const keepDays = Math.max(7, Number(getSettings().statsRetentionDays) || 90);
  const cutoff = dayKey(Date.now() - keepDays * 86400 * 1000);
  const files = await fsp.readdir(dir).catch(() => []);
  for (const f of files) {
    if (f.endsWith('.jsonl') && f.slice(0, 10) < cutoff) await fsp.rm(path.join(dir, f), { force: true });
  }
}

async function readRows(since) {
  const rows = [];
  const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.jsonl') && f.slice(0, 10) >= dayKey(since)).sort();
  for (const f of files) {
    const text = await fsp.readFile(path.join(dir, f), 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (r.t >= since) rows.push(r);
      } catch { /* defekte Zeile */ }
    }
  }
  return rows;
}

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

/**
 * Liefert verdichtete Zeitreihen, Kennzahlen und eine Wochentag/Stunde-Heatmap.
 */
const heatmapCache = new Map(); // `${days}:${tz}` → { at, heatmap, samples }

export async function queryStats(range = '24h', { heatmapDays = 30 } = {}) {
  const hours = { '6h': 6, '24h': 24, '7d': 168, '30d': 720 }[range] || 24;
  const now = Date.now();
  const since = now - hours * 3600 * 1000;
  // Die Heatmap nutzt ein eigenes, festes Fenster (Standard 30 Tage), unabhängig vom gewählten Zeitraum der Diagramme
  const days = Math.max(1, Math.min(Number(heatmapDays) || 30, Math.max(7, Number(getSettings().statsRetentionDays) || 90)));
  const heatSince = now - days * 86400 * 1000;
  const allRows = await readRows(Math.min(since, heatSince));
  const rows = allRows.filter((r) => r.t >= since);
  const bucketMs = hours <= 6 ? 60 * 1000 : hours <= 24 ? 5 * 60 * 1000 : hours <= 168 ? 30 * 60 * 1000 : 2 * 3600 * 1000;

  const buckets = new Map();
  for (const r of rows) {
    const key = Math.floor(r.t / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  const points = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, list]) => {
    const withData = list.filter((r) => r.c !== null);
    return {
      t,
      clients: withData.length ? Math.round(avg(withData.map((r) => r.c)) * 10) / 10 : null,
      clientsMax: withData.length ? Math.max(...withData.map((r) => r.c)) : null,
      channels: withData.length ? Math.round(avg(withData.map((r) => r.ch))) : null,
      up: withData.length ? Math.round(avg(withData.map((r) => r.up))) : null,
      down: withData.length ? Math.round(avg(withData.map((r) => r.dn))) : null,
      ping: withData.length ? Math.round(avg(withData.map((r) => r.ping)) * 10) / 10 : null,
      loss: withData.length ? Math.round(avg(withData.map((r) => r.loss)) * 10000) / 100 : null,
      running: Math.round((list.filter((r) => r.running).length / list.length) * 100),
    };
  });

  const withClients = rows.filter((r) => r.c !== null);
  let peak = null;
  for (const r of withClients) if (!peak || r.c > peak.value) peak = { value: r.c, t: r.t };
  const firstTraffic = rows.find((r) => r.tx !== null);
  const lastTraffic = [...rows].reverse().find((r) => r.tx !== null);
  const trafficOk = firstTraffic && lastTraffic && lastTraffic.tx >= firstTraffic.tx && lastTraffic.rx >= firstTraffic.rx;
  const summary = {
    samples: rows.length,
    from: rows[0]?.t ?? null,
    to: rows[rows.length - 1]?.t ?? null,
    currentClients: withClients.length ? withClients[withClients.length - 1].c : null,
    avgClients: withClients.length ? Math.round(avg(withClients.map((r) => r.c)) * 10) / 10 : null,
    peakClients: peak,
    uptimePct: rows.length ? Math.round((rows.filter((r) => r.running).length / rows.length) * 1000) / 10 : null,
    queryUptimePct: rows.length ? Math.round((withClients.length / rows.length) * 1000) / 10 : null,
    trafficTx: trafficOk ? lastTraffic.tx - firstTraffic.tx : null,
    trafficRx: trafficOk ? lastTraffic.rx - firstTraffic.rx : null,
    avgPing: withClients.length ? Math.round(avg(withClients.map((r) => r.ping)) * 10) / 10 : null,
    avgLoss: withClients.length ? Math.round(avg(withClients.map((r) => r.loss)) * 10000) / 100 : null,
  };

  // Heatmap: durchschnittliche Clients je Wochentag (0 = Montag) und Stunde in der konfigurierten Zeitzone,
  // über das Heatmap-Fenster (nicht den Diagramm-Zeitraum); 60 s zwischengespeichert, da pro Minute nur eine Zeile dazukommt
  const tz = getSettings().timezone || 'Europe/Berlin';
  const cacheKey = `${days}:${tz}`;
  let hc = heatmapCache.get(cacheKey);
  if (!hc || now - hc.at > 60 * 1000) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false });
    const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
    const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => []));
    let samples = 0;
    for (const r of allRows) {
      if (r.t < heatSince || r.c === null) continue;
      const parts = fmt.formatToParts(new Date(r.t));
      const wd = WD[parts.find((p) => p.type === 'weekday')?.value];
      const h = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
      if (wd !== undefined && Number.isFinite(h)) { cells[wd][h].push(r.c); samples++; }
    }
    hc = { at: now, samples, heatmap: cells.map((day) => day.map((list) => (list.length ? Math.round(avg(list) * 10) / 10 : null))) };
    heatmapCache.set(cacheKey, hc);
  }

  return { range, hours, bucketMs, points, summary, heatmap: hc.heatmap, heatmapWindowDays: days, heatmapSamples: hc.samples, timezone: tz };
}
