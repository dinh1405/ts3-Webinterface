# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.1] – 2026-09-06

Reliability release based on a code review; no new features.

### Added
- **Maintenance lock**: backups, restores, TS3 updates/rollbacks, webinterface updates, TS3 installation and serveradmin reset
  now exclude each other through one central lock (`409 maintenance.busy`). A banner shows every signed-in user what is running
  and who started it; `GET /api/system/maintenance` exposes the state.
- Backups verify the database copy (`PRAGMA integrity_check`) and record the result (`dbIntegrity`) – shown as a badge in the list.
- Client history: retention is enforced to the day, including nicknames, IP addresses and countries in `identities.json`
  (identities with notes keep the notes but lose their connection data). Cleanup runs 5 s after start and every 12 hours;
  **Clean up now** on the history page; the summary reports the last run.
- Test foundation: Vitest + Supertest (`npm test`) with first behaviour tests for the JSON store, roles & rights,
  maintenance lock, backups, update verification and history retention; CI and release workflows run them.
- Notification event **TS3 update not confirmed** (`updateUnverified`).

### Changed
- **Consistent SQLite backups without the `sqlite3` CLI**: the backup uses the `node:sqlite` backup API first (Node.js ≥ 22.16),
  then `sqlite3 .backup`; the plain file copy is only used when the TS3 process is verifiably stopped. With a running server and
  neither method available the backup fails with a clear message instead of silently producing an inconsistent copy.
- **TS3 update/rollback report success only after verification**: the process must run, ServerQuery must reconnect and the
  reported version must match. Otherwise the result is *Verification failed* (`state: unverified | mismatch`) with the reported
  version, an audit entry marked as failed, the new notification and a direct rollback button.
- **Write errors are reported**: `JsonStore` rejects when a file cannot be written and reverts the in-memory state to the last
  saved version; API calls answer `500 errors.storeWrite` instead of pretending success. Audit entries only log the failure.
  The service warns at startup when the data directory is not writable.
- Dialogs are fully keyboard-accessible: focus moves into the dialog, Tab/Shift+Tab stay inside, Escape closes the topmost
  dialog, focus returns to the trigger; `aria-labelledby`/`aria-describedby`, page content is `inert` while a dialog is open.
- Frontend split into per-page chunks (`React.lazy`), Recharts, icons and React vendor code in their own chunks:
  the initial download drops from one 1.2 MB bundle to about 520 KB (index + vendor); charts load only on pages that use them.
- System check shows which SQLite backup method is available (`node:sqlite` / `sqlite3`).

### Fixed
- The "last seen" timestamp of the current nickname was not updated on repeated connections.

## [1.3.0] – 2026-09-06

### Added
- Client profile: server groups can be added and removed directly on the profile page.
- Live profile for clients without recorded history (online or known in the TS3 database): the profile page shows the live data with a note instead of a 404.
- Clicking an online client on the dashboard, in the client list or in a group's member list opens the client profile.
- Statistics: the peak-time heatmap always covers a fixed window (7/30/90 days, default 30) independent of the selected chart range.

### Changed
- Navigation grouped into Overview, Clients, Server and Administration.
- Roles & rights: group headings are sticky and show icon, number of rights and how many are enabled per role.

### Fixed
- Stopping a virtual server from the dashboard failed with "ts is not a function".

## [1.2.0] – 2026-09-05

### Added
- **Update the webinterface from the browser** (System → Webinterface): version check against GitHub releases with release notes,
  update by click (download, SHA-256, `npm ci` in a staging directory, file swap, automatic restart under systemd) and
  automatic rollback if the new version fails to start twice. Data, backups and `.env` are never touched.
- Installer: prefers a system-wide Node.js, sets the SELinux boolean for the nginx proxy, opens the needed ports in ufw/firewalld
  (`--no-firewall` to skip), documented limits (other package managers, old glibc, no systemd, ARM64).
- Screenshots in the README (demo data).

### Changed
- `server/index.js` is now a small bootstrap that starts `server/main.js` and guards self-updates.

## [1.1.0] – 2026-09-05

### Added
- English translation of the interface, server messages and notifications; language is set system-wide and can be overridden per user (My account).
- Browser setup wizard with TeamSpeak detection, control-mode check, ServerQuery test and system check.
- The wizard can install a TeamSpeak 3 server itself (Linux x86_64): download with SHA-256 check, first start with a random serveradmin password, privilege key display, credentials taken over automatically.
- One-line installer (`deploy/install.sh`, English/German) for Debian/Ubuntu and RHEL-compatible systems: Node.js, system user (reuses the TeamSpeak user), release package with SHA-256 check, systemd unit, optional nginx site, setup URL with token. `ts3web` command-line tool (status, logs, update, rollback, setup-token, reset-admin, check, uninstall) and GitHub release packages built by `scripts/build-release.mjs`.
- README in English and German.
- `data/config.json` as configuration layer above `.env` (written by the wizard, editable in Settings → Connection & installation).

### Changed
- Version is reported by `/api/health` and shown in the interface.

## [1.0.0] – 2026-09-05

First complete version: dashboard with start/stop/restart, channel tree with client actions and drag & drop, groups and permission editor,
bans, complaints, file browser and icons, logs, server settings, backups with schedule and restore, statistics, watchdog, notifications
(Discord, Telegram, webhook, e-mail), TS3 update from the interface, invite links, role-based rights, client history with profiles,
light and dark theme.
