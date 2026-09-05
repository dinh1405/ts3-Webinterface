import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, listOrEmpty } from '../lib/errors.js';
import { requireCap } from '../lib/auth.js';
import { ts3, serializeClient } from '../lib/ts3.js';
import { audit, listAudit } from '../lib/audit.js';
import { addNote, deleteIdentity, deleteNote, getProfile, historySummary, listIdentities, findIdentityByCldbid } from '../lib/history.js';

const router = Router();

const uidParam = (v) => {
  const uid = String(v || '');
  if (!/^[A-Za-z0-9+/]{20,60}={0,2}$/.test(uid)) throw new HttpError(400, 'errors.invalidUid');
  return uid;
};

router.get('/', requireCap('history.view'), asyncHandler(async (req, res) => {
  const q = z.object({
    q: z.string().max(100).default(''),
    sort: z.enum(['lastSeen', 'firstSeen', 'onlineSec', 'sessions', 'nickname']).default('lastSeen'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    online: z.enum(['0', '1']).default('0'),
  }).parse(req.query);
  res.json(listIdentities({ ...q, q: q.q.trim(), online: q.online === '1' }));
}));

router.get('/summary', requireCap('history.view'), asyncHandler(async (req, res) => {
  res.json(await historySummary());
}));

/** Profil über die Datenbank-ID auflösen (z. B. aus Beschwerden). */
router.get('/by-cldbid/:cldbid', requireCap('history.view'), asyncHandler(async (req, res) => {
  if (!/^\d+$/.test(req.params.cldbid)) throw new HttpError(400, 'errors.invalidDbId');
  const id = findIdentityByCldbid(req.params.cldbid);
  if (!id) throw new HttpError(404, 'history.noneForDbId');
  res.json({ uid: id.uid, nickname: id.nickname });
}));

router.get('/:uid', requireCap('history.view'), asyncHandler(async (req, res) => {
  const uid = uidParam(req.params.uid);
  const profile = await getProfile(uid);
  if (!profile) throw new HttpError(404, 'history.noneForUid');

  // Live-Daten aus TS3 ergänzen, soweit erreichbar
  const live = { available: ts3.connected, online: null, db: null, groups: [], bans: [], complaints: [] };
  if (ts3.connected) {
    const ts = ts3.get();
    const cldbid = profile.identity.cldbid;
    const ips = new Set(profile.identity.ips.map((i) => i.ip));
    const [clients, dbInfo, groups, bans, complaints] = await Promise.all([
      ts.clientList({ clientType: 0 }).catch(() => []),
      cldbid ? ts.clientDbInfo(cldbid).catch(() => []) : [],
      cldbid ? listOrEmpty(ts.serverGroupsByClientId(cldbid)).catch(() => []) : [],
      listOrEmpty(ts.banList()).catch(() => []),
      listOrEmpty(ts.complainList()).catch(() => []),
    ]);
    const me = clients.find((c) => c.uniqueIdentifier === uid);
    live.online = me ? serializeClient(me) : null;
    const d = dbInfo[0];
    if (d) {
      live.db = {
        cldbid: String(d.clientDatabaseId ?? cldbid),
        nickname: d.clientNickname,
        created: Number(d.clientCreated) || 0,
        lastconnected: Number(d.clientLastconnected) || 0,
        totalconnections: Number(d.clientTotalconnections) || 0,
        description: d.clientDescription || '',
        lastIp: d.clientLastip || '',
        monthBytesUploaded: Number(d.clientMonthBytesUploaded) || 0,
        monthBytesDownloaded: Number(d.clientMonthBytesDownloaded) || 0,
        totalBytesUploaded: Number(d.clientTotalBytesUploaded) || 0,
        totalBytesDownloaded: Number(d.clientTotalBytesDownloaded) || 0,
      };
    }
    live.groups = groups.map((g) => ({ sgid: String(g.sgid), name: g.name }));
    live.bans = bans
      .filter((b) => b.uid === uid || (b.ip && ips.has(b.ip)) || (b.name && profile.identity.nicknames.some((n) => n.name === b.name)))
      .map((b) => ({ banid: String(b.banid), ip: b.ip || '', name: b.name || '', uid: b.uid || '', created: Number(b.created) || 0, duration: Number(b.duration) || 0, invokername: b.invokername || '', reason: b.reason || '', enforcements: Number(b.enforcements) || 0, match: b.uid === uid ? 'uid' : b.ip && ips.has(b.ip) ? 'ip' : 'name' }));
    if (cldbid) {
      live.complaints = complaints
        .filter((c) => String(c.tcldbid) === String(cldbid) || String(c.fcldbid) === String(cldbid))
        .map((c) => ({ targetCldbid: String(c.tcldbid), targetName: c.tname, fromCldbid: String(c.fcldbid), fromName: c.fname, message: c.message || '', timestamp: Number(c.timestamp), direction: String(c.tcldbid) === String(cldbid) ? 'about' : 'by' }))
        .sort((a, b) => b.timestamp - a.timestamp);
    }
  }

  // Aktionen aus dem Webinterface, die diese Identität betreffen (UID, DB-ID oder bekannter Nickname)
  const names = new Set(profile.identity.nicknames.map((n) => n.name));
  const cldbid = profile.identity.cldbid;
  const { entries } = listAudit({ limit: 5000 });
  const actions = entries.filter((e) => {
    const d = e.details || {};
    if (d.uid === uid) return true;
    if (cldbid && [d.cldbid, d.target, d.targetCldbid].some((v) => v !== undefined && String(v) === String(cldbid))) return true;
    return typeof d.nickname === 'string' && names.has(d.nickname) && /^(client|ban)\./.test(e.action);
  }).slice(0, 100);

  res.json({ ...profile, live, actions });
}));

router.post('/:uid/notes', requireCap('history.manage'), asyncHandler(async (req, res) => {
  const uid = uidParam(req.params.uid);
  const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(req.body);
  const note = addNote(uid, { text, author: req.user.username });
  if (!note) throw new HttpError(404, 'history.identityNotFound');
  audit(req, 'history.note.add', { uid, text: text.slice(0, 200) });
  res.json({ ok: true, note });
}));

router.delete('/:uid/notes/:noteId', requireCap('history.manage'), asyncHandler(async (req, res) => {
  const uid = uidParam(req.params.uid);
  const { noteId } = z.object({ noteId: z.string().uuid() }).parse(req.params);
  if (!deleteNote(uid, noteId)) throw new HttpError(404, 'history.noteNotFound');
  audit(req, 'history.note.delete', { uid, noteId });
  res.json({ ok: true });
}));

router.delete('/:uid', requireCap('history.manage'), asyncHandler(async (req, res) => {
  const uid = uidParam(req.params.uid);
  if (!(await deleteIdentity(uid))) throw new HttpError(404, 'history.identityNotFound');
  audit(req, 'history.delete', { uid });
  res.json({ ok: true });
}));

export default router;
