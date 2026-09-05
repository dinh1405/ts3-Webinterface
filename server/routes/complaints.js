import { Router } from 'express';
import { asyncHandler, HttpError, listOrEmpty } from '../lib/errors.js';
import { requireAuth, requireCap } from '../lib/auth.js';
import { ts3 } from '../lib/ts3.js';
import { audit } from '../lib/audit.js';

const router = Router();
const idParam = (v) => {
  if (!/^\d+$/.test(String(v))) throw new HttpError(400, 'errors.invalidDbId');
  return String(v);
};

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const list = await listOrEmpty(ts.complainList());
  res.json({
    complaints: list
      .map((c) => ({ targetCldbid: String(c.tcldbid), targetName: c.tname, fromCldbid: String(c.fcldbid), fromName: c.fname, message: c.message || '', timestamp: Number(c.timestamp) }))
      .sort((a, b) => b.timestamp - a.timestamp),
  });
}));

/** Eine Beschwerde (von fcldbid über tcldbid) löschen. */
router.delete('/:tcldbid/:fcldbid', requireCap('complaints.manage'), asyncHandler(async (req, res) => {
  const t = idParam(req.params.tcldbid);
  const f = idParam(req.params.fcldbid);
  const ts = ts3.get();
  await ts.complainDel(t, f);
  audit(req, 'complaint.delete', { target: t, from: f });
  res.json({ ok: true });
}));

/** Alle Beschwerden über einen Client löschen. */
router.delete('/:tcldbid', requireCap('complaints.manage'), asyncHandler(async (req, res) => {
  const t = idParam(req.params.tcldbid);
  const ts = ts3.get();
  await ts.complainDel(t);
  audit(req, 'complaint.delete-all', { target: t });
  res.json({ ok: true });
}));

export default router;
