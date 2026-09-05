/**
 * Leichtgewichtige Übersetzung für Servermeldungen (Fehler, Benachrichtigungen, Protokolle).
 *
 *   t('en', 'errors.notFound')                     → 'Not found'
 *   t('de', 'users.taken', { username: 'max' })    → 'Der Benutzername „max“ ist bereits vergeben'
 *   Plural: Schlüssel `x_one` / `x_other` werden gewählt, wenn params.count eine Zahl ist.
 */
import de from './de.js';
import en from './en.js';

export const SUPPORTED_LOCALES = ['de', 'en'];
export const DEFAULT_LOCALE = 'en';
const dicts = { de, en };
const warned = new Set();

export function isLocale(v) {
  return SUPPORTED_LOCALES.includes(v);
}

export function normalizeLocale(v) {
  if (!v) return null;
  const base = String(v).trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
}

/** Wertet einen Accept-Language-Header aus (erste unterstützte Sprache nach Gewicht). */
export function pickLocale(header) {
  if (!header) return null;
  const ranked = String(header)
    .split(',')
    .map((part, i) => {
      const [tag, ...rest] = part.trim().split(';');
      const q = rest.map((r) => r.trim()).find((r) => r.startsWith('q='));
      return { tag, q: q ? parseFloat(q.slice(2)) || 0 : 1, i };
    })
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const r of ranked) {
    const l = normalizeLocale(r.tag);
    if (l) return l;
  }
  return null;
}

function interpolate(str, params) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
}

export function hasKey(key) {
  return Object.prototype.hasOwnProperty.call(en, key);
}

export function t(locale, key, params = {}) {
  const dict = dicts[locale] || dicts[DEFAULT_LOCALE];
  let k = key;
  if (typeof params.count === 'number') {
    const rule = new Intl.PluralRules(locale === 'de' ? 'de' : 'en').select(params.count);
    if (dict[`${key}_${rule}`]) k = `${key}_${rule}`;
    else if (dict[`${key}_other`]) k = `${key}_other`;
  }
  const str = dict[k] ?? dicts[DEFAULT_LOCALE][k];
  if (str === undefined) {
    if (process.env.NODE_ENV !== 'production' && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] fehlender Schlüssel: ${key}`);
    }
    return key;
  }
  return interpolate(str, params);
}

/** Übersetzer, der die Sprache bereits kennt. */
export const translator = (locale) => (key, params) => t(locale, key, params);
