import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, listOrEmpty } from '../lib/errors.js';
import { requireAuth, requireCap } from '../lib/auth.js';
import { ts3 } from '../lib/ts3.js';
import { audit } from '../lib/audit.js';
import { tr } from '../lib/locale.js';

const router = Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const list = await listOrEmpty(ts.banList());
  res.json({
    bans: list.map((b) => ({
      banid: String(b.banid),
      ip: b.ip || '',
      name: b.name || '',
      uid: b.uid || '',
      mytsid: b.mytsid || '',
      lastnickname: b.lastnickname || '',
      created: b.created,
      duration: b.duration,
      invokername: b.invokername || '',
      invokercldbid: b.invokercldbid,
      invokeruid: b.invokeruid || '',
      reason: b.reason || '',
      enforcements: b.enforcements ?? 0,
    })),
  });
}));

router.post('/', requireCap('bans.manage'), asyncHandler(async (req, res) => {
  const body = z.object({
    ip: z.string().max(100).optional(),
    name: z.string().max(100).optional(),
    uid: z.string().max(100).optional(),
    mytsid: z.string().max(100).optional(),
    time: z.coerce.number().int().min(0).max(10 * 365 * 86400).default(0),
    reason: z.string().max(200).default(''),
  }).parse(req.body);
  const props = {};
  for (const k of ['ip', 'name', 'uid', 'mytsid']) if (body[k]?.trim()) props[k] = body[k].trim();
  if (!Object.keys(props).length) throw new HttpError(400, 'bans.needTarget');
  const ts = ts3.get();
  const r = await ts.ban({ ...props, time: body.time || undefined, banreason: body.reason || tr(req)('clients.defaultBanReason') });
  audit(req, 'ban.add', { ...props, time: body.time, reason: body.reason, banid: r?.banid });
  res.json({ ok: true, banid: r?.banid });
}));

router.delete('/all', requireCap('bans.manage'), asyncHandler(async (req, res) => {
  const ts = ts3.get();
  await ts.execute('bandelall');
  audit(req, 'ban.delete-all', {});
  res.json({ ok: true });
}));

router.delete('/:banid', requireCap('bans.manage'), asyncHandler(async (req, res) => {
  const { banid } = req.params;
  if (!/^\d+$/.test(banid)) throw new HttpError(400, 'errors.invalidBanId');
  const ts = ts3.get();
  await ts.banDel(banid);
  audit(req, 'ban.delete', { banid });
  res.json({ ok: true });
}));

export default router;
