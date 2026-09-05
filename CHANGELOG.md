# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
