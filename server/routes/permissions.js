import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, listOrEmpty } from '../lib/errors.js';
import { tr } from '../lib/locale.js';
import { requireAuth, requireCap } from '../lib/auth.js';
import { ts3 } from '../lib/ts3.js';
import { audit } from '../lib/audit.js';
import { listPresets, getPreset, createPreset, updatePreset, deletePreset, MAX_PRESET_PERMS } from '../lib/permpresets.js';

const router = Router();

let definitionsCache = null; // { loadedAt, list, byId }

const KINDS = ['servergroup', 'channelgroup', 'client', 'channel', 'channelclient'];
const KIND_KEYS = ['servergroup', 'channelgroup', 'client', 'channel', 'channelclient'];

const numId = (v, label = 'ID') => {
  if (!/^\d+$/.test(String(v))) throw new HttpError(400, label);
  return String(v);
};
const kindParam = (v) => {
  if (!KINDS.includes(v)) throw new HttpError(400, 'errors.invalidPermKind');
  return v;
};
const permName = z.string().regex(/^[a-z][a-z0-9_]{1,80}$/, 'errors.invalidPermName');
const permEntry = z.object({
  name: permName,
  value: z.coerce.number().int().min(-1).max(2147483647),
  skip: z.boolean().default(false),
  negate: z.boolean().default(false),
});
const presetIdParam = (v) => {
  if (!/^[0-9a-f-]{36}$/.test(String(v))) throw new HttpError(400, 'errors.invalidPresetId');
  return String(v);
};
const sameSubject = (a, b) => a.kind === b.kind && String(a.id) === String(b.id);

/** Setzt eine Rechteliste auf einem Subjekt; bei mode=replace werden vorher nicht enthaltene Rechte entfernt. */
async function applyPerms(s, perms, mode = 'merge') {
  const results = [];
  const removed = [];
  if (mode === 'replace') {
    const wanted = new Set(perms.map((p) => p.name));
    for (const cur of await s.list()) {
      if (wanted.has(cur.name)) continue;
      try {
        await s.del(cur.name);
        removed.push(cur.name);
      } catch (e) {
        results.push({ name: cur.name, ok: false, action: 'remove', error: [e.msg, e.extraMsg].filter(Boolean).join(' – ') || e.message });
      }
    }
  }
  for (const p of perms) {
    try {
      await s.set({ permname: p.name, permvalue: p.value, permskip: p.skip, permnegated: p.negate });
      results.push({ name: p.name, ok: true });
    } catch (e) {
      results.push({ name: p.name, ok: false, error: [e.msg, e.extraMsg].filter(Boolean).join(' – ') || e.message });
    }
  }
  return { results, removed };
}

async function definitions() {
  if (!definitionsCache || Date.now() - definitionsCache.loadedAt > 6 * 3600 * 1000) {
    const ts = ts3.get();
    const list = (await ts.permissionList()).map((p) => ({ id: Number(p.permid), name: p.permname, desc: p.permdesc || '' }));
    definitionsCache = { loadedAt: Date.now(), list, byId: new Map(list.map((p) => [p.id, p])) };
  }
  return definitionsCache;
}

