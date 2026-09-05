# Security

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Report them privately via GitHub's
"Report a vulnerability" (Security tab) or by e-mail to the maintainer listed in `package.json`.
You will get a response within a few days; fixes are published as a patch release with a note in the changelog.

## Threat model in short

- The webinterface has full control over the TeamSpeak server (ServerQuery as `serveradmin`) and can start/stop the process.
  Treat it like an admin console: expose it only over HTTPS, ideally behind a reverse proxy, and use strong passwords.
- The first-run setup wizard is protected by a **setup token** printed by the installer and written to `data/setup-token` (mode 0600).
  Nobody can configure the instance without it. The token is deleted once setup is complete.
- Secrets (ServerQuery password, JWT secret, notification tokens) live in `.env` and `data/config.json` with mode 0600.
  They are never written to the audit log or returned unmasked by the API.
- Backups contain the TeamSpeak database including password hashes of TeamSpeak accounts. Backup download and restore are
  separate rights and off by default for viewers.
- Sessions are `httpOnly`, `SameSite=Strict` cookies; state-changing requests additionally require the `X-Requested-With` header.
  Login is rate-limited; failed attempts are audited and can trigger a notification.
- The interface never writes sudoers rules or systemd units itself. Where elevated rights are needed (systemd/docker control modes)
  it shows the exact rule to add.
