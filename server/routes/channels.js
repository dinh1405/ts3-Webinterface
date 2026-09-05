import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireAuth, requireCap } from '../lib/auth.js';
import { ts3 } from '../lib/ts3.js';
import { audit } from '../lib/audit.js';

const router = Router();

export const CHANNEL_KEYS = [
  'channelName', 'channelTopic', 'channelDescription', 'channelPassword', 'channelCodec', 'channelCodecQuality', 'channelMaxclients',
  'channelMaxfamilyclients', 'channelOrder', 'channelFlagPermanent', 'channelFlagSemiPermanent', 'channelFlagTemporary', 'channelFlagDefault',
  'channelFlagMaxclientsUnlimited', 'channelFlagMaxfamilyclientsUnlimited', 'channelFlagMaxfamilyclientsInherited', 'channelNeededTalkPower',
  'channelNamePhonetic', 'channelCodecIsUnencrypted', 'channelIconId', 'channelBannerGfxUrl', 'channelBannerMode', 'channelDeleteDelay',
];

const cidParam = (v) => {
  if (!/^\d+$/.test(String(v))) throw new HttpError(400, 'errors.invalidChannelId');
  return String(v);
};

/** Kanal-Icons lassen sich per ServerQuery nur über das Kanalrecht i_icon_id setzen (channeledit lehnt channel_icon_id ab). */
async function applyChannelIcon(ts, cid, iconId) {
  const raw = Number(iconId);
  if (!Number.isFinite(raw)) return;
  const value = raw >= 2 ** 31 ? raw - 2 ** 32 : raw; // vorzeichenbehaftet senden
  if (value === 0) {
    try { await ts.channelDelPerm(cid, 'i_icon_id'); } catch (e) { if (String(e.id) !== '2568' && String(e.id) !== '1281') throw e; }
  } else {
    await ts.channelSetPerm(cid, { permname: 'i_icon_id', permvalue: value });
  }
}

function filterProps(body, extra = []) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'errors.objectExpected');
  const allowed = [...CHANNEL_KEYS, ...extra];
  const props = {};
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k) || v === null || v === undefined) continue;
    if (typeof v === 'boolean') props[k] = v ? 1 : 0;
    else if (typeof v === 'number' || typeof v === 'string') props[k] = v;
  }
  return props;
}

router.get('/:cid', requireAuth, asyncHandler(async (req, res) => {
  const cid = cidParam(req.params.cid);
  const ts = ts3.get();
  const info = await ts.channelInfo(cid);
  res.json({ cid, info, editableKeys: CHANNEL_KEYS });
}));

router.post('/', requireCap('channels.manage'), asyncHandler(async (req, res) => {
  const props = filterProps(req.body, ['cpid']);
  const name = String(props.channelName || '').trim();
  if (!name) throw new HttpError(400, 'channels.nameMissing');
  delete props.channelName;
  if (props.cpid !== undefined) props.cpid = cidParam(props.cpid);
  const iconId = props.channelIconId;
  delete props.channelIconId;
  // Ohne Typ-Flag würde TS3 einen temporären Kanal anlegen, der sofort wieder verschwindet
  if (!props.channelFlagPermanent && !props.channelFlagSemiPermanent && !props.channelFlagTemporary) props.channelFlagPermanent = 1;
  const ts = ts3.get();
  const ch = await ts.channelCreate(name, props);
  if (iconId !== undefined && Number(iconId) !== 0 && ch?.cid) await applyChannelIcon(ts, String(ch.cid), iconId);
  audit(req, 'channel.create', { cid: ch?.cid, name, cpid: props.cpid || '0' });
  res.status(201).json({ ok: true, cid: ch?.cid ? String(ch.cid) : null });
}));

router.put('/:cid', requireCap('channels.manage'), asyncHandler(async (req, res) => {
  const cid = cidParam(req.params.cid);
  const props = filterProps(req.body);
  if (!Object.keys(props).length) throw new HttpError(400, 'channels.noProps');
  if (props.channelName !== undefined && !String(props.channelName).trim()) throw new HttpError(400, 'channels.nameEmpty');
  const ts = ts3.get();
  const changed = Object.keys(props);
  const logged = { ...props };
  if ('channelPassword' in logged) logged.channelPassword = logged.channelPassword ? '***' : '(entfernt)';
  const iconId = props.channelIconId;
  delete props.channelIconId;
  if (Object.keys(props).length) await ts.channelEdit(cid, props);
  if (iconId !== undefined) await applyChannelIcon(ts, cid, iconId);
  audit(req, 'channel.edit', { cid, changed: logged });
  res.json({ ok: true, changed });
}));

router.post('/:cid/move', requireCap('channels.manage'), asyncHandler(async (req, res) => {
  const cid = cidParam(req.params.cid);
  const { cpid, order } = z.object({ cpid: z.coerce.string().regex(/^\d+$/).default('0'), order: z.coerce.number().int().min(0).optional() }).parse(req.body);
  const ts = ts3.get();
  const info = await ts.channelInfo(cid);
  if (String(info.pid) === cpid) {
    // gleicher Elternkanal: nur umsortieren (channelmove würde "already member of channel" liefern)
    await ts.channelEdit(cid, { channelOrder: order ?? 0 });
  } else {
    await ts.channelMove(cid, cpid, order);
  }
  audit(req, 'channel.move', { cid, cpid, order });
  res.json({ ok: true });
}));

router.delete('/:cid', requireCap('channels.manage'), asyncHandler(async (req, res) => {
  const cid = cidParam(req.params.cid);
  const force = req.query.force === '1' || req.query.force === 'true';
  const ts = ts3.get();
  let name = null;
  try { name = (await ts.channelInfo(cid)).channelName; } catch { /* ignore */ }
  await ts.channelDelete(cid, force);
  audit(req, 'channel.delete', { cid, name, force });
  res.json({ ok: true });
}));

export default router;
