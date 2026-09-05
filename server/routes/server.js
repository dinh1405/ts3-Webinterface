import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireAuth, requireCap } from '../lib/auth.js';
import { ts3, serializeServer, describeError } from '../lib/ts3.js';
import { controlServer, getProcessStatus, isControlBusy, controlInfo } from '../lib/process.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { tr, ts } from '../lib/locale.js';
import * as watchdog from '../lib/watchdog.js';

const router = Router();

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && obj[k] !== undefined).map((k) => [k, obj[k]]));

router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const proc = await getProcessStatus();
  const query = ts3.summary();
  let host = null;
  let version = null;
  let servers = [];
  let current = null;
  if (ts3.connected) {
    try {
      const ts = ts3.get();
      const [h, v, list, info] = await Promise.all([ts.hostInfo(), ts.version(), ts.serverList(), ts.serverInfo()]);
      host = pick(h, [
        'instanceUptime', 'hostTimestampUtc', 'virtualserversRunningTotal', 'virtualserversTotalMaxclients',
        'virtualserversTotalClientsOnline', 'virtualserversTotalChannelsOnline', 'connectionBytesSentTotal',
        'connectionBytesReceivedTotal', 'connectionBandwidthSentLastSecondTotal', 'connectionBandwidthReceivedLastSecondTotal',
        'connectionBandwidthSentLastMinuteTotal', 'connectionBandwidthReceivedLastMinuteTotal',
        'connectionFiletransferBytesSentTotal', 'connectionFiletransferBytesReceivedTotal',
      ]);
      version = v ? pick(v, ['version', 'build', 'platform']) : null;
      servers = list.map(serializeServer);
      current = pick(info, [
        'virtualserverId', 'virtualserverName', 'virtualserverPort', 'virtualserverStatus', 'virtualserverUniqueIdentifier',
        'virtualserverClientsonline', 'virtualserverQueryclientsonline', 'virtualserverMaxclients', 'virtualserverReservedSlots',
        'virtualserverChannelsonline', 'virtualserverUptime', 'virtualserverCreated', 'virtualserverTotalPing',
        'virtualserverTotalPacketlossTotal', 'virtualserverTotalBytesUploaded', 'virtualserverTotalBytesDownloaded',
        'connectionBandwidthSentLastSecondTotal', 'connectionBandwidthReceivedLastSecondTotal', 'virtualserverWelcomemessage',
      ]);
    } catch (e) {
      query.lastError = describeError(e);
    }
  }
  res.json({
    process: proc,
    control: controlInfo(),
    query,
    host,
    version,
    servers,
    current,
    busy: isControlBusy(),
    ts3Dir: config.ts3.dir || null,
    watchdog: (() => { const w = watchdog.watchdogState(); return { enabled: w.settings.enabled, suspended: w.settings.suspended, gaveUp: w.gaveUp, active: w.active }; })(),
  });
}));

router.post('/control/:action', requireCap('server.control'), asyncHandler(async (req, res) => {
  const { action } = req.params;
  if (!['start', 'stop', 'restart'].includes(action)) throw new HttpError(400, 'errors.unknownAction');
  if (action !== 'start') ts3.expectDisconnect();
  const result = await watchdog.withHold(() => controlServer(action));
  if (action !== 'stop') ts3.connectSoon(2500);
  // Watchdog: bewusst gestoppt → nicht neu starten; manuell gestartet → wieder überwachen
  if (result.ok) await watchdog.setSuspended(action === 'stop', req.user.username);
  audit(req, `server.${action}`, { ok: result.ok, output: (result.output || '').slice(0, 2000) }, result.ok);
  if (!result.ok) {
    return res.status(500).json({ error: tr(req)('server.actionFailed', { action }), key: 'server.actionFailed', output: result.output, code: result.code });
  }
  res.json({ ok: true, action, output: result.output, durationMs: result.durationMs });
}));

router.get('/virtualservers', requireAuth, asyncHandler(async (req, res) => {
  const ts = ts3.get();
  res.json({ servers: (await ts.serverList()).map(serializeServer) });
}));

router.post('/virtualservers/:sid/:action', requireCap('server.control'), asyncHandler(async (req, res) => {
  const { sid, action } = req.params;
  if (!/^\d+$/.test(sid)) throw new HttpError(400, 'errors.invalidServerId');
  const ts = ts3.get();
  if (action === 'start') await ts.serverStart(sid);
  else if (action === 'stop') await ts.serverStop(sid, ts('server.stopReason'));
  else throw new HttpError(400, 'errors.unknownAction');
  audit(req, `virtualserver.${action}`, { sid });
  res.json({ ok: true });
}));

router.get('/events/recent', requireAuth, (req, res) => {
  res.json({ events: ts3.recentEvents.slice(0, 100) });
});

export default router;
