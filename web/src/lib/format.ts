import { getLocale, INTL_TAG, t, type Locale } from '../i18n';

/**
 * Formatierung, gebunden an die aktive Oberflächensprache. Alle Funktionen lesen die
 * Sprache beim Aufruf; Komponenten rendern bei Sprachwechsel über `useT()`/`useLocale()` neu.
 */

const cache = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat | Intl.NumberFormat>();
function fmt<T>(key: string, make: () => T): T {
  const k = `${getLocale()}:${key}`;
  let f = cache.get(k) as T | undefined;
  if (!f) { f = make(); cache.set(k, f as never); }
  return f;
}
const tag = () => INTL_TAG[getLocale() as Locale];

export function formatBytes(n: number | string | null | undefined, digits = 1): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  let x = v;
  do {
    x /= 1024;
    i++;
  } while (x >= 1024 && i < units.length - 1);
  const nf = fmt(`num${digits}`, () => new Intl.NumberFormat(tag(), { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return `${nf.format(x)} ${units[i]}`;
}

export function formatBitrate(bytesPerSec: number | string | null | undefined): string {
  const v = Number(bytesPerSec);
  if (!Number.isFinite(v)) return '–';
  return `${formatBytes(v, 1)}/s`;
}

export function formatDuration(seconds: number | string | null | undefined): string {
  const s = Math.floor(Number(seconds));
  if (!Number.isFinite(s) || s < 0) return '–';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const U = { d: t('unit.day'), h: t('unit.hour'), m: t('unit.minute'), s: t('unit.second') };
  if (d > 0) return `${d} ${U.d} ${h} ${U.h} ${m} ${U.m}`;
  if (h > 0) return `${h} ${U.h} ${m} ${U.m}`;
  if (m > 0) return `${m} ${U.m} ${sec} ${U.s}`;
  return `${sec} ${U.s}`;
}

/** Kompakte Dauer für Kacheln: „3 T 2 h“, „5 h 12 min“, „42 min“. */
export function formatDurationShort(seconds: number | null | undefined): string {
  const s = Math.floor(Number(seconds));
  if (!Number.isFinite(s) || s < 0) return '–';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} ${t('unit.day')} ${h} ${t('unit.hour')}`;
  if (h > 0) return `${h} ${t('unit.hour')} ${m} ${t('unit.minute')}`;
  return `${m} ${t('unit.minute')}`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '–';
  return formatDuration(Math.round(ms / 1000));
}

function toDate(input: string | number | Date): Date {
  return typeof input === 'number' ? new Date(input < 1e12 ? input * 1000 : input) : new Date(input);
}

export function formatDate(input: string | number | Date | null | undefined, withSeconds = false): string {
  if (input === null || input === undefined || input === '' || input === 0) return '–';
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '–';
  const f = withSeconds
    ? fmt('dateSec', () => new Intl.DateTimeFormat(tag(), { dateStyle: 'medium', timeStyle: 'medium' }))
    : fmt('date', () => new Intl.DateTimeFormat(tag(), { dateStyle: 'medium', timeStyle: 'short' }));
  return f.format(d);
}

/** Nur Datum, kurz („05.09.26“ / „05/09/2026“). */
export function formatShortDate(input: string | number | Date | null | undefined): string {
  if (input === null || input === undefined || input === '' || input === 0) return '–';
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '–';
  return fmt('shortDate', () => new Intl.DateTimeFormat(tag(), { dateStyle: 'short' })).format(d);
}

/** Tag und Monat („05.09.“ / „05/09“). */
export function formatDayMonth(input: string | number | Date): string {
  return fmt('dayMonth', () => new Intl.DateTimeFormat(tag(), { day: '2-digit', month: '2-digit' })).format(toDate(input));
}

/** Uhrzeit mit Sekunden („11:00:05“). */
export function formatTime(input: string | number | Date | null | undefined, withSeconds = true): string {
  if (input === null || input === undefined || input === '') return '–';
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return '–';
  return fmt(withSeconds ? 'timeSec' : 'time', () => new Intl.DateTimeFormat(tag(), { hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hour12: false })).format(d);
}

export function formatRelative(input: string | number | Date | null | undefined): string {
  if (!input) return '–';
  const d = toDate(input);
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = fmt('rtf', () => new Intl.RelativeTimeFormat(tag(), { numeric: 'auto' }));
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function formatNumber(n: number | string | null | undefined, digits = 0): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '–';
  return fmt(`n${digits}`, () => new Intl.NumberFormat(tag(), { maximumFractionDigits: digits })).format(v);
}

export function banDuration(seconds: number): string {
  if (!seconds) return t('common.permanent');
  return formatDuration(seconds);
}

/** Dauer-Vorgaben für Bans (sprachabhängig, daher als Funktion). */
export function durationPresets(): { label: string; seconds: number }[] {
  return [
    { label: t('common.permanent'), seconds: 0 },
    { label: t('duration.10min'), seconds: 600 },
    { label: t('duration.1h'), seconds: 3600 },
    { label: t('duration.1d'), seconds: 86400 },
    { label: t('duration.1w'), seconds: 7 * 86400 },
    { label: t('duration.30d'), seconds: 30 * 86400 },
  ];
}

/** Wochentagsnamen, Index 0 = Sonntag (wie JavaScript). */
export function weekdayNames(style: 'long' | 'short' = 'long'): string[] {
  const f = fmt(`wd${style}`, () => new Intl.DateTimeFormat(tag(), { weekday: style }));
  // 2023-01-01 war ein Sonntag
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2023, 0, 1 + i, 12))));
}

export function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
