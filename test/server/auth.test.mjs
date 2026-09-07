import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, makeAdmin, loginAgent } from './helpers.mjs';

const XHR = 'XMLHttpRequest';
let app;
let admin;

describe('authentication', () => {
  beforeAll(async () => {
    app = await createTestApp();
    admin = await makeAdmin('admin', 'Sicheres-Kennwort-2026');
  });

  it('enforces one password policy everywhere', async () => {
    const { validatePassword } = await import('../../server/lib/passwords.js');
    const bad = (pw, username, key) => { try { validatePassword(pw, { username }); throw new Error('accepted'); } catch (e) { expect(e.key ?? e.message).toBe(key); } };
    bad('kurz12345', 'x', 'users.passwordTooShort');
    bad('max.mustermann1', 'max.mustermann', 'users.passwordUsername');
    bad('password123', 'x', 'users.passwordCommon');
    bad('aaaaaaaaaaaa', 'x', 'users.passwordCommon');
    bad('1234567890', 'x', 'users.passwordCommon');
    expect(() => validatePassword('Korrekt-Pferd-Batterie-9', { username: 'max' })).not.toThrow();

    const api = await loginAgent(app, admin);
    expect((await api.post('/api/users', { username: 'neu', password: 'kurz', role: 'viewer' })).body.key).toBe('users.passwordTooShort');
    expect((await api.post('/api/users', { username: 'neuer', password: 'neuer-neuer-neuer', role: 'viewer' })).body.key).toBe('users.passwordUsername');
    expect((await api.post('/api/users', { username: 'neu', password: 'Ein-gutes-Kennwort-42', role: 'viewer' })).status).toBe(201);
    expect((await api.post('/api/auth/change-password', { currentPassword: 'Sicheres-Kennwort-2026', newPassword: 'passwort123' })).body.key).toBe('users.passwordCommon');
    const status = await request(app).get('/api/auth/setup-status');
    expect(status.body.passwordPolicy).toMatchObject({ minLength: 10 });
  });

  it('changing the password ends other sessions and keeps the current one', async () => {
    const a = await loginAgent(app, admin);
    const b = await loginAgent(app, admin);
    expect((await a.post('/api/auth/change-password', { currentPassword: 'Sicheres-Kennwort-2026', newPassword: 'Neues-Kennwort-2026-x' })).status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    admin = { username: 'admin', password: 'Neues-Kennwort-2026-x' };
  });

  it('runs the full second-factor flow: setup, enable, two-step login, replay protection, recovery code, admin reset', async () => {
    const { totp } = await import('../../server/lib/totp.js');
    const { createUser } = await import('../../server/lib/users.js');
    await createUser({ username: 'mfa-user', password: 'Zweiter-Faktor-Kennwort-7', role: 'operator' });
    const creds = { username: 'mfa-user', password: 'Zweiter-Faktor-Kennwort-7' };
    const api = await loginAgent(app, creds);

    expect((await api.get('/api/auth/totp')).body).toMatchObject({ enabled: false, recoveryCodesLeft: 0 });
    expect((await api.post('/api/auth/totp/setup', { password: 'falsch' })).body.key).toBe('auth.currentPasswordWrong');
    const setup = await api.post('/api/auth/totp/setup', { password: creds.password });
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauth).toMatch(/^otpauth:\/\/totp\/TS3%20Webinterface:mfa-user\?secret=/);
    // Noch nicht aktiv: normale Anmeldung ohne zweiten Schritt
    expect((await request(app).post('/api/auth/login').set('X-Requested-With', XHR).send(creds)).body.user?.username).toBe('mfa-user');

    expect((await api.post('/api/auth/totp/enable', { code: '000000' })).body.key).toBe('auth.totpCodeInvalid');
    const enable = await api.post('/api/auth/totp/enable', { code: totp(setup.body.secret) });
    expect(enable.status).toBe(200);
    expect(enable.body.recoveryCodes).toHaveLength(10);
    expect(enable.body.recoveryCodes[0]).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
    expect((await api.get('/api/auth/me')).body.user).toMatchObject({ totpEnabled: true, recoveryCodesLeft: 10 });

    // Zweistufige Anmeldung
    const fresh = request.agent(app);
    const step1 = await fresh.post('/api/auth/login').set('X-Requested-With', XHR).send(creds);
    expect(step1.status).toBe(200);
    expect(step1.body).toMatchObject({ mfaRequired: true });
    expect(step1.headers['set-cookie']).toBeUndefined();
    expect((await fresh.get('/api/auth/me')).status).toBe(401);
    const wrong = await fresh.post('/api/auth/login/mfa').set('X-Requested-With', XHR).send({ ticket: step1.body.ticket, code: '123456' });
    expect(wrong.status).toBe(401);
    const code = totp(setup.body.secret, Date.now() + 30000); // nächstes Fenster: sicher nicht vom Aktivieren verbraucht
    const step2 = await fresh.post('/api/auth/login/mfa').set('X-Requested-With', XHR).send({ ticket: step1.body.ticket, code });
    expect(step2.status).toBe(200);
    expect(step2.body.mfa).toBe('totp');
    expect((await fresh.get('/api/auth/me')).body.user.username).toBe('mfa-user');
    // Derselbe Code ein zweites Mal → abgelehnt (Replay)
    const again = request.agent(app);
    const t1 = await again.post('/api/auth/login').set('X-Requested-With', XHR).send(creds);
    expect((await again.post('/api/auth/login/mfa').set('X-Requested-With', XHR).send({ ticket: t1.body.ticket, code })).status).toBe(401);
    // Wiederherstellungscode: einmal gültig
    const rc = enable.body.recoveryCodes[3];
    const r1 = await again.post('/api/auth/login/mfa').set('X-Requested-With', XHR).send({ ticket: t1.body.ticket, code: rc });
    expect(r1.status).toBe(200);
    expect(r1.body).toMatchObject({ mfa: 'recovery', recoveryCodesLeft: 9 });
    const t2 = await request(app).post('/api/auth/login').set('X-Requested-With', XHR).send(creds);
    expect((await request(app).post('/api/auth/login/mfa').set('X-Requested-With', XHR).send({ ticket: t2.body.ticket, code: rc })).status).toBe(401);
    // Ungültiges Ticket
    expect((await request(app).post('/api/auth/login/mfa').set('X-Requested-With', XHR).send({ ticket: 'abc', code: '123456' })).body.key).toBe('auth.mfaTicketExpired');

    // Admin setzt den zweiten Faktor zurück → normale Anmeldung
    const adminApi = await loginAgent(app, admin);
    const list = await adminApi.get('/api/users');
    const u = list.body.users.find((x) => x.username === 'mfa-user');
    expect(u.totpEnabled).toBe(true);
    expect((await adminApi.post(`/api/users/${u.id}/totp/reset`)).status).toBe(200);
    const plain = await request(app).post('/api/auth/login').set('X-Requested-With', XHR).send(creds);
    expect(plain.body.user?.totpEnabled).toBe(false);
  });

  it('reports degraded health without a query connection and 503 in strict mode', async () => {
    const h = await request(app).get('/api/health');
    expect(h.status).toBe(200);
    expect(h.body.status).toBe('degraded');
    expect((await request(app).get('/api/health?strict=1')).status).toBe(503);
  });

  it('protects the login with a rate limit per IP (LOGIN_RATE_MAX=5 in tests)', async () => {
    const agent = request.agent(app);
    let last;
    for (let i = 0; i < 5; i++) last = await agent.post('/api/auth/login').set('X-Requested-With', XHR).send({ username: 'ghost', password: 'falsch-falsch-1' });
    expect(last.status).toBe(401);
    const blocked = await agent.post('/api/auth/login').set('X-Requested-With', XHR).send({ username: 'ghost', password: 'falsch-falsch-1' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.key).toBe('auth.rateLimited');
  });
});
