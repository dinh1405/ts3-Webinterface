import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { tr } from '../lib/locale.js';
import { requireCap, issueSession } from '../lib/auth.js';
import { createUser, getUser, sanitizeUser, ROLES } from '../lib/users.js';
import { listInvites, createInvite, findValidInvite, consumeInvite, revokeInvite, deleteInvite } from '../lib/invites.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { canAssignRole } from '../lib/capabilities.js';

const router = Router();

const redeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: tr(req)('errors.rateLimited'), key: 'errors.rateLimited' }),
});

/* ---- öffentlich (per Token) ---- */
router.get('/check', redeemLimiter, (req, res) => {
  const r = findValidInvite(String(req.query.token || ''));
  if (!r) return res.json({ valid: false, error: tr(req)('invites.invalidLink') });
  if (r.error) return res.json({ valid: false, error: tr(req)(r.error) });
  res.json({ valid: true, role: r.invite.role, note: r.invite.note, createdBy: r.invite.createdBy, expiresAt: r.invite.expiresAt });
});

router.post('/redeem', redeemLimiter, asyncHandler(async (req, res) => {
  const body = z.object({
    token: z.string().min(16).max(200),
    username: z.string().min(3).max(32),
    password: z.string().min(8).max(200),
    displayName: z.string().max(80).optional(),
  }).parse(req.body);
  const r = findValidInvite(body.token);
  if (!r) throw new HttpError(400, 'invites.invalidLink');
  if (r.error) throw new HttpError(400, r.error);
  const created = await createUser({ username: body.username, password: body.password, displayName: body.displayName, role: r.invite.role });
  await consumeInvite(r.invite.id, created.username);
  const user = getUser(created.id);
  req.user = user;
  issueSession(req, res, user);
  audit(req, 'auth.register', { username: user.username, role: user.role, invite: r.invite.id, note: r.invite.note });
  res.status(201).json({ user: sanitizeUser(user) });
}));

/* ---- Verwaltung (Admin) ---- */
router.get('/', requireCap('users.manage'), (req, res) => {
  res.json({ invites: listInvites(), roles: ROLES, assignableRoles: ROLES.filter((r) => canAssignRole(req.user, r)) });
});

router.post('/', requireCap('users.manage'), asyncHandler(async (req, res) => {
  const body = z.object({
    role: z.enum(ROLES).default('viewer'),
    expiresInHours: z.coerce.number().min(0).max(24 * 365).default(24),
    maxUses: z.coerce.number().int().min(0).max(1000).default(1),
    note: z.string().max(120).default(''),
  }).parse(req.body);
  if (!canAssignRole(req.user, body.role)) throw new HttpError(403, 'invites.roleRank');
  const { invite, token } = await createInvite({ ...body, createdBy: req.user.username });
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  audit(req, 'invite.create', { id: invite.id, role: invite.role, maxUses: invite.maxUses, expiresAt: invite.expiresAt, note: invite.note });
  res.status(201).json({ invite, link: `${base.replace(/\/$/, '')}/register?token=${token}` });
}));

router.post('/:id/revoke', requireCap('users.manage'), asyncHandler(async (req, res) => {
  await revokeInvite(req.params.id);
  audit(req, 'invite.revoke', { id: req.params.id });
  res.json({ ok: true });
}));

router.delete('/:id', requireCap('users.manage'), asyncHandler(async (req, res) => {
  await deleteInvite(req.params.id);
  audit(req, 'invite.delete', { id: req.params.id });
  res.json({ ok: true });
}));

export default router;
