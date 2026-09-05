import { z } from 'zod';
import { t, hasKey } from '../i18n/index.js';
import { resolveLocale } from './locale.js';

/**
 * HTTP-Fehler mit übersetzbarem Schlüssel.
 *   new HttpError(404, 'users.notFound')
 *   new HttpError(400, 'auth.urlScheme', { name: 'Discord' })
 *   new HttpError(400, 'perms.noneSet', { error }, { results })   // 4. Argument = zusätzliche Antwortfelder
 * Ein „Schlüssel“ mit Leerzeichen gilt als fertiger Text (Übergangslösung während der Übersetzung).
 */
export class HttpError extends Error {
  constructor(status, keyOrMessage, params = {}, extra = {}) {
    const literal = typeof keyOrMessage !== 'string' || /\s/.test(keyOrMessage) || !hasKey(keyOrMessage);
    super(keyOrMessage);
    this.status = status;
    if (literal) {
      this.key = null;
      this.params = {};
      this.extra = { ...(params && typeof params === 'object' && !Array.isArray(params) ? params : {}), ...extra };
    } else {
      this.key = keyOrMessage;
      this.params = params || {};
      this.extra = extra || {};
    }
  }

  /** Übersetzter Text für eine Sprache. */
  localized(locale) {
    return this.key ? t(locale, this.key, this.params) : this.message;
  }
}

export class TS3Unavailable extends HttpError {
  constructor(detail) {
    if (detail) super(503, 'errors.ts3.unavailableDetail', { detail });
    else super(503, 'errors.ts3.unavailable');
    this.code = 'TS3_UNAVAILABLE';
  }
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** TS3-Fehler 1281 „database empty result set“ – bedeutet nur: leere Liste (die Fehler-ID kommt als String). */
export const isEmptyResult = (err) => String(err?.id) === '1281';

/** Führt eine Listenabfrage aus und liefert bei „leerer Ergebnismenge“ ein leeres Array. */
export async function listOrEmpty(promise) {
  try {
    return await promise;
  } catch (e) {
    if (isEmptyResult(e)) return [];
    throw e;
  }
}

export function notFound(req, res) {
  res.status(404).json({ error: t(resolveLocale(req), 'errors.notFound'), key: 'errors.notFound' });
}

const zodLocales = { de: z.locales.de(), en: z.locales.en() };

function zodMessage(issue, locale) {
  if (typeof issue.message === 'string' && hasKey(issue.message)) return t(locale, issue.message);
  try {
    const m = zodLocales[locale]?.localeError?.(issue);
    if (typeof m === 'string' && m) return m;
    if (m && typeof m === 'object' && typeof m.message === 'string') return m.message;
  } catch { /* Fallback auf Originalmeldung */ }
  return issue.message;
}

// eslint-disable-next-line no-unused-vars
export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) return;
  const locale = resolveLocale(req);
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.localized(locale), key: err.key || undefined, params: err.key && Object.keys(err.params).length ? err.params : undefined, ...err.extra });
  }
  if (err?.name === 'ZodError') {
    const issues = (err.issues || []).map((i) => `${i.path.join('.') || 'body'}: ${zodMessage(i, locale)}`);
    return res.status(400).json({ error: t(locale, 'errors.validation', { issues: issues.join('; ') }), key: 'errors.validation', issues });
  }
  if (err?.name === 'ResponseError' || (err?.id !== undefined && err?.msg !== undefined)) {
    // Fehler des TeamSpeak-Servers (ServerQuery) – die Meldung kommt englisch vom Server
    const detail = [err.msg, err.extraMsg].filter(Boolean).join(' – ');
    return res.status(400).json({ error: t(locale, 'errors.ts3Prefix', { detail: detail || err.message }), key: 'errors.ts3Prefix', ts3ErrorId: err.id });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: t(locale, 'errors.tooLarge'), key: 'errors.tooLarge' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: t(locale, 'errors.badJson'), key: 'errors.badJson' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: t(locale, 'errors.internal'), key: 'errors.internal', detail: err?.message });
}
