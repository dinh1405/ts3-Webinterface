import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, makeAdmin, loginAgent } from './helpers.mjs';

describe('maintenance lock', () => {
  beforeEach(async () => {
    const m = await import('../../server/lib/maintenance.js');
    m._reset();
  });

  it('allows one operation at a time and nested steps with the parent token', async () => {
    const m = await import('../../server/lib/maintenance.js');
    const outer = m.acquire('restore', { by: 'max' });
    expect(m.status().active).toMatchObject({ kind: 'restore', by: 'max' });
    expect(() => m.acquire('backup', { by: 'other' })).toThrow(expect.objectContaining({ status: 409, key: 'maintenance.busy' }));
    const nested = m.acquire('backup', { by: 'max', parent: outer.token });
    expect(nested.nested).toBe(true);
    m.release(nested); // gibt die äußere Sperre nicht frei
    expect(m.isBusy()).toBe(true);
    expect(() => m.acquire('backup', { parent: 'wrong-token' })).toThrow(expect.objectContaining({ key: 'maintenance.parentMismatch' }));
    m.release(outer);
    expect(m.isBusy()).toBe(false);
  });

  it('withLock releases after errors', async () => {
    const m = await import('../../server/lib/maintenance.js');
    await expect(m.withLock('ts3-update', { by: 'x' }, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(m.isBusy()).toBe(false);
    expect(() => m.acquire('nonsense')).toThrow(/unknown maintenance kind/);
  });

  it('blocks backups while a restore holds the lock and reports the status over the API', async () => {
    const m = await import('../../server/lib/maintenance.js');
    const { applyConfig } = await import('../../server/config.js');
    await applyConfig({ ts3: { dir: process.env.TS3WI_TEST_ROOT, controlMode: 'none' } });
    const app = await createTestApp();
    const admin = await makeAdmin();
    const api = await loginAgent(app, admin);

    let res = await api.get('/api/system/maintenance');
    expect(res.status).toBe(200);
    expect(res.body.active).toBeNull();

    const lease = m.acquire('restore', { by: 'someone', detail: 'ts3-backup_x' });
    res = await api.get('/api/system/maintenance');
    expect(res.body.active).toMatchObject({ kind: 'restore', by: 'someone', detail: 'ts3-backup_x' });

    res = await api.post('/api/backups', { includeLogs: false, label: 'blocked' });
    expect(res.status).toBe(409);
    expect(res.body.key).toBe('maintenance.busy');
    expect(res.body.error).toMatch(/restore/);
    m.release(lease);

    res = await api.get('/api/system/maintenance');
    expect(res.body.active).toBeNull();
  });

  it('requires a session for the maintenance status', async () => {
    const app = await createTestApp();
    const request = (await import('supertest')).default;
    const res = await request(app).get('/api/system/maintenance');
    expect(res.status).toBe(401);
  });
});