/** Löst das Rechte-Subjekt auf: Name, Anzeige, Funktionen zum Lesen/Setzen/Löschen. */
async function subject(ts, kind, rawId) {
  switch (kind) {
    case 'servergroup': {
      const id = numId(rawId, 'errors.invalidGroupId');
      const g = (await ts.serverGroupList()).find((x) => String(x.sgid) === id);
      if (!g) throw new HttpError(404, 'perms.serverGroupNotFound');
      return {
        info: { id, kind, name: g.name, type: Number(g.type) },
        list: () => listOrEmpty(ts.serverGroupPermList(id, true)).then(fromPermObjects),
        set: (p) => ts.serverGroupAddPerm(id, p),
        del: (n) => ts.serverGroupDelPerm(id, n),
      };
    }
    case 'channelgroup': {
      const id = numId(rawId, 'errors.invalidGroupId');
      const g = (await ts.channelGroupList()).find((x) => String(x.cgid) === id);
      if (!g) throw new HttpError(404, 'perms.channelGroupNotFound');
      return {
        info: { id, kind, name: g.name, type: Number(g.type) },
        list: () => listOrEmpty(ts.channelGroupPermList(id, true)).then(fromPermObjects),
        set: (p) => ts.channelGroupAddPerm(id, p),
        del: (n) => ts.channelGroupDelPerm(id, n),
      };
    }
    case 'client': {
      const id = numId(rawId, 'errors.invalidDbId');
      const [info] = await listOrEmpty(ts.clientDbInfo(id));
      if (!info) throw new HttpError(404, 'clients.notFound');
      return {
        info: { id, kind, name: info.clientNickname, uid: info.clientUniqueIdentifier },
        list: () => listOrEmpty(ts.clientPermList(id, true)).then(fromPermObjects),
        set: (p) => ts.clientAddPerm(id, p),
        del: (n) => ts.clientDelPerm(id, n),
      };
    }
    case 'channel': {
      const id = numId(rawId, 'errors.invalidChannelId');
      const info = await ts.channelInfo(id).catch(() => null);
      if (!info) throw new HttpError(404, 'perms.channelNotFound');
      return {
        info: { id, kind, name: info.channelName },
        list: () => listOrEmpty(ts.channelPermList(id, true)).then(fromPermObjects),
        set: (p) => ts.channelSetPerm(id, p),
        del: (n) => ts.channelDelPerm(id, n),
      };
    }
    case 'channelclient': {
      const [cidRaw, cldbidRaw] = String(rawId).split(':');
      const cid = numId(cidRaw, 'errors.invalidChannelId');
      const cldbid = numId(cldbidRaw, 'Datenbank-ID');
      const [chan, [client]] = await Promise.all([ts.channelInfo(cid).catch(() => null), listOrEmpty(ts.clientDbInfo(cldbid))]);
      if (!chan) throw new HttpError(404, 'perms.channelNotFound');
      if (!client) throw new HttpError(404, 'clients.notFound');
      return {
        info: { id: `${cid}:${cldbid}`, kind, name: `${client.clientNickname} in ${chan.channelName}`, cid, cldbid },
        list: async () => (await listOrEmpty(ts.channelClientPermList(cid, cldbid, true))).map((e) => ({ name: String(e.permsid), value: Number(e.permvalue), skip: Boolean(Number(e.permskip ?? 0)), negate: Boolean(Number(e.permnegated ?? 0)) })),
        set: (p) => ts.execute('channelclientaddperm', { cid, cldbid, permsid: p.permname, permvalue: p.permvalue }),
        del: (n) => ts.execute('channelclientdelperm', { cid, cldbid, permsid: n }),
      };
    }
    default:
      throw new HttpError(400, 'errors.invalidPermKind');
  }
}

function fromPermObjects(perms) {
  return perms.map((p) => ({ name: String(p.getPerm()), value: Number(p.getValue()), skip: Boolean(p.getSkip()), negate: Boolean(p.getNegate()) }));
}

/** Alle vom Server bekannten Berechtigungen (ID, Name, Beschreibung) – wird zwischengespeichert. */
router.get('/definitions', requireAuth, asyncHandler(async (req, res) => {
  const d = await definitions();
  res.json({ permissions: d.list, count: d.list.length, kinds: KIND_KEYS });
}));

