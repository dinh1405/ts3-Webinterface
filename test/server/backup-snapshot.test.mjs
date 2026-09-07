import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { withFakeQuery } from './helpers.mjs';

const root = process.env.TS3WI_TEST_ROOT;
const ts3Dir = path.join(root, 'ts3');
let fq;

describe('snapshot in ZIP backups', () => {
  beforeAll(async () => {
    fs.mkdirSync(path.join(ts3Dir, 'files', 'virtualserver_1'), { recursive: true });
    fs.writeFileSync(path.join(ts3Dir, 'ts3server.ini'), 'query_port=10011\n');
    fs.writeFileSync(path.join(ts3Dir, 'files', 'virtualserver_1', 'hello.txt'), 'hi');
    fq = await withFakeQuery();
    const { applyConfig } = await import('../../server/config.js');
    await applyConfig({ ts3: { dir: ts3Dir, controlMode: 'none' } });
  });
  afterAll(async () => { await fq?.close(); });

  it('adds snapshot.json when requested and records it in the metadata', async () => {
    const { createBackup, listBackups } = await import('../../server/lib/backup.js');
    const plain = await createBackup({ label: 'plain' });
    expect(plain.contents).not.toContain('snapshot.json');
    expect(plain.snapshot).toBeNull();

    const meta = await createBackup({ label: 'snap', includeSnapshot: true });
    expect(meta.contents).toContain('snapshot.json');
    expect(meta.snapshot).toMatchObject({ serverName: 'Example Community', version: 3 });
    expect(meta.snapshot.size).toBeGreaterThan(50);
    expect(meta.notes.some((n) => /snapshot/i.test(n))).toBe(false); // nur der Hinweis auf die fehlende SQLite-Datei
    const listed = (await listBackups()).find((b) => b.id === meta.id);
    expect(listed.snapshot).toMatchObject({ serverName: 'Example Community' });

    const extract = (await import('extract-zip')).default;
    const out = path.join(root, 'x-snap');
    await extract(path.join(process.env.BACKUP_DIR, `${meta.id}.zip`), { dir: out });
    const snap = JSON.parse(fs.readFileSync(path.join(out, 'snapshot.json'), 'utf8'));
    expect(snap).toMatchObject({ serverName: 'Example Community', version: 3, salt: 'ZmFrZXNhbHQ=' });
    expect(typeof snap.snapshot).toBe('string');
  });

  it('restores the files and keeps the contained snapshot as a separate, deployable snapshot', async () => {
    const { createBackup, restoreBackup, listSnapshots } = await import('../../server/lib/backup.js');
    const meta = await createBackup({ label: 'restore-me', includeSnapshot: true });
    fs.rmSync(path.join(ts3Dir, 'files', 'virtualserver_1', 'hello.txt'));
    const result = await restoreBackup(meta.id, { username: 'tester' });
    expect(result.ok).toBe(true);
    expect(result.snapshotId).toBe(`restored_${meta.id}`);
    expect(fs.existsSync(path.join(ts3Dir, 'files', 'virtualserver_1', 'hello.txt'))).toBe(true);
    const snaps = await listSnapshots();
    expect(snaps.find((s) => s.id === result.snapshotId)).toMatchObject({ serverName: 'Example Community', restoredFrom: meta.id });
    expect(fs.existsSync(path.join(process.env.BACKUP_DIR, 'snapshots', `${result.snapshotId}.json`))).toBe(true);
  });

  it('still succeeds with a note when the server is unreachable', async () => {
    await fq.close();
    fq = null;
    const { createBackup } = await import('../../server/lib/backup.js');
    const meta = await createBackup({ label: 'offline', includeSnapshot: true });
    expect(meta.contents).not.toContain('snapshot.json');
    expect(meta.snapshot).toBeNull();
    expect(meta.notes.some((n) => /snapshot/i.test(n))).toBe(true);
  });
});
