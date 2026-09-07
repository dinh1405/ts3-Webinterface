import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, makeAdmin, loginAgent, withFakeQuery } from './helpers.mjs';

let fq; let api;

describe('all files list', () => {
  beforeAll(async () => {
    fq = await withFakeQuery();
    api = await loginAgent(await createTestApp(), await makeAdmin());
  });
  afterAll(async () => { await fq?.close(); });

  it('collects files of every channel and the server storage, without icons', async () => {
    const res = await api.get('/api/files/all');
    expect(res.status).toBe(200);
    const names = res.body.rows.map((r) => `${r.cid}:${r.path}/${r.name}`).sort();
    expect(names).toEqual(['0://avatar_a1b2c3', '3://rules.txt', '3:/screenshots/boss-kill.png', '3:/screenshots/loot.jpg', '7://community-meeting-notes.pdf']);
    expect(res.body.rows.find((r) => r.cid === '3').channelName).toBe('Gaming 1');
    expect(res.body.count).toBe(5);
    expect(res.body.totalSize).toBe(18342 + 812 + 2_411_000 + 933_120 + 148_223);
    expect(res.body.channels).toBe(9);
    expect(res.body.truncated).toBe(false);
    expect(res.body.errors).toEqual([]);
    expect(typeof res.body.cachedAt).toBe('string');
  });

  it('serves the cached result and refreshes on demand', async () => {
    const first = await api.get('/api/files/all');
    const second = await api.get('/api/files/all');
    expect(second.body.cachedAt).toBe(first.body.cachedAt);
    // Datei im Simulator löschen → erst refresh=1 zeigt es
    fq.fake.state.files['7']['/'] = [];
    expect((await api.get('/api/files/all')).body.count).toBe(5);
    const refreshed = await api.get('/api/files/all?refresh=1');
    expect(refreshed.body.count).toBe(4);
    expect(refreshed.body.cachedAt).not.toBe(first.body.cachedAt);
  });
});
