/**
 * Simulierter WebAuthn-Authenticator für Tests: ES256-Schlüsselpaar, Attestation „none“,
 * Assertion mit Zähler. Erzeugt genau die JSON-Strukturen, die @simplewebauthn/browser liefern würde.
 */
import crypto from 'node:crypto';

/* ---- minimaler CBOR-Encoder (Ganzzahl, Byte-String, Text, Array, Map) ---- */
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
export function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v.entries()].flatMap(([k, val]) => [cbor(k), cbor(val)])]);
  if (v && typeof v === 'object') { const e = Object.entries(v); return Buffer.concat([head(5, e.length), ...e.flatMap(([k, val]) => [cbor(k), cbor(val)])]); }
  throw new Error(`cbor: unsupported ${typeof v}`);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();
const FLAG_UP = 0x01; const FLAG_UV = 0x04; const FLAG_AT = 0x40;

export function createAuthenticator({ rpId, origin, userVerification = true, transports = ['internal'] }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = crypto.randomBytes(32);
  let counter = 0;
  const flags = FLAG_UP | (userVerification ? FLAG_UV : 0);
  const coseKey = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);

  return {
    credentialId: b64url(credId),
    /** Antwort auf generateRegistrationOptions() */
    register(options) {
      counter = 0;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
      const c = Buffer.alloc(4); c.writeUInt32BE(counter);
      const credLen = Buffer.alloc(2); credLen.writeUInt16BE(credId.length);
      const authData = Buffer.concat([sha256(rpId), Buffer.from([flags | FLAG_AT]), c, Buffer.alloc(16), credLen, credId, cbor(coseKey)]);
      const attestationObject = cbor({ fmt: 'none', attStmt: {}, authData });
      return { id: b64url(credId), rawId: b64url(credId), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {}, response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports } };
    },
    /** Antwort auf generateAuthenticationOptions(); userHandle = Benutzer-ID für Discoverable Credentials */
    authenticate(options, { userHandle = null, counterOverride = null } = {}) {
      if (counterOverride === null) counter += 1;
      const used = counterOverride ?? counter;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
      const c = Buffer.alloc(4); c.writeUInt32BE(used);
      const authData = Buffer.concat([sha256(rpId), Buffer.from([flags]), c]);
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), { key: privateKey, dsaEncoding: 'der' });
      return { id: b64url(credId), rawId: b64url(credId), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {}, response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature), userHandle: userHandle ? b64url(Buffer.from(userHandle)) : null } };
    },
  };
}
