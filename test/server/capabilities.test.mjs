import { describe, it, expect } from 'vitest';

describe('capabilities', () => {
  it('admins have every capability, viewers only read access', async () => {
    const { CAPABILITIES, roleCapabilities, can } = await import('../../server/lib/capabilities.js');
    const roles = roleCapabilities();
    expect(roles.admin).toEqual(CAPABILITIES);
    expect(roles.viewer).not.toContain('users.manage');
    expect(roles.viewer).toContain('history.view');
    expect(can({ role: 'viewer' }, 'backups.restore')).toBe(false);
    expect(can({ role: 'operator' }, 'bans.manage')).toBe(true);
    expect(can({ role: 'operator' }, 'update.run')).toBe(false);
    expect(can(null, 'system.view')).toBe(false);
  });

  it('stored role configuration without catalog keeps defaults for later capabilities', async () => {
    const { updateSettings } = await import('../../server/lib/settings.js');
    const { roleCapabilities, setRoleCapabilities } = await import('../../server/lib/capabilities.js');
    // Alte Konfiguration (vor history.*): Beobachter ohne Liste der bekannten Rechte
    await updateSettings({ roleCapabilities: { operator: ['bans.manage'], viewer: [] } });
    let roles = roleCapabilities();
    expect(roles.operator).toEqual(['bans.manage', 'history.view', 'history.manage']);
    expect(roles.viewer).toEqual(['history.view']);
    // Neue Speicherung schreibt den Katalog → nachträgliche Rechte gelten explizit
    roles = await setRoleCapabilities({ operator: ['bans.manage'], viewer: [] });
    expect(roles.operator).toEqual(['bans.manage']);
    expect(roles.viewer).toEqual([]);
  });
});
