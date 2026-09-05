import { EventEmitter } from 'node:events';
import { TeamSpeak, QueryProtocol } from 'ts3-nodejs-library';
import { config } from '../config.js';
import { TS3Unavailable } from './errors.js';

const RECENT_EVENTS_MAX = 200;

/**
 * Verwaltet eine dauerhafte ServerQuery-Verbindung mit automatischem Reconnect
 * und verteilt TS3-Ereignisse (Client-Verbindungen, Nachrichten, ...) per EventEmitter.
 */
export class TS3Manager extends EventEmitter {
  constructor(opts = config.ts3.query) {
    super();
    this.opts = opts;
    this.ts = null;
    this.connected = false;
    this.connecting = false;
    this.stopped = false;
    this.lastError = null;
    this.connectedSince = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 3000;
    this.nextReconnectAt = null;
    this.recentEvents = [];
    this.expectingDisconnect = false;
    this.healthTimer = null;
    this.generation = 0; // steigt bei reconfigure/stop, damit späte connect()-Ergebnisse verworfen werden
    this.paused = false;
  }

  summary() {
    return {
      connected: this.connected,
      connecting: this.connecting,
      paused: this.paused,
      connectedSince: this.connectedSince,
      lastError: this.lastError,
      nextReconnectAt: this.nextReconnectAt,
      host: this.opts.host,
      port: this.opts.port,
      protocol: this.opts.protocol,
      username: this.opts.username,
      passwordSet: Boolean(this.opts.password),
    };
  }

  /** Liefert die aktive Verbindung oder wirft 503. */
  get() {
    if (!this.connected || !this.ts) throw new TS3Unavailable(this.lastError || undefined);
    return this.ts;
  }

  start() {
    this.stopped = false;
    this.connect();
    this.healthTimer = setInterval(() => this.healthCheck(), 30000);
    this.healthTimer.unref?.();
  }

