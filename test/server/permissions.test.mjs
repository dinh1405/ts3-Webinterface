import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestApp, makeAdmin, loginAgent, withFakeQuery } from './helpers.mjs';

let fq; let api;
const sg = (id) => fq.fake.state.perms.servergroup.get(String(id));

describe('permission editor', () => {
  beforeAll(async () => {
    fq = await withFakeQuery();
    api = await loginAgent(await createTestApp(), await makeAdmin());
  });
  afterAll(async () => { await fq?.close(); });

  it('lists definitions and the permissions of a server group', async () => {
    const defs = await api.get('/api/permissions/definitions');
    expect(defs.status).toBe(200);
    expect(defs.body.count).toBeGreaterThan(50);
    const res = await api.get('/api/permissions/servergroup/7');
    expect(res.status).toBe(200);
    expect(res.body.subject).toMatchObject({ kind: 'servergroup', id: '7', name: 'Moderator', type: 1 });
    expect(res.body.permissions.map((p) => p.name)).toContain('i_client_kick_from_server_power');
    expect((await api.get('/api/permissions/servergroup/999')).status).toBe(404);
  });

  it('copies permissions from another group (merge keeps, replace removes)', async () => {
    // Guest (9) hat 2 Rechte; Merge aus Member (8) ergänzt, Ersetzen aus Moderator (7) räumt auf
    let res = await api.post('/api/permissions/servergroup/9/copy-from', { sourceKind: 'servergroup', sourceId: '8', mode: 'merge' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(5);
    expect(res.body.removed).toEqual([]);
    expect(sg(9).get('i_channel_join_power')).toEqual([10, 0, 0]);
    expect(sg(9).get('i_client_talk_power')).toEqual([25, 0, 0]); // überschrieben (vorher 0)

    res = await api.post('/api/permissions/servergroup/9/copy-from', { sourceKind: 'servergroup', sourceId: '7', mode: 'replace' });
    expect(res.status).toBe(200);
    expect(res.body.removed.sort()).toEqual(['i_channel_join_power', 'i_client_private_textmessage_power']);
    expect([...sg(9).keys()].sort()).toEqual([...sg(7).keys()].sort());

    expect((await api.post('/api/permissions/servergroup/9/copy-from', { sourceKind: 'servergroup', sourceId: '9' })).body.key).toBe('perms.sameSubject');
    expect((await api.post('/api/permissions/servergroup/9/copy-from', { sourceKind: 'channelgroup', sourceId: '7' })).body.key).toBe('perms.sourceEmpty');
  });

  it('removes several permissions at once and reports unknown ones per entry', async () => {
    const res = await api.post('/api/permissions/servergroup/9/remove', { names: ['i_client_talk_power', 'b_does_not_exist_here'] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.results).toEqual([{ name: 'i_client_talk_power', ok: true }, expect.objectContaining({ name: 'b_does_not_exist_here', ok: false })]);
    expect(sg(9).has('i_client_talk_power')).toBe(false);
  });

  it('accepts bulk sets above the old 200 limit', async () => {
    const perms = Array.from({ length: 250 }, (_, i) => ({ name: 'i_client_talk_power', value: i }));
    const res = await api.put('/api/permissions/servergroup/9', { perms });
    expect(res.status).toBe(200);
    expect(sg(9).get('i_client_talk_power')[0]).toBe(249);
  });

  it('creates, applies, edits, exports and deletes presets', async () => {
    let res = await api.post('/api/permissions/presets', { name: 'Mod set', description: 'from Moderator', fromKind: 'servergroup', fromId: '7' });
    expect(res.status).toBe(200);
    const preset = res.body.preset;
    expect(preset.kind).toBe('servergroup');
    expect(preset.perms.length).toBe(sg(7).size);

    res = await api.get('/api/permissions/presets');
    expect(res.body.presets).toEqual([expect.objectContaining({ id: preset.id, name: 'Mod set', count: preset.perms.length })]);
    res = await api.get(`/api/permissions/presets/${preset.id}`);
    expect(res.body.preset.perms).toEqual(preset.perms);

    // Anwenden auf Kanalgruppe 6 (merge) und Kanal 5 (replace)
    res = await api.post(`/api/permissions/presets/${preset.id}/apply`, { kind: 'channelgroup', id: '6', mode: 'merge' });
    expect(res.status).toBe(200);
    expect(fq.fake.state.perms.channelgroup.get('6').get('i_client_ban_power')).toEqual([50, 0, 0]);
    res = await api.post(`/api/permissions/presets/${preset.id}/apply`, { kind: 'channel', id: '5', mode: 'replace' });
    expect(res.body.removed.sort()).toEqual(['i_channel_needed_join_power', 'i_channel_needed_subscribe_power']);

    res = await api.put(`/api/permissions/presets/${preset.id}`, { name: 'Moderator set', perms: [{ name: 'i_client_talk_power', value: 42 }] });
    expect(res.body.preset).toMatchObject({ name: 'Moderator set' });
    expect(res.body.preset.perms).toEqual([{ name: 'i_client_talk_power', value: 42, skip: false, negate: false }]);

    expect((await api.post('/api/permissions/presets', { name: 'empty' })).body.key).toBe('perms.presetNeedsPerms');
    expect((await api.get('/api/permissions/presets/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await api.get('/api/permissions/presets/not-a-uuid')).status).toBe(400);
    expect((await api.del(`/api/permissions/presets/${preset.id}`)).status).toBe(200);
    expect((await api.get('/api/permissions/presets')).body.presets).toEqual([]);
  });
});
