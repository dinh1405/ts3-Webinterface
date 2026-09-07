/**
 * Passkeys (WebAuthn/FIDO2) über @simplewebauthn/server.
 *   – Registrierung unter „Mein Konto“ (Passwort bestätigen → Browser-Dialog → Name)
 *   – Anmeldung ohne Passwort (Discoverable Credential) oder als zweiter Schritt statt TOTP
 * Relying Party = Hostname der Anfrage; verfügbar nur über HTTPS (oder localhost) und nicht über eine IP-Adresse.
 * Offene Challenges liegen 5 Minuten im Speicher (challengeId → Challenge, Benutzer, Zweck).
 */
import crypto from 'node:crypto';
import net from 'node:net';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import { getUser, listPasskeysRaw, addPasskey, findUserByCredential, bumpPasskey } from './users.js';

export const RP_NAME = 'TS3 Webinterface';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const ALGORITHMS = [-7, -257]; // ES256, RS256 – keine Post-Quantum-Algorithmen (experimentell in Node)
const challenges = new Map();

function putChallenge(entry) {
  for (const [k, v] of challenges) if (v.expires < Date.now()) challenges.delete(k);
  const id = crypto.randomUUID();
  challenges.set(id, { ...entry, expires: Date.now() + CHALLENGE_TTL_MS });
  return id;
}

function takeChallenge(id, purpose) {
  const c = challenges.get(String(id || ''));
  if (c) challenges.delete(id);
  if (!c || c.purpose !== purpose || c.expires < Date.now()) throw new HttpError(400, 'auth.passkeyChallengeExpired');
  return c;
}

const toB64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => new Uint8Array(Buffer.from(String(s), 'base64url'));

/**
 * Relying-Party-Daten aus der Anfrage: Hostname ohne Port, Ursprung mit Protokoll.
 * Hinter einem Proxy ohne TRUST_PROXY meldet Express http; ist PUBLIC_URL für denselben Host gesetzt, gilt dessen Protokoll.
 */
export function relyingParty(req) {
  const hostHeader = String(req.get('host') || 'localhost');
  const hostname = hostHeader.startsWith('[') ? hostHeader.slice(1, hostHeader.indexOf(']')) : hostHeader.split(':')[0];
  let proto = req.protocol || 'http';
  if (config.publicUrl) {
    try {
      const pu = new URL(config.publicUrl);
      if (pu.hostname.toLowerCase() === hostname.toLowerCase()) proto = pu.protocol.replace(':', '');
    } catch { /* ungültige PUBLIC_URL */ }
  }
  // Browser verlangen einen Domainnamen als Relying Party – auch 127.0.0.1 ist ausgeschlossen; localhost gilt als sicher
  const local = hostname === 'localhost' || hostname.endsWith('.localhost');
  let reason = null;
  if (net.isIP(hostname)) reason = 'ipHost';
  else if (proto !== 'https' && !local) reason = 'insecure';
  return { available: !reason, reason, rpId: hostname, origin: `${proto}://${hostHeader}` };
}

function requireAvailable(req) {
  const rp = relyingParty(req);
  if (!rp.available) throw new HttpError(400, rp.reason === 'ipHost' ? 'auth.passkeyIpHost' : 'auth.passkeyInsecure');
  return rp;
}

/* ---------------- Registrierung ---------------- */

export async function beginRegistration(req, user) {
  const rp = requireAvailable(req);
  const existing = listPasskeysRaw(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpId,
    userID: new Uint8Array(Buffer.from(user.id)),
    userName: user.username,
    userDisplayName: user.displayName || user.username,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    supportedAlgorithmIDs: ALGORITHMS,
  });
  const challengeId = putChallenge({ challenge: options.challenge, userId: user.id, purpose: 'register', rp });
  return { options, challengeId };
}

export async function finishRegistration(req, user, { challengeId, response, name }) {
  const c = takeChallenge(challengeId, 'register');
  if (c.userId !== user.id) throw new HttpError(400, 'auth.passkeyChallengeExpired');
  const rp = relyingParty(req);
  let v;
  try {
    v = await verifyRegistrationResponse({ response, expectedChallenge: c.challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpId, requireUserVerification: false, supportedAlgorithmIDs: ALGORITHMS });
  } catch (e) {
    throw new HttpError(400, 'auth.passkeyVerifyFailed', { error: e.message });
  }
  if (!v.verified || !v.registrationInfo) throw new HttpError(400, 'auth.passkeyVerifyFailed', { error: 'not verified' });
  const { credential, credentialDeviceType, credentialBackedUp, aaguid } = v.registrationInfo;
  const pk = {
    id: credential.id,
    publicKey: toB64url(credential.publicKey),
    counter: credential.counter || 0,
    transports: credential.transports || response?.response?.transports || [],
    name: String(name || '').trim().slice(0, 60) || 'Passkey',
    deviceType: credentialDeviceType || 'singleDevice',
    backedUp: Boolean(credentialBackedUp),
    aaguid: aaguid || null,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  await addPasskey(user.id, pk);
  return pk;
}

/* ---------------- Anmeldung ---------------- */

/** Optionen: mit Benutzer (zweiter Schritt / bekannter Benutzername) eingeschränkt, sonst Discoverable Credential. */
export async function beginAuthentication(req, { user = null } = {}) {
  const rp = requireAvailable(req);
  const allow = user ? listPasskeysRaw(user.id).map((p) => ({ id: p.id, transports: p.transports })) : undefined;
  if (user && !allow.length) throw new HttpError(400, 'auth.passkeyNone');
  const options = await generateAuthenticationOptions({ rpID: rp.rpId, allowCredentials: allow, userVerification: 'preferred' });
  const challengeId = putChallenge({ challenge: options.challenge, userId: user?.id || null, purpose: 'authenticate' });
  return { options, challengeId };
}

/** Prüft die Antwort und liefert den Benutzer (Sitzung stellt der Aufrufer aus). */
export async function finishAuthentication(req, { challengeId, response }) {
  const c = takeChallenge(challengeId, 'authenticate');
  const rp = relyingParty(req);
  const credId = String(response?.id || response?.rawId || '');
  const found = findUserByCredential(credId);
  if (!found || (c.userId && found.user.id !== c.userId)) throw new HttpError(401, 'auth.passkeyUnknown');
  const { user, passkey } = found;
  if (!user.active) throw new HttpError(403, 'users.disabled');
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response,
      expectedChallenge: c.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: false,
      credential: { id: passkey.id, publicKey: fromB64url(passkey.publicKey), counter: passkey.counter || 0, transports: passkey.transports },
    });
  } catch (e) {
    throw new HttpError(401, 'auth.passkeyVerifyFailed', { error: e.message });
  }
  if (!v.verified) throw new HttpError(401, 'auth.passkeyVerifyFailed', { error: 'not verified' });
  await bumpPasskey(user.id, passkey.id, v.authenticationInfo?.newCounter ?? passkey.counter);
  return { user: getUser(user.id), passkey, userVerified: Boolean(v.authenticationInfo?.userVerified) };
}

/** Nur für Tests. */
export function _challengeCount() {
  return challenges.size;
}
