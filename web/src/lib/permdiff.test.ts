import { describe, it, expect } from 'vitest';
import { diffPerms, parsePermExport, PERM_EXPORT_FORMAT } from './permdiff';
import type { GroupPermission } from '../api/types';

const p = (name: string, value: number, skip = false, negate = false): GroupPermission => ({ name, value, skip, negate });

describe('diffPerms', () => {
  it('classifies added, removed, changed and identical permissions from A to B', () => {
    const a = [p('b_a', 1), p('i_b', 10), p('i_c', 5), p('b_d', 1, true)];
    const b = [p('i_b', 10), p('i_c', 7), p('b_d', 1, false), p('b_e', 1)];
    const d = diffPerms(a, b);
    expect(d).toMatchObject({ added: 1, removed: 1, changed: 2, same: 1 });
    expect(d.rows.map((r) => `${r.name}:${r.status}`)).toEqual(['b_a:removed', 'b_d:changed', 'b_e:added', 'i_b:same', 'i_c:changed']);
    expect(d.rows.find((r) => r.name === 'b_d')).toMatchObject({ a: { skip: true }, b: { skip: false } });
  });

  it('treats two empty sets as identical', () => {
    expect(diffPerms([], [])).toEqual({ rows: [], added: 0, removed: 0, changed: 0, same: 0 });
  });
});

describe('parsePermExport', () => {
  it('accepts the export format and normalises flags', () => {
    const text = JSON.stringify({ format: PERM_EXPORT_FORMAT, exportedAt: '2026-09-07T00:00:00Z', subject: { kind: 'servergroup', id: '7', name: 'Moderator' }, perms: [{ name: 'i_channel_modify_power', value: 75 }, { name: 'b_client_ignore_antiflood', value: 1, skip: 1, negate: 0 }] });
    const r = parsePermExport(text);
    expect(r.subject).toMatchObject({ kind: 'servergroup', id: '7' });
    expect(r.perms).toEqual([
      { name: 'i_channel_modify_power', value: 75, skip: false, negate: false },
      { name: 'b_client_ignore_antiflood', value: 1, skip: true, negate: false },
    ]);
  });

  it('rejects other formats and malformed entries', () => {
    expect(() => parsePermExport(JSON.stringify({ format: 'other', perms: [] }))).toThrow('format');
    expect(() => parsePermExport(JSON.stringify({ format: PERM_EXPORT_FORMAT, perms: [{ name: 'Bad Name', value: 1 }] }))).toThrow('entry');
    expect(() => parsePermExport(JSON.stringify({ format: PERM_EXPORT_FORMAT, perms: [{ name: 'i_x', value: 1.5 }] }))).toThrow('entry');
    expect(() => parsePermExport('not json')).toThrow();
  });
});
