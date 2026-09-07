import request from 'supertest';

/** Express-App ohne Hintergrunddienste (nie main.js importieren – das startet Query, Watchdog und Sampler). */
export async function createTestApp() {
  const { createApp } = await import('../../server/app.js');
  return createApp();
}

/** Legt einen Administrator an (Benutzername/Passwort für loginAgent). */
export async function makeAdmin(username = 'admin', password = 'Test-Passwort-1234') {
  const { createUser } = await import('../../server/lib/users.js');
  await createUser({ username, password, role: 'admin' });
  return { username, password };
}

/** Meldet sich an und liefert einen Agenten mit Sitzungs-Cookie und CSRF-Header. */
export async function loginAgent(app, { username, password }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set('X-Requested-With', 'XMLHttpRequest').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.text}`);
  const post = (url, body) => agent.post(url).set('X-Requested-With', 'XMLHttpRequest').send(body ?? {});
  const put = (url, body) => agent.put(url).set('X-Requested-With', 'XMLHttpRequest').send(body ?? {});
  const del = (url) => agent.delete(url).set('X-Requested-With', 'XMLHttpRequest');
  return { agent, get: (url) => agent.get(url), post, put, del };
}

/**
 * Startet den ServerQuery-Simulator und verbindet das ts3-Modul damit. Muss VOR dem ersten Import
 * eines Servermoduls aufgerufen werden (setzt TS3_QUERY_* in der Umgebung, die config.js beim Import bindet).
 */
export async function withFakeQuery({ password = 'testpw' } = {}) {
  const { startFakeQuery } = await import('../fixtures/fakequery.mjs');
  const fake = await startFakeQuery({ port: 0, password });
  process.env.TS3_QUERY_HOST = '127.0.0.1';
  process.env.TS3_QUERY_PORT = String(fake.port);
  process.env.TS3_QUERY_PASSWORD = password;
  process.env.TS3_QUERY_PROTOCOL = 'raw';
  const { ts3 } = await import('../../server/lib/ts3.js');
  ts3.start();
  const deadline = Date.now() + 10000;
  while (!ts3.connected && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (!ts3.connected) throw new Error(`fake query not connected: ${ts3.lastError}`);
  return { fake, ts3, close: async () => { await ts3.stop(); await fake.close(); } };
}
