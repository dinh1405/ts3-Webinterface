import { Router } from 'express';
import path from 'node:path';
import busboy from 'busboy';
import { z } from 'zod';
import { asyncHandler, HttpError, listOrEmpty } from '../lib/errors.js';
import { requireCap } from '../lib/auth.js';
import { ts3 } from '../lib/ts3.js';
import { audit } from '../lib/audit.js';

const router = Router();
const MAX_UPLOAD = 512 * 1024 * 1024;

const cidParam = (v) => {
  if (!/^\d+$/.test(String(v ?? '0'))) throw new HttpError(400, 'errors.invalidChannelId');
  return String(v ?? '0');
};
/** Pfade innerhalb des TS3-Dateisystems normalisieren ("/", "/ordner"). */
function safePath(p) {
  let s = String(p || '/').replace(/\\/g, '/');
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.includes('..')) throw new HttpError(400, 'errors.invalidPath');
  s = s.replace(/\/+/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}
function safeName(n) {
  const s = String(n || '').trim();
  if (!s || s.includes('/') || s.includes('\\') || s.includes('..') || s.length > 255) throw new HttpError(400, 'errors.invalidFileName');
  return s;
}
const join = (dir, name) => (dir === '/' ? `/${name}` : `${dir}/${name}`);

function mimeOf(buf, name = '') {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length >= 6 && buf.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (buf.subarray(0, 64).toString('utf8').includes('<svg')) return 'image/svg+xml';
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  const ext = path.extname(name).toLowerCase();
  return { '.txt': 'text/plain', '.zip': 'application/zip', '.pdf': 'application/pdf' }[ext] || 'application/octet-stream';
}

/* ---------------- Dateien ---------------- */
router.get('/', requireCap('files.view'), asyncHandler(async (req, res) => {
  const cid = cidParam(req.query.cid);
  const dir = safePath(req.query.path);
  const cpw = String(req.query.cpw || '');
  const ts = ts3.get();
  const entries = await listOrEmpty(ts.ftGetFileList(cid, dir, cpw));
  res.json({
    cid,
    path: dir,
    entries: entries.map((e) => ({ name: e.name, size: Number(e.size) || 0, datetime: Number(e.datetime) || 0, type: Number(e.type) === 0 ? 'dir' : 'file' }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)),
  });
}));

router.get('/download', requireCap('files.view'), asyncHandler(async (req, res) => {
  const cid = cidParam(req.query.cid);
  const dir = safePath(req.query.path);
  const name = safeName(req.query.name);
  const cpw = String(req.query.cpw || '');
  const ts = ts3.get();
  const buf = await ts.downloadFile(join(dir, name), cid, cpw);
  audit(req, 'files.download', { cid, path: join(dir, name), size: buf.length });
  res.setHeader('Content-Type', mimeOf(buf, name));
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.send(buf);
}));

/** Vorschau (Bild) ohne Download-Header, z. B. für Avatare. */
router.get('/preview', requireCap('files.view'), asyncHandler(async (req, res) => {
  const cid = cidParam(req.query.cid);
  const dir = safePath(req.query.path);
  const name = safeName(req.query.name);
  const ts = ts3.get();
  const buf = await ts.downloadFile(join(dir, name), cid, String(req.query.cpw || ''));
  res.setHeader('Content-Type', mimeOf(buf, name));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(buf);
}));

router.post('/upload', requireCap('files.manage'), (req, res, next) => {
  let bb;
  try {
    bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_UPLOAD } });
  } catch (e) {
    return next(new HttpError(400, 'files.badUpload', { error: e.message }));
  }
  const fields = {};
  let fileName = null;
  const chunks = [];
  let tooBig = false;
  bb.on('field', (k, v) => { fields[k] = v; });
  bb.on('file', (field, stream, info) => {
    fileName = info.filename;
    stream.on('data', (c) => chunks.push(c));
    stream.on('limit', () => { tooBig = true; });
  });
  bb.on('error', (e) => next(new HttpError(400, 'files.uploadFailed', { error: e.message })));
  bb.on('close', async () => {
    try {
      if (tooBig) throw new HttpError(413, 'files.tooLarge');
      if (!fileName) throw new HttpError(400, 'files.noFile');
      const cid = cidParam(fields.cid);
      const dir = safePath(fields.path);
      const name = safeName(fields.name || fileName);
      const data = Buffer.concat(chunks);
      const ts = ts3.get();
      await ts.uploadFile(join(dir, name), data, cid, String(fields.cpw || ''));
      audit(req, 'files.upload', { cid, path: join(dir, name), size: data.length });
      res.json({ ok: true, name, size: data.length });
    } catch (e) {
      next(e);
    }
  });
  req.pipe(bb);
});

router.post('/mkdir', requireCap('files.manage'), asyncHandler(async (req, res) => {
  const { cid, path: dir, name, cpw } = z.object({ cid: z.coerce.string().default('0'), path: z.string().default('/'), name: z.string().min(1).max(255), cpw: z.string().default('') }).parse(req.body);
  const ts = ts3.get();
  const full = join(safePath(dir), safeName(name));
  await ts.ftCreateDir(cidParam(cid), full, cpw);
  audit(req, 'files.mkdir', { cid, path: full });
  res.json({ ok: true });
}));

