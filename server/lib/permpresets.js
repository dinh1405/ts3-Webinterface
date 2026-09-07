import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { JsonStore } from './store.js';
import { HttpError } from './errors.js';

/** Rechte-Vorlagen: benannte Rechtesätze, die auf Gruppen, Kanäle oder Clients angewendet werden können. */
const store = new JsonStore(path.join(config.dataDir, 'permission-presets.json'), { presets: [] });
export const MAX_PRESETS = 100;
export const MAX_PRESET_PERMS = 1000;

export function listPresets() {
  return store.get().presets.map(summary).sort((a, b) => a.name.localeCompare(b.name));
}

function summary(p) {
  return { id: p.id, name: p.name, description: p.description || '', kind: p.kind || null, count: p.perms.length, createdAt: p.createdAt, createdBy: p.createdBy, updatedAt: p.updatedAt };
}

export function getPreset(id) {
  const p = store.get().presets.find((x) => x.id === id);
  if (!p) throw new HttpError(404, 'perms.presetNotFound');
  return p;
}

export async function createPreset({ name, description = '', kind = null, perms, createdBy }) {
  const d = store.get();
  if (d.presets.length >= MAX_PRESETS) throw new HttpError(400, 'perms.tooManyPresets', { max: MAX_PRESETS });
  const now = new Date().toISOString();
  const preset = { id: crypto.randomUUID(), name, description, kind, perms, createdAt: now, createdBy, updatedAt: now };
  await store.update((x) => { x.presets.push(preset); });
  return preset;
}

export async function updatePreset(id, patch) {
  getPreset(id);
  let out;
  await store.update((d) => {
    const p = d.presets.find((x) => x.id === id);
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.description !== undefined) p.description = patch.description;
    if (patch.kind !== undefined) p.kind = patch.kind;
    if (patch.perms !== undefined) p.perms = patch.perms;
    p.updatedAt = new Date().toISOString();
    out = p;
  });
  return out;
}

export async function deletePreset(id) {
  getPreset(id);
  await store.update((d) => { d.presets = d.presets.filter((x) => x.id !== id); });
}
