import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('translations', () => {
  it('pass scripts/i18n-check.mjs (identical key sets, every used key exists, no German remnants)', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'i18n-check.mjs')], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  });

  it('translate a key with parameters in both languages and fall back to English for unknown locales', async () => {
    const { t } = await import('../../server/i18n/index.js');
    expect(t('de', 'notify.updateDone.title', { to: '3.13.8' })).toBe('TS3-Update auf 3.13.8 abgeschlossen');
    expect(t('en', 'notify.updateDone.title', { to: '3.13.8' })).toBe('TS3 update to 3.13.8 completed');
    expect(t('fr', 'notify.updateDone.title', { to: '3.13.8' })).toBe('TS3 update to 3.13.8 completed');
  });
});
