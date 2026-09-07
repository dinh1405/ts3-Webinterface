import { describe, it, expect, beforeAll } from 'vitest';
import { createTestApp, makeAdmin, loginAgent } from './helpers.mjs';

let api;

describe('backup schedule', () => {
  beforeAll(async () => {
    api = await loginAgent(await createTestApp(), await makeAdmin());
  });

  it('keeps includeLogs and includeSnapshot after saving and reflects them in the scheduler', async () => {
    let res = await api.get('/api/backups/schedule');
    expect(res.status).toBe(200);
    expect(res.body.schedule).toMatchObject({ enabled: false, includeLogs: false, includeSnapshot: false });

    const body = { enabled: true, frequency: 'weekly', time: '04:15', weekday: 3, keep: 5, includeLogs: true, includeSnapshot: true, timezone: 'Europe/Berlin' };
    res = await api.put('/api/backups/schedule', body);
    expect(res.status).toBe(200);
    expect(res.body.schedule).toMatchObject({ enabled: true, frequency: 'weekly', time: '04:15', weekday: 3, keep: 5, includeLogs: true, includeSnapshot: true, cron: '15 4 * * 3' });

    res = await api.get('/api/backups/schedule');
    expect(res.body.schedule).toMatchObject({ includeLogs: true, includeSnapshot: true });
    const { getSettings } = await import('../../server/lib/settings.js');
    expect(getSettings().backupSchedule).toMatchObject({ includeSnapshot: true, includeLogs: true });

    // Ohne includeSnapshot im Body (ältere Clients) → false, nicht undefined
    res = await api.put('/api/backups/schedule', { ...body, includeSnapshot: undefined });
    expect(res.body.schedule.includeSnapshot).toBe(false);
    // Aufräumen: Zeitplan wieder aus, damit kein Cron-Task den Prozess offen hält
    await api.put('/api/backups/schedule', { ...body, enabled: false });
  });

  it('rejects an invalid time and an unknown timezone', async () => {
    expect((await api.put('/api/backups/schedule', { enabled: false, frequency: 'daily', time: '25:99', keep: 7 })).status).toBe(400);
    expect((await api.put('/api/backups/schedule', { enabled: false, frequency: 'daily', time: '03:30', keep: 7, timezone: 'Mars/Olympus' })).body.key).toBe('errors.unknownTimezone');
  });
});
