import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, listOrEmpty } from '../lib/errors.js';
import { requireAuth, requireCap } from '../lib/auth.js';
import { ts3 } from '../lib/ts3.js';
import { audit } from '../lib/audit.js';
import { tr } from '../lib/locale.js';

const router = Router();

const idParam = (v, key = 'errors.invalidIdGeneric') => {
  if (!/^\d+$/.test(String(v))) throw new HttpError(400, key);
  return String(v);
};

const serializeSg = (g) => ({ sgid: String(g.sgid), name: g.name, type: Number(g.type), iconId: String(g.iconid ?? '0'), saveDb: Boolean(Number(g.savedb)), sortId: Number(g.sortid) || 0, nameMode: Number(g.namemode) || 0 });
const serializeCg = (g) => ({ cgid: String(g.cgid), name: g.name, type: Number(g.type), iconId: String(g.iconid ?? '0'), saveDb: Boolean(Number(g.savedb)), sortId: Number(g.sortid) || 0, nameMode: Number(g.namemode) || 0 });

const nameSchema = z.object({ name: z.string().trim().min(1).max(60), type: z.coerce.number().int().min(0).max(2).default(1) });

/** Übersicht: Server- und Kanalgruppen inkl. Mitgliederzahl und Standardgruppen. */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const [sgs, cgs, info] = await Promise.all([ts.serverGroupList(), ts.channelGroupList(), ts.serverInfo()]);
  const serverGroups = sgs.map(serializeSg);
  const defaultSg = String(info.virtualserverDefaultServerGroup);
  const counts = await Promise.all(serverGroups.map(async (g) => {
    // Nur reguläre Gruppen; die Standardgruppe darf laut TS3 nicht aufgelistet werden (Fehler 2564)
    if (g.type !== 1 || g.sgid === defaultSg) return null;
    try {
      return (await listOrEmpty(ts.serverGroupClientList(g.sgid))).length;
    } catch {
      return null;
    }
  }));
  serverGroups.forEach((g, i) => { g.memberCount = counts[i]; });
  serverGroups.sort((a, b) => a.type - b.type || a.sortId - b.sortId || a.name.localeCompare(b.name));
  const channelGroups = cgs.map(serializeCg).sort((a, b) => a.type - b.type || a.sortId - b.sortId || a.name.localeCompare(b.name));
  res.json({
    serverGroups,
    channelGroups,
    defaults: {
      serverGroup: String(info.virtualserverDefaultServerGroup),
      channelGroup: String(info.virtualserverDefaultChannelGroup),
      channelAdminGroup: String(info.virtualserverDefaultChannelAdminGroup),
    },
  });
}));

/* ---------------- Servergruppen ---------------- */

router.get('/server/:sgid/members', requireAuth, asyncHandler(async (req, res) => {
  const sgid = idParam(req.params.sgid, 'errors.invalidGroupId');
  const ts = ts3.get();
  const info = await ts.serverInfo();
  if (String(info.virtualserverDefaultServerGroup) === sgid) {
    return res.json({ members: [], isDefault: true, note: tr(req)('groups.defaultNote') });
  }
  const members = (await listOrEmpty(ts.serverGroupClientList(sgid)))
    .map((m) => ({ cldbid: String(m.cldbid), nickname: m.clientNickname || `#${m.cldbid}`, uid: m.clientUniqueIdentifier || '' }))
    .sort((a, b) => a.nickname.localeCompare(b.nickname));
  res.json({ members });
}));

router.post('/server', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const { name, type } = nameSchema.parse(req.body);
  const ts = ts3.get();
  const g = await ts.serverGroupCreate(name, type);
  audit(req, 'group.server.create', { name, type, sgid: g?.sgid });
  res.status(201).json({ ok: true, sgid: g?.sgid ? String(g.sgid) : null });
}));

router.post('/server/:sgid/copy', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const sgid = idParam(req.params.sgid, 'errors.invalidGroupId');
  const { name, type } = nameSchema.parse(req.body);
  const ts = ts3.get();
  const r = await ts.serverGroupCopy(sgid, '0', type, name);
  audit(req, 'group.server.copy', { source: sgid, name, type, sgid: r?.sgid });
  res.json({ ok: true, sgid: r?.sgid ? String(r.sgid) : null });
}));

router.patch('/server/:sgid', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const sgid = idParam(req.params.sgid, 'errors.invalidGroupId');
  const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
  const ts = ts3.get();
  await ts.serverGroupRename(sgid, name);
  audit(req, 'group.server.rename', { sgid, name });
  res.json({ ok: true });
}));

router.delete('/server/:sgid', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const sgid = idParam(req.params.sgid, 'errors.invalidGroupId');
  const force = req.query.force === '1' || req.query.force === 'true';
  const ts = ts3.get();
  await ts.serverGroupDel(sgid, force);
  audit(req, 'group.server.delete', { sgid, force });
  res.json({ ok: true });
}));

