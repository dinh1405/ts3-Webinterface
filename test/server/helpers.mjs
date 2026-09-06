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
