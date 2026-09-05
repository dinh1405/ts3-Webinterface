import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let cached = null;

/** Version aus VERSION-Datei (Release-Paket) oder package.json (Entwicklung). */
export function appVersion() {
  if (cached) return cached;
  try {
    cached = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
  } catch {
    try {
      cached = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
    } catch {
      cached = '0.0.0';
    }
  }
  return cached;
}