router.post('/server/:sgid/members', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const sgid = idParam(req.params.sgid, 'errors.invalidGroupId');
  const { cldbid } = z.object({ cldbid: z.coerce.string().regex(/^\d+$/) }).parse(req.body);
  const ts = ts3.get();
  await ts.serverGroupAddClient(cldbid, sgid);
  audit(req, 'group.server.member.add', { sgid, cldbid });
  res.json({ ok: true });
}));

router.delete('/server/:sgid/members/:cldbid', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const sgid = idParam(req.params.sgid, 'errors.invalidGroupId');
  const cldbid = idParam(req.params.cldbid, 'errors.invalidDbId');
  const ts = ts3.get();
  await ts.serverGroupDelClient(cldbid, sgid);
  audit(req, 'group.server.member.remove', { sgid, cldbid });
  res.json({ ok: true });
}));

/** Servergruppen eines Clients (per Datenbank-ID). */
router.get('/client/:cldbid', requireAuth, asyncHandler(async (req, res) => {
  const cldbid = idParam(req.params.cldbid, 'errors.invalidDbId');
  const ts = ts3.get();
  const groups = (await listOrEmpty(ts.serverGroupsByClientId(cldbid))).map((g) => ({ sgid: String(g.sgid), name: g.name }));
  res.json({ groups });
}));

/* ---------------- Kanalgruppen ---------------- */

router.get('/channel/:cgid/assignments', requireAuth, asyncHandler(async (req, res) => {
  const cgid = idParam(req.params.cgid, 'errors.invalidGroupId');
  const ts = ts3.get();
  const [entries, channels] = await Promise.all([listOrEmpty(ts.channelGroupClientList(cgid)), ts.channelList()]);
  const channelNames = new Map(channels.map((c) => [String(c.cid), c.name]));
  const cldbids = [...new Set(entries.map((e) => String(e.cldbid)).filter(Boolean))];
  const names = new Map();
  for (let i = 0; i < cldbids.length; i += 25) {
    const chunk = cldbids.slice(i, i + 25);
    const infos = await listOrEmpty(ts.clientDbInfo(chunk));
    for (const info of infos) names.set(String(info.clientDatabaseId), { nickname: info.clientNickname, uid: info.clientUniqueIdentifier });
  }
  const assignments = entries
    .filter((e) => e.cid && e.cldbid)
    .map((e) => ({
      cid: String(e.cid),
      channelName: channelNames.get(String(e.cid)) || `#${e.cid}`,
      cldbid: String(e.cldbid),
      nickname: names.get(String(e.cldbid))?.nickname || `#${e.cldbid}`,
      uid: names.get(String(e.cldbid))?.uid || '',
    }))
    .sort((a, b) => a.channelName.localeCompare(b.channelName) || a.nickname.localeCompare(b.nickname));
  res.json({ assignments });
}));

router.post('/channel', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const { name, type } = nameSchema.parse(req.body);
  const ts = ts3.get();
  const g = await ts.channelGroupCreate(name, type);
  audit(req, 'group.channel.create', { name, type, cgid: g?.cgid });
  res.status(201).json({ ok: true, cgid: g?.cgid ? String(g.cgid) : null });
}));

router.post('/channel/:cgid/copy', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const cgid = idParam(req.params.cgid, 'errors.invalidGroupId');
  const { name, type } = nameSchema.parse(req.body);
  const ts = ts3.get();
  const r = await ts.channelGroupCopy(cgid, '0', type, name);
  audit(req, 'group.channel.copy', { source: cgid, name, type, cgid: r?.cgid });
  res.json({ ok: true, cgid: r?.cgid ? String(r.cgid) : null });
}));

router.patch('/channel/:cgid', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const cgid = idParam(req.params.cgid, 'errors.invalidGroupId');
  const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
  const ts = ts3.get();
  await ts.channelGroupRename(cgid, name);
  audit(req, 'group.channel.rename', { cgid, name });
  res.json({ ok: true });
}));

router.delete('/channel/:cgid', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const cgid = idParam(req.params.cgid, 'errors.invalidGroupId');
  const force = req.query.force === '1' || req.query.force === 'true';
  const ts = ts3.get();
  await ts.execute('channelgroupdel', { cgid, force: force ? 1 : 0 });
  audit(req, 'group.channel.delete', { cgid, force });
  res.json({ ok: true });
}));

/** Kanalgruppe eines Clients in einem Kanal setzen (Entfernen = Standard-Kanalgruppe setzen). */
router.post('/channel/assign', requireCap('groups.manage'), asyncHandler(async (req, res) => {
  const { cgid, cid, cldbid } = z.object({
    cgid: z.coerce.string().regex(/^\d+$/),
    cid: z.coerce.string().regex(/^\d+$/),
    cldbid: z.coerce.string().regex(/^\d+$/),
  }).parse(req.body);
  const ts = ts3.get();
  await ts.setClientChannelGroup(cgid, cid, cldbid);
  audit(req, 'group.channel.assign', { cgid, cid, cldbid });
  res.json({ ok: true });
}));

export default router;
