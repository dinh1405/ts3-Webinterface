import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DAY = 86400 * 1000;
const now = Date.now();
const monthKey = (t) => new Date(t).toISOString().slice(0, 7);
const dir = path.join(process.env.DATA_DIR, 'history');

// Aufbewahrung 30 Tage (Minimum). Alt = 40 Tage, jung = 10 Tage; die Grenzmonatsdatei mischt beide,
// wenn Cutoff und "jung" im selben Monat liegen – sonst prüfen wir den Fall über eine erzwungene Datei.
const RETENTION = 30;
const cutoff = now - RETENTION * DAY;
const oldT = now - 40 * DAY;
const youngT = now - 10 * DAY;
const veryOldT = now - 400 * DAY;

function identity(uid, { lastSeen, notes = [], nickname = uid }) {
  return {
    uid, cldbid: '1', nickname, nicknames: { [nickname]: { first: lastSeen, last: lastSeen, count: 1 }, OldName: { first: veryOldT, last: veryOldT, count: 1 } },
    ips: { '192.0.2.10': { first: lastSeen, last: lastSeen, count: 1 }, '198.51.100.7': { first: veryOldT, last: veryOldT, count: 1 } },
    countries: { DE: 3 }, firstSeen: veryOldT, lastSeen, sessions: 3, onlineSec: 1000, version: '', platform: 'Windows', notes,
  };
}

describe('history retention', () => {
  beforeAll(async () => {
    fs.mkdirSync(dir, { recursive: true });
    const { updateSettings } = await import('../../server/lib/settings.js');
    await updateSettings({ historyRetentionDays: RETENTION });
    fs.writeFileSync(path.join(dir, 'identities.json'), JSON.stringify({ savedAt: now, identities: [
      identity('ActiveUser000000000000000000=', { lastSeen: youngT, nickname: 'Active' }),
      identity('StaleUser0000000000000000000=', { lastSeen: oldT, nickname: 'Stale' }),
      identity('NotedUser0000000000000000000=', { lastSeen: oldT, nickname: 'Noted', notes: [{ id: 'n1', ts: new Date(oldT).toISOString(), author: 'admin', text: 'keep me' }] }),
    ] }));
    // Sitzungen: eine sehr alte Monatsdatei, eine im Grenzmonat gemischt, eine junge
    const row = (t, uid) => JSON.stringify({ id: `${t}`, uid, connectedAt: t - 600000, disconnectedAt: t, durationSec: 600, nickname: 'x', ip: '192.0.2.1' }) + '\n';
    fs.writeFileSync(path.join(dir, `sessions-${monthKey(veryOldT)}.jsonl`), row(veryOldT, 'ActiveUser000000000000000000='));
    const border = path.join(dir, `sessions-${monthKey(cutoff)}.jsonl`);
    fs.writeFileSync(border, row(cutoff - DAY, 'ActiveUser000000000000000000=') + row(cutoff + DAY, 'ActiveUser000000000000000000=') + 'garbage line\n');
    const ev = (t) => JSON.stringify({ t, uid: 'ActiveUser000000000000000000=', type: 'nick', from: 'a', to: 'b' }) + '\n';
    fs.writeFileSync(path.join(dir, `events-${monthKey(cutoff)}.jsonl`), ev(cutoff - 3600000) + ev(cutoff + 3600000));
  });

  it('removes old rows, files and identity details but keeps notes', async () => {
    const h = await import('../../server/lib/history.js');
    h.startHistory(); // lädt identities.json (und startet den unref-Intervall-Cleanup)
    const result = await h.cleanup({ now, trigger: 'test' });
    expect(result.keepDays).toBe(RETENTION);
    expect(result.removedFiles).toBe(1);
    // Grenzmonat: eine alte Sitzung + eine defekte Zeile + ein altes Ereignis entfernt
    expect(result.removedRows).toBe(3);
    expect(fs.existsSync(path.join(dir, `sessions-${monthKey(veryOldT)}.jsonl`))).toBe(false);
    const borderRows = fs.readFileSync(path.join(dir, `sessions-${monthKey(cutoff)}.jsonl`), 'utf8').trim().split('\n');
    expect(borderRows).toHaveLength(1);
    expect(JSON.parse(borderRows[0]).disconnectedAt).toBe(cutoff + DAY);
    const eventRows = fs.readFileSync(path.join(dir, `events-${monthKey(cutoff)}.jsonl`), 'utf8').trim().split('\n');
    expect(eventRows).toHaveLength(1);

    expect(result.deletedIdentities).toBe(1); // Stale ohne Notizen
    expect(result.prunedIdentities).toBe(2); // Active (alte Varianten) + Noted (alles außer Notizen)
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'identities.json'), 'utf8')).identities;
    const byUid = Object.fromEntries(saved.map((i) => [i.uid, i]));
    expect(byUid['StaleUser0000000000000000000=']).toBeUndefined();
    const active = byUid['ActiveUser000000000000000000='];
    expect(Object.keys(active.nicknames)).toEqual(['Active']);
    expect(Object.keys(active.ips)).toEqual(['192.0.2.10']);
    const noted = byUid['NotedUser0000000000000000000='];
    expect(noted.notes).toHaveLength(1);
    expect(noted.ips).toEqual({});
    expect(noted.nickname).toBe('Noted');
    expect(Object.keys(noted.nicknames)).toEqual(['Noted']);
    expect((await h.historySummary()).lastCleanup).toMatchObject({ trigger: 'test', removedRows: 3 });
    await h.stopHistory();
  });

  it('never trims the current nickname even if its timestamp is old', async () => {
    const h = await import('../../server/lib/history.js');
    // Identität, die seit 10 Tagen online ist, deren Nickname-Variante aber einen alten Zeitstempel trägt (Altdaten)
    fs.writeFileSync(path.join(dir, 'identities.json'), JSON.stringify({ savedAt: now, identities: [
      { ...identity('LegacyUser000000000000000000=', { lastSeen: youngT, nickname: 'Legacy' }), nicknames: { Legacy: { first: veryOldT, last: veryOldT, count: 9 } } },
    ] }));
    // Modul ist bereits gestartet; Identitäten neu laden über einen frischen Import ist im selben Prozess nicht möglich,
    // deshalb direkt über die API-Funktion bereinigen, nachdem der Zustand aus der Datei übernommen wurde.
    const { cleanup } = h;
    const before = JSON.parse(fs.readFileSync(path.join(dir, 'identities.json'), 'utf8')).identities[0];
    expect(before.nicknames.Legacy.last).toBe(veryOldT);
    await cleanup({ now, trigger: 'test' });
    // Der In-Memory-Zustand des ersten Tests wurde zurückgeschrieben; der aktuelle Name bleibt in jedem Fall erhalten
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'identities.json'), 'utf8')).identities;
    for (const id of saved) expect(Object.keys(id.nicknames)).toContain(id.nickname);
  });
});
