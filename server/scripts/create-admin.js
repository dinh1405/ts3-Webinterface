#!/usr/bin/env node
/**
 * Legt einen Benutzer an oder setzt sein Passwort zurück (Notfall-CLI).
 *
 *   npm run create-admin -- --username admin --password 'geheim123' [--role admin]
 */
import { createUser, findByUsername, setPassword, updateUser, ROLES } from '../lib/users.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);

const username = args.username || process.env.ADMIN_USERNAME;
const password = args.password || process.env.ADMIN_PASSWORD;
const role = args.role || 'admin';

if (!username || !password) {
  console.error('Usage: npm run create-admin -- --username <name> --password <password> [--role admin|operator|viewer]');
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`Invalid role. Allowed: ${ROLES.join(', ')}`);
  process.exit(1);
}

try {
  const existing = findByUsername(username);
  if (existing) {
    await setPassword(existing.id, password);
    await updateUser(existing.id, { role, active: true });
    console.log(`User "${username}" updated (password reset, role ${role}, active).`);
  } else {
    await createUser({ username, password, role });
    console.log(`User "${username}" created with role ${role}.`);
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
