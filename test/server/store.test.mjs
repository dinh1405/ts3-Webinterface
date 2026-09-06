import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.TS3WI_TEST_ROOT;

describe('JsonStore', () => {
  it('writes atomically and reads back', async () => {
    const { JsonStore } = await import('../../server/lib/store.js');
    const file = path.join(root, 'store', 'a.json');
    const store = new JsonStore(file, { items: [] });
    expect(store.get()).toEqual({ items: [] });
    await store.update((d) => { d.items.push(1); });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ items: [1] });
    expect(fs.readdirSync(path.dirname(file)).some((n) => n.endsWith('.tmp'))).toBe(false);
  });

  it('keeps the queue usable after a failure', async () => {
    const { JsonStore } = await import('../../server/lib/store.js');
    const dir = path.join(root, 'store', 'q');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'b.json');
    const store = new JsonStore(file, { n: 0 });
    await store.set({ n: 1 });
    // Fehler provozieren: Zielpfad durch ein nicht leeres Verzeichnis blockieren (rename scheitert auf jeder Plattform)
    fs.rmSync(file);
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, 'x'), '');
    await expect(store.set({ n: 2 })).rejects.toMatchObject({ code: 'STORE_WRITE' });
    expect(store.data).toEqual({ n: 1 }); // zurückgesetzt auf den letzten geschriebenen Stand
    fs.rmSync(file, { recursive: true, force: true });
    await store.set({ n: 3 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ n: 3 });
  });

  it('only the last pending write reverts the in-memory state', async () => {
    const { JsonStore } = await import('../../server/lib/store.js');
    const dir = path.join(root, 'store', 'p');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'c.json');
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, 'x'), '');
    const store = new JsonStore(file, { n: 0 });
    const first = store.set({ n: 1 });
    const second = store.set({ n: 2 });
    await expect(first).rejects.toMatchObject({ code: 'STORE_WRITE' });
    expect(store.data).toEqual({ n: 2 }); // zweiter Schreibvorgang steht noch aus → kein Zurücksetzen
    await expect(second).rejects.toMatchObject({ code: 'STORE_WRITE' });
    expect(store.data).toEqual({ n: 0 }); // letzter Fehlschlag → zurück auf den gespeicherten Stand (hier: Defaults)
    fs.rmSync(file, { recursive: true, force: true });
    await store.set({ n: 4 });
    expect(store.data).toEqual({ n: 4 });
  });
});
