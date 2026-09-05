import { Router } from 'express';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { requireCap } from '../lib/auth.js';
import { ts3 } from '../lib/ts3.js';
import { audit } from '../lib/audit.js';

const router = Router();

export const VIRTUAL_KEYS = [
  'virtualserverName', 'virtualserverNamePhonetic', 'virtualserverWelcomemessage', 'virtualserverMaxclients', 'virtualserverReservedSlots',
  'virtualserverPassword', 'virtualserverHostmessage', 'virtualserverHostmessageMode', 'virtualserverDefaultServerGroup',
  'virtualserverDefaultChannelGroup', 'virtualserverDefaultChannelAdminGroup', 'virtualserverMaxDownloadTotalBandwidth',
  'virtualserverMaxUploadTotalBandwidth', 'virtualserverHostbannerUrl', 'virtualserverHostbannerGfxUrl', 'virtualserverHostbannerGfxInterval',
  'virtualserverHostbannerMode', 'virtualserverHostbuttonTooltip', 'virtualserverHostbuttonGfxUrl', 'virtualserverHostbuttonUrl',
  'virtualserverComplainAutobanCount', 'virtualserverComplainAutobanTime', 'virtualserverComplainRemoveTime',
  'virtualserverMinClientsInChannelBeforeForcedSilence', 'virtualserverPrioritySpeakerDimmModificator',
  'virtualserverAntifloodPointsTickReduce', 'virtualserverAntifloodPointsNeededCommandBlock', 'virtualserverAntifloodPointsNeededPluginBlock',
  'virtualserverAntifloodPointsNeededIpBlock', 'virtualserverDownloadQuota', 'virtualserverUploadQuota', 'virtualserverAutostart',
  'virtualserverLogClient', 'virtualserverLogQuery', 'virtualserverLogChannel', 'virtualserverLogPermissions', 'virtualserverLogServer',
  'virtualserverLogFiletransfer', 'virtualserverMinClientVersion', 'virtualserverMinAndroidVersion', 'virtualserverMinIosVersion',
  'virtualserverNeededIdentitySecurityLevel', 'virtualserverWeblistEnabled', 'virtualserverCodecEncryptionMode', 'virtualserverChannelTempDeleteDelayDefault',
];

export const INSTANCE_KEYS = [
  'serverinstanceFiletransferPort', 'serverinstanceMaxDownloadTotalBandwidth', 'serverinstanceMaxUploadTotalBandwidth',
  'serverinstanceServerqueryFloodCommands', 'serverinstanceServerqueryFloodTime', 'serverinstanceServerqueryFloodBanTime',
  'serverinstanceTemplateServeradminGroup', 'serverinstanceTemplateServerdefaultGroup', 'serverinstanceTemplateChanneldefaultGroup',
  'serverinstanceTemplateChanneladminGroup',
];

function filterProps(body, allowed) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'errors.objectExpected');
  const props = {};
  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'boolean') props[k] = v ? 1 : 0;
    else if (typeof v === 'number') props[k] = v;
    else if (typeof v === 'string') props[k] = v;
  }
  if (!Object.keys(props).length) throw new HttpError(400, 'settings.noProps');
  return props;
}

router.get('/virtual', requireCap('settings.view'), asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const info = await ts.serverInfo();
  res.json({ info, editableKeys: VIRTUAL_KEYS });
}));

router.put('/virtual', requireCap('settings.manage'), asyncHandler(async (req, res) => {
  const props = filterProps(req.body, VIRTUAL_KEYS);
  const ts = ts3.get();
  await ts.serverEdit(props);
  const logged = { ...props };
  if ('virtualserverPassword' in logged) logged.virtualserverPassword = logged.virtualserverPassword ? '***' : '(entfernt)';
  audit(req, 'settings.virtual', { changed: logged });
  res.json({ ok: true, changed: Object.keys(props) });
}));

router.get('/instance', requireCap('settings.view'), asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const info = await ts.instanceInfo();
  res.json({ info, editableKeys: INSTANCE_KEYS });
}));

router.put('/instance', requireCap('settings.manage'), asyncHandler(async (req, res) => {
  const props = filterProps(req.body, INSTANCE_KEYS);
  const ts = ts3.get();
  await ts.instanceEdit(props);
  audit(req, 'settings.instance', { changed: props });
  res.json({ ok: true, changed: Object.keys(props) });
}));

router.get('/groups', requireCap('settings.view'), asyncHandler(async (req, res) => {
  const ts = ts3.get();
  const [sg, cg] = await Promise.all([ts.serverGroupList(), ts.channelGroupList()]);
  res.json({
    serverGroups: sg.map((g) => ({ sgid: String(g.sgid), name: g.name, type: g.type })),
    channelGroups: cg.map((g) => ({ cgid: String(g.cgid), name: g.name, type: g.type })),
  });
}));

export default router;
