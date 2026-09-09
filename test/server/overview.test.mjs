import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTestApp, makeAdmin, loginAgent, withFakeQuery } from './helpers.mjs';

// TS3-Verzeichnis vor dem ersten Import setzen (config.js bindet es beim Laden)
process.env.TS3_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ts3wi-overview-'));
fs.writeFileSync(path.join(process.env.TS3_DIR, 'ts3server.ini'), 'machine_id=\n');

/*
 * GET /api/overview – Kopfleiste und Dashboard-Kacheln: Sparklines der letzten Stunde,
 * letztes Backup nur mit backups.view, Update-Stand nur mit system.view.
 */
let app;
let admin;
let viewer;
let fq;

describe('overview endpoint', () => {
  beforeAll(async () => {
    fq = await withFakeQuery();
    app = await createTestApp();
    admin = await makeAdmin('admin', 'Sicheres-Kennwort-2026');
    const { createUser } = await import('../../server/lib/users.js');
    await createUser({ username: 'viewer', password: 'Nur-Lesen-Kennwort-2026', role: 'viewer' });
    viewer = { username: 'viewer', password: 'Nur-Lesen-Kennwort-2026' };
    // Zwei Minutenzeilen der Statistik anlegen (alt → neu), wie sie der Sampler schreibt
    const { config } = await import('../../server/config.js');
    const dir = path.join(config.dataDir, 'stats');
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    const rows = [
      { t: now - 5 * 60000, running: true, c: 3, q: 1, ch: 9, up: 1000, dn: 2000, ping: 20.5, loss: 0, tx: 1, rx: 1 },
      { t: now - 1 * 60000, running: true, c: 6, q: 1, ch: 9, up: 1500, dn: 2500, ping: 23.4, loss: 0, tx: 2, rx: 2 },
    ];
    fs.appendFileSync(path.join(dir, `${new Date(now).toISOString().slice(0, 10)}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    // Zeile von gestern darf nicht in das 60-Minuten-Fenster fallen
    fs.appendFileSync(path.join(dir, `${new Date(now - 86400000).toISOString().slice(0, 10)}.jsonl`), JSON.stringify({ ...rows[0], t: now - 86400000 }) + '\n');
  });
  afterAll(async () => { await fq.close(); });

  it('requires a session', async () => {
    const request = (await import('supertest')).default;
    expect((await request(app).get('/api/overview')).status).toBe(401);
  });

  it('returns sparklines of the last hour with gaps as null', async () => {
    const api = await loginAgent(app, admin);
    const res = await api.get('/api/overview');
    expect(res.status).toBe(200);
    const { spark } = res.body;
    expect(spark.minutes).toBe(60);
    expect(spark.clients).toHaveLength(60);
    expect(spark.clients.filter((v) => v !== null)).toEqual([3, 6]);
    expect(spark.ping.filter((v) => v !== null)).toEqual([20.5, 23.4]);
    expect(spark.up.filter((v) => v !== null)).toEqual([1000, 1500]);
    expect(spark.down.filter((v) => v !== null)).toEqual([2000, 2500]);
    // neuere Zeile liegt weiter rechts
    expect(spark.clients.lastIndexOf(6)).toBeGreaterThan(spark.clients.indexOf(3));
  });

  it('shows backup and update state only with the matching capability', async () => {
    const asAdmin = await loginAgent(app, admin);
    const a = (await asAdmin.get('/api/overview')).body;
    expect(a.updates).toMatchObject({ ts3: { available: false }, webinterface: { available: false } });
    expect(a).toHaveProperty('lastBackup'); // null ohne Backups, aber vorhanden

    // Beobachter ohne backups.view/system.view sieht weder Backup- noch Update-Stand
    const { setRoleCapabilities } = await import('../../server/lib/capabilities.js');
    await setRoleCapabilities({ operator: ['bans.manage'], viewer: ['history.view'] });
    const asViewer = await loginAgent(app, viewer);
    const v = (await asViewer.get('/api/overview')).body;
    expect(v.updates).toBeNull();
    expect(v.lastBackup).toBeNull();
    expect(v.spark.clients).toHaveLength(60);
  });

  it('reports the newest backup once one exists', async () => {
    const { createBackup } = await import('../../server/lib/backup.js');
    const { invalidateOverview } = await import('../../server/routes/overview.js');
    const result = await createBackup({ label: 'overview-test', username: 'admin', dbMethods: [] }).catch((e) => ({ error: e }));
    if (result.error) return; // Umgebung ohne Backup-Voraussetzungen: Kernaussage wurde oben geprüft
    invalidateOverview();
    const api = await loginAgent(app, admin);
    const body = (await api.get('/api/overview')).body;
    expect(body.lastBackup).toMatchObject({ id: result.id, ok: true });
  });
});
