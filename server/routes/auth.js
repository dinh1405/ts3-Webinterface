import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { issueSession, clearSession, requireAuth } from '../lib/auth.js';
import { hasUsers, verifyLogin, sanitizeUser, getUser, setPassword, getUserNotifications, setUserNotifications, updateUser, startTotpSetup, enableTotp, disableTotp, regenerateRecoveryCodes, verifyUserTotp, totpStatus } from '../lib/users.js';
import { passwordPolicy } from '../lib/passwords.js';
import { listPasskeys, removePasskey, renamePasskey, listPasskeysRaw, touchLogin } from '../lib/users.js';
import { relyingParty, beginRegistration, finishRegistration, beginAuthentication, finishAuthentication } from '../lib/passkeys.js';
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

const mfaLimiter = rateLimit({
  windowMs: config.loginRateLimit.windowMs,
  limit: Math.max(config.loginRateLimit.max, 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).json({ error: new HttpError(429, 'auth.rateLimited').localized(resolveLocale(req)), key: 'auth.rateLimited' }),
});
const MFA_TICKET_MINUTES = 5;
const mfaTicket = (user) => jwt.sign({ sub: user.id, tv: user.tokenVersion || 0, purpose: 'mfa' }, config.jwtSecret, { expiresIn: `${MFA_TICKET_MINUTES}m` });

const credentials = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

router.get('/setup-status', (req, res) => {
  const rp = relyingParty(req);
  res.json({ needsSetup: needsSetup(), hasUsers: hasUsers(), language: systemLocale(), version: appVersion(), passwordPolicy: passwordPolicy(), passkeys: { available: rp.available, reason: rp.reason } });
});


router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { username, password } = credentials.parse(req.body);
  const user = await verifyLogin(username, password);
  if (!user) {
    audit({ ip: req.ip, user: { username } }, 'auth.login', { reason: 'bad-credentials' }, false);
    throw new HttpError(401, 'auth.badCredentials');
  }
  if (user.totp?.enabled) {
    // Zweiter Schritt nötig: kurzlebiges Ticket statt Sitzung
    audit({ ip: req.ip, user: { username } }, 'auth.login', { step: 'password-ok', mfa: 'pending' });
    return res.json({ mfaRequired: true, ticket: mfaTicket(user), expiresInSec: MFA_TICKET_MINUTES * 60, passkeyAvailable: relyingParty(req).available && listPasskeysRaw(user.id).length > 0 });
  }
  req.user = user;
  issueSession(req, res, user);
  audit(req, 'auth.login', {});
  res.json({ user: sanitizeUser(user) });
}));

