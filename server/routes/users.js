import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireCap, requireAdmin } from '../lib/auth.js';
import { listUsers, createUser, updateUser, setPassword, deleteUser, getUser, countActiveAdmins, ROLES } from '../lib/users.js';
import { capabilityCatalog, CAPABILITIES, ROLE_DEFAULTS, roleCapabilities, setRoleCapabilities, canAssignRole, canManageUser, ROLE_RANK } from '../lib/capabilities.js';
import { resolveLocale } from '../lib/locale.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireCap('users.manage'));

const assignable = (actor) => ROLES.filter((r) => canAssignRole(actor, r));

router.get('/', (req, res) => {
  res.json({ users: listUsers(), roles: ROLES, assignableRoles: assignable(req.user), roleRank: ROLE_RANK });
});

/* ---- Rollen & Rechte (nur Administratoren) ---- */
router.get('/roles', (req, res) => {
  res.json({ groups: capabilityCatalog(resolveLocale(req)), roles: roleCapabilities(), defaults: ROLE_DEFAULTS, canEdit: req.user.role === 'admin' });
});

router.put('/roles', requireAdmin, asyncHandler(async (req, res) => {
  const capList = z.array(z.string().refine((c) => CAPABILITIES.includes(c), 'Unbekanntes Recht'));
  const body = z.object({ operator: capList, viewer: capList }).parse(req.body);
  const roles = await setRoleCapabilities(body);
  audit(req, 'roles.update', { operator: roles.operator, viewer: roles.viewer });
  res.json({ roles });
}));

router.post('/roles/reset', requireAdmin, asyncHandler(async (req, res) => {
  const roles = await setRoleCapabilities({ operator: ROLE_DEFAULTS.operator, viewer: ROLE_DEFAULTS.viewer });
  audit(req, 'roles.reset', {});
  res.json({ roles });
}));

/* ---- Benutzer ---- */
router.post('/', asyncHandler(async (req, res) => {
  const body = z.object({
    username: z.string().min(3).max(32),
    password: z.string().min(8).max(200),
    role: z.enum(ROLES).default('viewer'),
    displayName: z.string().max(80).optional(),
  }).parse(req.body);
  if (!canAssignRole(req.user, body.role)) throw new HttpError(403, 'users.rankCreate');
  const user = await createUser(body);
  audit(req, 'user.create', { username: user.username, role: user.role });
  res.status(201).json({ user });
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const body = z.object({
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    displayName: z.string().max(80).optional(),
  }).parse(req.body);
  const target = getUser(req.params.id);
  if (!target) throw new HttpError(404, 'users.notFound');
  if (!canManageUser(req.user, target)) throw new HttpError(403, 'users.rankEdit');
  if (body.role && !canAssignRole(req.user, body.role)) throw new HttpError(403, 'users.rankRole');
  const losesAdmin = target.role === 'admin' && ((body.role && body.role !== 'admin') || body.active === false);
  if (losesAdmin && countActiveAdmins(target.id) === 0) {
    throw new HttpError(400, 'users.lastAdmin');
  }
  if (target.id === req.user.id && (body.active === false || (body.role && body.role !== target.role))) {
    throw new HttpError(400, 'users.selfChange');
  }
  const user = await updateUser(target.id, body);
  audit(req, 'user.update', { username: user.username, ...body });
  res.json({ user });
}));

router.post('/:id/password', asyncHandler(async (req, res) => {
  const { password } = z.object({ password: z.string().min(8).max(200) }).parse(req.body);
  const target = getUser(req.params.id);
  if (!target) throw new HttpError(404, 'users.notFound');
  if (!canManageUser(req.user, target)) throw new HttpError(403, 'users.rankPassword');
  await setPassword(target.id, password);
  audit(req, 'user.reset-password', { username: target.username });
  res.json({ ok: true });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const target = getUser(req.params.id);
  if (!target) throw new HttpError(404, 'users.notFound');
  if (target.id === req.user.id) throw new HttpError(400, 'users.selfDelete');
  if (!canManageUser(req.user, target)) throw new HttpError(403, 'users.rankDelete');
  if (target.role === 'admin' && countActiveAdmins(target.id) === 0) {
    throw new HttpError(400, 'users.lastAdminDelete');
  }
  await deleteUser(target.id);
  audit(req, 'user.delete', { username: target.username });
  res.json({ ok: true });
}));

export default router;
