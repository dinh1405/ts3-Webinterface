/**
 * TOTP (RFC 6238, SHA-1, 6 Stellen, 30 s) und Wiederherstellungscodes – ohne Abhängigkeiten.
 * Kompatibel mit Google Authenticator, Aegis, Authy, 1Password, Bitwarden, Microsoft Authenticator.
 */
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Neues Geheimnis (20 Byte = 160 Bit) als Base32. */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBase32, counter, digits = 6) {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

/** Aktueller Code (oder für einen bestimmten Zeitpunkt in ms). */
export function totp(secretBase32, nowMs = Date.now(), period = 30) {
  return hotp(secretBase32, Math.floor(nowMs / 1000 / period));
}

/**
 * Prüft einen Code mit Toleranz von ±window Zeitfenstern (Uhrenabweichung). Liefert den Zähler des
 * passenden Fensters (für Replay-Schutz) oder null.
 */
export function verifyTotp(secretBase32, code, { nowMs = Date.now(), window = 1, period = 30 } = {}) {
  const wanted = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(wanted)) return null;
  const counter = Math.floor(nowMs / 1000 / period);
  for (let i = -window; i <= window; i++) {
    const c = counter + i;
    const expected = hotp(secretBase32, c);
    if (expected.length === wanted.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(wanted))) return c;
  }
  return null;
}

/** otpauth://-URL für QR-Codes. */
export function otpauthUrl({ issuer, account, secret }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Wiederherstellungscodes im Format xxxxx-xxxxx (Kleinbuchstaben/Ziffern ohne verwechselbare Zeichen). */
export function generateRecoveryCodes(count = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const one = () => {
    const bytes = crypto.randomBytes(10);
    let s = '';
    for (let i = 0; i < 10; i++) s += chars[bytes[i] % chars.length];
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  };
  return Array.from({ length: count }, one);
}

export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(String(code).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
}
