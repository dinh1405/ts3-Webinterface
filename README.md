# TS3 Webinterface

**English** · [Deutsch](README.de.md)

A modern web interface for managing a **TeamSpeak 3 server** – Node.js/Express backend talking ServerQuery,
React frontend (dark/light theme, responsive), fully available in **English and German**.

- **One-line installation** on Debian/Ubuntu/RHEL-compatible servers, browser-based **setup wizard** – the wizard can
  even **install a TeamSpeak 3 server** for you if none exists yet.
- Start/stop/restart the server, watchdog, backups with schedule and restore, TeamSpeak updates from the browser.
- Channel tree with drag & drop, client actions, groups, full permission editor, bans, complaints, files/icons, logs, statistics.
- Client history and profiles, notifications (Discord, Telegram, e-mail, webhook), invite links, role-based rights, audit log.

## Screenshots

All screenshots show a demo server with fictional data.

| Dashboard | Clients & channels |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Clients & channels](docs/screenshots/clients.png) |

| Setup wizard | Client profile |
|---|---|
| ![Setup wizard](docs/screenshots/setup-wizard.png) | ![Client profile](docs/screenshots/history-profile.png) |

| Settings → Connection & installation |
|---|
| ![Connection & installation](docs/screenshots/settings-connection.png) |

## Contents

