/**
 * Bootstrap: startet die Anwendung (main.js) und schützt Selbst-Updates.
 *
 * Nach einem Update aus der Oberfläche liegt .update-pending im Installationsverzeichnis und die alte Version in
 * .previous/. Startet die neue Version zweimal nicht (Importfehler oder Absturz vor dem erfolgreichen Listen),
 * werden die alten Dateien zurückgeholt und der Prozess beendet – systemd (Restart=always) startet dann wieder
 * die vorherige Version. Ein erfolgreicher Start entfernt den Marker (main.js → confirmStartup()).
 *
 * Diese Datei bewusst klein und ohne Abhängigkeiten halten.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = path.join(ROOT, '.update-pending');
const PREVIOUS = path.join(ROOT, '.previous');
const FAILED = path.join(ROOT, '.failed-update');
const ENTRIES = ['server', 'web', 'deploy', 'docs', 'node_modules', 'package.json', 'package-lock.json', 'VERSION', 'README.md', 'README.de.md', 'CHANGELOG.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', '.env.example'];
const MAX_ATTEMPTS = 2;

function readMarker() {
  try { return JSON.parse(fs.readFileSync(MARKER, 'utf8')); } catch { return null; }
}

function rollback(marker, reason) {
  console.error(`[bootstrap] rolling back to ${marker.from}: ${reason}`);
  fs.rmSync(FAILED, { recursive: true, force: true });
  fs.mkdirSync(FAILED, { recursive: true });
  for (const name of ENTRIES) {
    const cur = path.join(ROOT, name);
    const prev = path.join(PREVIOUS, name);
    try { if (fs.existsSync(cur)) fs.renameSync(cur, path.join(FAILED, name)); } catch (e) { console.error(`[bootstrap] cannot move ${name}: ${e.message}`); }
    try { if (fs.existsSync(prev)) fs.renameSync(prev, cur); } catch (e) { console.error(`[bootstrap] cannot restore ${name}: ${e.message}`); }
  }
  fs.rmSync(PREVIOUS, { recursive: true, force: true });
  fs.rmSync(MARKER, { force: true });
  try {
    fs.writeFileSync(path.join(ROOT, '.update-last.json'), JSON.stringify({ ...marker, ok: false, rolledBack: true, error: reason, finishedAt: new Date().toISOString() }, null, 2));
  } catch { /* ignore */ }
}

const marker = readMarker();
if (marker && fs.existsSync(PREVIOUS)) {
  marker.attempts = (marker.attempts || 0) + 1;
  if (marker.attempts > MAX_ATTEMPTS) {
    rollback(marker, `version ${marker.to} did not start successfully after ${MAX_ATTEMPTS} attempts`);
    process.exit(1);
  }
  try { fs.writeFileSync(MARKER, JSON.stringify(marker)); } catch { /* ignore */ }
}

try {
  await import('./main.js');
} catch (e) {
  console.error('[bootstrap] start failed:', e);
  if (marker && fs.existsSync(PREVIOUS) && marker.attempts >= MAX_ATTEMPTS) rollback(marker, `start failed: ${e.message}`);
  process.exit(1);
}
