import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { HttpError } from './errors.js';

const ACTIONS = ['start', 'stop', 'restart'];
let busy = null; // { action, startedAt }

export function isControlBusy() {
  return busy;
}

export function controlInfo(t = config.ts3) {
  return {
    mode: t.controlMode,
    configured: isConfigured(t),
    detail:
      t.controlMode === 'script' ? t.startScript
        : t.controlMode === 'systemd' ? t.systemdUnit
          : t.controlMode === 'docker' ? t.dockerContainer
            : t.controlMode === 'custom' ? 'custom'
              : 'disabled',
  };
}

export function isConfigured(t = config.ts3) {
  switch (t.controlMode) {
    case 'script': return Boolean(t.startScript);
    case 'systemd': return Boolean(t.systemdUnit);
    case 'docker': return Boolean(t.dockerContainer);
    case 'custom': return Boolean(t.customCmd.start && t.customCmd.stop);
    default: return false;
  }
}

export function buildCommand(action, t = config.ts3) {
  const sudo = t.useSudo ? ['sudo', '-n'] : [];
  switch (t.controlMode) {
    case 'script': {
      const args = action === 'stop' ? [] : t.startArgs;
      return { cmd: '/bin/sh', args: [t.startScript, action, ...args], cwd: t.dir || undefined };
    }
    case 'systemd':
      return { cmd: sudo[0] || 'systemctl', args: [...sudo.slice(1), ...(sudo.length ? ['systemctl'] : []), action, t.systemdUnit] };
    case 'docker':
      return { cmd: sudo[0] || 'docker', args: [...sudo.slice(1), ...(sudo.length ? ['docker'] : []), action, t.dockerContainer] };
    case 'custom': {
      const line = t.customCmd[action];
      if (!line) return null;
      return { cmd: '/bin/sh', args: ['-c', line], cwd: t.dir || undefined };
    }
    default:
      return null;
  }
}

export function runCommand({ cmd, args, cwd }, timeoutMs = 330000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let child;
    try {
      // stdin ignorieren; bei "exit" (nicht "close") auflösen, damit ein daemonisierter
      // ts3server, der die Pipes offen hält, den Aufruf nicht blockiert.
      child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    } catch (e) {
      return resolve({ ok: false, code: -1, stdout, stderr: e.message, durationMs: 0 });
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve({ ok: false, code: -1, stdout, stderr: `${stderr}\ntimeout after ${timeoutMs / 1000}s`, durationMs: Date.now() - started });
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: `${stderr}\n${e.message}`, durationMs: Date.now() - started });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      // kleine Verzögerung, damit noch gepufferte Ausgabe ankommt
      setTimeout(() => resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim(), durationMs: Date.now() - started }), 150);
    });
  });
}

/**
 * Führt start | stop | restart aus. Nur eine Aktion gleichzeitig.
 */
export async function controlServer(action) {
  if (!ACTIONS.includes(action)) throw new HttpError(400, 'errors.unknownAction');
  if (!isConfigured()) throw new HttpError(400, 'process.notConfigured');
  if (busy) throw new HttpError(409, 'process.busy', { action: busy.action });
  busy = { action, startedAt: new Date().toISOString() };
  try {
    if (action === 'restart' && config.ts3.controlMode === 'custom' && !config.ts3.customCmd.restart) {
      const stop = await runCommand(buildCommand('stop'));
      const start = await runCommand(buildCommand('start'));
      return { ok: stop.ok && start.ok, steps: [stop, start], output: [stop.stdout, stop.stderr, start.stdout, start.stderr].filter(Boolean).join('\n') };
    }
    const spec = buildCommand(action);
    if (!spec) throw new HttpError(400, 'process.noCommand', { action });
    const result = await runCommand(spec);
    return { ...result, output: [result.stdout, result.stderr].filter(Boolean).join('\n') };
  } finally {
    busy = null;
  }
}

async function readPid(t = config.ts3) {
  if (!t.pidFile) return null;
  try {
    const pid = parseInt((await fsp.readFile(t.pidFile, 'utf8')).trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function processStartTime(pid) {
  // Linux: Startzeit aus /proc ableiten
  try {
    const stat = await fsp.stat(`/proc/${pid}`);
    return stat.ctime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Ermittelt, ob der TS3-Prozess läuft (je nach Steuerungsmodus).
 */
export async function getProcessStatus(t = config.ts3) {
  const base = { mode: t.controlMode, configured: isConfigured(t), checkedAt: new Date().toISOString(), running: null, pid: null, startedAt: null, detail: '' };
  try {
    switch (t.controlMode) {
      case 'script': {
        const pid = await readPid(t);
        if (pid && pidAlive(pid)) {
          return { ...base, running: true, pid, startedAt: await processStartTime(pid) };
        }
        return { ...base, running: false, detail: pid ? 'pidStale' : 'noPidFile' };
      }
      case 'systemd': {
        const r = await runCommand({ cmd: 'systemctl', args: ['show', t.systemdUnit, '-p', 'ActiveState,MainPID,ExecMainStartTimestamp'] }, 10000);
        const props = Object.fromEntries(r.stdout.split('\n').map((l) => l.split('=')));
        const running = props.ActiveState === 'active';
        return { ...base, running, pid: parseInt(props.MainPID, 10) || null, startedAt: props.ExecMainStartTimestamp ? new Date(props.ExecMainStartTimestamp).toISOString() : null, detail: props.ActiveState };
      }
      case 'docker': {
        const r = await runCommand({ cmd: 'docker', args: ['inspect', '-f', '{{.State.Running}}|{{.State.Pid}}|{{.State.StartedAt}}', t.dockerContainer] }, 10000);
        if (!r.ok) return { ...base, running: false, detail: r.stderr };
        const [running, pid, startedAt] = r.stdout.split('|');
        return { ...base, running: running === 'true', pid: parseInt(pid, 10) || null, startedAt };
      }
      case 'custom': {
        if (!t.customCmd.status) return { ...base, running: null, detail: 'noStatusCmd' };
        const r = await runCommand({ cmd: '/bin/sh', args: ['-c', t.customCmd.status], cwd: t.dir || undefined }, 10000);
        return { ...base, running: r.ok, detail: r.stdout || r.stderr };
      }
      default:
        return { ...base, running: null, detail: 'disabled' };
    }
  } catch (e) {
    return { ...base, running: null, detail: e.message };
  }
}

