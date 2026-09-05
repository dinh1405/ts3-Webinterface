import { getSettings, updateSettings } from './settings.js';
import { getProcessStatus, controlServer, isControlBusy, isConfigured } from './process.js';
import { ts3 } from './ts3.js';
import { notify } from './notify.js';
import { audit } from './audit.js';
import { ts } from './locale.js';

const LOG_MAX = 100;
const state = {
  lastCheck: null,
  lastStatus: null, // true | false | null
  lastAction: null, // { ts, ok, output }
  restarts: [], // ISO-Zeitstempel der Neustartversuche
  gaveUp: false,
  holds: 0,
  checking: false,
  log: [],
};
let timer = null;

const log = (msg) => {
  state.log.unshift({ ts: new Date().toISOString(), msg });
  if (state.log.length > LOG_MAX) state.log.length = LOG_MAX;
  console.log(`[watchdog] ${msg}`);
};

const restartsLastHour = () => {
  const cutoff = Date.now() - 3600 * 1000;
  state.restarts = state.restarts.filter((t) => new Date(t).getTime() > cutoff);
  return state.restarts.length;
};

export function watchdogState() {
  const s = getSettings().watchdog;
  return {
    settings: s,
    configured: isConfigured(),
    active: Boolean(timer) && s.enabled,
    lastCheck: state.lastCheck,
    lastStatus: state.lastStatus,
    lastAction: state.lastAction,
    restartsLastHour: restartsLastHour(),
    gaveUp: state.gaveUp,
    held: state.holds > 0,
    log: state.log,
  };
}

/** Während Restore/Update: Watchdog darf nicht eingreifen. */
export function hold() { state.holds++; }
export function release() { state.holds = Math.max(0, state.holds - 1); }
export async function withHold(fn) {
  hold();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Manuell gestoppt → Watchdog pausiert bis zum nächsten manuellen Start. */
export async function setSuspended(suspended, who = 'system') {
  const s = getSettings().watchdog;
  if (s.suspended === suspended) return;
  await updateSettings({ watchdog: { ...s, suspended } });
  if (!suspended) { state.gaveUp = false; state.restarts = []; }
  log(suspended ? ts('watchdog.log.suspended', { who }) : ts('watchdog.log.resumed', { who }));
}

export function resetGaveUp() {
  state.gaveUp = false;
  state.restarts = [];
  log(ts('watchdog.log.reset'));
}

export function applyWatchdog() {
  if (timer) { clearInterval(timer); timer = null; }
  const s = getSettings().watchdog;
  if (!s.enabled) { log(ts('watchdog.log.disabled')); return; }
  if (!isConfigured()) { log(ts('watchdog.log.notConfigured')); return; }
  const interval = Math.min(600, Math.max(10, Number(s.intervalSec) || 30));
  timer = setInterval(check, interval * 1000);
  timer.unref?.();
  log(ts('watchdog.log.active', { interval, max: s.maxRestartsPerHour }));
}

export function startWatchdog() {
  applyWatchdog();
  const s = getSettings().watchdog;
  if (s.enabled && s.startOnBoot && !s.suspended) {
    setTimeout(() => bootCheck().catch((e) => log(ts('watchdog.log.bootCheckFailed', { error: e.message }))), 15000).unref?.();
  }
}

async function bootCheck() {
  if (!isConfigured() || state.holds > 0) return;
  const st = await getProcessStatus();
  if (st.running === false) {
    log(ts('watchdog.log.autostart'));
    await restart(ts('watchdog.reason.boot'));
  }
}

async function restart(reason) {
  if (isControlBusy()) { log(ts('watchdog.log.busy')); return; }
  state.restarts.push(new Date().toISOString());
  log(ts('watchdog.log.starting', { reason }));
  let result;
  try {
    result = await controlServer('start');
  } catch (e) {
    result = { ok: false, output: e.message };
  }
  state.lastAction = { ts: new Date().toISOString(), ok: result.ok, output: (result.output || '').slice(0, 500), reason };
  audit(null, 'watchdog.restart', { ok: result.ok, reason, output: (result.output || '').slice(0, 500) }, result.ok);
  if (result.ok) {
    ts3.connectSoon(3000);
    log(ts('watchdog.log.started'));
    notify('serverRestarted', { reason, count: restartsLastHour() });
  } else {
    log(ts('watchdog.log.startFailed', { output: result.output }));
  }
  return result;
}

async function check() {
  const s = getSettings().watchdog;
  if (!s.enabled || state.holds > 0 || state.checking || isControlBusy()) return;
  state.checking = true;
  try {
    const st = await getProcessStatus();
    state.lastCheck = new Date().toISOString();
    const wasRunning = state.lastStatus;
    state.lastStatus = st.running;
    if (st.running !== false) {
      if (st.running === true && state.gaveUp) { state.gaveUp = false; log(ts('watchdog.log.backUp')); }
      return;
    }
    if (s.suspended) return; // bewusst gestoppt
    if (state.gaveUp) return;
    if (wasRunning !== false) {
      log(ts('watchdog.log.down'));
      notify('serverDown', { detail: st.detail || '?' });
    }
    if (restartsLastHour() >= s.maxRestartsPerHour) {
      state.gaveUp = true;
      log(ts('watchdog.log.gaveUp', { max: s.maxRestartsPerHour }));
      audit(null, 'watchdog.gaveup', { restartsLastHour: restartsLastHour() }, false);
      notify('watchdogGaveUp', { max: s.maxRestartsPerHour, output: state.lastAction?.output || '–' });
      return;
    }
    await restart(ts('watchdog.reason.notRunning'));
  } catch (e) {
    log(ts('watchdog.log.checkFailed', { error: e.message }));
  } finally {
    state.checking = false;
  }
}
