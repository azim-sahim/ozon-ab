# AGENTS.md

Ozon A/B-testing app: rotates product-card photos/titles via Ozon Seller API, pulls order metrics, ad stats via Performance API. UI text and error messages are **Russian**.

Stack: TanStack Start (React 19) + Vite 8 + Nitro 3 + Tailwind 4 + `pg` + Better Auth. Node 22.

Deploy/env details live in `README.md` and `env.example` — don't duplicate them here.

## Commands

| Command | Notes |
|---|---|
| `npm run dev` | Dev server on **`0.0.0.0:8080`** (strictPort — live-preview contract; don't change host/port) |
| `npm test` | Two runners: `node --test 'scripts/**/*.test.mjs'` then `node --experimental-strip-types --test` on an **explicit file list** |
| `npm run typecheck` | `tsc --noEmit` (covers `src/` + `server/`) |
| `npm run lint` | ESLint flat config |
| `npm run format` | Prettier (`--write`) |
| `npm run check:auth` | Compares dev-server vs build `VITE_AUTH_ENABLED` (needs a running dev server) |
| `npm run build` | `vite build` → `patch-ssr-exports` → `db:migrate` (deploy path) |
| `npm run build:selfhost` | Same but `NITRO_PRESET=node-server`, **no** migrate (runs at container start) |
| `npm run db:migrate` | Apply `migrations/*.sql` to `DATABASE_URL` |
| `npm start` | `node .output/server/index.mjs` |

There is no per-package runner (single package). To run one test file: `node --test scripts/migration-plan.test.mjs` or `node --experimental-strip-types --test src/lib/auth/gate-identity.test.ts`.

**New TS test files must be added to the `test` script in `package.json`** — only `scripts/**/*.test.mjs` is globbed.

## Architecture

- Business logic: `src/lib/server/actions.ts` (shops, tests, rotation, metrics) and `src/lib/server/finance-actions.ts` (profit/finance). Both export `createServerFn` handlers.
- Ozon API wrappers: `src/lib/ozon/` — `client.ts` (Seller API), `performance.ts` (ads), `finance.ts`, `demo.ts` (hardcoded demo shops).
- Domain types: `src/lib/types.ts`. Pure calc: `src/lib/metrics.ts`, `stats.ts`, `profit.ts`.
- Routes: `src/routes/` (TanStack file-based). App pages under `_app/`, API under `api/`.
- DB access: `src/lib/db.ts` → `getSql()`. Dual backend: **Postgres** when `DATABASE_URL` is set, else embedded **PGLite**.
- Auth: Better Auth at `src/lib/auth/`. Server functions use `authMiddleware` from `src/lib/auth/middleware` and must scope every query by `context.userId`.
- Nitro server extras: `server/middleware/` (PWA), `server/tasks/rotate.ts` (scheduled rotation).
- Much of the tree is Grok app-builder **template scaffolding**, not this product: `src/lib/multiplayer/`, `src/lib/app-data/`, `src/lib/og/`, `scripts/grok-pwa-*`, `scripts/browser-smoke-*`, `scripts/brand-check.*`, `public/__grok/`. Touch only if the task is about that scaffolding.

Path alias: `@/*` → `./src/*`.

## Gotchas

1. **Always start dev/build/preview through the npm scripts.** They wrap Vite with `scripts/with-app-env.mjs`, which merges `.grok/app-env.json` (only `VITE_*` keys). Calling `npx vite dev` directly skips the wrapper and makes the dev server disagree with the built output about `VITE_AUTH_ENABLED` (see `npm run check:auth`).
2. **`scripts/patch-ssr-exports.mjs` is mandatory after every `vite build`.** It fixes a Rolldown SSR export cycle/`s` export bug in TanStack Start; without it every request 500s. Never remove it from the build scripts.
3. **Migrations** (`migrations/*.sql`): applied in **basename sort order**, recorded in `_migrations`, keyed by basename. Appliers are **non-recursive** — `migrations/auth/*.sql` is opt-in and ignored until copied up into `migrations/`. Add a new numbered file; never edit one already applied.
4. **`BETTER_AUTH_SECRET` also encrypts stored Ozon shop keys** (`src/lib/server/secrets.ts`). Rotating it makes existing keys undecryptable; users must re-enter them. Same secret is tried first when decrypting, with `ENCRYPTION_KEY` and a local preview key as fallbacks.
5. **`APP_URL` must be publicly reachable in production** — Ozon fetches uploaded variant photos from it (`src/lib/server/media.ts`).
6. **`src/lib/db.ts` normalizes pg vs PGLite row types** (int8→number, date→`YYYY-MM-DD` string, interval→text). Don't re-parse those types in call sites; cast `::text` if you need huge integers.
7. **`src/lib/auth/server.ts` is frozen pre-wired config — do not rewrite it.** Email/password is toggled only in `src/lib/auth/email-password.ts` (currently `true`). Never import `*.server` modules from client code.
8. **Keep Nitro `serverDir: "./server"` in `vite.config.ts`** (Nitro v3 defaults it to `false`). Removing it silently unwires the PWA middleware and `/?install=1`.
9. **Rotation runs three ways:** in-process every 20s via `src/lib/server/scheduler.ts` (no-op when `VERCEL` is set), Nitro scheduled task `* * * * *` → `server/tasks/rotate.ts`, and manual `GET/POST /api/cron/tick` (`CRON_SECRET` optional).
10. **Name/description updates go through `applyNameDescription`** (`src/lib/ozon/client.ts`). Primary path is a **targeted** `/v3/product/import` with only `offer_id` + `name`/`description` (never pass `attributes: []` — that wipes characteristics). Fallback (`/v1/product/attributes/update` attrs 4180/4191) requires `dictionary_value_id: 0` in values or Ozon silently ignores text. This area has been buggy — see git history for prior failed attempts.
11. Demo shops (`shops.is_demo`) short-circuit to `src/lib/ozon/demo.ts` fixtures — no real API calls.

## Conventions

- Prettier: semicolons, double quotes, trailing commas, `printWidth: 100`.
- Server functions: `createServerFn(...).middleware([authMiddleware]).handler(...)` — see the example in `src/lib/auth/middleware.ts`.
- Prefer tagged-template SQL (`sql\`select … where user_id = ${userId}\``) from `getSql()`; it is parameterized.
- User-facing strings and thrown errors are Russian.