/** Effektive Rechte eines Clients in einem Kanal (permoverview) inkl. Herkunft. */
router.get('/overview', requireAuth, asyncHandler(async (req, res) => {
  const cldbid = numId(req.query.cldbid, 'Datenbank-ID');
  const cid = numId(req.query.cid || '0', 'errors.invalidChannelId');
  const ts = ts3.get();
  const d = await definitions();
  const [entries, sgs, cgs, channels, [client]] = await Promise.all([
    listOrEmpty(ts.permOverview(cldbid, cid, [0])), // permid=0 → alle Rechte
    ts.serverGroupList(),
    ts.channelGroupList(),
    ts.channelList(),
    listOrEmpty(ts.clientDbInfo(cldbid)),
  ]);
  const sgName = new Map(sgs.map((g) => [String(g.sgid), g.name]));
  const cgName = new Map(cgs.map((g) => [String(g.cgid), g.name]));
  const chName = new Map(channels.map((c) => [String(c.cid), c.name]));
  const tt = tr(req);
  const permissions = entries.map((e) => {
    const t = Number(e.t);
    const id1 = String(e.id1 ?? e.id ?? '');
    const id2 = String(e.id2 ?? '');
    const sg = sgName.get(id1) || id1;
    const ch = chName.get(id1) || id1;
    const cg = cgName.get(id2) || id2;
    const source = t === 0 ? tt('perms.src.serverGroup', { name: sg })
      : t === 1 ? tt('perms.src.client')
        : t === 2 ? tt('perms.src.channel', { name: ch })
          : t === 3 ? tt('perms.src.channelGroup', { group: cg, channel: ch })
            : t === 4 ? tt('perms.src.clientInChannel', { channel: ch })
              : tt('perms.src.other', { type: t });
    const def = d.byId.get(Number(e.p));
    return { name: def?.name || `perm#${e.p}`, desc: def?.desc || '', value: Number(e.v), negate: Boolean(Number(e.n)), skip: Boolean(Number(e.s)), sourceType: t, source };
  }).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ client: client ? { cldbid, name: client.clientNickname, uid: client.clientUniqueIdentifier } : { cldbid }, channel: { cid, name: chName.get(cid) || (cid === '0' ? 'Server' : `#${cid}`) }, permissions });
}));

/* ---------------- Vorlagen ---------------- */
router.get('/presets', requireAuth, (req, res) => {
  res.json({ presets: listPresets() });
});

router.get('/presets/:id', requireAuth, (req, res) => {
  const p = getPreset(presetIdParam(req.params.id));
  res.json({ preset: p });
});

const presetBody = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).default(''),
  kind: z.enum(KINDS).nullable().default(null),
  perms: z.array(permEntry).max(MAX_PRESET_PERMS).optional(),
  fromKind: z.enum(KINDS).optional(),
  fromId: z.string().max(40).optional(),
});

router.post('/presets', requireCap('permissions.manage'), asyncHandler(async (req, res) => {
  const body = presetBody.parse(req.body);
  let perms = body.perms;
  let kind = body.kind;
  if (!perms) {
    if (!body.fromKind || !body.fromId) throw new HttpError(400, 'perms.presetNeedsPerms');
    const s = await subject(ts3.get(), kindParam(body.fromKind), body.fromId);
    perms = await s.list();
    kind = kind ?? body.fromKind;
  }
  if (!perms.length) throw new HttpError(400, 'perms.presetNeedsPerms');
  const p = await createPreset({ name: body.name, description: body.description, kind, perms, createdBy: req.user.username });
  audit(req, 'permissions.preset.create', { id: p.id, name: p.name, count: perms.length, from: body.fromKind ? `${body.fromKind}:${body.fromId}` : 'body' });
  res.json({ ok: true, preset: p });
}));

router.put('/presets/:id', requireCap('permissions.manage'), asyncHandler(async (req, res) => {
  const id = presetIdParam(req.params.id);
  const body = z.object({ name: z.string().trim().min(1).max(60).optional(), description: z.string().trim().max(300).optional(), kind: z.enum(KINDS).nullable().optional(), perms: z.array(permEntry).min(1).max(MAX_PRESET_PERMS).optional() }).parse(req.body);
  const p = await updatePreset(id, body);
  audit(req, 'permissions.preset.update', { id, name: p.name, fields: Object.keys(body) });
  res.json({ ok: true, preset: p });
}));

router.delete('/presets/:id', requireCap('permissions.manage'), asyncHandler(async (req, res) => {
  const id = presetIdParam(req.params.id);
  const p = getPreset(id);
  await deletePreset(id);
  audit(req, 'permissions.preset.delete', { id, name: p.name });
  res.json({ ok: true });
}));

router.post('/presets/:id/apply', requireCap('permissions.manage'), asyncHandler(async (req, res) => {
  const preset = getPreset(presetIdParam(req.params.id));
  const { kind, id, mode } = z.object({ kind: z.enum(KINDS), id: z.string().max(40), mode: z.enum(['merge', 'replace']).default('merge') }).parse(req.body);
  const s = await subject(ts3.get(), kind, id);
  const { results, removed } = await applyPerms(s, preset.perms, mode);
  const failed = results.filter((r) => !r.ok);
  audit(req, `permissions.${kind}.preset`, { id: s.info.id, subject: s.info.name, preset: preset.name, mode, set: preset.perms.length, removed: removed.length, failed: failed.map((f) => f.name) }, failed.length === 0);
  res.json({ ok: failed.length === 0, results, removed });
}));

