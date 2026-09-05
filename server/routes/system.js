import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireCap } from '../lib/auth.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import * as watchdog from '../lib/watchdog.js';
import { notifyState, testChannel, EVENT_KEYS, eventLabels } from '../lib/notify.js';
import { resolveLocale } from '../lib/locale.js';
import { checkForUpdate, runUpdate, rollback, updateSummary } from '../lib/update.js';
import { audit } from '../lib/audit.js';

const router = Router();
const MASK = '***';

/* ---------------- Watchdog ---------------- */
router.get('/watchdog', requireCap('system.view'), (req, res) => {
  res.json(watchdog.watchdogState());
});

router.put('/watchdog', requireCap('system.manage'), asyncHandler(async (req, res) => {
  const body = z.object({
    enabled: z.boolean(),
    intervalSec: z.coerce.number().int().min(10).max(600).default(30),
    maxRestartsPerHour: z.coerce.number().int().min(1).max(20).default(3),
    startOnBoot: z.boolean().default(true),
  }).parse(req.body);
  const current = getSettings().watchdog;
  await updateSettings({ watchdog: { ...current, ...body } });
  watchdog.applyWatchdog();
  audit(req, 'watchdog.settings', body);
  res.json(watchdog.watchdogState());
}));

router.post('/watchdog/reset', requireCap('system.manage'), asyncHandler(async (req, res) => {
  watchdog.resetGaveUp();
  await watchdog.setSuspended(false, req.user.username);
  audit(req, 'watchdog.reset', {});
  res.json(watchdog.watchdogState());
}));

/* ---------------- Benachrichtigungen ---------------- */
function maskedNotifications() {
  const n = getSettings().notifications;
  return {
    ...n,
    discord: { ...n.discord, webhookUrl: n.discord.webhookUrl ? MASK : '' },
    telegram: { ...n.telegram, botToken: n.telegram.botToken ? MASK : '' },
    webhook: { ...n.webhook, secret: n.webhook.secret ? MASK : '' },
  };
}

router.get('/notifications', requireCap('system.view'), (req, res) => {
  const settings = maskedNotifications();
  if (!settings.email.from) settings.email.from = notifyState().mailFrom; // Vorbelegung des Absenders
  res.json({ settings, state: notifyState(), eventLabels: eventLabels(resolveLocale(req)) });
});

router.put('/notifications', requireCap('system.manage'), asyncHandler(async (req, res) => {
  const body = z.object({
    discord: z.object({ enabled: z.boolean(), webhookUrl: z.string().max(500) }),
    telegram: z.object({ enabled: z.boolean(), botToken: z.string().max(200), chatId: z.string().max(64) }),
    webhook: z.object({ enabled: z.boolean(), url: z.string().max(500), secret: z.string().max(200) }),
    email: z.object({ enabled: z.boolean(), to: z.string().max(200), from: z.string().max(200), sendmailPath: z.string().max(200) }),
    events: z.record(z.string(), z.boolean()),
  }).parse(req.body);
  const current = getSettings().notifications;
  const keep = (val, prev) => (val === MASK ? prev : val.trim());
  const next = {
    discord: { enabled: body.discord.enabled, webhookUrl: keep(body.discord.webhookUrl, current.discord.webhookUrl) },
    telegram: { enabled: body.telegram.enabled, botToken: keep(body.telegram.botToken, current.telegram.botToken), chatId: body.telegram.chatId.trim() },
    webhook: { enabled: body.webhook.enabled, url: body.webhook.url.trim(), secret: keep(body.webhook.secret, current.webhook.secret) },
    email: { enabled: body.email.enabled, to: body.email.to.trim(), from: body.email.from.trim(), sendmailPath: body.email.sendmailPath.trim() || '/usr/sbin/sendmail' },
    events: { ...current.events, ...Object.fromEntries(Object.entries(body.events).filter(([k]) => EVENT_KEYS.includes(k))) },
  };
  for (const [name, url] of [['Discord', next.discord.webhookUrl], ['Webhook', next.webhook.url]]) {
    if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'auth.urlScheme', { name });
  }
  await updateSettings({ notifications: next });
  audit(req, 'notifications.settings', { discord: next.discord.enabled, telegram: next.telegram.enabled, webhook: next.webhook.enabled, email: next.email.enabled, events: Object.entries(next.events).filter(([, v]) => v).map(([k]) => k) });
  res.json({ settings: maskedNotifications(), state: notifyState() });
}));

router.post('/notifications/test', requireCap('system.manage'), asyncHandler(async (req, res) => {
  const { channel } = z.object({ channel: z.enum(['discord', 'telegram', 'webhook', 'email']) }).parse(req.body);
  const r = await testChannel(channel);
  audit(req, 'notifications.test', { channel, ok: !r.skipped && r.results?.every((x) => x.ok) }, !r.skipped);
  if (r.skipped) throw new HttpError(400, 'auth.channelNotReady');
  const failed = r.results.filter((x) => !x.ok);
  if (failed.length) throw new HttpError(502, 'auth.sendFailed', { error: failed[0].error });
  res.json({ ok: true });
}));

/* ---------------- TS3-Update ---------------- */
router.get('/update', requireCap('system.view'), asyncHandler(async (req, res) => {
  res.json(await checkForUpdate(false));
}));

router.post('/update/check', requireCap('system.view'), asyncHandler(async (req, res) => {
  res.json(await checkForUpdate(true));
}));

router.post('/update/run', requireCap('update.run'), asyncHandler(async (req, res) => {
  const { version, confirm } = z.object({ version: z.string().max(20), confirm: z.string() }).parse(req.body);
  if (confirm !== 'UPDATE') throw new HttpError(400, 'errors.confirmMissing', { word: 'UPDATE' });
  const summary = await updateSummary();
  if (summary.running) throw new HttpError(409, 'update.running');
  audit(req, 'update.start', { version });
  // asynchron ausführen – der Client verfolgt den Fortschritt über GET /update
  runUpdate({ version, username: req.user.username }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  res.status(202).json(await updateSummary());
}));

router.post('/update/rollback', requireCap('update.run'), asyncHandler(async (req, res) => {
  const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
  if (confirm !== 'ROLLBACK') throw new HttpError(400, 'errors.confirmMissing', { word: 'ROLLBACK' });
  audit(req, 'update.rollback.start', {});
  rollback({ username: req.user.username }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  res.status(202).json(await updateSummary());
}));

export default router;
