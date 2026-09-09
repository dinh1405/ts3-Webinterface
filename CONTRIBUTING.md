# Contributing

Thanks for helping to improve the TS3 Webinterface. Issues and pull requests are welcome in English or German.

## Development setup

```bash
git clone https://github.com/dinh1405/ts3-Webinterface.git
cd ts3-Webinterface
npm install
cp .env.example .env          # HOST, PORT, JWT_SECRET are enough; TeamSpeak via the wizard
npm run dev                   # API on :8088, Vite on :5173
npm run dev:fake              # optional: ServerQuery simulator on 127.0.0.1:10099 (password testpw) – point the wizard at it
```

Node.js ≥ 20. No native dependencies – keep it that way (the release package must install with `npm ci --omit=dev` on any Linux box).

## Before you open a pull request

```bash
npm run typecheck             # TypeScript (frontend)
npm run lint                  # ESLint (server, scripts, tests, frontend)
npm test                      # server tests (Vitest + Supertest; each test file gets a fresh data directory)
node scripts/i18n-check.mjs   # de/en dictionaries in sync, no hard-coded German/English UI text
npm run build                 # frontend build
bash -n deploy/install.sh && bash -n deploy/ts3web
```

CI runs the same checks plus shellcheck for `deploy/`.

## Translations

- Frontend texts live in `web/src/i18n/de.ts` and `en.ts`; the `en` object is typed against `de`, so a missing key fails the type check.
  Use `useT()` in components (`t('key', { param })`), `td()` for dynamic keys, `_one`/`_other` suffixes for plurals.
- Server texts (errors, notifications, log lines) live in `server/i18n/de.js` and `en.js`. Throw `HttpError(status, 'key', params)`;
  the error middleware translates per request. Use `tr(req)` for request-scoped texts and `ts()` for system-language texts.
- Adding a language: copy `en.ts`/`en.js`, register it in `web/src/i18n/index.tsx` and `server/i18n/index.js`, add it to the language
  selectors (Account, wizard) and to the `zod` locale mapping in `server/lib/errors.js`.

## Code style

- ESM everywhere, small focused modules, comments where the *why* is not obvious.
- Backend routes validate input with `zod`, check rights with `requireCap('…')` and log state changes with `audit()`.
- Anything that talks to the TeamSpeak server should tolerate a disconnected ServerQuery (return a 503 with `errors.ts3.unavailable`).
- Never log or return secrets (query password, JWT secret, notification tokens, setup token).

## Design system (frontend)

- All building blocks live in `web/src/components/ui.tsx`; the developer route `/styleguide` (dev server only) shows every
  component with its variants and states – check it after changing a component.
- **Tones** are semantic: `success · danger · warning · info · neutral · accent` (plus `purple`). Use `Badge`, `Alert`,
  `StatusText` and `StatTile` with a tone instead of writing `text-emerald-300` / `border-amber-500/30 …` by hand.
- **Tokens** (`web/src/index.css`, `@theme`): `text-2xs` (11 px), radii `rounded-control` (controls, 10 px), `rounded-chip`
  (8 px), `rounded-surface` (cards, 16 px), `shadow-surface`, `shadow-glow`, chart colours `--color-chart-1…5`. The accent
  gradient (`--accent-gradient`) is reserved for the primary button and the active navigation item.
- Tabs → `TabBar` (Radix Tabs), tooltips → `Tip`, dropdowns → `Menu`, popovers → `Pop`, sortable columns → `SortableTh`
  (sets `aria-sort`), loading → `Skeleton`/`PageSkeleton`. Icon-only buttons need a `title` (becomes `aria-label`) or use `IconButton`.
- Forms with unsaved edits call `useUnsavedChanges(dirty)` (`web/src/lib/unsaved.tsx`); the layout renders the guard dialog.
- Motion is 150–200 ms and must respect `prefers-reduced-motion` (the global rule in `index.css` handles CSS animations).
- New pages: add the entry to `web/src/lib/nav.ts` (sidebar, command palette and `G` + key shortcuts derive from it).

## Testing

- Server tests live in `test/server/*.test.mjs` and run with Vitest in one process per file (`pool: forks`), because the server
  modules bind `DATA_DIR`/`BACKUP_DIR` at import time. `test/server/setup.mjs` creates a temporary data directory and sets the
  environment before the test imports anything from `server/` – always import server modules **dynamically** inside tests.
- `test/server/helpers.mjs` provides `createTestApp()` (Express app without background services), `makeAdmin()` and
  `loginAgent()` (Supertest agent with session cookie and CSRF header).
- Tests that need `node:sqlite` skip themselves on older Node.js versions.
- `test/fixtures/fakequery.mjs` is a ServerQuery simulator (module + CLI) with fictional data; `withFakeQuery()` in the helpers starts it
  on a free port and connects the `ts3` module. `test/server/e2e-setup.test.mjs` runs the whole flow wizard → login → administration.
- Frontend unit tests live next to the code as `web/src/**/*.test.ts` (Vitest project `web`, plain Node – no DOM). Keep them to pure
  helpers; component behaviour is covered by the browser checks before a release.

## Releases (maintainers)

1. Update `CHANGELOG.md` (move *Unreleased* into a version section) and bump `version` in `package.json`, `server/package.json`, `web/package.json`.
2. Commit, tag `vX.Y.Z`, push the tag – the *Release* workflow builds `ts3-webinterface-X.Y.Z.tar.gz` (+ `.sha256`, `latest` copies) and
   publishes the GitHub release with notes from the changelog.
3. `sudo ts3web update` on servers picks up the new release. The *Docker image* workflow publishes `ghcr.io/dinh1405/ts3-webinterface`
   (`X.Y.Z`, `X.Y`, `latest`) for the same tag.
