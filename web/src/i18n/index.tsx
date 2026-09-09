import { useSyncExternalStore } from 'react';
import type deDict from './de';

/*
 * Wörterbücher werden pro Sprache nachgeladen (eigene Chunks): Beim Start lädt `loadLocale()` nur die
 * aktive Sprache, ein Sprachwechsel lädt die andere bei Bedarf. Die Typen kommen weiterhin aus `de.ts`.
 */
export type Locale = 'de' | 'en';
type Dict = Record<string, string>;
export type MessageKey = keyof typeof deDict;
/** Basis eines Plural-Schlüssels (`x_one`/`x_other` → `x`). */
type PluralBase<K> = K extends `${infer B}_other` ? B : never;
export type TKey = MessageKey | PluralBase<MessageKey>;
export type Params = Record<string, string | number | null | undefined>;

export const LOCALES: Locale[] = ['de', 'en'];
export const LOCALE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' };
/** BCP-47-Tags für Intl-Formatierung. */
export const INTL_TAG: Record<Locale, string> = { de: 'de-DE', en: 'en-GB' };
const STORAGE_KEY = 'ts3wi-lang';

const dicts: Partial<Record<Locale, Dict>> = {};
const loaders: Record<Locale, () => Promise<{ default: Dict }>> = {
  de: () => import('./de') as Promise<{ default: Dict }>,
  en: () => import('./en') as Promise<{ default: Dict }>,
};
const pending: Partial<Record<Locale, Promise<Dict>>> = {};
let current: Locale = readStored() ?? browserLocale() ?? 'de';
const listeners = new Set<() => void>();
const warned = new Set<string>();

/** Lädt ein Wörterbuch (einmalig) und liefert es. */
export function loadLocale(locale: Locale): Promise<Dict> {
  const have = dicts[locale];
  if (have) return Promise.resolve(have);
  const p = pending[locale];
  if (p) return p;
  const next = loaders[locale]().then((m) => { dicts[locale] = m.default; delete pending[locale]; return m.default; });
  pending[locale] = next;
  return next;
}

/** Wörterbuch der Startsprache laden; danach ist `t()` synchron nutzbar. */
export function initLocale(): Promise<void> {
  return loadLocale(current).then(() => { emit(); });
}

/** Zuletzt gespeicherte Sprache dieses Browsers (oder null). */
export function storedLocale(): Locale | null {
  return readStored();
}

function readStored(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

export function isLocale(v: unknown): v is Locale {
  return v === 'de' || v === 'en';
}

export function normalizeLocale(v: unknown): Locale | null {
  if (typeof v !== 'string') return null;
  const base = v.toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
}

/** Browsersprache, falls unterstützt. */
export function browserLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null;
  for (const l of navigator.languages ?? [navigator.language]) {
    const n = normalizeLocale(l);
    if (n) return n;
  }
  return null;
}

export function getLocale(): Locale {
  return current;
}

function emit() { listeners.forEach((fn) => fn()); }

/** Sprache wechseln; das Wörterbuch wird bei Bedarf nachgeladen, die Oberfläche rendert danach neu. */
export function setLocale(next: Locale) {
  if (next === current) return;
  const apply = () => {
    current = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* privat/blockiert */ }
    if (typeof document !== 'undefined') document.documentElement.lang = next;
    emit();
  };
  if (dicts[next]) apply();
  else void loadLocale(next).then(apply).catch((e) => console.error('[i18n] Wörterbuch konnte nicht geladen werden:', e));
}

function interpolate(str: string, params?: Params): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
}

/** Übersetzt einen bekannten Schlüssel (Tippfehler werden vom Typecheck gefunden). */
export function t(key: TKey, params?: Params): string {
  return td(key, params);
}

/** Übersetzt einen dynamischen Schlüssel (z. B. `cap.${key}`); Fallback ist der Schlüssel selbst. */
export function td(key: string, params?: Params, fallback?: string): string {
  const dict = dicts[current] ?? {};
  let k = key;
  if (typeof params?.count === 'number') {
    const rule = new Intl.PluralRules(INTL_TAG[current]).select(params.count);
    if (dict[`${key}_${rule}`]) k = `${key}_${rule}`;
    else if (dict[`${key}_other`]) k = `${key}_other`;
  }
  const str = dict[k] ?? dicts.en?.[k];
  if (str === undefined) {
    if (import.meta.env.DEV && dicts[current] && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] fehlender Schlüssel: ${key}`);
    }
    return fallback ?? key;
  }
  return interpolate(str, params);
}

/** Prüft, ob ein dynamischer Schlüssel existiert (im aktuell geladenen Wörterbuch). */
export function hasKey(key: string): boolean {
  return key in (dicts[current] ?? {});
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Aktuelle Sprache; die Komponente rendert bei Wechsel neu. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/** Übersetzungsfunktion, gebunden an die aktuelle Sprache (rendert bei Wechsel neu). */
export function useT() {
  useLocale();
  return { t, td, locale: current };
}

if (typeof document !== 'undefined') document.documentElement.lang = current;