  async stop() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.healthTimer);
    this.nextReconnectAt = null;
    this.connecting = false;
    if (this.ts) {
      try {
        await this.ts.quit();
      } catch {
        this.ts.forceQuit?.();
      }
    }
    this.ts = null;
    this.connected = false;
    this.connectedSince = null;
  }

  /**
   * Verbindung mit den aktuellen `opts` neu aufbauen (nach Konfigurationsänderung).
   * `opts` referenziert config.ts3.query und ist bereits aktualisiert.
   */
  async reconfigure() {
    await this.stop();
    this.reconnectDelay = 3000;
    this.lastError = null;
    if (!this.paused) this.start();
    this.emitStatus();
  }

  /** Während des Setup-Assistenten: keine eigenen Verbindungsversuche (verhindert TS3-Login-Sperren). */
  async pause() {
    if (this.paused) return;
    this.paused = true;
    await this.stop();
    this.emit('log', 'ServerQuery paused (setup)');
    this.emitStatus();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.reconnectDelay = 3000;
    this.start();
    this.emitStatus();
  }

  /** Beschleunigt den nächsten Verbindungsversuch (z. B. nach einem Serverstart). */
  connectSoon(delayMs = 1500) {
    clearTimeout(this.reconnectTimer);
    this.reconnectDelay = 3000;
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
    this.nextReconnectAt = new Date(Date.now() + delayMs).toISOString();
  }

  /** Vor einem Stop/Neustart aufrufen, damit der Verbindungsabbruch nicht als Fehler gilt. */
  expectDisconnect() {
    this.expectingDisconnect = true;
  }

  async connect() {
    if (this.stopped || this.connecting || this.connected || this.paused) return;
    const gen = this.generation;
    if (!this.opts.password) {
      this.lastError = 'ServerQuery password not configured';
      this.emitStatus();
      return;
    }
    this.connecting = true;
    clearTimeout(this.reconnectTimer);
    this.nextReconnectAt = null;
    this.emitStatus();
    let ts;
    try {
      ts = await TeamSpeak.connect({
        host: this.opts.host,
        queryport: this.opts.port,
        protocol: this.opts.protocol === 'ssh' ? QueryProtocol.SSH : QueryProtocol.RAW,
        username: this.opts.username,
        password: this.opts.password,
        serverport: this.opts.serverId ? undefined : this.opts.serverPort,
        keepAlive: true,
        keepAliveTimeout: 120,
        readyTimeout: 15000,
        ignoreQueries: true,
      });
      if (gen !== this.generation) { try { ts.forceQuit(); } catch { /* ignore */ } return; }
      if (this.opts.serverId) await ts.useBySid(String(this.opts.serverId));
      await this.applyNickname(ts);
      if (gen !== this.generation) { try { ts.forceQuit(); } catch { /* ignore */ } return; }
      ts.on('error', (err) => {
        this.lastError = err?.message || String(err);
        this.emit('log', `ServerQuery-Fehler: ${this.lastError}`);
      });
      ts.on('close', (err) => this.handleClose(err));
      ts.on('flooding', () => this.emit('log', 'ServerQuery reports flooding – commands are throttled'));
      await this.registerEvents(ts);
      this.ts = ts;
      this.connected = true;
      this.connecting = false;
      this.lastError = null;
      this.connectedSince = new Date().toISOString();
      this.reconnectDelay = 3000;
      this.expectingDisconnect = false;
      this.emit('log', `ServerQuery connected (${this.opts.host}:${this.opts.port})`);
      this.pushEvent({ type: 'query.connected', message: 'ServerQuery connected', params: {} });
      this.emitStatus();
    } catch (err) {
      if (gen !== this.generation) { if (ts) { try { ts.forceQuit(); } catch { /* ignore */ } } return; }
      this.connecting = false;
      this.lastError = describeError(err);
      if (ts) {
        try { ts.forceQuit(); } catch { /* ignore */ }
      }
      if (!this.expectingDisconnect) this.emit('log', `ServerQuery connection failed: ${this.lastError}`);
      this.scheduleReconnect();
      this.emitStatus();
    }
  }

  async applyNickname(ts) {
    const base = this.opts.nickname || 'Webinterface';
    for (let i = 0; i < 5; i++) {
      const name = i === 0 ? base : `${base} ${i + 1}`;
      try {
        await ts.execute('clientupdate', { client_nickname: name });
        return;
      } catch {
        // Name bereits belegt → nächsten probieren
      }
    }
  }

  async registerEvents(ts) {
    try {
      await ts.registerEvent('server');
      await ts.registerEvent('channel', 0);
      await ts.registerEvent('textserver');
      await ts.registerEvent('textchannel');
      await ts.registerEvent('textprivate');
    } catch (err) {
      this.emit('log', `event registration failed: ${describeError(err)}`);
    }

    for (const name of ['clientconnect', 'clientdisconnect', 'clientmoved']) ts.on(name, (ev) => this.emit('raw', name, ev));
    ts.on('clientconnect', (ev) => {
      const c = ev.client;
      this.pushEvent({
        type: 'client.connect',
        message: `${c?.nickname ?? '?'} connected`,
        params: { nickname: c?.nickname ?? '?' },
        client: { clid: c?.clid, nickname: c?.nickname, uid: c?.uniqueIdentifier, ip: c?.connectionClientIp, country: c?.country },
      });
    });
    ts.on('clientdisconnect', (ev) => {
      const name = ev.client?.nickname ?? `Client #${ev.event?.clid}`;
      const reason = ev.event?.reasonmsg || '';
      const invoker = ev.event?.invokername || '';
      const banned = ev.event?.bantime !== undefined && ev.event?.reasonid === '6';
      this.pushEvent({
        type: banned ? 'client.banned' : invoker ? 'client.kicked' : 'client.disconnect',
        message: `${name} ${banned ? 'was banned' : invoker ? 'was kicked' : 'disconnected'}${invoker ? ` by ${invoker}` : ''}${reason ? ` (${reason})` : ''}`,
        params: { nickname: name, invoker, reason },
        client: { clid: ev.event?.clid, nickname: ev.client?.nickname, uid: ev.client?.uniqueIdentifier },
      });
    });
    ts.on('clientmoved', (ev) => {
      this.pushEvent({
        type: 'client.moved',
        message: `${ev.client?.nickname ?? 'Client'} → ${ev.channel?.name ?? '?'}`,
        params: { nickname: ev.client?.nickname ?? 'Client', channel: ev.channel?.name ?? '?' },
        client: { clid: ev.client?.clid, nickname: ev.client?.nickname, uid: ev.client?.uniqueIdentifier },
        channel: { cid: ev.channel?.cid, name: ev.channel?.name },
      });
    });
    ts.on('textmessage', (ev) => {
      const scope = { 1: 'private', 2: 'channel', 3: 'server' }[ev.targetmode] || 'chat';
      this.pushEvent({
        type: 'chat',
        message: `[${scope}] ${ev.invoker?.nickname ?? '?'}: ${ev.msg}`,
        params: { scope, nickname: ev.invoker?.nickname ?? '?', msg: ev.msg },
        client: { clid: ev.invoker?.clid, nickname: ev.invoker?.nickname },
      });
    });
    ts.on('serveredit', (ev) => {
      const keys = Object.keys(ev.modified || {}).join(', ');
      this.pushEvent({ type: 'server.edit', message: `Server settings changed by ${ev.invoker?.nickname ?? '?'}${keys ? `: ${keys}` : ''}`, params: { invoker: ev.invoker?.nickname ?? '?', keys } });
    });
    const chEvent = (type, verb) => (ev) => this.pushEvent({ type, message: `Channel "${ev.channel?.name ?? `#${ev.cid ?? '?'}`}" ${verb} by ${ev.invoker?.nickname ?? '?'}`, params: { name: ev.channel?.name ?? `#${ev.cid ?? '?'}`, invoker: ev.invoker?.nickname ?? '?' } });
    ts.on('channelcreate', chEvent('channel.create', 'created'));
    ts.on('channeledit', chEvent('channel.edit', 'edited'));
    ts.on('channeldelete', chEvent('channel.delete', 'deleted'));
    ts.on('channelmoved', chEvent('channel.move', 'moved'));
  }

  handleClose(err) {
    if (!this.connected && !this.ts) return;
    this.connected = false;
    this.ts = null;
    this.connectedSince = null;
    const expected = this.expectingDisconnect;
    this.lastError = err ? describeError(err) : expected ? 'connection closed (server stopped)' : 'connection lost';
    this.emit('log', `ServerQuery disconnected${err ? `: ${describeError(err)}` : ''}`);
    this.pushEvent({ type: 'query.disconnected', message: 'ServerQuery disconnected', params: {} });
    this.emitStatus();
    if (!this.stopped) this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.stopped || this.paused) return;
    clearTimeout(this.reconnectTimer);
    let delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
    const err = String(this.lastError || '');
    // TS3 sperrt die IP nach fehlgeschlagenen Logins ("you are banned – retry in N seconds");
    // jeder weitere Versuch verlängert die Sperre → exakt so lange warten.
    const banned = err.match(/retry in (\d+) seconds/i);
    if (banned) {
      delay = (parseInt(banned[1], 10) + 10) * 1000;
      this.emit('log', `ServerQuery login blocked – next attempt in ${Math.round(delay / 1000)} s`);
    } else if (/invalid loginname or password/i.test(err)) {
      // Falsches Passwort: langsam erneut versuchen, sonst löst TS3 den Brute-Force-Schutz aus
      delay = Math.max(delay, 120000);
      this.emit('log', 'ServerQuery credentials rejected (check the password) – next attempt in 2 min');
    }
    this.nextReconnectAt = new Date(Date.now() + delay).toISOString();
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }

  async healthCheck() {
    if (!this.connected || !this.ts) return;
    try {
      await this.ts.whoami();
    } catch (err) {
      this.emit('log', `health check failed: ${describeError(err)}`);
      const ts = this.ts;
      this.handleClose(err);
      try { ts.forceQuit(); } catch { /* ignore */ }
    }
  }

  pushEvent(ev) {
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ts: new Date().toISOString(), ...ev };
    this.recentEvents.unshift(entry);
    if (this.recentEvents.length > RECENT_EVENTS_MAX) this.recentEvents.length = RECENT_EVENTS_MAX;
    this.emit('event', entry);
  }

  emitStatus() {
    this.emit('status', this.summary());
  }
}

