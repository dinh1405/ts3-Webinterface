import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createTestApp, makeAdmin, loginAgent, withFakeQuery } from './helpers.mjs';

let api;
let fq;
let feed;

/** Lokaler Versions-Feed im Format von teamspeak.com/versions/server.json. */
function startFeed(version) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ linux: { x86_64: { version, checksum: 'deadbeef', mirrors: { 'test': `http://127.0.0.1:1/teamspeak3-server_linux_amd64-${version}.tar.bz2` } } } }));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, close: () => new Promise((r) => srv.close(r)) }));
  });
}

describe('auto-update', () => {
  beforeAll(async () => {
    feed = await startFeed('3.99.0');
    process.env.TS3_VERSIONS_URL = `http://127.0.0.1:${feed.port}/server.json`;
    const dir = path.join(process.env.TS3WI_TEST_ROOT, 'ts3');
    fs.mkdirSync(dir, { recursive: true });
    process.env.TS3_DIR = dir;
    fq = await withFakeQuery();
    api = await loginAgent(await createTestApp(), await makeAdmin());
  });
  afterAll(async () => {
    const { _clearAll } = await import('../../server/lib/scheduler.js');
    _clearAll();
    await fq?.close();
    await feed?.close();
  });

  it('has defaults, saves settings and activates the cron task', async () => {
    let res = await api.get('/api/system/autoupdate');
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ enabled: false, frequency: 'daily', time: '04:30', ts3: true, webinterface: true, onlyWhenEmpty: true });
    expect(res.body.cron).toBeNull();
    expect(res.body.nextRun).toBeNull();

    res = await api.put('/api/system/autoupdate', { enabled: true, frequency: 'weekly', weekday: 2, time: '05:15', ts3: true, webinterface: false, onlyWhenEmpty: false, timezone: 'Europe/Berlin' });
    expect(res.status).toBe(200);
    expect(res.body.cron).toBe('15 5 * * 2');
    expect(res.body.nextRun).toMatch(/^\d{4}-/);
    expect(res.body.settings).toMatchObject({ enabled: true, webinterface: false, onlyWhenEmpty: false });
    const { getSettings } = await import('../../server/lib/settings.js');
    expect(getSettings().autoUpdate).toMatchObject({ enabled: true, frequency: 'weekly', weekday: 2, time: '05:15' });

    expect((await api.put('/api/system/autoupdate', { enabled: true, time: '24:00' })).status).toBe(400);
    expect((await api.put('/api/system/autoupdate', { enabled: true, time: '04:30', timezone: 'Nowhere/Land' })).body.key).toBe('errors.unknownTimezone');

    res = await api.put('/api/system/autoupdate', { enabled: false, time: '04:30' });
    expect(res.body.cron).toBeNull();
  });

  it('skips the run while another maintenance action is active', async () => {
    const maintenance = await import('../../server/lib/maintenance.js');
    const { runAutoUpdate } = await import('../../server/lib/autoupdate.js');
    const lease = maintenance.acquire('backup', { by: 'test' });
    try {
      const r = await runAutoUpdate({ trigger: 'manual', username: 'tester' });
      expect(r).toMatchObject({ ok: false, skipped: 'busy', trigger: 'manual', by: 'tester' });
    } finally {
      maintenance.release(lease);
    }
    const { getSettings } = await import('../../server/lib/settings.js');
    expect(getSettings().lastAutoUpdate).toMatchObject({ skipped: 'busy' });
  });

  it('postpones the TS3 update while clients are online and reports why the webinterface cannot update', async () => {
    const { runAutoUpdate } = await import('../../server/lib/autoupdate.js');
    const maintenance = await import('../../server/lib/maintenance.js');
    const r = await runAutoUpdate({ trigger: 'schedule' });
    // Simulator: 7 Clients online, davon 1 Query → 6 echte Clients; Feed meldet 3.99.0 > 3.13.8
    expect(r.ts3).toMatchObject({ skipped: 'clientsOnline', count: 6, from: '3.13.8', to: '3.99.0' });
    // Entwicklungs-Checkout: kein Release / nicht Linux → Selbst-Update nicht möglich
    expect(r.webinterface.skipped).toBe('notPossible');
    expect(['notLinux', 'notRelease', 'notWritable', 'npmMissing', 'tarMissing', 'container']).toContain(r.webinterface.reason);
    expect(r.ok).toBe(true);
    expect(r.restart).toBe(false);
    expect(maintenance.isBusy()).toBe(false);
    const res = await api.get('/api/system/autoupdate');
    expect(res.body.lastRun).toMatchObject({ trigger: 'schedule', ts3: { skipped: 'clientsOnline' } });
    expect(res.body.running).toBeNull();
  });

  it('starts a manual run via the API and rejects a second one while running', async () => {
    const res = await api.post('/api/system/autoupdate/run-now');
    expect(res.status).toBe(202);
    const deadline = Date.now() + 10000;
    let info;
    do {
      info = (await api.get('/api/system/autoupdate')).body;
      if (!info.running) break;
      await new Promise((r) => setTimeout(r, 100));
    } while (Date.now() < deadline);
    expect(info.running).toBeNull();
    expect(info.lastRun).toMatchObject({ trigger: 'manual', by: 'admin' });
  });

  it('renders component summaries and exposes the new notification events', async () => {
    const { describeComponent, EVENT_KEYS, eventLabels } = await import('../../server/lib/notify.js');
    const { DEFAULT_SETTINGS } = await import('../../server/lib/settings.js');
    expect(EVENT_KEYS).toEqual(expect.arrayContaining(['selfUpdateDone', 'autoUpdateDone', 'autoUpdateSkipped']));
    expect(DEFAULT_SETTINGS.notifications.events).toMatchObject({ selfUpdateDone: true, autoUpdateDone: true, autoUpdateSkipped: false });
    expect(eventLabels('de').autoUpdateDone).toMatch(/Automatisches Update/);
    expect(eventLabels('en').autoUpdateSkipped).toMatch(/skipped/);
    expect(describeComponent('en', { skipped: 'clientsOnline', count: 3 })).toBe('skipped, 3 client(s) connected');
    expect(describeComponent('de', { ok: true, from: '1.4.2', to: '1.5.0', restart: true })).toMatch(/1\.4\.2 auf 1\.5\.0.*startet neu/);
    expect(describeComponent('en', { ok: false, from: 'a', to: 'b', error: 'boom' })).toBe('update from a to b failed: boom');
    expect(describeComponent('en', null)).toBe('not enabled');
  });
});
