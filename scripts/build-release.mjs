#!/usr/bin/env node
/**
 * Builds the release package  release/ts3-webinterface-<version>.tar.gz  (+ .sha256 and "latest" copies).
 *
 *   node scripts/build-release.mjs [--version 1.2.3] [--no-build] [--out release]
 *
 * Package layout (top-level directory ts3-webinterface-<version>/):
 *   server/            backend (no node_modules)
 *   web/dist/          built frontend
 *   deploy/            install.sh, ts3web, unit/nginx templates, Plesk notes
 *   package.json       generated: runtime dependencies only (no workspaces) → "npm ci --omit=dev" on the server
 *   package-lock.json  generated for exactly these dependencies
 *   VERSION, LICENSE, README*.md, CHANGELOG.md, SECURITY.md, .env.example
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(name);

const rootPkg = JSON.parse(await fsp.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const serverPkg = JSON.parse(await fsp.readFile(path.join(ROOT, 'server', 'package.json'), 'utf8'));
const version = String(opt('--version', rootPkg.version)).replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`invalid version: ${version}`);
const outDir = path.resolve(ROOT, opt('--out', 'release'));
const name = `ts3-webinterface-${version}`;
const stage = path.join(outDir, name);
// npm via its CLI script → no shell needed on Windows
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
const npm = fs.existsSync(npmCli) ? [process.execPath, npmCli] : ['npm'];

function run(cmd, cmdArgs, cwd = ROOT) {
  const [bin, ...pre] = Array.isArray(cmd) ? cmd : [cmd];
  const r = spawnSync(bin, [...pre, ...cmdArgs], { cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (${r.status})`);
}
const log = (m) => console.log(`[release] ${m}`);

if (!flag('--no-build')) {
  log('building frontend');
  run(npm, ['run', 'build', '-w', 'web']);
}
if (!fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) throw new Error('web/dist/index.html missing – run the build first');

log(`staging ${stage}`);
await fsp.rm(stage, { recursive: true, force: true });
await fsp.mkdir(stage, { recursive: true });

const skipServer = new Set(['node_modules', 'package.json', 'package-lock.json']);
await fsp.cp(path.join(ROOT, 'server'), path.join(stage, 'server'), { recursive: true, filter: (src) => !skipServer.has(path.basename(src)) || path.dirname(src) !== path.join(ROOT, 'server') });
await fsp.mkdir(path.join(stage, 'web'), { recursive: true });
await fsp.cp(path.join(ROOT, 'web', 'dist'), path.join(stage, 'web', 'dist'), { recursive: true });
await fsp.cp(path.join(ROOT, 'deploy'), path.join(stage, 'deploy'), { recursive: true, filter: (src) => !/\.generated$/.test(src) });
for (const f of ['LICENSE', 'README.md', 'README.de.md', 'CHANGELOG.md', 'SECURITY.md', '.env.example']) {
  if (fs.existsSync(path.join(ROOT, f))) await fsp.copyFile(path.join(ROOT, f), path.join(stage, f));
}
await fsp.writeFile(path.join(stage, 'VERSION'), `${version}\n`);

const pkg = {
  name: 'ts3-webinterface',
  version,
  private: true,
  description: rootPkg.description,
  license: 'MIT',
  type: 'module',
  engines: rootPkg.engines,
  scripts: { start: 'node server/index.js', 'create-admin': 'node server/scripts/create-admin.js' },
  dependencies: serverPkg.dependencies,
};
await fsp.writeFile(path.join(stage, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

log('generating package-lock.json');
run(npm, ['install', '--package-lock-only', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], stage);
await fsp.rm(path.join(stage, 'node_modules'), { recursive: true, force: true });

// Executable bits (the installer chmods again, but keep the archive tidy on Linux)
for (const f of ['deploy/install.sh', 'deploy/ts3web', 'server/scripts/create-admin.js']) {
  try { await fsp.chmod(path.join(stage, f), 0o755); } catch { /* Windows */ }
}

const tarName = `${name}.tar.gz`;
log(`packing ${tarName}`);
await fsp.rm(path.join(outDir, tarName), { force: true });
run('tar', ['-czf', tarName, name], outDir);
const buf = await fsp.readFile(path.join(outDir, tarName));
const sha = crypto.createHash('sha256').update(buf).digest('hex');
await fsp.writeFile(path.join(outDir, `${tarName}.sha256`), `${sha}  ${tarName}\n`);
await fsp.copyFile(path.join(outDir, tarName), path.join(outDir, 'ts3-webinterface-latest.tar.gz'));
await fsp.writeFile(path.join(outDir, 'ts3-webinterface-latest.tar.gz.sha256'), `${sha}  ts3-webinterface-latest.tar.gz\n`);
await fsp.rm(stage, { recursive: true, force: true });
log(`done: ${path.join(outDir, tarName)} (${(buf.length / 1048576).toFixed(2)} MB, sha256 ${sha})`);
