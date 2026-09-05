import { api } from './client';
import type { Locale } from '../i18n';

export type ControlMode = 'script' | 'systemd' | 'docker' | 'custom' | 'none';
export type ConfigSource = 'file' | 'env' | 'default';

export interface QueryConfig { host: string; port: number; protocol: 'raw' | 'ssh'; username: string; password: string; nickname: string; serverPort: number; serverId: number }
export interface Ts3Config {
  dir: string; controlMode: ControlMode; startScript: string | null; startArgs: string[]; pidFile: string | null; systemdUnit: string; dockerContainer: string; useSudo: boolean;
  customCmd: { start: string; stop: string; restart: string; status: string }; logDir: string | null; dbFile: string | null; sqlite3Bin: string; query: QueryConfig;
}
export interface CurrentConfig {
  publicUrl: string; trustProxy: boolean; mailFrom: string; backupDir: string;
  ts3: Omit<Ts3Config, 'query'> & { query: QueryConfig & { passwordSet: boolean } };
  source: Record<string, ConfigSource>;
  envOnly: { host: string; port: number; dataDir: string; sessionHours: number };
}
export interface SetupState {
  needsSetup: boolean; hasUsers: boolean; setupMode: boolean; version: string; language: Locale; timezone: string;
  current: CurrentConfig; query: { connected: boolean; connecting: boolean; paused: boolean; lastError: string | null };
  me: { uid: number | null; name: string | null; home: string }; platform: string;
}
export interface Owner { uid: number; gid: number; name: string; sameUser: boolean | null; mode: string }
export interface Candidate {
  dir: string; sources: ('process' | 'systemd' | 'docker' | 'scan')[]; running: boolean; pid: number | null; unit: string | null; container: string | null;
  user: string | null; owner: Owner | null; sameUser: boolean | null; exists: boolean; args?: Record<string, string>;
}
export interface Detection {
  candidates: Candidate[];
  processes: { pid: number; user: string | null; cwd: string | null; unit: string | null; container: string | null; args: Record<string, string> }[];
  units: { name: string; active: boolean | null; dir?: string | null; user?: string | null; pid?: number | null; file?: string }[];
  docker: { available: boolean; error?: string; containers: { id: string; name: string; image: string; status: string; running: boolean; dataDir: string | null }[] };
  me: SetupState['me']; platform: string;
}
export interface DirCheck { key: string; required: boolean; ok: boolean; detail: string }
export interface DirInspection {
  dir: string; exists: boolean; valid: boolean; checks: DirCheck[]; version?: string | null; owner?: Owner | null; sameUser?: boolean | null; running?: boolean; pid?: number | null;
  ini?: { exists: boolean; queryPort: number; querySshPort: number; queryProtocols: string[]; queryIp: string; voicePort: number; dbPlugin: string; logPath: string; skipBruteforceCheck: boolean };
  suggested?: { startScript: string; pidFile: string; logDir: string; dbFile: string | null; queryHost: string; queryPort: number; serverPort: number };
}
export interface ControlTest {
  configured: boolean; status: { running: boolean | null; pid: number | null; detail: string } | null; hints: string[]; command: string | null;
  me: SetupState['me']; dirOwner: Owner | null;
}
export interface QueryTest {
  ok: boolean; durationMs: number;
  version?: { version: string; build: string; platform: string } | null;
  servers?: { id: string; port: number; name: string; status: string; clientsOnline: number; maxClients: number; autostart: boolean }[];
  error?: { code: 'banned' | 'badCredentials' | 'refused' | 'dns' | 'timeout' | 'error'; message: string; retryAfterSec?: number };
}
export interface BackupDirTest { path: string; exists: boolean; created: boolean; writable: boolean; disk: { free: number; total: number } | null; owner: Owner | null }
export interface SystemCheck {
  platform: string; os: { name: string; id?: string; like?: string }; node: { version: string; ok: boolean }; user: SetupState['me']; isRoot: boolean;
  tools: Record<string, string | null>; sudo: { available: boolean; rules: string[]; error?: string };
  dirs: Record<string, { path: string; exists: boolean; writable: boolean; owner: Owner | null; disk: { free: number; total: number } | null } | null>;
  plesk: boolean; configFile: { path: string; exists: boolean }; rootDir: string;
}
export interface ResetJob { id: string; startedAt: string; done: boolean; ok: boolean | null; steps: { ts: string; key: string; detail: string }[]; result: { passwordAvailable: boolean; servers?: QueryTest['servers'] } | null; finishedAt?: string }

export interface InstallInfo {
  platform: string; arch: string; canInstall: boolean; reasons: ('notLinux' | 'arch' | 'tar' | 'bzip2')[]; me: SetupState['me']; isRoot: boolean; defaultDir: string;
  tools: { tar: boolean; bzip2: boolean }; latest: { version: string; url: string; checksum: string | null } | null; latestError: string | null; running: boolean;
  dir?: { path: string; ok: boolean; reason: 'forbidden' | 'notDir' | 'parentNotWritable' | 'notEmpty' | null; exists: boolean; empty: boolean; parentWritable: boolean; parent?: string };
  ports?: Record<string, boolean>;
}
export interface InstallJob {
  id: string; startedAt: string; done: boolean; ok: boolean | null; dir: string; steps: { ts: string; key: string; detail: string }[];
  result: { dir: string; version: string; voicePort: number; queryPort: number; filetransferPort: number; privilegeKey: string | null; passwordAvailable: boolean; servers?: QueryTest['servers']; startScript: string; pidFile: string; user: string | null } | null;
  finishedAt?: string;
}

