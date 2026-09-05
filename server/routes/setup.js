import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireCap, issueSession } from '../lib/auth.js';
import { hasUsers } from '../lib/users.js';
import { getSettings } from '../lib/settings.js';
import { ts3 } from '../lib/ts3.js';
import { audit } from '../lib/audit.js';
import { appVersion } from '../version.js';
import {
  needsSetup, setupGuard, verifySetupToken, ensureSetupToken, maskedConfig, systemCheck, detectInstallations, inspectDir, testControl, testQuery,
  testBackupDir, findInitialPassword, startServerAdminReset, resetJobState, takeResetPassword, applySetup, draftSchema, migrateEnvToFile, currentUser,
} from '../lib/setup.js';
import { installInfo, startInstall, installJobState, takeInstallPassword } from '../lib/ts3install.js';

const router = Router();
const guard = setupGuard(requireCap);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, handler: (req, res) => res.status(429).json({ error: 'Too many requests', key: 'errors.rateLimited' }) });
const tokenLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, handler: (req, res) => res.status(429).json({ error: 'Too many attempts', key: 'errors.rateLimited' }) });
router.use(limiter);

/** Token prüfen, ohne etwas zu tun (der Assistent behält das Token im sessionStorage). */
router.post('/verify-token', tokenLimiter, (req, res) => {
  if (!needsSetup()) return res.json({ ok: true, needsSetup: false });
  ensureSetupToken();
  const { token } = z.object({ token: z.string().max(200) }).parse(req.body || {});
  if (!verifySetupToken(token)) throw new HttpError(401, 'setup.tokenInvalid');
  res.json({ ok: true, needsSetup: true, hasUsers: hasUsers() });
});

router.get('/state', guard, (req, res) => {
  const s = getSettings();
  res.json({
    needsSetup: needsSetup(),
    hasUsers: hasUsers(),
    setupMode: Boolean(req.setupMode),
    version: appVersion(),
    language: s.language,
    timezone: s.timezone,
    current: maskedConfig(),
    query: ts3.summary(),
    me: currentUser(),
    platform: process.platform,
  });
});

router.get('/system-check', guard, asyncHandler(async (req, res) => {
  res.json(await systemCheck());
}));

router.post('/detect', guard, asyncHandler(async (req, res) => {
  res.json(await detectInstallations());
}));

router.post('/inspect-dir', guard, asyncHandler(async (req, res) => {
  const { dir } = z.object({ dir: z.string().min(1).max(500) }).parse(req.body);
  res.json(await inspectDir(dir));
}));

router.post('/test-control', guard, asyncHandler(async (req, res) => {
  const draft = draftSchema.parse(req.body || {});
  res.json(await testControl(draft));
}));

router.post('/test-query', guard, asyncHandler(async (req, res) => {
  const q = z.object({
    host: z.string().max(200).optional(),
    port: z.coerce.number().int().min(1).max(65535).optional(),
    protocol: z.enum(['raw', 'ssh']).optional(),
    username: z.string().max(100).optional(),
    password: z.string().max(200).optional(),
  }).parse(req.body || {});
  res.json(await testQuery(q));
}));

router.post('/test-backup-dir', guard, asyncHandler(async (req, res) => {
  const { backupDir } = z.object({ backupDir: z.string().max(500).optional() }).parse(req.body || {});
  res.json(await testBackupDir(backupDir));
}));

router.post('/find-initial-password', guard, asyncHandler(async (req, res) => {
  const { dir } = z.object({ dir: z.string().min(1).max(500) }).parse(req.body);
  res.json(await findInitialPassword(dir));
}));

router.post('/reset-serveradmin', guard, asyncHandler(async (req, res) => {
  const body = z.object({ config: draftSchema.optional(), confirm: z.literal('RESET'), newPassword: z.string().min(12).max(64).optional(), restartToHide: z.boolean().optional() }).parse(req.body || {});
  const id = startServerAdminReset(body.config || {}, { newPassword: body.newPassword, restartToHide: body.restartToHide !== false, username: req.user?.username || 'setup' });
  res.status(202).json({ jobId: id });
}));

