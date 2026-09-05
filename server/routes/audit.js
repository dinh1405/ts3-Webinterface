import { Router } from 'express';
import { requireCap } from '../lib/auth.js';
import { listAudit, auditActions } from '../lib/audit.js';

const router = Router();
router.use(requireCap('audit.view'));

router.get('/', (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const { total, entries } = listAudit({
    limit,
    offset,
    username: req.query.username ? String(req.query.username) : undefined,
    action: req.query.action ? String(req.query.action) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
    ok: req.query.ok ? String(req.query.ok) : undefined,
  });
  res.json({ total, entries, limit, offset, actions: auditActions() });
});

export default router;