/** Entwurf, wie ihn der Assistent und die Admin-Seite bearbeiten (Startargumente als Text). */
export interface Draft {
  publicUrl: string; trustProxy: boolean; mailFrom: string; backupDir: string;
  ts3: Omit<Ts3Config, 'startArgs' | 'query'> & { startArgs: string; query: QueryConfig };
}

export function draftFromConfig(c: CurrentConfig): Draft {
  const { query, ...ts3 } = c.ts3;
  const { passwordSet, ...q } = query;
  return {
    publicUrl: c.publicUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
    trustProxy: c.trustProxy,
    mailFrom: c.source.mailFrom === 'default' ? '' : c.mailFrom,
    backupDir: c.backupDir,
    ts3: { ...ts3, startArgs: (ts3.startArgs || []).join(' '), query: { ...q, password: passwordSet ? '***' : '' } },
  };
}

/** Entwurf in das Format von data/config.json bringen. */
export function draftToConfig(d: Draft) {
  return {
    publicUrl: d.publicUrl.trim(),
    trustProxy: d.trustProxy,
    mailFrom: d.mailFrom.trim() || null,
    backupDir: d.backupDir.trim() || 'backups',
    ts3: {
      ...d.ts3,
      startArgs: d.ts3.startArgs.split(/\s+/).filter(Boolean),
      startScript: d.ts3.startScript || null,
      pidFile: d.ts3.pidFile || null,
      logDir: d.ts3.logDir || null,
      dbFile: d.ts3.dbFile || null,
      query: { ...d.ts3.query, port: Number(d.ts3.query.port), serverPort: Number(d.ts3.query.serverPort), serverId: Number(d.ts3.query.serverId) },
    },
  };
}

export const setupApi = {
  verifyToken: (token: string) => api.post<{ ok: boolean; needsSetup: boolean; hasUsers?: boolean }>('/api/setup/verify-token', { token }),
  state: () => api.get<SetupState>('/api/setup/state'),
  systemCheck: () => api.get<SystemCheck>('/api/setup/system-check'),
  detect: () => api.post<Detection>('/api/setup/detect', {}),
  inspectDir: (dir: string) => api.post<DirInspection>('/api/setup/inspect-dir', { dir }),
  testControl: (d: Draft) => api.post<ControlTest>('/api/setup/test-control', draftToConfig(d)),
  testQuery: (q: Partial<QueryConfig>) => api.post<QueryTest>('/api/setup/test-query', q),
  testBackupDir: (backupDir: string) => api.post<BackupDirTest>('/api/setup/test-backup-dir', { backupDir }),
  findInitialPassword: (dir: string) => api.post<{ found: boolean; loginname?: string; password?: string; logFile?: string; searched?: number; logPath?: string }>('/api/setup/find-initial-password', { dir }),
  startReset: (d: Draft, newPassword?: string) => api.post<{ jobId: string }>('/api/setup/reset-serveradmin', { config: draftToConfig(d), confirm: 'RESET', newPassword: newPassword || undefined }),
  resetJob: (id: string) => api.get<ResetJob>(`/api/setup/reset-serveradmin/${id}`),
  takeResetPassword: (id: string) => api.post<{ password: string }>(`/api/setup/reset-serveradmin/${id}/password`, {}),
  installInfo: (body: { dir?: string; ports?: Record<string, number> }) => api.post<InstallInfo>('/api/setup/install-info', body),
  startInstall: (body: { dir: string; acceptLicense: boolean; voicePort: number; queryPort: number; filetransferPort: number }) => api.post<{ jobId: string }>('/api/setup/install', body),
  installJob: (id: string) => api.get<InstallJob>(`/api/setup/install/${id}`),
  takeInstallPassword: (id: string) => api.post<{ password: string }>(`/api/setup/install/${id}/password`, {}),
  apply: (body: { language: Locale; timezone: string; config: ReturnType<typeof draftToConfig>; admin?: { username: string; password: string; displayName?: string } }) => api.post<{ ok: boolean; user: { id: string; username: string; role: string } | null; changed: string[] }>('/api/setup/apply', body),
  saveConfig: (body: { config: ReturnType<typeof draftToConfig>; timezone?: string; language?: Locale }) => api.put<{ ok: boolean; changed: string[]; current: CurrentConfig }>('/api/setup/config', body),
  migrateEnv: () => api.post<{ ok: boolean; changed: string[]; current: CurrentConfig }>('/api/setup/migrate-env', {}),
  resume: () => api.post('/api/setup/resume', {}),
};

export const SETUP_TOKEN_KEY = 'ts3wi_setup_token';
