export type Role = 'admin' | 'operator' | 'viewer';

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  language: 'de' | 'en' | null;
  capabilities: string[];
}

export interface SetupStatus {
  needsSetup: boolean;
  hasUsers: boolean;
  language: 'de' | 'en';
  version: string;
}

export interface CapabilityGroup {
  key: string;
  label: string;
  caps: { key: string; label: string; danger?: boolean }[];
}

export interface ProcessStatus {
  mode: string;
  configured: boolean;
  checkedAt: string;
  running: boolean | null;
  pid: number | null;
  startedAt: string | null;
  detail: string;
}

export interface QueryStatus {
  connected: boolean;
  connecting: boolean;
  connectedSince: string | null;
  lastError: string | null;
  nextReconnectAt: string | null;
  host: string;
  port: number;
  protocol: string;
  username: string;
  passwordSet: boolean;
}

export interface VirtualServer {
  id: string;
  port: number;
  status: string;
  clientsonline: number;
  queryclientsonline: number;
  maxclients: number;
  uptime: number;
  name: string;
  autostart: boolean;
  machineId: string;
  uid: string;
}

export interface ServerStatus {
  process: ProcessStatus;
  control: { mode: string; configured: boolean; detail: string };
  query: QueryStatus;
  host: Record<string, number | string> | null;
  version: { version: string; build: string | number; platform: string } | null;
  servers: VirtualServer[];
  current: Record<string, number | string> | null;
  busy: { action: string; startedAt: string } | null;
  ts3Dir: string | null;
  watchdog?: { enabled: boolean; suspended: boolean; gaveUp: boolean; active: boolean };
}

export interface WatchdogState {
  settings: { enabled: boolean; intervalSec: number; maxRestartsPerHour: number; startOnBoot: boolean; suspended: boolean };
  configured: boolean;
  active: boolean;
  lastCheck: string | null;
  lastStatus: boolean | null;
  lastAction: { ts: string; ok: boolean; output: string; reason: string } | null;
  restartsLastHour: number;
  gaveUp: boolean;
  held: boolean;
  log: { ts: string; msg: string }[];
}

export interface NotificationSettings {
  discord: { enabled: boolean; webhookUrl: string };
  telegram: { enabled: boolean; botToken: string; chatId: string };
  webhook: { enabled: boolean; url: string; secret: string };
  email: { enabled: boolean; to: string; from: string; sendmailPath: string };
  events: Record<string, boolean>;
}

export interface NotificationState {
  lastSent: string | null;
  lastError: string | null;
  history: { ts: string; event: string; title: string; results: { owner?: string; channel: string; ok: boolean; error: string | null }[] }[];
  channels: Record<string, boolean>;
  mailFrom: string;
}

export interface UserNotificationSettings {
  discord: { enabled: boolean; webhookUrl: string };
  telegram: { enabled: boolean; botToken: string; chatId: string };
  webhook: { enabled: boolean; url: string; secret: string };
  email: { enabled: boolean; to: string };
  events: Record<string, boolean>;
}

export interface UpdateStep { ts: string; msg: string }
export interface SelfUpdateRelease { version: string; name: string; notes: string; publishedAt: string | null; url: string | null; assetUrl: string | null; shaUrl: string | null; size: number | null }
export interface SelfUpdateSummary {
  current: string; isRelease: boolean; canUpdate: boolean; reasons: ('notLinux' | 'notRelease' | 'notWritable' | 'npmMissing' | 'tarMissing')[];
  restartMode: 'systemd' | 'manual'; rootDir: string; repo: string; checkedAt: number | null; latest: SelfUpdateRelease | null; updateAvailable: boolean; checkError: string | null;
  running: { version: string; from: string; startedAt: string; steps: UpdateStep[]; by: string; restart: boolean } | null;
  lastResult: { ok: boolean; from: string; to: string; finishedAt?: string; error?: string; steps?: UpdateStep[]; restart?: boolean; confirmedAt?: string; rolledBack?: boolean; version?: string } | null;
  previousVersion: string | null; pending: boolean;
}
export interface UpdateSummary {
  checkedAt: number | null;
  current: string | null;
  latest: string | null;
  latestUrl: string | null;
  updateAvailable: boolean;
  checkError: string | null;
  running: { version: string; startedAt: string; steps: UpdateStep[]; by: string; rollback?: boolean } | null;
  lastResult: { ok: boolean; from?: string; to: string; error?: string; finishedAt: string; steps: UpdateStep[]; rollback?: boolean } | null;
  previousVersion: string | null;
  ts3Dir: string | null;
}

