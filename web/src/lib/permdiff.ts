import type { GroupPermission } from '../api/types';

export type DiffStatus = 'added' | 'removed' | 'changed' | 'same';
export interface DiffRow { name: string; status: DiffStatus; a?: GroupPermission; b?: GroupPermission }
export interface PermDiff { rows: DiffRow[]; added: number; removed: number; changed: number; same: number }

const equal = (x: GroupPermission, y: GroupPermission) => x.value === y.value && Boolean(x.skip) === Boolean(y.skip) && Boolean(x.negate) === Boolean(y.negate);

/**
 * Vergleicht zwei Rechtesätze aus Sicht von A → B:
 *   added   = nur in B gesetzt, removed = nur in A gesetzt, changed = in beiden mit anderem Wert/Flag, same = identisch.
 */
export function diffPerms(a: GroupPermission[], b: GroupPermission[]): PermDiff {
  const ma = new Map(a.map((p) => [p.name, p]));
  const mb = new Map(b.map((p) => [p.name, p]));
  const names = [...new Set([...ma.keys(), ...mb.keys()])].sort();
  const rows: DiffRow[] = names.map((name) => {
    const pa = ma.get(name);
    const pb = mb.get(name);
    if (pa && !pb) return { name, status: 'removed', a: pa };
    if (!pa && pb) return { name, status: 'added', b: pb };
    return { name, status: equal(pa!, pb!) ? 'same' : 'changed', a: pa, b: pb };
  });
  const count = (s: DiffStatus) => rows.filter((r) => r.status === s).length;
  return { rows, added: count('added'), removed: count('removed'), changed: count('changed'), same: count('same') };
}

export const PERM_EXPORT_FORMAT = 'ts3wi-perms/1';

/** Prüft eine importierte Datei und liefert die bereinigte Rechteliste (wirft bei ungültigem Aufbau). */
export function parsePermExport(text: string): { subject?: { kind?: string; id?: string; name?: string }; perms: GroupPermission[]; exportedAt?: string } {
  const data = JSON.parse(text) as { format?: string; perms?: unknown; subject?: { kind?: string; id?: string; name?: string }; exportedAt?: string };
  if (data.format !== PERM_EXPORT_FORMAT || !Array.isArray(data.perms)) throw new Error('format');
  const perms: GroupPermission[] = [];
  for (const raw of data.perms as unknown[]) {
    const p = raw as Partial<GroupPermission>;
    if (typeof p?.name !== 'string' || !/^[a-z][a-z0-9_]{1,80}$/.test(p.name) || typeof p.value !== 'number' || !Number.isInteger(p.value)) throw new Error('entry');
    perms.push({ name: p.name, value: p.value, skip: Boolean(p.skip), negate: Boolean(p.negate) });
  }
  return { subject: data.subject, perms, exportedAt: data.exportedAt };
}
