import { getSettings } from './settings.js';
import { normalizeLocale, pickLocale, DEFAULT_LOCALE, t } from '../i18n/index.js';

/**
 * Sprache einer Anfrage: X-Locale-Header der Oberfläche (zeigt, was der Benutzer gerade sieht)
 * → persönliche Einstellung → systemweite Einstellung → Accept-Language → Englisch.
 */
export function resolveLocale(req) {
  return (
    normalizeLocale(req?.get?.('x-locale'))
    || normalizeLocale(req?.user?.language)
    || systemLocale()
    || pickLocale(req?.get?.('accept-language'))
    || DEFAULT_LOCALE
  );
}

/** Systemweite Sprache (Einstellungen), Fallback Englisch. */
export function systemLocale() {
  return normalizeLocale(getSettings().language) || DEFAULT_LOCALE;
}

/** Sprache eines Benutzers (persönlich, sonst systemweit). */
export function userLocale(user) {
  return normalizeLocale(user?.language) || systemLocale();
}

/** Übersetzer für eine Anfrage. */
export const tr = (req) => {
  const locale = resolveLocale(req);
  return (key, params) => t(locale, key, params);
};

/** Übersetzer in Systemsprache (Protokolle, Zeitpläne, Watchdog). */
export const ts = (key, params) => t(systemLocale(), key, params);
