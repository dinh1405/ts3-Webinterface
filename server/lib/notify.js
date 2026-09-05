import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { getSettings } from './settings.js';
import { usersWithNotifications, getUserNotifications, getUser } from './users.js';
import { t } from '../i18n/index.js';
import { systemLocale, userLocale } from './locale.js';

const HISTORY_MAX = 50;
const state = { lastSent: null, lastError: null, history: [] };
let serverNameProvider = () => 'TeamSpeak server';

export const EVENT_KEYS = ['serverDown', 'serverRestarted', 'watchdogGaveUp', 'backupFailed', 'backupDone', 'updateDone', 'updateFailed', 'clientBanned', 'clientKicked', 'loginBlocked', 'queryLost'];

/** Übersetzte Ereignisbezeichnungen (für die Einstellungsoberfläche). */
export function eventLabels(locale) {
  return Object.fromEntries(EVENT_KEYS.map((k) => [k, t(locale, `notifyEvent.${k}`)]));
}

/** Titel und Text eines Ereignisses in einer Sprache aufbauen. */
function render(event, params, locale) {
  const p = { ...params };
  if (event === 'clientBanned' || event === 'clientKicked') {
    p.by = p.invoker ? t(locale, 'notify.by', { invoker: p.invoker }) : '';
    p.reason = p.reason ? t(locale, 'notify.reason', { reason: p.reason }) : '';
    p.nickname = p.nickname || '?';
  }
  if (event === 'backupDone') p.deleted = p.deletedList ? t(locale, 'notify.backupDone.deleted', { list: p.deletedList }) : '';
  return { title: t(locale, `notify.${event}.title`, p), message: t(locale, `notify.${event}.body`, p) };
}

const EVENT_COLORS = {
  serverDown: 0xef4444, watchdogGaveUp: 0xef4444, backupFailed: 0xef4444, updateFailed: 0xef4444, loginBlocked: 0xf59e0b,
  serverRestarted: 0x22c55e, backupDone: 0x22c55e, updateDone: 0x22c55e, clientBanned: 0xf59e0b, clientKicked: 0xf59e0b, queryLost: 0xf59e0b,
};

export function setServerNameProvider(fn) {
  serverNameProvider = fn;
}

export function mailFrom() {
  return getSettings().notifications.email.from || config.mailFrom;
}

export function channelReady(n, channel) {
  switch (channel) {
    case 'discord': return n.discord.enabled && Boolean(n.discord.webhookUrl);
    case 'telegram': return n.telegram.enabled && Boolean(n.telegram.botToken && n.telegram.chatId);
    case 'webhook': return n.webhook.enabled && Boolean(n.webhook.url);
    case 'email': return n.email.enabled && Boolean(n.email.to);
    default: return false;
  }
}

export function notifyState() {
  const s = getSettings().notifications;
  return {
    lastSent: state.lastSent,
    lastError: state.lastError,
    history: state.history,
    channels: { discord: channelReady(s, 'discord'), telegram: channelReady(s, 'telegram'), webhook: channelReady(s, 'webhook'), email: channelReady(s, 'email') },
    mailFrom: mailFrom(),
  };
}

const withTimeout = (ms) => AbortSignal.timeout(ms);

async function sendDiscord(cfg, { event, title, message, server }) {
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'TS3 Webinterface',
      embeds: [{ title, description: message.slice(0, 4000), color: EVENT_COLORS[event] || 0x6366f1, footer: { text: server }, timestamp: new Date().toISOString() }],
    }),
    signal: withTimeout(10000),
  });
  if (!res.ok) throw new Error(`Discord antwortete mit HTTP ${res.status}`);
}

async function sendTelegram(cfg, { title, message, server }) {
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(cfg.botToken)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.chatId, text: `${title}\n\n${message}\n\n— ${server}`, disable_web_page_preview: true }),
    signal: withTimeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.description || `Telegram antwortete mit HTTP ${res.status}`);
}

