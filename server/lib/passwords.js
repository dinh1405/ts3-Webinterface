/**
 * Eine Passwortregel für alle Wege: Assistent, Benutzerverwaltung, Einladung, eigener Wechsel, CLI.
 *   – mindestens MIN_LENGTH Zeichen, höchstens 200
 *   – nicht gleich dem Benutzernamen (auch nicht als Teil, wenn der Name ≥ 4 Zeichen hat)
 *   – keine Trivialpasswörter (bekannte Wörter, Tastaturreihen, ein einziges wiederholtes Zeichen)
 */
import { HttpError } from './errors.js';

export const MIN_LENGTH = 10;
export const MAX_LENGTH = 200;

// Bewusst kurz: die häufigsten Muster aus öffentlichen Leak-Listen, auf ≥ 10 Zeichen ergänzt/gekürzt geprüft
const COMMON = new Set([
  'password', 'passwort', 'password1', 'passwort1', 'password123', 'passwort123', 'qwertyuiop', 'qwertzuiop', '1234567890', '0123456789',
  '12345678910', '123456789a', 'abcdefghij', 'iloveyou12', 'admin12345', 'administrator', 'teamspeak', 'teamspeak3', 'teamspeak123',
  'serveradmin', 'letmein123', 'welcome123', 'changeme123', 'football123', 'baseball123', 'superman123', 'trustno1234', 'sunshine123',
  'princess123', 'dragon12345', 'monkey12345', 'master12345', 'shadow12345', 'michael123', 'jennifer123', 'computer123', 'internet123',
]);

/** Wirft HttpError(400, …) bei Verstoß; sonst nichts. */
export function validatePassword(password, { username = '' } = {}) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) throw new HttpError(400, 'users.passwordTooShort', { min: MIN_LENGTH });
  if (password.length > MAX_LENGTH) throw new HttpError(400, 'users.passwordTooLong');
  const lower = password.toLowerCase();
  const name = String(username || '').trim().toLowerCase();
  if (name && (lower === name || (name.length >= 4 && lower.includes(name)))) throw new HttpError(400, 'users.passwordUsername');
  const stripped = lower.replace(/[^a-z0-9]/g, '');
  if (COMMON.has(lower) || COMMON.has(stripped)) throw new HttpError(400, 'users.passwordCommon');
  if (/^(.)\1+$/.test(password)) throw new HttpError(400, 'users.passwordCommon');
  // Reine Zahlen- oder Buchstabenfolgen der Tastatur (z. B. 1234567890, qwertzuiopü)
  if (/^(?:0?1234567890?|abcdefghijk?l?m?|qwert[yz]uiop[üu]?|asdfghjkl[öo]?)\d*$/.test(lower)) throw new HttpError(400, 'users.passwordCommon');
}

/** Für die Oberfläche: Regeln als Objekt (Mindestlänge). */
export function passwordPolicy() {
  return { minLength: MIN_LENGTH, maxLength: MAX_LENGTH };
}