router.get('/reset-serveradmin/:id', guard, (req, res) => {
  const job = resetJobState(req.params.id);
  if (!job) throw new HttpError(404, 'errors.notFound');
  res.json(job);
});

/** Neues Passwort einmalig abholen (danach nur noch im Entwurf des Browsers). */
router.post('/reset-serveradmin/:id/password', guard, (req, res) => {
  const pw = takeResetPassword(req.params.id);
  if (!pw) throw new HttpError(404, 'setup.passwordAlreadyTaken');
  res.json({ password: pw });
});

/* ---- TeamSpeak-Server aus dem Assistenten installieren ---- */
router.post('/install-info', guard, asyncHandler(async (req, res) => {
  const body = z.object({ dir: z.string().max(500).optional(), ports: z.record(z.string().max(20), z.coerce.number().int()).optional() }).parse(req.body || {});
  res.json(await installInfo(body));
}));

router.post('/install', guard, asyncHandler(async (req, res) => {
  const body = z.object({
    dir: z.string().min(2).max(500),
    acceptLicense: z.boolean(),
    version: z.string().max(20).optional(),
    voicePort: z.coerce.number().int().min(1).max(65535).default(9987),
    queryPort: z.coerce.number().int().min(1).max(65535).default(10011),
    filetransferPort: z.coerce.number().int().min(1).max(65535).default(30033),
  }).parse(req.body || {});
  const id = await startInstall({ ...body, username: req.user?.username || 'setup' });
  res.status(202).json({ jobId: id });
}));

router.get('/install/:id', guard, (req, res) => {
  const j = installJobState(req.params.id);
  if (!j) throw new HttpError(404, 'errors.notFound');
  res.json(j);
});

router.post('/install/:id/password', guard, (req, res) => {
  const pw = takeInstallPassword(req.params.id);
  if (!pw) throw new HttpError(404, 'setup.passwordAlreadyTaken');
  res.json({ password: pw });
});

router.post('/apply', guard, asyncHandler(async (req, res) => {
  const body = z.object({
    language: z.enum(['de', 'en']).optional(),
    timezone: z.string().max(64).optional(),
    config: draftSchema.optional(),
    admin: z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200), displayName: z.string().max(80).optional() }).optional(),
  }).parse(req.body || {});
  const wasSetup = needsSetup();
  const { user, changed } = await applySetup({ ...body, actor: req.user?.username });
  if (user) {
    req.user = user;
    issueSession(req, res, user);
  }
  audit(req, wasSetup ? 'setup.complete' : 'setup.config', { changed: changed.filter((k) => !k.includes('password')) });
  res.json({ ok: true, user: user ? { id: user.id, username: user.username, role: user.role } : null, changed });
}));

/** Nach der Einrichtung: Werte ändern (Admin-Seite). */
router.put('/config', requireCap('system.manage'), asyncHandler(async (req, res) => {
  const body = z.object({ config: draftSchema, timezone: z.string().max(64).optional(), language: z.enum(['de', 'en']).optional() }).parse(req.body || {});
  const { changed } = await applySetup({ ...body, actor: req.user.username });
  audit(req, 'setup.config', { changed: changed.filter((k) => !k.includes('password')) });
  res.json({ ok: true, changed, current: maskedConfig() });
}));

router.post('/migrate-env', requireCap('system.manage'), asyncHandler(async (req, res) => {
  const { changed } = await migrateEnvToFile();
  audit(req, 'setup.migrate-env', {});
  res.json({ ok: true, changed, current: maskedConfig() });
}));

/** Assistent verlassen/abbrechen: Manager wieder aktivieren. */
router.post('/resume', guard, (req, res) => {
  ts3.resume();
  res.json({ ok: true });
});

export default router;