/** Zweiter Schritt: TOTP- oder Wiederherstellungscode gegen das Ticket aus /login. */
router.post('/login/mfa', mfaLimiter, asyncHandler(async (req, res) => {
  const { ticket, code } = z.object({ ticket: z.string().max(1000), code: z.string().min(1).max(64) }).parse(req.body);
  let payload;
  try {
    payload = jwt.verify(ticket, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'auth.mfaTicketExpired');
  }
  const user = payload.purpose === 'mfa' ? getUser(payload.sub) : null;
  if (!user || !user.active || (user.tokenVersion || 0) !== (payload.tv || 0)) throw new HttpError(401, 'auth.mfaTicketExpired');
  const how = await verifyUserTotp(user.id, code);
  if (!how) {
    audit({ ip: req.ip, user: { username: user.username } }, 'auth.login', { reason: 'bad-mfa-code' }, false);
    throw new HttpError(401, 'auth.mfaCodeInvalid');
  }
  req.user = user;
  issueSession(req, res, user);
  audit(req, 'auth.login', { mfa: how });
  res.json({ user: sanitizeUser(user), mfa: how, recoveryCodesLeft: totpStatus(user.id).recoveryCodesLeft });
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

async function requirePassword(req, password) {
  if (!(await bcrypt.compare(String(password || ''), req.user.passwordHash))) throw new HttpError(400, 'auth.currentPasswordWrong');
}

/* ---- Passkeys: Anmeldung ---- */
function userFromMfaTicket(ticket) {
  let payload;
  try {
    payload = jwt.verify(ticket, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'auth.mfaTicketExpired');
  }
  const user = payload.purpose === 'mfa' ? getUser(payload.sub) : null;
  if (!user || !user.active || (user.tokenVersion || 0) !== (payload.tv || 0)) throw new HttpError(401, 'auth.mfaTicketExpired');
  return user;
}

/** Optionen für die Passkey-Anmeldung: ohne Ticket beliebiger Benutzer (Discoverable), mit MFA-Ticket nur dessen Passkeys. */
router.post('/passkey/options', loginLimiter, asyncHandler(async (req, res) => {
  const { ticket } = z.object({ ticket: z.string().max(1000).optional() }).parse(req.body || {});
  const user = ticket ? userFromMfaTicket(ticket) : null;
  res.json(await beginAuthentication(req, { user }));
}));

router.post('/passkey/verify', loginLimiter, asyncHandler(async (req, res) => {
  const { challengeId, response, ticket } = z.object({ challengeId: z.string().max(100), response: z.record(z.string(), z.unknown()), ticket: z.string().max(1000).optional() }).parse(req.body || {});
  const expected = ticket ? userFromMfaTicket(ticket) : null;
  let result;
  try {
    result = await finishAuthentication(req, { challengeId, response });
  } catch (e) {
    audit({ ip: req.ip, user: { username: expected?.username || '?' } }, 'auth.login', { reason: 'bad-passkey', error: e.message }, false);
    throw e;
  }
  if (expected && expected.id !== result.user.id) throw new HttpError(401, 'auth.passkeyUnknown');
  const user = result.user;
  await touchLogin(user.id);
  req.user = user;
  issueSession(req, res, user);
  audit(req, 'auth.login', { passkey: result.passkey.name, mfa: ticket ? 'passkey' : undefined, userVerified: result.userVerified });
  res.json({ user: sanitizeUser(user), mfa: ticket ? 'passkey' : undefined, passkey: result.passkey.name });
}));

/* ---- Passkeys: Verwaltung (angemeldet) ---- */
router.get('/passkeys', requireAuth, (req, res) => {
  const rp = relyingParty(req);
  res.json({ passkeys: listPasskeys(req.user.id), available: rp.available, reason: rp.reason, rpId: rp.rpId });
});

router.post('/passkeys/register/options', requireAuth, asyncHandler(async (req, res) => {
  const { password } = z.object({ password: z.string().max(200) }).parse(req.body || {});
  await requirePassword(req, password);
  res.json(await beginRegistration(req, req.user));
}));

router.post('/passkeys/register/verify', requireAuth, asyncHandler(async (req, res) => {
  const { challengeId, response, name } = z.object({ challengeId: z.string().max(100), response: z.record(z.string(), z.unknown()), name: z.string().max(60).optional() }).parse(req.body || {});
  const pk = await finishRegistration(req, req.user, { challengeId, response, name });
  audit(req, 'auth.passkey-add', { name: pk.name });
  res.json({ ok: true, passkey: { id: pk.id, name: pk.name, createdAt: pk.createdAt }, passkeys: listPasskeys(req.user.id) });
}));

router.patch('/passkeys/:id', requireAuth, asyncHandler(async (req, res) => {
  const { name } = z.object({ name: z.string().min(1).max(60) }).parse(req.body || {});
  const passkeys = await renamePasskey(req.user.id, req.params.id, name);
  res.json({ ok: true, passkeys });
}));

router.post('/passkeys/:id/delete', requireAuth, asyncHandler(async (req, res) => {
  const { password } = z.object({ password: z.string().max(200) }).parse(req.body || {});
  await requirePassword(req, password);
  await removePasskey(req.user.id, req.params.id);
  audit(req, 'auth.passkey-remove', {});
  res.json({ ok: true, passkeys: listPasskeys(req.user.id) });
}));

/* ---- Zweiter Faktor (TOTP) ---- */

router.get('/totp', requireAuth, (req, res) => {
  res.json(totpStatus(req.user.id));
});

/** Einrichtung starten (Passwort bestätigen) → Geheimnis + otpauth-URL; aktiv wird es erst mit /totp/enable. */
router.post('/totp/setup', requireAuth, asyncHandler(async (req, res) => {
  const { password } = z.object({ password: z.string().max(200) }).parse(req.body || {});
  await requirePassword(req, password);
  if (req.user.totp?.enabled) throw new HttpError(400, 'auth.totpAlreadyEnabled');
  res.json(startTotpSetup(req.user.id));
}));

router.post('/totp/enable', requireAuth, asyncHandler(async (req, res) => {
  const { code } = z.object({ code: z.string().min(6).max(10) }).parse(req.body || {});
  const recoveryCodes = await enableTotp(req.user.id, code);
  audit(req, 'auth.totp-enable', {});
  res.json({ ok: true, recoveryCodes, status: totpStatus(req.user.id) });
}));

router.post('/totp/disable', requireAuth, asyncHandler(async (req, res) => {
  const { password, code } = z.object({ password: z.string().max(200), code: z.string().min(1).max(64) }).parse(req.body || {});
  await requirePassword(req, password);
  if (!req.user.totp?.enabled) throw new HttpError(400, 'auth.totpNotEnabled');
  if (!(await verifyUserTotp(req.user.id, code))) throw new HttpError(400, 'auth.totpCodeInvalid');
  await disableTotp(req.user.id);
  audit(req, 'auth.totp-disable', {});
  res.json({ ok: true, status: totpStatus(req.user.id) });
}));

router.post('/totp/recovery-codes', requireAuth, asyncHandler(async (req, res) => {
  const { password, code } = z.object({ password: z.string().max(200), code: z.string().min(1).max(64) }).parse(req.body || {});
  await requirePassword(req, password);
  if (!(await verifyUserTotp(req.user.id, code))) throw new HttpError(400, 'auth.totpCodeInvalid');
  const recoveryCodes = await regenerateRecoveryCodes(req.user.id);
  audit(req, 'auth.totp-recovery-codes', {});
  res.json({ ok: true, recoveryCodes, status: totpStatus(req.user.id) });
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