/**
 * Einmaliger Verbindungstest ohne Nebenwirkungen: anmelden, virtuelle Server und Version lesen, trennen.
 * Liefert strukturierte Fehlercodes: banned | badCredentials | refused | timeout | error.
 */
export async function probeQuery(opts, { timeoutMs = 10000 } = {}) {
  let ts;
  const started = Date.now();
  try {
    ts = await TeamSpeak.connect({
      host: opts.host,
      queryport: Number(opts.port),
      protocol: opts.protocol === 'ssh' ? QueryProtocol.SSH : QueryProtocol.RAW,
      username: opts.username,
      password: opts.password,
      keepAlive: false,
      readyTimeout: timeoutMs,
      ignoreQueries: true,
    });
    const [servers, version] = await Promise.all([
      ts.serverList().catch(() => []),
      ts.version().catch(() => null),
    ]);
    return {
      ok: true,
      durationMs: Date.now() - started,
      version: version ? { version: version.version, build: version.build, platform: version.platform } : null,
      servers: servers.map((s) => ({ id: String(s.id), port: Number(s.port), name: s.name, status: s.status, clientsOnline: Number(s.clientsonline) || 0, maxClients: Number(s.maxclients) || 0, autostart: Boolean(s.autostart) })),
    };
  } catch (err) {
    const message = describeError(err);
    const banned = message.match(/retry in (\d+) seconds/i);
    const code = banned ? 'banned'
      : /invalid loginname or password/i.test(message) ? 'badCredentials'
        : /ECONNREFUSED/i.test(message) ? 'refused'
          : /ENOTFOUND|EAI_AGAIN/i.test(message) ? 'dns'
            : /timed? ?out|ETIMEDOUT|ready timeout/i.test(message) ? 'timeout'
              : 'error';
    return { ok: false, durationMs: Date.now() - started, error: { code, message, retryAfterSec: banned ? parseInt(banned[1], 10) : undefined } };
  } finally {
    if (ts) {
      try { await ts.quit(); } catch { try { ts.forceQuit(); } catch { /* ignore */ } }
    }
  }
}

