import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { JsonStore } from './store.js';
import { HttpError } from './errors.js';
import { ROLES } from './users.js';

const store = new JsonStore(path.join(config.dataDir, 'invites.json'), { invites: [] });
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function listInvites() {
  const now = Date.now();
  return store.get().invites.map((i) => ({
    ...i,
    tokenHash: undefined,
    status: i.revokedAt ? 'revoked' : i.expiresAt && new Date(i.expiresAt).getTime() < now ? 'expired' : i.maxUses && i.uses >= i.maxUses ? 'used' : 'active',
  }));
}

export async function createInvite({ role = 'viewer', expiresInHours = 24, maxUses = 1, note = '', createdBy }) {
  if (!ROLES.includes(role)) throw new HttpError(400, 'users.invalidRole');
  const token = crypto.randomBytes(24).toString('base64url');
  const invite = {
    id: crypto.randomUUID(),
    tokenHash: hash(token),
    tokenPreview: `${token.slice(0, 4)}…${token.slice(-3)}`,
    role,
    note: String(note || '').slice(0, 120),
    maxUses: Math.max(0, Number(maxUses) || 0), // 0 = unbegrenzt
    uses: 0,
    usedBy: [],
    createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: expiresInHours > 0 ? new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString() : null,
    revokedAt: null,
  };
  await store.update((d) => { d.invites.unshift(invite); });
  return { invite: { ...invite, tokenHash: undefined }, token };
}

export function findValidInvite(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) return null;
  const h = hash(token);
  const i = store.get().invites.find((x) => x.tokenHash === h);
  if (!i) return null;
  if (i.revokedAt) return { invite: i, error: 'invites.revoked' };
  if (i.expiresAt && new Date(i.expiresAt).getTime() < Date.now()) return { invite: i, error: 'invites.expired' };
  if (i.maxUses && i.uses >= i.maxUses) return { invite: i, error: 'invites.used' };
  return { invite: i, error: null };
}

export async function consumeInvite(id, username) {
  await store.update((d) => {
    const i = d.invites.find((x) => x.id === id);
    if (i) { i.uses += 1; i.usedBy.push({ username, at: new Date().toISOString() }); }
  });
}

export async function revokeInvite(id) {
  const i = store.get().invites.find((x) => x.id === id);
  if (!i) throw new HttpError(404, 'invites.notFound');
  await store.update((d) => { const x = d.invites.find((y) => y.id === id); x.revokedAt = new Date().toISOString(); });
}

export async function deleteInvite(id) {
  await store.update((d) => { d.invites = d.invites.filter((x) => x.id !== id); });
}