- [Screenshots](#screenshots)
- [Quick start](#quick-start)
- [What the installer does](#what-the-installer-does)
- [Setup wizard](#setup-wizard)
- [Features](#features)
- [Requirements](#requirements)
- [Manual installation](#manual-installation)
- [Configuration](#configuration)
- [Updating, rollback, uninstall](#updating-rollback-uninstall)
- [Reverse proxy & HTTPS](#reverse-proxy--https)
- [Process control modes](#process-control-modes)
- [Backups](#backups)
- [Security](#security)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Quick start

On the server that runs (or should run) your TeamSpeak 3 server:

```bash
curl -fsSL https://raw.githubusercontent.com/dinh1405/ts3-Webinterface/main/deploy/install.sh | sudo bash
```

The installer asks a few questions (language, nginx reverse proxy with domain, direct access or not) and finally prints a
link like `http://your-server:8088/setup#token=…`. Open it in the browser and the **setup wizard** guides you through the rest.
Afterwards you sign in with the administrator account you created.

Non-interactive example (no nginx, reachable on port 8088, English):

```bash
curl -fsSL https://raw.githubusercontent.com/dinh1405/ts3-Webinterface/main/deploy/install.sh | sudo bash -s -- --yes --no-nginx --host 0.0.0.0 --lang en
```

All options: `bash install.sh --help` (`--dir`, `--user`, `--port`, `--host`, `--nginx <domain>`, `--no-nginx`, `--no-firewall`, `--service-name`, `--version`, `--from-file`, `--update`, `--uninstall`, …).

## What the installer does

The installer only takes care of the operating-system side and never touches your TeamSpeak installation:

1. Installs `curl`, `tar`, `bzip2`, `sqlite3` and **Node.js 22** (NodeSource) if no Node.js ≥ 20 is present.
2. Chooses the **system user**: if a `ts3server` process is running, it offers to use the same user (needed for start/stop
   via the start script and for backups). Otherwise it creates the user `ts3web`.
3. Downloads the latest **release package** from GitHub and verifies its **SHA-256** checksum (no build on the server).
4. Installs to `/opt/ts3-webinterface`, runs `npm ci --omit=dev`, creates a minimal `.env` (port, random session secret).
5. Creates and starts the **systemd service** `ts3-webinterface` (`KillMode=process`, so restarting the web interface never
   kills the TeamSpeak server).
6. Optionally sets up **nginx** as reverse proxy for your domain (Plesk is detected and skipped – see below).
7. Installs the **`ts3web`** command and prints the setup URL including the one-time **setup token**.

## Setup wizard

The wizard runs in the browser on first start and is protected by a **setup token** (printed by the installer, stored in
`data/setup-token` with mode 0600 and deleted once setup is complete). Steps:

| Step | What happens |
|---|---|
| **Language** | System language (English/German, every user can override it) and time zone. |
| **Installation** | Detects TeamSpeak installations (running processes, systemd units, Docker containers, typical paths) and checks the directory (binary, start script, ini, logs, database, allowlist, licence, owner). **No server yet?** The wizard downloads the current TeamSpeak 3 server (SHA-256 verified), installs it, starts it once with a random `serveradmin` password, shows the **privilege key** and fills in everything below automatically. |
| **Control** | How to start/stop the process: start script, systemd, Docker, custom commands or none. Live check with the exact command and, where needed, the sudoers rule to add. |
| **ServerQuery** | Connection test with the serveradmin (or a query) account, list of virtual servers to choose from. Password unknown? Search the first server log, or let the wizard **reset the serveradmin password** (start-script mode). The TeamSpeak brute-force lock is respected (countdown). |
| **Storage & network** | Backup directory (writable? free space), public URL, reverse-proxy flag, e-mail sender. |
| **Administrator** | First web interface account. |
| **Summary** | Everything is written to `data/config.json` (mode 0600) and applied **without restart**. |

Everything can be changed later under **Settings → Connection & installation** (administrators only), including a system check
(Node, tools, sudo, disk space, file permissions).

## Features

| Area | Functions |
|---|---|
| **Dashboard** | Process status, uptime, clients, traffic, virtual servers, **start / stop / restart**, message to all, live activity feed (SSE) |
| **Clients & channels** | Live channel tree, online list, client details, **kick, poke, message, move, ban**, client database (search offline clients and ban them) |
| **Groups** | Server and channel groups: create, rename, copy, delete; members, add/remove clients; channel group assignments (client ↔ channel); a client's server groups directly in the client dialog |
| **Permission editor** | View and edit permissions of server groups, channel groups, clients, channels and client-in-channel (value, skip, negate), search and categories over all ~500 permissions, bulk save, remove single permissions; **effective permissions** of a client including origin (`permoverview`) |
| **Channel management** | Create channels (incl. sub-channels), edit (name, topic, description, password, type, codec, limits, talk power, icon, banner …), move/sort, delete – right in the channel tree |
| **Complaints** | List, delete single or per client, ban the target directly |
| **Client history & profiles** | Every connection per identity (UID): sessions with duration and disconnect reason (kick/ban/timeout), all **nicknames and IPs** used, channel switches, online time per day and hour; search by nickname, UID, IP or DB id (finds returning users with a new name); profile page with live data (server groups, active bans, complaints, TS3 database info), related web interface actions and **notes**; top clients by online time; history deletable per identity. Retention `historyRetentionDays` (default 365) in `data/history/` |
| **Files** | File browser for channel files and server files (avatars): upload, download, folders, rename, delete, image preview; upload, view, delete icons and assign them to groups/channels |
| **Invite links** | Admins create links with role, expiry and usage limit; invitees register under `/register?token=…`; revoke/delete links, history |
| **Bans** | Ban list, add ban (IP / name / UID / myTeamSpeak id, duration, reason), **unban**, delete all |
| **Logs** | Server/instance log via ServerQuery (live, filter, load older entries), log files in `logs/` (tail, search, level filter, download) |
| **Settings** | Virtual server (name, welcome message, password, slots, host banner/button, default groups, anti-flood, quota, logging …) and instance (file transfer port, bandwidth, query flood protection) |
| **Backups** | ZIP backup (consistent SQLite copy, `files/`, ini, licence, query lists), **download**, upload, delete, **restore** (with safety copy), ServerQuery snapshots create/deploy, **schedule** (daily/weekly, retention) |
| **Statistics** | Per-minute collection of clients, channels, bandwidth, ping and process status; charts for 6 h to 30 days, peak-time heatmap (weekday × hour), availability, traffic sums; 90 days retention (`data/stats/`) |
| **Watchdog** | Checks the TS3 process regularly, restarts it after a crash (limit per hour, then notification), autostart when the web interface service starts (= after reboot); stopping the server deliberately pauses the watchdog |
| **Notifications** | Discord webhook, Telegram bot, e-mail (local sendmail), generic webhook with HMAC signature; selectable events (server stop/restart, watchdog, backups, updates, bans, kicks, login lock, query loss); test send, history. **System-wide** and **per user** (My account) – each in the recipient's language |
| **Drag & drop** | Move clients into channels, sort channels (top/bottom edge) or nest them as sub-channels (middle) |
| **Webinterface update** | System → Webinterface: version check against GitHub releases, update by click with automatic restart and rollback (see [Updating](#updating-rollback-uninstall)) |
| **TS3 update** | Version check against the TeamSpeak version feed, update by click: download, SHA-256, extract, backup, stop, old files to `.previous-version/`, new files, start, **version verification** (success only when the running server reports the target version; otherwise *Verification failed* with rollback button); automatic rollback on error, manual rollback |
| **Users** | Login, roles `admin` / `operator` / `viewer`, language per user, password reset, enable/disable |
| **Audit log** | Who did what and when (incl. failed logins) |

Roles: **Administrator** (always all rights), **Operator** and **Viewer** with **freely configurable rights** (Users → Roles & rights):
26 individual rights in 8 groups. Default: operator = all TeamSpeak functions without administration/restore/update, viewer = read only.
Changes apply immediately; backend and frontend check the same rights (`server/lib/capabilities.js`).

## Requirements

- Linux with systemd (Debian 11+, Ubuntu 20.04+, RHEL 8+/Rocky/Alma/Fedora). Other systems: [manual installation](#manual-installation).
- Node.js ≥ 20 (the installer installs 22 LTS).
- TeamSpeak 3 server with ServerQuery enabled (raw 10011 or ssh 10022) and the `serveradmin` password – or let the wizard install one.
- For start/stop, backups, logs and updates the web interface runs **on the same host** and **as the same user** as the TS3 server
  (or with a sudoers rule for systemd/Docker). ServerQuery-only operation (`none` control mode) works from any host.
- Consistent database backups need Node.js ≥ 22.16 (`node:sqlite`, no extra tool) **or** the `sqlite3` CLI (installed by the installer).
  Without either, backups only work while the TS3 server is stopped (plain file copy).

**Known limits of the installer** (manual installation still works):

- Package managers other than apt/dnf (openSUSE/SLES, Arch, Alpine) are not supported by `install.sh`.
- Distributions whose glibc is too old for Node.js 22 (CentOS/RHEL 7, Debian 10, Ubuntu 18.04) fail at the Node.js step.
- Systems without systemd (plain Docker containers, WSL, some LXC templates) are not supported by the installer.
- ARM64 hosts (Raspberry Pi, Ampere, Graviton) run the web interface, but TeamSpeak only ships x86_64 Linux builds; the wizard
  cannot install a server there and control is limited to ServerQuery against another host.
- The installer opens the needed ports in ufw/firewalld when they are active (`--no-firewall` to skip) and sets the SELinux boolean
  `httpd_can_network_connect` for nginx; other firewalls (cloud provider, raw iptables) must be adjusted by hand.

## Manual installation

Without the installer (any Linux, macOS, Windows for development):

```bash
# 1. Release package
curl -fsSLO https://github.com/dinh1405/ts3-Webinterface/releases/latest/download/ts3-webinterface-latest.tar.gz
tar -xzf ts3-webinterface-latest.tar.gz && cd ts3-webinterface-*/
npm ci --omit=dev

# 2. Minimal .env
cp .env.example .env            # set HOST, PORT, JWT_SECRET (openssl rand -hex 48)

# 3. Start
node server/index.js            # prints the setup URL with token
```

For a service, use `deploy/ts3-webinterface.service.tpl` (replace `@APP_DIR@`, `@APP_USER@`, `@SERVICE@`, `@NODE@`).
Keep `KillMode=process` if the TeamSpeak server is started from the web interface.

## Configuration

Three layers, highest priority first:

1. **`data/config.json`** – written by the wizard / Settings → Connection & installation (TeamSpeak directory, control mode, ServerQuery, backup directory, public URL …).
2. **`.env`** – see [`.env.example`](.env.example). Only needed for the web server itself; TeamSpeak values can also live here (existing installations keep working). Settings → Connection shows where each value comes from and can migrate `.env` values into `config.json`.
3. Built-in defaults.

Env-only (need a restart): `HOST`, `PORT`, `JWT_SECRET`, `SESSION_HOURS`, `LOGIN_RATE_MAX`, `LOGIN_RATE_WINDOW_MIN`, `DATA_DIR`, `UI_LANGUAGE` (initial language).

| Variable | Default | Description |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8088` | Bind address and port |
| `TRUST_PROXY` | `0` | `1` behind nginx/Plesk (correct client IPs, `Secure` cookies) |
| `PUBLIC_URL` / `MAIL_FROM` | – / `ts3@<domain>` | Public URL (invite links, setup URL) and e-mail sender |
| `JWT_SECRET` | *(random)* | Session secret – **set it**, otherwise sessions expire on every restart |
| `SESSION_HOURS` | `12` | Session lifetime |
| `LOGIN_RATE_MAX` / `LOGIN_RATE_WINDOW_MIN` | `10` / `15` | Login rate limit |
| `DATA_DIR` / `BACKUP_DIR` | `data` / `backups` | Data and backup directories |
| `UI_LANGUAGE` | `en` | Initial system language (`de`/`en`) until set in the wizard |
| `TS3_DIR` | – | TS3 installation directory |
| `TS3_CONTROL_MODE` | `script` | `script`, `systemd`, `docker`, `custom`, `none` |
| `TS3_START_SCRIPT` / `TS3_START_ARGS` / `TS3_PID_FILE` | `<TS3_DIR>/ts3server_startscript.sh` / `inifile=ts3server.ini` / `<TS3_DIR>/ts3server.pid` | Mode `script` |
| `TS3_SYSTEMD_UNIT` / `TS3_DOCKER_CONTAINER` / `TS3_USE_SUDO` | | Modes `systemd` / `docker` |
| `TS3_CMD_START\|STOP\|RESTART\|STATUS` | | Mode `custom` |
| `TS3_LOG_DIR` / `TS3_DB_FILE` / `SQLITE3_BIN` | `<TS3_DIR>/logs` / `<TS3_DIR>/ts3server.sqlitedb` / `sqlite3` | Logs & backups |
| `TS3_QUERY_HOST` / `TS3_QUERY_PORT` / `TS3_QUERY_PROTOCOL` | `127.0.0.1` / `10011` / `raw` | ServerQuery |
| `TS3_QUERY_USER` / `TS3_QUERY_PASSWORD` / `TS3_QUERY_NICKNAME` | `serveradmin` / – / `Webinterface` | Credentials |
| `TS3_SERVER_PORT` / `TS3_SERVER_ID` | `9987` / `0` | Which virtual server is managed |

## Updating, rollback, uninstall

In the browser: **System → Webinterface** shows the installed and the latest version with release notes; administrators can update
by click. The service downloads and verifies the package, swaps the files, restarts itself (about five seconds) and rolls back
automatically if the new version fails to start. On the command line:

```bash
sudo ts3web update                 # latest release (keeps .env, data/, backups/; old version in .previous/)
sudo ts3web update --version 1.2.0 # specific release
sudo ts3web rollback               # back to the previous version
sudo ts3web status | logs | check  # service, health, quick diagnosis
sudo ts3web setup-token            # show the wizard URL again (--regenerate for a new token)
sudo ts3web reset-admin admin      # create an admin or reset a password
sudo ts3web uninstall [--purge]    # remove (purge also deletes data, backups, .env and the created user)
```

`ts3web -s <service> …` addresses a second instance installed with `--service-name` (e.g. one web interface per TeamSpeak server).

## Reverse proxy & HTTPS

- **Installer with `--nginx ts.example.org`** (or the interactive question): writes an nginx site from
  [`deploy/nginx-site.conf.tpl`](deploy/nginx-site.conf.tpl) and binds the app to `127.0.0.1`. Then run
  `certbot --nginx -d ts.example.org` for HTTPS and set `PUBLIC_URL=https://ts.example.org` in `.env`.
- **Plesk**: nginx is managed by Plesk, so the installer skips it. Create a subdomain, issue a Let's Encrypt certificate and add
  the directives from [`deploy/nginx-plesk.conf`](deploy/nginx-plesk.conf) under *Apache & nginx settings → Additional nginx directives*
  (leave *Serve static files directly by nginx* off). CLI:
  ```bash
  plesk bin subdomain --create ts -domain example.org
  plesk bin extension --exec letsencrypt cli.php -d ts.example.org
  cp /opt/ts3-webinterface/deploy/nginx-plesk.conf /var/www/vhosts/system/ts.example.org/conf/vhost_nginx.conf
  plesk bin site -u ts.example.org -ssl-redirect true
  plesk sbin httpdmng --reconfigure-domain ts.example.org
  ```
  If ModSecurity (Plesk WAF) blocks API calls, set the WAF for the subdomain to off or detection only.
- **Any other proxy**: forward to `127.0.0.1:8088`, disable buffering for `/api/events` (Server-Sent Events), allow large bodies
  for backup uploads, set `TRUST_PROXY=1`.

## Process control modes

- **`script`** (default): the web interface runs `ts3server_startscript.sh start|stop|restart <args>` – exactly like a manual
  start. Requires the **same Linux user** as the TeamSpeak server. The generated unit uses `KillMode=process` so that restarting
  the web interface does not stop TeamSpeak.
- **`systemd`**: `systemctl start|stop|restart <unit>`; with *use sudo* and a sudoers rule when not running as root
  (the wizard shows the exact line). An example unit for the TS3 server itself is in [`deploy/ts3server.service`](deploy/ts3server.service).
- **`docker`**: `docker start|stop|restart <container>` (user in the `docker` group or sudo).
- **`custom`**: arbitrary shell commands.
- **`none`**: ServerQuery only – no start/stop, watchdog, restore or TS3 update; everything else works, also from another host.

## Backups

- **ZIP backup**: `ts3server.sqlitedb` (consistent copy via `node:sqlite` or `sqlite3 .backup`, WAL-safe, integrity-checked), `files/` (avatars, icons, uploads), `ts3server.ini`,
  `licensekey.dat`, `query_ip_*.txt`, `ssh_host_rsa_key`, optionally `logs/` and a `backup-info.json`. MariaDB/PostgreSQL databases are **not** included (noted in the backup).
- **Restore** (admins): safety copy → stop TS3 → restore files → start TS3. All clients are disconnected.
- Backups, restores, updates, installation and serveradmin reset share one **maintenance lock**; a banner shows what is running.
- **Snapshots**: `serversnapshotcreate/-deploy` via ServerQuery – channels, groups and permissions of the virtual server without a stop.
- **Schedule**: daily or weekly at a given time (time zone configurable), retention by count; only automatic backups are rotated.

## Security

- Passwords with bcrypt (cost 12), sessions as `httpOnly` cookies (`SameSite=Strict`, `Secure` behind HTTPS), tokens are invalidated on password/role changes.
- CSRF protection via `X-Requested-With` header + SameSite cookie, login rate limit, Helmet/CSP.
- Setup wizard protected by a one-time token; secrets only in `.env` and `data/config.json` (0600), never in the audit log or API responses.
- Rights are enforced server-side per route (`requireCap`); the frontend only hides what is not allowed.
- See [SECURITY.md](SECURITY.md) for the threat model and how to report vulnerabilities.

## Development

```bash
npm install
cp .env.example .env         # HOST/PORT/JWT_SECRET; TeamSpeak settings via the wizard
npm run dev                  # API on :8088, Vite dev server on :5173 (proxy → API)
npm run typecheck            # TypeScript
npm test                     # server tests (Vitest + Supertest)
node scripts/i18n-check.mjs  # dictionary parity (de/en) and untranslated strings
node scripts/build-release.mjs   # release package in release/
```

```
server/            Express 5 (ESM), ts3-nodejs-library (ServerQuery raw/ssh), JWT cookie auth, JSON storage
  lib/ts3.js       persistent ServerQuery connection, auto-reconnect, events → SSE
  lib/process.js   start/stop/restart (script | systemd | docker | custom)
  lib/setup.js     wizard: detection, checks, serveradmin reset, apply config
  lib/ts3install.js  TeamSpeak server installation from the wizard
  lib/backup.js    ZIP backups, restore, snapshots
  i18n/            server-side messages (de/en)
  routes/          REST API under /api/*
web/               React 19 + Vite + Tailwind CSS 4 + TanStack Query, src/i18n/ dictionaries
deploy/            install.sh, ts3web, systemd/nginx templates, Plesk notes
scripts/           i18n-check.mjs, build-release.mjs
```

There are deliberately **no native dependencies** (nothing to compile on the server). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Troubleshooting

- **Setup URL lost?** `sudo ts3web setup-token` (or read `data/setup-token`).
- **"Too many failed logins" / TeamSpeak locks 127.0.0.1**: TeamSpeak bans an IP for 10 minutes after a few failed ServerQuery logins –
  including localhost. The wizard makes exactly one attempt per click and shows a countdown. Other tools with an old serveradmin
  password (Plesk *Voice-Server Manager*, TS viewer scripts …) must be updated too. `query_skipbruteforcecheck=1` in `ts3server.ini`
  exempts addresses in `query_ip_allowlist.txt`.
- **Server stopped by systemd-logind**: when TS3 was started from an SSH session, logind removes its shared memory on logout
  (“failed to register local accounting service”). Fix: `/etc/systemd/logind.conf.d/ts3-removeipc.conf` with `[Login]` / `RemoveIPC=no`,
  then `systemctl restart systemd-logind`. Servers started via the web interface are not affected.
- **Start script mode says "other user"**: the web interface must run as the owner of the TeamSpeak directory
  (`install.sh --user <ts3user>` or switch to systemd mode with a sudoers rule).
- **Service log**: `sudo ts3web logs` (= `journalctl -u ts3-webinterface -f`).

## License

[MIT](LICENSE) © 2026 Maximilian Barth. TeamSpeak is a trademark of TeamSpeak Systems GmbH; this project is not affiliated with it.