export function describeError(err) {
  if (!err) return 'Unbekannter Fehler';
  if (err.msg) return [err.msg, err.extraMsg].filter(Boolean).join(' – ');
  return err.message || String(err);
}

/* ---------- Serialisierung von Bibliotheksobjekten in reines JSON ---------- */

export function serializeClient(c) {
  return {
    clid: c.clid,
    cid: c.cid,
    databaseId: c.databaseId,
    nickname: c.nickname,
    type: c.type,
    uid: c.uniqueIdentifier,
    away: Boolean(c.away),
    awayMessage: c.awayMessage || '',
    inputMuted: Boolean(c.inputMuted),
    outputMuted: Boolean(c.outputMuted),
    talkPower: c.talkPower,
    isTalker: Boolean(c.isTalker),
    isPrioritySpeaker: Boolean(c.isPrioritySpeaker),
    isRecording: Boolean(c.isRecording),
    isChannelCommander: Boolean(c.isChannelCommander),
    servergroups: c.servergroups || [],
    channelGroupId: c.channelGroupId,
    version: c.version,
    platform: c.platform,
    idleTime: c.idleTime,
    created: c.created,
    lastconnected: c.lastconnected,
    country: c.country || '',
    ip: c.connectionClientIp || '',
  };
}

export function serializeChannel(ch) {
  return {
    cid: ch.cid,
    pid: ch.pid,
    order: ch.order,
    name: ch.name,
    topic: ch.topic || '',
    flagDefault: Boolean(ch.flagDefault),
    flagPassword: Boolean(ch.flagPassword),
    flagPermanent: Boolean(ch.flagPermanent),
    flagSemiPermanent: Boolean(ch.flagSemiPermanent),
    codec: ch.codec,
    iconId: ch.iconId,
    maxclients: ch.maxclients,
    totalClients: ch.totalClients,
    neededSubscribePower: ch.neededSubscribePower,
  };
}

export function serializeServer(s) {
  return {
    id: s.id,
    port: s.port,
    status: s.status,
    clientsonline: s.clientsonline,
    queryclientsonline: s.queryclientsonline,
    maxclients: s.maxclients,
    uptime: s.uptime,
    name: s.name,
    autostart: Boolean(s.autostart),
    machineId: s.machineId,
    uid: s.uniqueIdentifier,
  };
}

/**
 * Sortiert Geschwister-Kanäle in TS3-Reihenfolge. `order` ist die ID des
 * vorhergehenden Kanals (0 = erster), nicht ein Index.
 */
export function sortSiblings(list) {
  const byPrev = new Map(list.map((c) => [String(c.order), c]));
  const out = [];
  const seen = new Set();
  let cur = byPrev.get('0');
  while (cur && !seen.has(cur.cid)) {
    out.push(cur);
    seen.add(cur.cid);
    cur = byPrev.get(String(cur.cid));
  }
  for (const c of list) if (!seen.has(c.cid)) out.push(c);
  return out;
}

export function buildChannelTree(channels, clients) {
  const byCid = new Map(channels.map((c) => [String(c.cid), { ...c, children: [], clients: [] }]));
  for (const cl of clients) {
    const ch = byCid.get(String(cl.cid));
    if (ch) ch.clients.push(cl);
  }
  const roots = [];
  for (const ch of byCid.values()) {
    const parent = byCid.get(String(ch.pid));
    if (parent && ch.pid !== '0') parent.children.push(ch);
    else roots.push(ch);
  }
  const sortRec = (list) => {
    const sorted = sortSiblings(list);
    for (const ch of sorted) {
      ch.children = sortRec(ch.children);
      ch.clients.sort((a, b) => (b.talkPower - a.talkPower) || a.nickname.localeCompare(b.nickname));
    }
    return sorted;
  };
  return sortRec(roots);
}

export const ts3 = new TS3Manager();
