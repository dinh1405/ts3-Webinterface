import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, makeAdmin, loginAgent, withFakeQuery } from './helpers.mjs';

let fq; let api; let viewer;
const OTTO = 'dB0nLyUsEr00000000000000001='; // Offline Otto (nur in der Datenbank)

describe('offline messages', () => {
  beforeAll(async () => {
    fq = await withFakeQuery();
    const app = await createTestApp();
    api = await loginAgent(app, await makeAdmin());
    const { createUser } = await import('../../server/lib/users.js');
    await createUser({ username: 'viewer', password: 'Viewer-Passwort-1234', role: 'viewer' });
    viewer = await loginAgent(app, { username: 'viewer', password: 'Viewer-Passwort-1234' });
  });
  afterAll(async () => { await fq?.close(); });

  it('lists the inbox with resolved nicknames and unread count', async () => {
    const res = await api.get('/api/messages');
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.unread).toBe(1);
    expect(res.body.account).toBe('serveradmin');
    const m = res.body.messages.find((x) => !x.read);
    expect(m.nickname).toBe('RaccoonKing');
    expect(m.subject).toMatch(/music bot/);
    const unread = await api.get('/api/messages/unread-count');
    expect(unread.body.count).toBe(1);
  });

  it('reads a message, marks it read and unread again', async () => {
    const list = (await api.get('/api/messages')).body.messages;
    const id = list.find((x) => !x.read).id;
    const res = await api.get(`/api/messages/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/too loud/);
    expect((await api.post(`/api/messages/${id}/read`, { read: true })).status).toBe(200);
    expect((await api.get('/api/messages/unread-count')).body.count).toBe(0);
    expect((await api.post(`/api/messages/${id}/read`, { read: false })).status).toBe(200);
    expect((await api.get('/api/messages/unread-count')).body.count).toBe(1);
    expect((await api.get('/api/messages/999')).status).toBe(404);
    expect((await api.get('/api/messages/abc')).status).toBe(400);
  });

  it('sends an offline message to a client that is not online', async () => {
    const before = fq.fake.state.messages.length;
    const res = await api.post('/api/messages', { uid: OTTO, subject: 'Hello', message: 'See you at the event!' });
    expect(res.status).toBe(200);
    expect(res.body.nickname).toBe('Offline Otto');
    expect(fq.fake.state.messages).toHaveLength(before + 1);
    expect(fq.fake.state.messages.at(-1)).toMatchObject({ cluid: OTTO, subject: 'Hello', message: 'See you at the event!' });
    // unbekannte UID → 404, ungültige UID → 400
    expect((await api.post('/api/messages', { uid: 'unknownUidThatIsLongEnough00=', subject: 'x', message: 'y' })).status).toBe(404);
    expect((await api.post('/api/messages', { uid: 'short', subject: 'x', message: 'y' })).status).toBe(400);
  });

  it('deletes a message and enforces capabilities', async () => {
    const list = (await api.get('/api/messages')).body.messages;
    const id = list[0].id;
    expect((await api.del(`/api/messages/${id}`)).status).toBe(200);
    expect((await api.get('/api/messages')).body.messages.some((m) => m.id === id)).toBe(false);
    // Beobachter: standardmäßig weder lesen noch senden
    expect((await viewer.get('/api/messages')).status).toBe(403);
    expect((await viewer.post('/api/messages', { uid: OTTO, subject: 'x', message: 'y' })).status).toBe(403);
  });
});
