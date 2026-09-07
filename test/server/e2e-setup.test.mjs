import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp } from './helpers.mjs';

/**
 * Ende-zu-Ende über die API: frische Installation → Einrichtungsassistent (Token, Verbindungstest,
 * Übernahme mit Admin-Konto) → angemeldete Sitzung → Verwaltungsaktionen gegen den Simulator.
 */
let app;
let fake;
let token;
let agent;
const PASSWORD = 'e2e-query-pw';
const hdr = (req) => req.set('X-Requested-With', 'XMLHttpRequest').set('X-Setup-Token', token || '');

describe('end-to-end: setup wizard → login → administration', () => {
  beforeAll(async () => {
    const { startFakeQuery } = await import('../fixtures/fakequery.mjs');
    fake = await startFakeQuery({ port: 0, password: PASSWORD });
    app = await createTestApp();
    agent = request.agent(app);
  });
  afterAll(async () => {
    const { ts3 } = await import('../../server/lib/ts3.js');
    await ts3.stop();
    await fake.close();
  });

  it('starts in setup mode and protects the wizard with the token', async () => {
    const { needsSetup, ensureSetupToken } = await import('../../server/lib/setup.js');
    expect(needsSetup()).toBe(true);
    token = ensureSetupToken();
    expect(token).toMatch(/^[a-f0-9]{48}$/);
    // Ohne Token kein Zugriff auf den Assistenten und keine normale API
    expect((await agent.get('/api/setup/state')).status).toBe(401);
    expect((await agent.get('/api/server/status')).status).toBe(401);
    const bad = await agent.post('/api/setup/verify-token').set('X-Requested-With', 'XMLHttpRequest').send({ token: 'f'.repeat(48) });
    expect(bad.status).toBe(401);
    const ok = await agent.post('/api/setup/verify-token').set('X-Requested-With', 'XMLHttpRequest').send({ token });
    expect(ok.body).toMatchObject({ ok: true, needsSetup: true, hasUsers: false });
  });

  it('runs the wizard checks and applies the configuration with the first admin', async () => {
    const state = await hdr(agent.get('/api/setup/state'));
    expect(state.status).toBe(200);
    expect(state.body.setupMode).toBe(true);

    const query = { host: '127.0.0.1', port: fake.port, protocol: 'raw', username: 'serveradmin', password: PASSWORD };
    const wrong = await hdr(agent.post('/api/setup/test-query')).send({ ...query, password: 'nope' });
    expect(wrong.body.ok).toBe(false);
    const probe = await hdr(agent.post('/api/setup/test-query')).send(query);
    expect(probe.body.ok).toBe(true);
    expect(probe.body.servers.length).toBeGreaterThanOrEqual(1);
    expect(probe.body.version.version).toBe('3.13.8');

    const apply = await hdr(agent.post('/api/setup/apply')).send({
      language: 'de', timezone: 'Europe/Berlin',
      config: { ts3: { controlMode: 'none', query } },
      admin: { username: 'first-admin', password: 'Erstes-Passwort-2026' },
    });
    expect(apply.status).toBe(200);
    expect(apply.body.user).toMatchObject({ username: 'first-admin', role: 'admin' });
    expect(apply.headers['set-cookie']?.join(';')).toMatch(/ts3wi_session=/);

    const { needsSetup } = await import('../../server/lib/setup.js');
    expect(needsSetup()).toBe(false);
    const { config } = await import('../../server/config.js');
    expect(config.ts3.query.port).toBe(fake.port);
    // In der Anwendung übernimmt der reconfigure-Hook aus main.js die Neuverbindung; hier ohne Hintergrunddienste manuell
    const { ts3 } = await import('../../server/lib/ts3.js');
    ts3.start();
    const deadline = Date.now() + 10000;
    while (!ts3.connected && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    expect(ts3.connected).toBe(true);
  });

  it('uses the session from the wizard for administration', async () => {
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('first-admin');
    // Assistent ist geschlossen: Token reicht nicht mehr, Recht system.manage schon
    expect((await request(app).get('/api/setup/state').set('X-Setup-Token', token)).status).toBe(401);
    const state = await agent.get('/api/setup/state');
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ needsSetup: false, setupMode: false });

    const status = await agent.get('/api/server/status');
    expect(status.status).toBe(200);
    expect(status.body.query.connected).toBe(true);
    expect(status.body.current.virtualserverName).toBe('Example Community');

    const clients = await agent.get('/api/clients');
    expect(clients.status).toBe(200);
    const list = clients.body.clients ?? clients.body;
    expect(list.some((c) => c.nickname === 'RaccoonKing')).toBe(true);

    // Verwaltungsaktion mit Audit-Eintrag: Servergruppen-Rechte setzen und wieder entfernen
    const put = await agent.put('/api/permissions/servergroup/7').set('X-Requested-With', 'XMLHttpRequest').send({ perms: [{ name: 'b_client_ignore_antiflood', value: 1, skip: false, negate: false }] });
    expect(put.status).toBe(200);
    expect(put.body.results.every((r) => r.ok)).toBe(true);
    const perms = await agent.get('/api/permissions/servergroup/7');
    expect(perms.body.permissions.some((p) => p.name === 'b_client_ignore_antiflood' && p.value === 1)).toBe(true);
    const rm = await agent.post('/api/permissions/servergroup/7/remove').set('X-Requested-With', 'XMLHttpRequest').send({ names: ['b_client_ignore_antiflood'] });
    expect(rm.status).toBe(200);

    const audit = await agent.get('/api/audit?limit=50');
    expect(audit.status).toBe(200);
    const actions = (audit.body.entries ?? audit.body.items ?? audit.body).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['setup.complete']));
  });

  it('rejects login with a wrong password and accepts the right one in a fresh session', async () => {
    const fresh = request.agent(app);
    const bad = await fresh.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ username: 'first-admin', password: 'falsch' });
    expect(bad.status).toBe(401);
    const good = await fresh.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ username: 'first-admin', password: 'Erstes-Passwort-2026' });
    expect(good.status).toBe(200);
    expect((await fresh.get('/api/server/status')).status).toBe(200);
  });
});