router.post('/rename', requireCap('files.manage'), asyncHandler(async (req, res) => {
  const { cid, path: dir, oldName, newName, cpw } = z.object({ cid: z.coerce.string().default('0'), path: z.string().default('/'), oldName: z.string().min(1), newName: z.string().min(1), cpw: z.string().default('') }).parse(req.body);
  const ts = ts3.get();
  const d = safePath(dir);
  // ohne tcid (Umbenennen innerhalb desselben Kanals) – die Bibliothek würde tcid=undefined mitsenden
  await ts.execute('ftrenamefile', { cid: cidParam(cid), cpw, oldname: join(d, safeName(oldName)), newname: join(d, safeName(newName)) });
  audit(req, 'files.rename', { cid, from: join(d, oldName), to: join(d, newName) });
  res.json({ ok: true });
}));

router.delete('/', requireCap('files.manage'), asyncHandler(async (req, res) => {
  const cid = cidParam(req.query.cid);
  const dir = safePath(req.query.path);
  const name = safeName(req.query.name);
  const ts = ts3.get();
  await ts.ftDeleteFile(cid, join(dir, name), String(req.query.cpw || ''));
  audit(req, 'files.delete', { cid, path: join(dir, name) });
  res.json({ ok: true });
}));

/* ---------------- Icons ---------------- */
router.get('/icons', requireCap('files.view'), asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const entries = await listOrEmpty(ts.ftGetFileList('0', '/icons', ''));
  const icons = entries
    .filter((e) => /^icon_\d+$/.test(e.name))
    .map((e) => ({ id: e.name.slice(5), size: Number(e.size) || 0, datetime: Number(e.datetime) || 0 }))
    .sort((a, b) => b.datetime - a.datetime);
  res.json({ icons });
}));

router.get('/icons/:id', requireCap('files.view'), asyncHandler(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) throw new HttpError(400, 'errors.invalidIconId');
  const ts = ts3.get();
  const buf = await ts.downloadIcon(Number(req.params.id));
  res.setHeader('Content-Type', mimeOf(buf));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(buf);
}));

router.post('/icons', requireCap('files.manage'), (req, res, next) => {
  let bb;
  try {
    bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: 64 * 1024 } });
  } catch (e) {
    return next(new HttpError(400, 'files.badUpload', { error: e.message }));
  }
  const chunks = [];
  let tooBig = false;
  let got = false;
  bb.on('file', (field, stream) => { got = true; stream.on('data', (c) => chunks.push(c)); stream.on('limit', () => { tooBig = true; }); });
  bb.on('error', (e) => next(new HttpError(400, 'files.uploadFailed', { error: e.message })));
  bb.on('close', async () => {
    try {
      if (tooBig) throw new HttpError(413, 'files.iconTooLarge');
      if (!got) throw new HttpError(400, 'files.noFile');
      const data = Buffer.concat(chunks);
      if (!mimeOf(data).startsWith('image/')) throw new HttpError(400, 'files.imagesOnly');
      const ts = ts3.get();
      const id = await ts.uploadIcon(data);
      audit(req, 'icons.upload', { id, size: data.length });
      res.json({ ok: true, id: String(id) });
    } catch (e) {
      next(e);
    }
  });
  req.pipe(bb);
});

router.delete('/icons/:id', requireCap('files.manage'), asyncHandler(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) throw new HttpError(400, 'errors.invalidIconId');
  const ts = ts3.get();
  await ts.ftDeleteFile('0', `/icon_${req.params.id}`, ''); // Icons liegen für cid 0 direkt unter /icon_<id>
  audit(req, 'icons.delete', { id: req.params.id });
  res.json({ ok: true });
}));

/** Icon zuweisen: Servergruppe / Kanalgruppe (i_icon_id) oder Kanal (channel_icon_id). id "0" entfernt das Icon. */
router.post('/icons/assign', requireCap('files.manage'), asyncHandler(async (req, res) => {
  const { iconId, kind, targetId } = z.object({ iconId: z.coerce.string().regex(/^\d+$/), kind: z.enum(['servergroup', 'channelgroup', 'channel']), targetId: z.coerce.string().regex(/^\d+$/) }).parse(req.body);
  const ts = ts3.get();
  // TS3 erwartet Icon-IDs als vorzeichenbehaftete 32-Bit-Zahl (IDs ≥ 2^31 werden negativ)
  const raw = Number(iconId);
  const value = raw >= 2 ** 31 ? raw - 2 ** 32 : raw;
  if (kind === 'servergroup') {
    if (value === 0) await ts.serverGroupDelPerm(targetId, 'i_icon_id'); else await ts.serverGroupAddPerm(targetId, { permname: 'i_icon_id', permvalue: value });
  } else if (kind === 'channelgroup') {
    if (value === 0) await ts.channelGroupDelPerm(targetId, 'i_icon_id'); else await ts.channelGroupAddPerm(targetId, { permname: 'i_icon_id', permvalue: value });
  } else {
    // Kanal-Icons werden nicht über channeledit, sondern über das Kanalrecht i_icon_id gesetzt
    if (value === 0) await ts.channelDelPerm(targetId, 'i_icon_id'); else await ts.channelSetPerm(targetId, { permname: 'i_icon_id', permvalue: value });
  }
  audit(req, 'icons.assign', { iconId, kind, targetId });
  res.json({ ok: true });
}));

export default router;
