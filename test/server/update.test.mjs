import { describe, it, expect } from 'vitest';

describe('update verification', () => {
  it('compares versions numerically', async () => {
    const { compareVersions } = await import('../../server/lib/update.js');
    expect(compareVersions('3.13.7', '3.13.6')).toBeGreaterThan(0);
    expect(compareVersions('3.13.7', '3.13.7')).toBe(0);
    expect(compareVersions('3.9', '3.13.7')).toBeLessThan(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('only counts a confirmed matching version as success', async () => {
    const { classifyVersion } = await import('../../server/lib/update.js');
    expect(classifyVersion('3.13.7', '3.13.7')).toBe('ok');
    expect(classifyVersion('3.13.6', '3.13.7')).toBe('mismatch');
    expect(classifyVersion(null, '3.13.7')).toBe('unverified');
    expect(classifyVersion('', '3.13.7')).toBe('unverified');
  });

  it('exposes the new notification event with a default and texts in both languages', async () => {
    const { EVENT_KEYS, eventLabels } = await import('../../server/lib/notify.js');
    const { DEFAULT_SETTINGS } = await import('../../server/lib/settings.js');
    expect(EVENT_KEYS).toContain('updateUnverified');
    expect(DEFAULT_SETTINGS.notifications.events.updateUnverified).toBe(true);
    expect(eventLabels('de').updateUnverified).toMatch(/nicht bestätigt/);
    expect(eventLabels('en').updateUnverified).toMatch(/not confirmed/);
  });
});
