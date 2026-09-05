import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { issueSession, clearSession, requireAuth } from '../lib/auth.js';
import { hasUsers, verifyLogin, sanitizeUser, getUser, setPassword, getUserNotifications, setUserNotifications, updateUser } from '../lib/users.js';
import { getSettings } from '../lib/settings.js';
import { isLocale } from '../i18n/index.js';
import { resolveLocale, systemLocale, userLocale } from '../lib/locale.js';
import { appVersion } from '../version.js';
import { needsSetup } from '../lib/setup.js';
import { audit } from '../lib/audit.js';
import { notify, testChannel, EVENT_KEYS, eventLabels, channelReady, mailFrom } from '../lib/notify.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: config.loginRateLimit.windowMs,
  limit: config.loginRateLimit.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    audit({ ip: req.ip, user: { username: String(req.body?.username || '?') } }, 'auth.ratelimit', {}, false);
    notify('loginBlocked', { ip: req.ip, username: String(req.body?.username || '?') });
    res.status(429).json({ error: new HttpError(429, 'auth.rateLimited').localized(resolveLocale(req)), key: 'auth.rateLimited' });
  },
});

const credentials = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

router.get('/setup-status', (req, res) => {
  res.json({ needsSetup: needsSetup(), hasUsers: hasUsers(), language: systemLocale(), version: appVersion() });
});


router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { username, password } = credentials.parse(req.body);
  const user = await verifyLogin(username, password);
  if (!user) {
    audit({ ip: req.ip, user: { username } }, 'auth.login', { reason: 'bad-credentials' }, false);
    throw new HttpError(401, 'auth.badCredentials');
  }
  req.user = user;
  issueSession(req, res, user);
  audit(req, 'auth.login', {});
  res.json({ user: sanitizeUser(user) });
}));

router.post('/logout', requireAuth, (req, res) => {
  audit(req, 'auth.logout', {});
  clearSession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user), needsSetup: false, language: userLocale(req.user), systemLanguage: systemLocale(), timezone: getSettings().timezone });
});

/** Persönliche Sprache setzen (null = Systemstandard). */
router.post('/language', requireAuth, asyncHandler(async (req, res) => {
  const { language } = z.object({ language: z.string().nullable() }).parse(req.body);
  if (language !== null && !isLocale(language)) throw new HttpError(400, 'auth.invalidLanguage');
  const user = await updateUser(req.user.id, { language });
  audit(req, 'auth.language', { language });
  res.json({ user, language: userLocale({ ...req.user, language }) });
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string(), newPassword: z.string() }).parse(req.body);
  const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!ok) throw new HttpError(400, 'auth.currentPasswordWrong');
  const user = await setPassword(req.user.id, newPassword);
  issueSession(req, res, user); // neue Sitzung, da alte durch tokenVersion ungültig wurde
  audit(req, 'auth.change-password', {});
  res.json({ ok: true });
}));

/* ---- persönliche Benachrichtigungen ---- */
const MASK = '***';
function maskedUserNotifications(id) {
  const n = getUserNotifications(id);
  return {
    ...n,
    discord: { ...n.discord, webhookUrl: n.discord.webhookUrl ? MASK : '' },
    telegram: { ...n.telegram, botToken: n.telegram.botToken ? MASK : '' },
    webhook: { ...n.webhook, secret: n.webhook.secret ? MASK : '' },
  };
}

router.get('/notifications', requireAuth, (req, res) => {
  const n = getUserNotifications(req.user.id);
  res.json({
    settings: maskedUserNotifications(req.user.id),
    eventLabels: eventLabels(resolveLocale(req)),
    channels: { discord: channelReady(n, 'discord'), telegram: channelReady(n, 'telegram'), webhook: channelReady(n, 'webhook'), email: channelReady(n, 'email') },
    mailFrom: mailFrom(),
  });
});

router.put('/notifications', requireAuth, asyncHandler(async (req, res) => {
  const body = z.object({
    discord: z.object({ enabled: z.boolean(), webhookUrl: z.string().max(500) }),
    telegram: z.object({ enabled: z.boolean(), botToken: z.string().max(200), chatId: z.string().max(64) }),
    webhook: z.object({ enabled: z.boolean(), url: z.string().max(500), secret: z.string().max(200) }),
    email: z.object({ enabled: z.boolean(), to: z.string().max(200) }),
    events: z.record(z.string(), z.boolean()),
  }).parse(req.body);
  const current = getUserNotifications(req.user.id);
  const keep = (val, prev) => (val === MASK ? prev : val.trim());
  const next = {
    discord: { enabled: body.discord.enabled, webhookUrl: keep(body.discord.webhookUrl, current.discord.webhookUrl) },
    telegram: { enabled: body.telegram.enabled, botToken: keep(body.telegram.botToken, current.telegram.botToken), chatId: body.telegram.chatId.trim() },
    webhook: { enabled: body.webhook.enabled, url: body.webhook.url.trim(), secret: keep(body.webhook.secret, current.webhook.secret) },
    email: { enabled: body.email.enabled, to: body.email.to.trim() },
    events: Object.fromEntries(Object.entries(body.events).filter(([k]) => EVENT_KEYS.includes(k))),
  };
  for (const [name, url] of [['Discord', next.discord.webhookUrl], ['Webhook', next.webhook.url]]) {
    if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'auth.urlScheme', { name });
  }
  if (next.email.to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email.to)) throw new HttpError(400, 'auth.invalidEmail');
  await setUserNotifications(req.user.id, next);
  audit(req, 'auth.notifications', { discord: next.discord.enabled, telegram: next.telegram.enabled, webhook: next.webhook.enabled, email: next.email.enabled, events: Object.entries(next.events).filter(([, v]) => v).map(([k]) => k) });
  res.json({ settings: maskedUserNotifications(req.user.id) });
}));

router.post('/notifications/test', requireAuth, asyncHandler(async (req, res) => {
  const { channel } = z.object({ channel: z.enum(['discord', 'telegram', 'webhook', 'email']) }).parse(req.body);
  const r = await testChannel(channel, req.user.id, req.user.username);
  if (r.skipped) throw new HttpError(400, 'auth.channelNotReady');
  const failed = r.results.filter((x) => !x.ok);
  if (failed.length) throw new HttpError(502, 'auth.sendFailed', { error: failed[0].error });
  res.json({ ok: true });
}));

export default router;