export interface StatsPoint {
  t: number;
  clients: number | null;
  clientsMax: number | null;
  channels: number | null;
  up: number | null;
  down: number | null;
  ping: number | null;
  loss: number | null;
  running: number;
}

export interface StatsResponse {
  range: string;
  hours: number;
  bucketMs: number;
  points: StatsPoint[];
  summary: {
    samples: number;
    from: number | null;
    to: number | null;
    currentClients: number | null;
    avgClients: number | null;
    peakClients: { value: number; t: number } | null;
    uptimePct: number | null;
    queryUptimePct: number | null;
    trafficTx: number | null;
    trafficRx: number | null;
    avgPing: number | null;
    avgLoss: number | null;
  };
  heatmap: (number | null)[][];
  heatmapWindowDays: number;
  heatmapSamples: number;
  timezone: string;
}

export interface Client {
  clid: string;
  cid: string;
  databaseId: string;
  nickname: string;
  type: number;
  uid: string;
  away: boolean;
  awayMessage: string;
  inputMuted: boolean;
  outputMuted: boolean;
  talkPower: number;
  isTalker: boolean;
  isPrioritySpeaker: boolean;
  isRecording: boolean;
  isChannelCommander: boolean;
  servergroups: string[];
  channelGroupId: string;
  version: string;
  platform: string;
  idleTime: number;
  created: number;
  lastconnected: number;
  country: string;
  ip: string;
}

export interface Channel {
  cid: string;
  pid: string;
  order: number;
  name: string;
  topic: string;
  flagDefault: boolean;
  flagPassword: boolean;
  flagPermanent: boolean;
  flagSemiPermanent: boolean;
  codec: number;
  iconId: string;
  maxclients: number;
  totalClients: number;
  neededSubscribePower: number;
  children: Channel[];
  clients: Client[];
}

export interface DbClient {
  cldbid: string;
  uid: string;
  nickname: string;
  created: number;
  lastconnected: number;
  totalconnections: number;
  description: string;
  lastIp: string;
}

export interface Ban {
  banid: string;
  ip: string;
  name: string;
  uid: string;
  mytsid: string;
  lastnickname: string;
  created: number;
  duration: number;
  invokername: string;
  invokercldbid: number;
  invokeruid: string;
  reason: string;
  enforcements: number;
}

export interface LogLine {
  ts: string;
  level: string;
  channel: string;
  sid: string;
  msg: string;
  raw: string;
}

export interface LogFile {
  name: string;
  size: number;
  mtime: string;
  kind: 'instance' | 'server' | 'other';
  sid: number | null;
}

export interface Backup {
  id: string;
  size: number;
  createdAt: string;
  trigger: string;
  createdBy: string;
  label: string;
  includeLogs: boolean;
  dbMethod: string | null;
  ts3Version: string | null;
  contents: string[];
  notes: string[];
  durationMs: number | null;
}

export interface BackupSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  time: string;
  weekday: number;
  keep: number;
  includeLogs: boolean;
  timezone: string;
  cron: string | null;
  nextRun: string | null;
  lastRun: { at: string; ok: boolean; backupId: string | null; size: number; deleted: string[]; error: string | null } | null;
  running: boolean;
}

export interface Snapshot {
  id: string;
  createdAt: string;
  createdBy: string;
  serverName: string;
  version: number | null;
  size: number;
}

export interface AuditEntry {
  id: string;
  ts: string;
  userId: string | null;
  username: string;
  ip: string | null;
  action: string;
  details: Record<string, unknown>;
  ok: boolean;
}

export interface ServerGroup {
  sgid: string;
  name: string;
  type: number; // 0 Vorlage, 1 regulär, 2 Query
  iconId: string;
  saveDb: boolean;
  sortId: number;
  nameMode: number;
  memberCount: number | null;
}

export interface ChannelGroup {
  cgid: string;
  name: string;
  type: number;
  iconId: string;
  saveDb: boolean;
  sortId: number;
  nameMode: number;
}

export interface GroupsResponse {
  serverGroups: ServerGroup[];
  channelGroups: ChannelGroup[];
  defaults: { serverGroup: string; channelGroup: string; channelAdminGroup: string };
}

export interface GroupMember {
  cldbid: string;
  nickname: string;
  uid: string;
}

export interface ChannelGroupAssignment {
  cid: string;
  channelName: string;
  cldbid: string;
  nickname: string;
  uid: string;
}

