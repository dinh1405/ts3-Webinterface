import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, makeAdmin } from './helpers.mjs';
import { createAuthenticator } from './fake-authenticator.mjs';

const XHR = 'XMLHttpRequest';
const HOST = 'localhost'; // localhost gilt als sicherer Kontext → Passkeys verfügbar ohne HTTPS
let app;
let admin;
let auth; // simulierter Authenticator

/** Agent mit Host-Header localhost (Relying Party) und CSRF-Header. */
function agentFor() {
  const agent = request.agent(app);
  return {
    get: (u) => agent.get(u).set('Host', HOST),
    post: (u, b) => agent.post(u).set('Host', HOST).set('X-Requested-With', XHR).send(b ?? {}),
    patch: (u, b) => agent.patch(u).set('Host', HOST).set('X-Requested-With', XHR).send(b ?? {}),
  };
}
async function login(api, creds) {
  const r = await api.post('/api/auth/login', creds);
  expect(r.status).toBe(200);
  return r.body;
}

describe('passkeys', () => {
  beforeAll(async () => {
    app = await createTestApp();
    admin = await makeAdmin('admin', 'Sicheres-Kennwort-2026');
    auth = createAuthenticator({ rpId: HOST, origin: `http://${HOST}` });
  });

  it('is available on localhost but not via an IP address or plain http', async () => {
    const viaIp = await request(app).get('/api/auth/setup-status').set('Host', '192.0.2.10:8088');
    expect(viaIp.body.passkeys).toEqual({ available: false, reason: 'ipHost' });
    const viaHttp = await request(app).get('/api/auth/setup-status').set('Host', 'ts.example.org');
    expect(viaHttp.body.passkeys).toEqual({ available: false, reason: 'insecure' });
    const local = await request(app).get('/api/auth/setup-status').set('Host', HOST);
    expect(local.body.passkeys).toEqual({ available: true, reason: null });
    // PUBLIC_URL mit https für denselben Host macht die Anfrage vertrauenswürdig (Proxy ohne TRUST_PROXY)
    const { config } = await import('../../server/config.js');
    const before = config.publicUrl;
    config.publicUrl = 'https://ts.example.org';
    const proxied = await request(app).get('/api/auth/setup-status').set('Host', 'ts.example.org');
    config.publicUrl = before;
    expect(proxied.body.passkeys.available).toBe(true);
  });

  it('registers a passkey after confirming the password and lists it', async () => {
    const api = agentFor();
    await login(api, admin);
    expect((await api.get('/api/auth/passkeys')).body).toMatchObject({ passkeys: [], available: true, rpId: HOST });
    expect((await api.post('/api/auth/passkeys/register/options', { password: 'falsch' })).body.key).toBe('auth.currentPasswordWrong');
    const opts = await api.post('/api/auth/passkeys/register/options', { password: admin.password });
    expect(opts.status).toBe(200);
    expect(opts.body.options.rp).toMatchObject({ id: HOST, name: 'TS3 Webinterface' });
    expect(opts.body.options.user.name).toBe('admin');
    expect(opts.body.challengeId).toMatch(/^[0-9a-f-]{36}$/);

    // abgelaufene/fremde Challenge
    expect((await api.post('/api/auth/passkeys/register/verify', { challengeId: 'nope', response: auth.register(opts.body.options), name: 'x' })).body.key).toBe('auth.passkeyChallengeExpired');
    const ok = await api.post('/api/auth/passkeys/register/verify', { challengeId: opts.body.challengeId, response: auth.register(opts.body.options), name: 'Laptop' });
    expect(ok.status).toBe(200);
    expect(ok.body.passkeys).toHaveLength(1);
    expect(ok.body.passkeys[0]).toMatchObject({ id: auth.credentialId, name: 'Laptop', deviceType: 'singleDevice', transports: ['internal'] });
    expect(ok.body.passkeys[0].publicKey).toBeUndefined();
    // Challenge ist verbraucht
    expect((await api.post('/api/auth/passkeys/register/verify', { challengeId: opts.body.challengeId, response: auth.register(opts.body.options) })).status).toBe(400);
    const me = await api.get('/api/auth/me');
    expect(me.body.user.passkeyCount).toBe(1);
    // umbenennen
    expect((await api.patch(`/api/auth/passkeys/${auth.credentialId}`, { name: 'Arbeitsrechner' })).body.passkeys[0].name).toBe('Arbeitsrechner');
  });

  it('signs in with the passkey without a password (discoverable) and rejects replays and wrong origins', async () => {
    const api = agentFor();
    const opts = await api.post('/api/auth/passkey/options', {});
    expect(opts.status).toBe(200);
    expect(opts.body.options.allowCredentials ?? []).toHaveLength(0);
    const adminUser = (await import('../../server/lib/users.js')).findByUsername('admin');
    const assertion = auth.authenticate(opts.body.options, { userHandle: adminUser.id });
    const ok = await api.post('/api/auth/passkey/verify', { challengeId: opts.body.challengeId, response: assertion });
    expect(ok.status).toBe(200);
    expect(ok.body.user.username).toBe('admin');
    expect(ok.body.passkey).toBe('Arbeitsrechner');
    expect((await api.get('/api/auth/me')).body.user.username).toBe('admin');
    expect((await api.get('/api/auth/passkeys')).body.passkeys[0].lastUsedAt).toBeTruthy();

    // Wiederholung derselben Antwort → Challenge verbraucht
    const again = agentFor();
    expect((await again.post('/api/auth/passkey/verify', { challengeId: opts.body.challengeId, response: assertion })).status).toBe(400);
    // (Fehlversuche zählen für die Login-Ratenbegrenzung – LOGIN_RATE_MAX=5 in den Tests, deshalb sparsam)
    // Zähler darf nicht zurückgehen (geklonter Authenticator)
    const o3 = await again.post('/api/auth/passkey/options', {});
    const cloned = auth.authenticate(o3.body.options, { counterOverride: 0 });
    expect((await again.post('/api/auth/passkey/verify', { challengeId: o3.body.challengeId, response: cloned })).status).toBe(401);
    // Unbekannter Passkey
    const other = createAuthenticator({ rpId: HOST, origin: `http://${HOST}` });
    const o4 = await again.post('/api/auth/passkey/options', {});
    expect((await again.post('/api/auth/passkey/verify', { challengeId: o4.body.challengeId, response: other.authenticate(o4.body.options) })).body.key).toBe('auth.passkeyUnknown');
  });

  it('replaces the TOTP step with a passkey when both are set up', async () => {
    const { totp } = await import('../../server/lib/totp.js');
    const api = agentFor();
    await login(api, admin);
    const setup = await api.post('/api/auth/totp/setup', { password: admin.password });
    expect((await api.post('/api/auth/totp/enable', { code: totp(setup.body.secret) })).status).toBe(200);

    const fresh = agentFor();
    const step1 = await fresh.post('/api/auth/login', admin);
    expect(step1.body).toMatchObject({ mfaRequired: true, passkeyAvailable: true });
    const opts = await fresh.post('/api/auth/passkey/options', { ticket: step1.body.ticket });
    expect(opts.body.options.allowCredentials).toHaveLength(1);
    expect(opts.body.options.allowCredentials[0].id).toBe(auth.credentialId);
    const done = await fresh.post('/api/auth/passkey/verify', { ticket: step1.body.ticket, challengeId: opts.body.challengeId, response: auth.authenticate(opts.body.options) });
    expect(done.status).toBe(200);
    expect(done.body.mfa).toBe('passkey');
    expect((await fresh.get('/api/auth/me')).status).toBe(200);
    expect((await fresh.post('/api/auth/passkey/options', { ticket: 'abc' })).body.key).toBe('auth.mfaTicketExpired');
    // TOTP wieder aus, damit die folgenden Tests ohne zweiten Schritt anmelden können (nächstes Zeitfenster, das aktuelle ist verbraucht)
    expect((await fresh.post('/api/auth/totp/disable', { password: admin.password, code: totp(setup.body.secret, Date.now() + 30000) })).status).toBe(200);
  });

  it('removes passkeys with password confirmation and by admin reset', async () => {
    const api = agentFor();
    await login(api, admin);
    // Zweiter Passkey, dann einen per Passwort entfernen
    const o = await api.post('/api/auth/passkeys/register/options', { password: admin.password });
    const second = createAuthenticator({ rpId: HOST, origin: `http://${HOST}` });
    expect((await api.post('/api/auth/passkeys/register/verify', { challengeId: o.body.challengeId, response: second.register(o.body.options), name: 'Handy' })).body.passkeys).toHaveLength(2);
    expect((await api.post(`/api/auth/passkeys/${second.credentialId}/delete`, { password: 'falsch' })).body.key).toBe('auth.currentPasswordWrong');
    expect((await api.post(`/api/auth/passkeys/${second.credentialId}/delete`, { password: admin.password })).body.passkeys).toHaveLength(1);
    expect((await api.post(`/api/auth/passkeys/${second.credentialId}/delete`, { password: admin.password })).body.key).toBe('auth.passkeyNotFound');
    // Admin-Reset (eigenes Konto als Ziel reicht für den Ablauf)
    const list = await api.get('/api/users');
    const me = list.body.users.find((u) => u.username === 'admin');
    expect(me.passkeyCount).toBe(1);
    expect((await api.post(`/api/users/${me.id}/passkeys/reset`)).status).toBe(200);
    expect((await api.get('/api/auth/passkeys')).body.passkeys).toHaveLength(0);
    const o5 = await api.post('/api/auth/passkey/options', {});
    expect((await agentFor().post('/api/auth/passkey/verify', { challengeId: o5.body.challengeId, response: auth.authenticate(o5.body.options) })).body.key).toBe('auth.passkeyUnknown');
  });
});
