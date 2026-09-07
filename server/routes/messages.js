import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, listOrEmpty } from '../lib/errors.js';
import { requireCap } from '../lib/auth.js';
import { ts3 } from '../lib/ts3.js';
import { audit } from '../lib/audit.js';
import { nicknameForUid } from '../lib/history.js';

/**
 * Offline-Nachrichten (TeamSpeak-Posteingang des Query-Kontos auf dem aktiven virtuellen Server).
 * messageadd erreicht auch Clients, die gerade offline sind – sie sehen die Nachricht beim nächsten Login.
 */
const router = Router();

const idParam = (v) => {
  if (!/^\d+$/.test(String(v))) throw new HttpError(400, 'errors.invalidMessageId');
  return String(v);
};
const uidSchema = z.string().regex(/^[A-Za-z0-9+/]{20,60}={0,2}$/, 'errors.invalidUid');

// Nickname je UID (10 min), damit die Liste nicht pro Zeile eine Query-Abfrage braucht
const nameCache = new Map(); // uid → { name, at }
let unreadCache = null; // { count, at }

async function nicknameOf(ts, uid) {
  const hit = nameCache.get(uid);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.name;
  let name = '';
  try {
    const r = await ts.clientGetNameFromUid(uid);
    name = r?.name || '';
  } catch { /* unbekannt oder gelöscht */ }
  if (!name) name = nicknameForUid(uid) || '';
  nameCache.set(uid, { name, at: Date.now() });
  return name;
}

function entry(m) {
  return { id: String(m.msgid), uid: m.cluid, subject: m.subject || '', timestamp: Number(m.timestamp) || 0, read: Boolean(Number(m.flagRead ?? m.flag_read ?? 0)) };
}

async function listAll(ts) {
  const raw = await listOrEmpty(ts.messageList());
  const list = raw.map(entry).sort((a, b) => b.timestamp - a.timestamp);
  unreadCache = { count: list.filter((m) => !m.read).length, at: Date.now() };
  return list;
}

router.get('/', requireCap('messages.view'), asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const list = await listAll(ts);
  const uids = [...new Set(list.map((m) => m.uid))];
  const names = new Map(await Promise.all(uids.map(async (uid) => [uid, await nicknameOf(ts, uid)])));
  let account = '';
  try { account = (await ts.whoami()).clientLoginName || ''; } catch { /* egal */ }
  res.json({ messages: list.map((m) => ({ ...m, nickname: names.get(m.uid) || '' })), unread: list.filter((m) => !m.read).length, account });
}));

router.get('/unread-count', requireCap('messages.view'), asyncHandler(async (req, res) => {
  if (!unreadCache || Date.now() - unreadCache.at > 30 * 1000) await listAll(ts3.get());
  res.json({ count: unreadCache.count });
}));

router.post('/', requireCap('messages.manage'), asyncHandler(async (req, res) => {
  const { uid, subject, message } = z.object({ uid: uidSchema, subject: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(4096) }).parse(req.body);
  const ts = ts3.get();
  const found = await listOrEmpty(ts.clientDbFind(uid, true));
  if (!found.length) throw new HttpError(404, 'clients.notFound');
  await ts.execute('messageadd', { cluid: uid, subject, message });
  audit(req, 'message.send', { uid, nickname: found[0].name || '', subject: subject.slice(0, 100) });
  res.json({ ok: true, nickname: found[0].name || '' });
}));

router.get('/:id', requireCap('messages.view'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const ts = ts3.get();
  let m;
  try {
    m = await ts.messageGet(id);
  } catch (e) {
    if (String(e?.id) === '1281' || String(e?.id) === '3072') throw new HttpError(404, 'messages.notFound');
    throw e;
  }
  if (!m) throw new HttpError(404, 'messages.notFound');
  res.json({ id: String(m.msgid), uid: m.cluid, nickname: await nicknameOf(ts, m.cluid), subject: m.subject || '', message: m.message || '', timestamp: Number(m.timestamp) || 0 });
}));

router.post('/:id/read', requireCap('messages.view'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  const { read } = z.object({ read: z.boolean().default(true) }).parse(req.body || {});
  await ts3.get().messageUpdate(id, read);
  unreadCache = null;
  res.json({ ok: true });
}));

router.delete('/:id', requireCap('messages.manage'), asyncHandler(async (req, res) => {
  const id = idParam(req.params.id);
  await ts3.get().messageDel(id);
  unreadCache = null;
  audit(req, 'message.delete', { id });
  res.json({ ok: true });
}));

export default router;
