import { Router } from 'express';
import path from 'node:path';
import { asyncHandler, listOrEmpty } from '../lib/errors.js';
import { requireCap } from '../lib/auth.js';
import { ts3 } from '../lib/ts3.js';
import { listLogFiles, readLogTail, safeLogPath, parseLogLine } from '../lib/logs.js';
import { audit } from '../lib/audit.js';

const router = Router();

/** Log über ServerQuery (logview). instance=1 → Instanzlog, 0 → virtueller Server. */
router.get('/query', requireCap('logs.view'), asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const lines = Math.min(100, Math.max(1, parseInt(req.query.lines, 10) || 100));
  const reverse = req.query.reverse === '0' ? 0 : 1;
  const instance = req.query.instance === '1' ? 1 : 0;
  const beginPos = Math.max(0, parseInt(req.query.beginPos, 10) || 0);
  const entries = await listOrEmpty(ts.logView(lines, reverse, instance, beginPos));
  const first = entries[0] || {};
  res.json({
    lines: entries.map((e) => parseLogLine(e.l || '')).filter((l) => l.raw !== ''),
    lastPos: first.lastPos ?? 0,
    fileSize: first.fileSize ?? 0,
    instance,
  });
}));

router.get('/files', requireCap('logs.view'), asyncHandler(async (req, res) => {
  res.json(await listLogFiles());
}));

router.get('/files/:name', requireCap('logs.view'), asyncHandler(async (req, res) => {
  const lines = Math.min(5000, Math.max(10, parseInt(req.query.lines, 10) || 500));
  res.json(await readLogTail(req.params.name, { lines, q: String(req.query.q || ''), level: String(req.query.level || '') }));
}));

router.get('/files/:name/download', requireCap('logs.view'), asyncHandler(async (req, res) => {
  const full = safeLogPath(req.params.name);
  audit(req, 'logs.download', { file: path.basename(full) });
  res.download(full, path.basename(full));
}));

export default router;
