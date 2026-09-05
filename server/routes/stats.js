import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { queryStats } from '../lib/stats.js';

const router = Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const range = ['6h', '24h', '7d', '30d'].includes(String(req.query.range)) ? String(req.query.range) : '24h';
  res.json(await queryStats(range));
}));

export default router;
