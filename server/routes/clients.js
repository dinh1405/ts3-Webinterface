import { Router } from 'express';
import { z } from 'zod';
import { ReasonIdentifier, TextMessageTargetMode } from 'ts3-nodejs-library';
import { asyncHandler, HttpError, listOrEmpty } from '../lib/errors.js';
import { requireAuth, requireCap } from '../lib/auth.js';
import { ts3, serializeClient, serializeChannel, buildChannelTree } from '../lib/ts3.js';
import { audit } from '../lib/audit.js';
import { tr } from '../lib/locale.js';

const router = Router();

const idParam = (v, key = 'errors.invalidIdGeneric') => {
  if (!/^\d+$/.test(String(v))) throw new HttpError(400, key);
  return String(v);
};

const banBody = z.object({
  time: z.coerce.number().int().min(0).max(10 * 365 * 86400).default(0),
  reason: z.string().max(200).default(''),
  banIp: z.boolean().optional(),
});

router.get('/tree', requireAuth, asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const [channels, clients] = await Promise.all([ts.channelList(), ts.clientList({ clientType: 0 })]);
  const ch = channels.map(serializeChannel);
  const cl = clients.map(serializeClient);
  res.json({ tree: buildChannelTree(ch, cl), clients: cl, channelCount: ch.length, clientCount: cl.length });
}));

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const clients = await ts.clientList({ clientType: 0 });
  res.json({ clients: clients.map(serializeClient) });
}));

router.get('/db/search', requireAuth, asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const q = String(req.query.q || '').trim();
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  let entries = [];
  if (!q) {
    entries = await listOrEmpty(ts.clientDbList(offset, limit));
  } else {
    const found = new Map();
    for (const [pattern, isUid] of [[`%${q}%`, false], [q, true]]) {
      for (const f of await listOrEmpty(ts.clientDbFind(pattern, isUid))) found.set(String(f.cldbid), f);
    }
    const ids = [...found.keys()].slice(0, limit);
    if (ids.length) entries = await ts.clientDbInfo(ids);
  }
  res.json({
    entries: entries.map((e) => ({
      cldbid: String(e.cldbid ?? e.clientDatabaseId),
      uid: e.clientUniqueIdentifier,
      nickname: e.clientNickname,
      created: e.clientCreated,
      lastconnected: e.clientLastconnected,
      totalconnections: e.clientTotalconnections,
      description: e.clientDescription || '',
      lastIp: e.clientLastip || '',
    })),
  });
}));

router.post('/db/:cldbid/ban', requireCap('bans.manage'), asyncHandler(async (req, res) => {
  const cldbid = idParam(req.params.cldbid, 'errors.invalidDbId');
  const { time, reason, banIp } = banBody.parse(req.body);
  const ts = ts3.get();
  const [info] = await ts.clientDbInfo(cldbid);
  if (!info) throw new HttpError(404, 'clients.dbNotFound');
  const banreason = reason || tr(req)('clients.defaultBanReason');
  const created = [];
  const r1 = await ts.ban({ uid: info.clientUniqueIdentifier, time: time || undefined, banreason });
  created.push(r1.banid);
  if (banIp && info.clientLastip) {
    const r2 = await ts.ban({ ip: info.clientLastip, time: time || undefined, banreason });
    created.push(r2.banid);
  }
  audit(req, 'client.ban.offline', { cldbid, nickname: info.clientNickname, uid: info.clientUniqueIdentifier, time, reason, banIp: Boolean(banIp), banids: created });
  res.json({ ok: true, banids: created });
}));

router.get('/:clid', requireAuth, asyncHandler(async (req, res) => {
  const clid = idParam(req.params.clid, 'errors.invalidClientId');
  const ts = ts3.get();
  const [info] = await ts.clientInfo(clid);
  if (!info) throw new HttpError(404, 'clients.notFound');
  res.json({ client: info });
}));

router.post('/:clid/kick', requireCap('clients.manage'), asyncHandler(async (req, res) => {
  const clid = idParam(req.params.clid, 'errors.invalidClientId');
  const { scope, reason } = z.object({ scope: z.enum(['server', 'channel']).default('server'), reason: z.string().max(80).default('') }).parse(req.body);
  const ts = ts3.get();
  const name = await clientName(ts, clid);
  await ts.clientKick(clid, scope === 'channel' ? ReasonIdentifier.KICK_CHANNEL : ReasonIdentifier.KICK_SERVER, reason || tr(req)('clients.defaultKickReason'));
  audit(req, `client.kick.${scope}`, { clid, nickname: name, reason });
  res.json({ ok: true });
}));

router.post('/:clid/poke', requireCap('clients.manage'), asyncHandler(async (req, res) => {
  const clid = idParam(req.params.clid, 'errors.invalidClientId');
  const { message } = z.object({ message: z.string().min(1).max(100) }).parse(req.body);
  const ts = ts3.get();
  const name = await clientName(ts, clid);
  await ts.clientPoke(clid, message);
  audit(req, 'client.poke', { clid, nickname: name, message });
  res.json({ ok: true });
}));

router.post('/:clid/message', requireCap('clients.manage'), asyncHandler(async (req, res) => {
  const clid = idParam(req.params.clid, 'errors.invalidClientId');
  const { message } = z.object({ message: z.string().min(1).max(1024) }).parse(req.body);
  const ts = ts3.get();
  const name = await clientName(ts, clid);
  await ts.sendTextMessage(clid, TextMessageTargetMode.CLIENT, message);
  audit(req, 'client.message', { clid, nickname: name, message });
  res.json({ ok: true });
}));

router.post('/:clid/move', requireCap('clients.manage'), asyncHandler(async (req, res) => {
  const clid = idParam(req.params.clid, 'errors.invalidClientId');
  const { cid, password } = z.object({ cid: z.coerce.string().regex(/^\d+$/), password: z.string().max(100).optional() }).parse(req.body);
  const ts = ts3.get();
  const name = await clientName(ts, clid);
  await ts.clientMove(clid, cid, password || undefined);
  audit(req, 'client.move', { clid, nickname: name, cid });
  res.json({ ok: true });
}));

router.post('/:clid/ban', requireCap('bans.manage'), asyncHandler(async (req, res) => {
  const clid = idParam(req.params.clid, 'errors.invalidClientId');
  const { time, reason } = banBody.parse(req.body);
  const ts = ts3.get();
  const name = await clientName(ts, clid);
  const r = await ts.banClient({ clid, time: time || undefined, banreason: reason || tr(req)('clients.defaultBanReason') });
  audit(req, 'client.ban', { clid, nickname: name, time, reason, banid: r?.banid });
  res.json({ ok: true, banid: r?.banid });
}));

router.post('/broadcast', requireCap('server.message'), asyncHandler(async (req, res) => {
  const { message } = z.object({ message: z.string().min(1).max(1024) }).parse(req.body);
  const ts = ts3.get();
  await ts.sendTextMessage('0', TextMessageTargetMode.SERVER, message);
  audit(req, 'server.message', { message });
  res.json({ ok: true });
}));

async function clientName(ts, clid) {
  try {
    const c = await ts.getClientById(clid);
    return c?.nickname || null;
  } catch {
    return null;
  }
}

export default router;
