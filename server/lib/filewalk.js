import { listOrEmpty } from './errors.js';

/**
 * Sammelt alle Dateien aller Orte (Server-Ablage cid 0 ohne /icons sowie jeder Kanal) in einer Liste.
 * Breitensuche mit begrenzter Parallelität, Tiefe, Anzahl und Zeitbudget – bei sehr großen Ablagen
 * wird `truncated` gesetzt statt den Query-Flood-Schutz zu reizen.
 */
export async function walkAllFiles(ts, { maxDepth = 8, concurrency = 4, maxEntries = 20000, budgetMs = 60000 } = {}) {
  const started = Date.now();
  const channels = await ts.channelList();
  const channelName = new Map(channels.map((c) => [String(c.cid), c.name]));
  const rows = [];
  const errors = [];
  let truncated = false;
  const queue = [{ cid: '0', path: '/', depth: 0 }, ...channels.map((c) => ({ cid: String(c.cid), path: '/', depth: 0 }))];

  async function worker() {
    while (queue.length) {
      if (rows.length >= maxEntries || Date.now() - started > budgetMs) { truncated = true; queue.length = 0; return; }
      const job = queue.shift();
      if (!job) return;
      let entries;
      try {
        entries = await listOrEmpty(ts.ftGetFileList(job.cid, job.path, ''));
      } catch (e) {
        errors.push({ cid: job.cid, path: job.path, error: [e.msg, e.extraMsg].filter(Boolean).join(' – ') || e.message });
        continue;
      }
      for (const e of entries) {
        const name = String(e.name);
        const full = job.path === '/' ? `/${name}` : `${job.path}/${name}`;
        if (Number(e.type) === 0) {
          if (job.cid === '0' && full === '/icons') continue; // Icons haben ihre eigene Ansicht
          if (job.depth + 1 <= maxDepth) queue.push({ cid: job.cid, path: full, depth: job.depth + 1 });
          continue;
        }
        rows.push({ cid: job.cid, channelName: job.cid === '0' ? '' : (channelName.get(job.cid) || `#${job.cid}`), path: job.path, name, size: Number(e.size) || 0, datetime: Number(e.datetime) || 0 });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
  rows.sort((a, b) => b.datetime - a.datetime);
  return { rows, count: rows.length, totalSize: rows.reduce((a, r) => a + r.size, 0), channels: channels.length, errors, truncated, durationMs: Date.now() - started };
}