async function sendWebhook(cfg, payload) {
  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'ts3-webinterface' };
  if (cfg.secret) headers['X-Signature-256'] = `sha256=${crypto.createHmac('sha256', cfg.secret).update(body).digest('hex')}`;
  const res = await fetch(cfg.url, { method: 'POST', headers, body, signal: withTimeout(10000) });
  if (!res.ok) throw new Error(`Webhook antwortete mit HTTP ${res.status}`);
}

function sendEmail(cfg, { title, message, server, locale }) {
  return new Promise((resolve, reject) => {
    const subject = `=?UTF-8?B?${Buffer.from(`[${server}] ${title}`).toString('base64')}?=`;
    const from = cfg.from || mailFrom();
    const mail = [
      `To: ${cfg.to}`,
      `From: ${from}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      `${title}`,
      '',
      message,
      '',
      `-- ${server} · ${new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: getSettings().timezone || 'UTC' }).format(new Date())}`,
      '',
    ].join('\n');
    let stderr = '';
    const child = spawn(cfg.sendmailPath || getSettings().notifications.email.sendmailPath || '/usr/sbin/sendmail', ['-t', '-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('sendmail: timeout')); }, 20000);
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`sendmail: ${e.message}`)); });
    child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`sendmail Exit ${code}: ${stderr.trim()}`)); });
    child.stdin.end(mail);
  });
}

const SENDERS = { discord: sendDiscord, telegram: sendTelegram, webhook: sendWebhook, email: sendEmail };

/** Baut die Ziel-Liste (Kanal + Konfiguration) für ein Ereignis aus globalen und persönlichen Einstellungen. */
function collectTargets(event, opts) {
  const targets = [];
  const global = getSettings().notifications;
  const wants = (n) => opts.force || Boolean(n.events[event]);
  const add = (owner, n, locale) => {
    for (const ch of ['discord', 'telegram', 'webhook', 'email']) {
      if (opts.only && opts.only !== ch) continue;
      if (!channelReady(n, ch)) continue;
      targets.push({ owner, channel: ch, cfg: n[ch], locale });
    }
  };
  if (!opts.userId && wants(global)) add('system', global, systemLocale());
  if (opts.userId) {
    add(opts.username || 'user', getUserNotifications(opts.userId), userLocale(getUser(opts.userId)));
  } else if (!opts.only) {
    for (const u of usersWithNotifications()) if (wants(u.notifications)) add(u.username, u.notifications, userLocale(getUser(u.id)));
  }
  return targets;
}

/**
 * Sendet eine Benachrichtigung an alle passenden Ziele (global + persönliche Einstellungen der Benutzer).
 * @param opts { force: Ereignisfilter ignorieren, only: nur dieser Kanal, userId: nur dieser Benutzer }
 */
export async function notify(event, params = {}, opts = {}) {
  const targets = collectTargets(event, opts);
  if (!targets.length) return { skipped: true, reason: 'no target' };
  const server = serverNameProvider();
  const ts = new Date().toISOString();
  const settled = await Promise.allSettled(targets.map((tg) => {
    const { title, message } = render(event, params, tg.locale);
    return SENDERS[tg.channel](tg.cfg, { event, title, message, server, ts, locale: tg.locale, params });
  }));
  const results = settled.map((r, i) => ({ owner: targets[i].owner, channel: targets[i].channel, ok: r.status === 'fulfilled', error: r.status === 'rejected' ? (r.reason?.message || String(r.reason)) : null }));
  const { title } = render(event, params, systemLocale());
  const entry = { ts, event, title, results };
  state.history.unshift(entry);
  if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
  if (results.some((r) => r.ok)) state.lastSent = ts;
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    state.lastError = failed.map((f) => `${f.owner}/${f.channel}: ${f.error}`).join('; ');
    console.warn(`[notify] ${state.lastError}`);
  }
  return { skipped: false, results };
}

export function testChannel(channel, userId = null, username = null) {
  return notify('test', {}, { force: true, only: channel, userId, username });
}
