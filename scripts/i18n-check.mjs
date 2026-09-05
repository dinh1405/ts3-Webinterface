#!/usr/bin/env node
/**
 * Prüft die Übersetzungen:
 *   1. de/en haben dieselben Schlüssel (Server: server/i18n, Frontend: web/src/i18n)
 *   2. Jeder statisch verwendete Schlüssel (t('…'), td('…'), HttpError(n, '…')) existiert
 *   3. Verbleibende deutsche Texte außerhalb der Wörterbücher (Umlaute/ß in Strings und JSX-Text)
 *
 *   node scripts/i18n-check.mjs            → Fehler bei 1 und 2, Bericht zu 3
 *   node scripts/i18n-check.mjs --strict   → zusätzlich Fehler bei 3 (Ziel nach vollständiger Übersetzung)
 *   node scripts/i18n-check.mjs --report   → ausführliche Liste der Fundstellen zu 3
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const report = args.has('--report');
let failed = false;
const fail = (msg) => { failed = true; console.error(`✖ ${msg}`); };
const ok = (msg) => console.log(`✔ ${msg}`);

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'data'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.includes(path.extname(e.name))) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');

/* 1. Schlüsselmengen */
const serverDe = (await import(pathToFileURL(path.join(ROOT, 'server/i18n/de.js')))).default;
const serverEn = (await import(pathToFileURL(path.join(ROOT, 'server/i18n/en.js')))).default;
function tsKeys(file) {
  const src = fs.readFileSync(file, 'utf8');
  return new Set([...src.matchAll(/^\s*'([\w.:-]+)':\s/gm)].map((m) => m[1]));
}
const webDe = tsKeys(path.join(ROOT, 'web/src/i18n/de.ts'));
const webEn = tsKeys(path.join(ROOT, 'web/src/i18n/en.ts'));

function compare(name, a, b) {
  const onlyA = [...a].filter((k) => !b.has(k));
  const onlyB = [...b].filter((k) => !a.has(k));
  if (onlyA.length) fail(`${name}: nur in de: ${onlyA.join(', ')}`);
  if (onlyB.length) fail(`${name}: nur in en: ${onlyB.join(', ')}`);
  if (!onlyA.length && !onlyB.length) ok(`${name}: ${a.size} Schlüssel in de und en identisch`);
}
compare('Server', new Set(Object.keys(serverDe)), new Set(Object.keys(serverEn)));
compare('Frontend', webDe, webEn);

/* 2. Verwendete Schlüssel */
const serverKeys = new Set(Object.keys(serverEn));
const serverFiles = walk(path.join(ROOT, 'server'), ['.js']).filter((f) => !f.includes(`${path.sep}i18n${path.sep}`));
const missingServer = [];
for (const f of serverFiles) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const known = (k) => serverKeys.has(k) || serverKeys.has(`${k}_other`);
  for (const m of src.matchAll(/HttpError\(\s*\d+\s*,\s*'([\w.:-]+)'/g)) if (!known(m[1])) missingServer.push(`${rel(f)}: ${m[1]}`);
  for (const m of src.matchAll(/\b(?:t|ts|tr\(req\))\(\s*(?:locale\s*,\s*)?'([\w.:-]+)'/g)) if (!known(m[1])) missingServer.push(`${rel(f)}: ${m[1]}`);
}
if (missingServer.length) fail(`Server: unbekannte Schlüssel:\n   ${missingServer.join('\n   ')}`); else ok('Server: alle verwendeten Schlüssel vorhanden');

const webFiles = walk(path.join(ROOT, 'web/src'), ['.ts', '.tsx']).filter((f) => !f.includes(`${path.sep}i18n${path.sep}`));
const missingWeb = [];
for (const f of webFiles) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/\bt[d]?\(\s*'([\w.:-]+)'/g)) if (!webEn.has(m[1]) && !webEn.has(`${m[1]}_other`)) missingWeb.push(`${rel(f)}: ${m[1]}`);
}
if (missingWeb.length) fail(`Frontend: unbekannte Schlüssel:\n   ${missingWeb.join('\n   ')}`); else ok('Frontend: alle verwendeten Schlüssel vorhanden');

/* 3. Deutsche Reste: Umlaute/ß in String-Literalen oder JSX-Text (Kommentare ausgenommen) */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}
const GERMAN = /[äöüÄÖÜß]|\b(Speichern|Abbrechen|Löschen|Benutzer|Kanal|Kanäle|Einstellungen|Verbindung|erfolgreich|fehlgeschlagen|Bitte|nicht|wird|wurde|keine|Keine)\b/;
const remnants = new Map();
for (const f of [...serverFiles, ...webFiles]) {
  const lines = stripComments(fs.readFileSync(f, 'utf8')).split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    // nur Zeilen mit String-Literal oder JSX-Text betrachten
    const strings = [...line.matchAll(/'([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`([^`\\]|\\.)*`|>([^<{}]+)</g)].map((m) => m[0]);
    if (strings.some((s) => GERMAN.test(s))) hits.push(i + 1);
  });
  if (hits.length) remnants.set(rel(f), hits);
}
const total = [...remnants.values()].reduce((a, b) => a + b.length, 0);
if (total) {
  const lines = [...remnants.entries()].sort((a, b) => b[1].length - a[1].length).map(([f, hits]) => `   ${String(hits.length).padStart(4)}  ${f}${report ? `  (Zeilen ${hits.slice(0, 40).join(', ')}${hits.length > 40 ? ', …' : ''})` : ''}`);
  const msg = `Deutsche Texte außerhalb der Wörterbücher: ${total} Zeilen in ${remnants.size} Dateien\n${lines.join('\n')}`;
  if (strict) fail(msg); else console.log(`ℹ ${msg}`);
} else ok('Keine deutschen Texte außerhalb der Wörterbücher');

process.exit(failed ? 1 : 0);