export interface PermissionDef {
  id: number;
  name: string;
  desc: string;
}

export interface GroupPermission {
  name: string;
  value: number;
  skip: boolean;
  negate: boolean;
}

export interface GroupPermissionsResponse {
  group: { id: string; kind: 'server' | 'channel'; name: string; type: number };
  permissions: GroupPermission[];
}

export type PermKind = 'servergroup' | 'channelgroup' | 'client' | 'channel' | 'channelclient';

export interface PermOverviewEntry {
  name: string;
  desc: string;
  value: number;
  negate: boolean;
  skip: boolean;
  sourceType: number;
  source: string;
}

export interface Complaint {
  targetCldbid: string;
  targetName: string;
  fromCldbid: string;
  fromName: string;
  message: string;
  timestamp: number;
}

export interface FileEntry {
  name: string;
  size: number;
  datetime: number;
  type: 'dir' | 'file';
}

export interface IconEntry {
  id: string;
  size: number;
  datetime: number;
}

export interface Invite {
  id: string;
  tokenPreview: string;
  role: Role;
  note: string;
  maxUses: number;
  uses: number;
  usedBy: { username: string; at: string }[];
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'used' | 'revoked';
}

export interface Ts3Event {
  id: string;
  ts: string;
  type: string;
  message: string;
  params?: Record<string, string | undefined>;
  client?: { clid?: string; nickname?: string; uid?: string; ip?: string; country?: string };
  channel?: { cid?: string; name?: string };
}

/* ---------- Client-Historie ---------- */
export interface HistoryIdentitySummary {
  uid: string;
  cldbid: string | null;
  nickname: string;
  nicknames: number;
  ips: number;
  lastIp: string;
  country: string;
  firstSeen: number;
  lastSeen: number;
  sessions: number;
  onlineSec: number;
  online: boolean;
  notes: number;
  platform: string;
}

export interface HistoryVariant { first: number; last: number; count: number }
export interface HistoryNote { id: string; ts: string; author: string; text: string }

export interface HistorySession {
  id: string;
  uid: string;
  cldbid: string | null;
  nickname: string;
  ip: string;
  country: string;
  version: string;
  platform: string;
  connectedAt: number;
  disconnectedAt: number | null;
  durationSec: number;
  reasonid: number | null;
  reason: string | null;
  reasonmsg: string;
  invoker: string;
  lastCid: string | null;
  moves: number;
  open?: boolean;
}

export interface HistoryEvent {
  t: number;
  uid: string;
  type: 'nick' | 'move' | 'kick' | 'ban';
  nickname?: string;
  from?: string | null;
  to?: string | null;
  toName?: string;
  by?: string;
  msg?: string;
  reasonid?: number | null;
}

export interface HistoryProfile {
  identity: Omit<HistoryIdentitySummary, 'nicknames' | 'ips'> & {
    nicknames: ({ name: string } & HistoryVariant)[];
    ips: ({ ip: string } & HistoryVariant)[];
    countries: { code: string; count: number }[];
    version: string;
    platform: string;
    notes: HistoryNote[];
  };
  sessions: HistorySession[];
  sessionsTotal: number;
  events: HistoryEvent[];
  daily: { day: string; onlineSec: number }[];
  hours: number[];
  live: {
    available: boolean;
    online: Client | null;
    db: { cldbid: string; nickname: string; created: number; lastconnected: number; totalconnections: number; description: string; lastIp: string; monthBytesUploaded: number; monthBytesDownloaded: number; totalBytesUploaded: number; totalBytesDownloaded: number } | null;
    groups: { sgid: string; name: string }[];
    bans: { banid: string; ip: string; name: string; uid: string; created: number; duration: number; invokername: string; reason: string; enforcements: number; match: 'uid' | 'ip' | 'name' }[];
    complaints: { targetCldbid: string; targetName: string; fromCldbid: string; fromName: string; message: string; timestamp: number; direction: 'about' | 'by' }[];
  };
  actions: AuditEntry[];
  /** false = Live-Profil ohne aufgezeichnete Historie */
  tracked?: boolean;
}

export interface HistorySummary {
  identities: number;
  onlineNow: number;
  uniqueToday: number;
  uniqueWeek: number;
  uniqueMonth: number;
  sessionsMonth: number;
  newIdentitiesWeek: number;
  top: { uid: string; nickname: string; onlineSec: number; online: boolean; country: string }[];
  retentionDays: number;
}
