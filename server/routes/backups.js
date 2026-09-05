import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import busboy from 'busboy';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireCap } from '../lib/auth.js';
import {
  createBackup, listBackups, backupPath, deleteBackup, restoreBackup, backupState, registerUploadedBackup,
  createSnapshot, listSnapshots, snapshotPath, deleteSnapshot, deploySnapshot,
} from '../lib/backup.js';
import { getScheduleInfo, applySchedule, runScheduledBackup } from '../lib/scheduler.js';
import { updateSettings } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';

const router = Router();

router.get('/', requireCap('backups.view'), asyncHandler(async (req, res) => {
  res.json({ backups: await listBackups(), ...backupState(), dir: config.backupDir });
}));

router.post('/', requireCap('backups.manage'), asyncHandler(async (req, res) => {
  const { includeLogs, label } = z.object({ includeLogs: z.boolean().default(false), label: z.string().max(80).default('') }).parse(req.body || {});
  try {
    const meta = await createBackup({ includeLogs, label, trigger: 'manual', username: req.user.username });
    audit(req, 'backup.create', { id: meta.id, size: meta.size, includeLogs });
    res.json({ ok: true, backup: meta });
  } catch (e) {
    audit(req, 'backup.create', { error: e.message }, false);
    throw e;
  }
}));

/* ---- Zeitplan ---- */
router.get('/schedule', requireCap('backups.view'), (req, res) => {
  res.json({ schedule: getScheduleInfo() });
});

router.put('/schedule', requireCap('backups.manage'), asyncHandler(async (req, res) => {
  const body = z.object({
    enabled: z.boolean(),
    frequency: z.enum(['daily', 'weekly']),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM'),
    weekday: z.coerce.number().int().min(0).max(6).default(0),
    keep: z.coerce.number().int().min(1).max(365).default(7),
    includeLogs: z.boolean().default(false),
    timezone: z.string().max(64).optional(),
  }).parse(req.body);
  const { timezone, ...schedule } = body;
  const patch = { backupSchedule: schedule };
  if (timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new HttpError(400, 'errors.unknownTimezone');
    }
    patch.timezone = timezone;
  }
  await updateSettings(patch);
  applySchedule();
  audit(req, 'backup.schedule', schedule);
  res.json({ ok: true, schedule: getScheduleInfo() });
}));

router.post('/schedule/run-now', requireCap('backups.manage'), asyncHandler(async (req, res) => {
  const result = await runScheduledBackup('schedule');
  audit(req, 'backup.schedule.run-now', result, result.ok);
  if (!result.ok) throw new HttpError(500, 'backups.failedWith', { error: result.error || '' });
  res.json({ ok: true, result });
}));

/* ---- Upload ---- */
router.post('/upload', requireCap('backups.restore'), (req, res, next) => {
  let bb;
  try {
    bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: 4 * 1024 * 1024 * 1024 } });
  } catch (e) {
    return next(new HttpError(400, 'files.badUpload', { error: e.message }));
  }
  const tmp = path.join(os.tmpdir(), `ts3upload-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  let originalName = 'upload.zip';
  let received = false;
  let failed = false;
  bb.on('file', (field, stream, info) => {
    received = true;
    originalName = info.filename || originalName;
    const ws = fs.createWriteStream(tmp);
    stream.pipe(ws);
    stream.on('limit', () => { failed = true; ws.destroy(); });
    ws.on('finish', async () => {
      if (failed) return;
      try {
        const meta = await registerUploadedBackup(tmp, originalName, req.user.username);
        audit(req, 'backup.upload', { id: meta.id, size: meta.size, originalName });
        res.json({ ok: true, backup: meta });
      } catch (e) {
        next(e);
      }
    });
    ws.on('error', (e) => next(e));
  });
  bb.on('error', (e) => next(new HttpError(400, 'files.uploadFailed', { error: e.message })));
  bb.on('close', () => {
    if (!received) next(new HttpError(400, 'files.noFile'));
    else if (failed) { fs.rm(tmp, { force: true }, () => {}); next(new HttpError(413, 'files.tooLarge')); }
  });
  req.pipe(bb);
});

/* ---- Snapshots ---- */
router.get('/snapshots', requireCap('backups.view'), asyncHandler(async (req, res) => {
  res.json({ snapshots: await listSnapshots() });
}));

router.post('/snapshots', requireCap('backups.manage'), asyncHandler(async (req, res) => {
  const meta = await createSnapshot({ username: req.user.username });
  audit(req, 'snapshot.create', { id: meta.id });
  res.json({ ok: true, snapshot: meta });
}));

router.get('/snapshots/:id/download', requireCap('backups.download'), asyncHandler(async (req, res) => {
  const p = snapshotPath(req.params.id);
  audit(req, 'snapshot.download', { id: req.params.id });
  res.download(p, `${req.params.id}.json`);
}));

router.delete('/snapshots/:id', requireCap('backups.manage'), asyncHandler(async (req, res) => {
  await deleteSnapshot(req.params.id);
  audit(req, 'snapshot.delete', { id: req.params.id });
  res.json({ ok: true });
}));

router.post('/snapshots/deploy', requireCap('backups.restore'), asyncHandler(async (req, res) => {
  const body = z.object({
    id: z.string().optional(),
    data: z.object({ snapshot: z.string(), salt: z.string().nullable().optional(), version: z.union([z.number(), z.string()]).nullable().optional() }).optional(),
    confirm: z.string(),
  }).parse(req.body);
  if (body.confirm !== 'EINSPIELEN') throw new HttpError(400, 'errors.confirmMissing', { word: 'EINSPIELEN' });
  await deploySnapshot({ id: body.id, data: body.data });
  audit(req, 'snapshot.deploy', { id: body.id || '(hochgeladen)' });
  res.json({ ok: true });
}));

/* ---- Einzelne Backups ---- */
router.get('/:id/download', requireCap('backups.download'), asyncHandler(async (req, res) => {
  const p = backupPath(req.params.id);
  audit(req, 'backup.download', { id: req.params.id });
  res.download(p, `${req.params.id}.zip`);
}));

router.delete('/:id', requireCap('backups.manage'), asyncHandler(async (req, res) => {
  await deleteBackup(req.params.id);
  audit(req, 'backup.delete', { id: req.params.id });
  res.json({ ok: true });
}));

router.post('/:id/restore', requireCap('backups.restore'), asyncHandler(async (req, res) => {
  const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
  if (confirm !== req.params.id) throw new HttpError(400, 'backups.confirmMismatch');
  try {
    const result = await restoreBackup(req.params.id, { username: req.user.username });
    audit(req, 'backup.restore', { id: req.params.id, safetyBackup: result.safetyBackup });
    res.json(result);
  } catch (e) {
    audit(req, 'backup.restore', { id: req.params.id, error: e.message }, false);
    if (e.steps) e.extra = { ...(e.extra || {}), steps: e.steps };
    throw e;
  }
}));

export default router;