/** Gesetzte Berechtigungen eines Subjekts. */
router.get('/:kind/:id', requireAuth, asyncHandler(async (req, res) => {
  const kind = kindParam(req.params.kind);
  const ts = ts3.get();
  const s = await subject(ts, kind, req.params.id);
  const permissions = (await s.list()).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ group: s.info, subject: s.info, permissions });
}));

/** Berechtigungen setzen/ändern (mehrere auf einmal). */
router.put('/:kind/:id', requireCap('permissions.manage'), asyncHandler(async (req, res) => {
  const kind = kindParam(req.params.kind);
  const { perms } = z.object({ perms: z.array(permEntry).min(1).max(1000) }).parse(req.body);
  const ts = ts3.get();
  const s = await subject(ts, kind, req.params.id);
  const { results } = await applyPerms(s, perms, 'merge');
  const failed = results.filter((r) => !r.ok);
  audit(req, `permissions.${kind}.set`, { id: s.info.id, subject: s.info.name, perms: perms.map((p) => `${p.name}=${p.value}${p.skip ? ' skip' : ''}${p.negate ? ' negate' : ''}`), failed: failed.map((f) => f.name) }, failed.length === 0);
  if (failed.length === perms.length) throw new HttpError(400, 'perms.noneSet', { error: failed[0].error }, { results });
  res.json({ ok: failed.length === 0, results });
}));

/** Mehrere Berechtigungen entfernen (Express 5: kein DELETE mit Body). */
router.post('/:kind/:id/remove', requireCap('permissions.manage'), asyncHandler(async (req, res) => {
  const kind = kindParam(req.params.kind);
  const { names } = z.object({ names: z.array(permName).min(1).max(1000) }).parse(req.body);
  const ts = ts3.get();
  const s = await subject(ts, kind, req.params.id);
  const results = [];
  for (const name of names) {
    try {
      await s.del(name);
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: [e.msg, e.extraMsg].filter(Boolean).join(' – ') || e.message });
    }
  }
  const failed = results.filter((r) => !r.ok);
  audit(req, `permissions.${kind}.remove`, { id: s.info.id, subject: s.info.name, perms: names, failed: failed.map((f) => f.name) }, failed.length === 0);
  res.json({ ok: failed.length === 0, results });
}));

/** Rechte eines anderen Subjekts übernehmen (merge: ergänzen/überschreiben, replace: nicht enthaltene entfernen). */
router.post('/:kind/:id/copy-from', requireCap('permissions.manage'), asyncHandler(async (req, res) => {
  const kind = kindParam(req.params.kind);
  const { sourceKind, sourceId, mode } = z.object({ sourceKind: z.enum(KINDS), sourceId: z.string().max(40), mode: z.enum(['merge', 'replace']).default('merge') }).parse(req.body);
  const ts = ts3.get();
  const target = await subject(ts, kind, req.params.id);
  const source = await subject(ts, sourceKind, sourceId);
  if (sameSubject(target.info, source.info)) throw new HttpError(400, 'perms.sameSubject');
  const perms = await source.list();
  if (!perms.length) throw new HttpError(400, 'perms.sourceEmpty', { name: source.info.name });
  const { results, removed } = await applyPerms(target, perms, mode);
  const failed = results.filter((r) => !r.ok);
  audit(req, `permissions.${kind}.copy`, { id: target.info.id, subject: target.info.name, from: `${sourceKind}:${source.info.id}`, fromName: source.info.name, mode, set: perms.length, removed: removed.length, failed: failed.map((f) => f.name) }, failed.length === 0);
  res.json({ ok: failed.length === 0, results, removed, count: perms.length });
}));

/** Einzelne Berechtigung entfernen. */
router.delete('/:kind/:id/:perm', requireCap('permissions.manage'), asyncHandler(async (req, res) => {
  const kind = kindParam(req.params.kind);
  const name = permName.parse(req.params.perm);
  const ts = ts3.get();
  const s = await subject(ts, kind, req.params.id);
  await s.del(name);
  audit(req, `permissions.${kind}.remove`, { id: s.info.id, subject: s.info.name, perm: name });
  res.json({ ok: true });
}));

export default router;
