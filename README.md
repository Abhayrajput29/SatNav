# SATNAV — Global Event Intelligence

> **Explore the world. Understand what is happening.**

SATNAV is a map-first workspace for exploring public event records with geographic context, timestamps, source attribution, and visible data-coverage limitations. It is an informational tool—not an emergency-warning service, a guarantee of real-time delivery, or a claim of complete global coverage.

**Project status:** Source code is public at [github.com/Abhayrajput29/SatNav](https://github.com/Abhayrajput29/SatNav). This working tree adds a provider-neutral production container and CI workflow; neither these changes nor a hosted deployment have been verified on GitHub yet. See [source coverage](docs/data-sources.md) before relying on any feed.

## What SATNAV does

- Renders a full-screen MapLibre map with OpenFreeMap Dark and Fiord styles, visible attribution, clustered event markers, and a responsive control layout.
- Queries the selected map viewport and time window; URL state can carry map center, zoom, and time preset.
- Offers event-category filters, event-list sorting, map selection, event/source detail panels, and source-health/freshness status.
- Supports 1-hour, 24-hour, 7-day, and 30-day presets plus historical exploration where provider data is available.
- Lets users search local event records and submit explicit place searches. Remote place lookup is not triggered while typing.
- Stores saved events in the current browser's local storage; saved items are not account-synced.
- Provides user-triggered, source-grounded explanation actions only when the configured server-side Manus LLM service is available.
- Shows partial, unavailable, and unsupported-source states instead of implying that every category is live.

## Data coverage and boundaries

| Integration                                                              | Current use                                                                                   | Important limits                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [USGS ComCat](https://earthquake.usgs.gov/fdsnws/event/1/)               | Public earthquake and other supported ComCat event records.                                   | Source coverage and reporting are not uniform; only supplied, validated locations are plotted.                                                                                                                                                                                        |
| [GDACS](https://www.gdacs.org/gdacsapi/swagger/v1/swagger.json)          | Public multi-hazard alert/event records, including bounded geographic and historical queries. | Alerts can be automated/model-based, incomplete, delayed, or uncertain; verify with local/national authorities.                                                                                                                                                                       |
| [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | Recent article metadata, publisher links, and source-provided article coordinates.            | Article metadata is coverage—not a verified incident. The request window is bounded to 24 hours; timeouts/rate limits can make the source unavailable. A local last-success cache can serve validated data for up to 72 hours after it has been warmed by a successful real response. |
| [Nominatim](https://operations.osmfoundation.org/policies/nominatim/)    | Server-side lookup for a place explicitly submitted by the user.                              | No remote autocomplete or bulk geocoding. Requests are serialized per server process; observe the service policy and include OpenStreetMap attribution.                                                                                                                               |
| [OpenFreeMap](https://openfreemap.org/quick_start/)                      | MapLibre vector basemap with Dark and Fiord styles.                                           | Public service has no availability/SLA guarantee; attribution is shown in the map.                                                                                                                                                                                                    |

Only high-precision USGS/GDACS earthquake records are candidates for cross-provider grouping. Related records remain inspectable, and grouping is **not independent corroboration**. GDELT article centroids are not merged into incident records.

The following categories/integrations are **not connected** in this release: NASA FIRMS (no configured `MAP_KEY` and no active integration), ACLED (intentionally excluded pending written authorization), and conflict, political, weather, public-health, humanitarian, transport, infrastructure, space/science, and general-news incident feeds. Their presence as filters or categories does not imply live coverage. There are no alert subscriptions, continuous-monitoring guarantees, or push notifications. Custom date windows and selectable display time zones are not implemented.

For detailed provider behavior, attribution, freshness, timeout/cache handling, and observed availability, see [`docs/data-sources.md`](docs/data-sources.md).

## Technology

- **Client:** React 19, TypeScript, Vite 7, Tailwind CSS 4, MapLibre GL JS.
- **Server/API:** Node.js, Express, tRPC, Zod validation.
- **Persistence:** Drizzle ORM and MySQL-compatible database; public source records/status and bounded explanations can be persisted when the database is configured.
- **Tests and automation:** Vitest, Playwright, and GitHub Actions.
- **Deployment:** Multi-stage Docker image based on Node.js 22, with a non-root runtime user and an HTTP health check.
- **Package manager:** pnpm **10.18.0**, pinned in `package.json` and `pnpm-lock.yaml`.

## Requirements

- Node.js **22.12.0 or newer** for local development.
- pnpm 10.18.0 (Corepack is a convenient way to activate the pinned version).
- Network access for the public feeds, place lookup, and basemap tiles.
- A MySQL-compatible `DATABASE_URL` for database-backed persistence and migrations. The server can start without it, but database operations will not be available.
- Protected server-side platform configuration for OAuth or LLM features that you choose to enable. These services are not required for the map shell itself.

## Run locally

From a clone or local project copy:

```sh
cd SATNAV
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
```

Optionally create a local environment file:

```sh
cp .env.example .env
```

`.env.example` contains blank placeholders, not working credentials. Fill only values available to your development environment. Keep secrets server-side and never commit `.env`, put credentials in client/Vite variables, or paste them into logs or source code. The root `.gitignore` excludes environment files, generated test artifacts, debug logs, caches, dependencies, and build output.

Start the development server on loopback port 3000:

```sh
HOST=127.0.0.1 PORT=3000 STRICT_PORT=true pnpm dev
```

Open <http://127.0.0.1:3000/>. Check process health at <http://127.0.0.1:3000/api/health>; the expected response is `{"status":"ok"}`. This endpoint is a **liveness check**: it confirms that the HTTP process responds, not that the database or external providers are healthy. The only declared product route is `/` (`client/public/manus-routes.json`).

### Environment variables

| Variable                                                                                                                                            | Purpose                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`                                                                                                                                              | Server bind address. For a local-only preview, set `127.0.0.1`; the server otherwise defaults to `0.0.0.0`.                                                                              |
| `PORT`                                                                                                                                              | HTTP port; defaults to `3000`.                                                                                                                                                           |
| `STRICT_PORT`                                                                                                                                       | Set to `true` to fail rather than silently share a different port.                                                                                                                       |
| `DATABASE_URL`                                                                                                                                      | MySQL-compatible connection string for persistence and Drizzle migrations. Required by Drizzle CLI commands.                                                                             |
| `SATNAV_GDELT_CACHE_PATH`                                                                                                                           | Optional server-side file path for the GDELT last-success cache. Default outside Docker: `.cache/satnav/gdelt-v1.json`; the cache is local and ignored by Git.                           |
| `MANUS_PROJECT_ID`, `MANUS_API_URL`, `MANUS_API_KEY`, `BUILT_IN_FORGE_API_KEY`, `MANUS_JWT_SECRET`, `MANUS_OAUTH_API_URL`, `MANUS_OAUTH_PORTAL_URL` | Managed platform/OAuth values used by the corresponding server features. Configure only through protected runtime settings or a private local `.env`; do not expose them to the browser. |

The GDELT offline cache stores only validated real provider responses; it is not pre-seeded. Until a successful GDELT fetch warms the cache, a live timeout remains an unavailable source rather than synthetic news.

## Database and migrations

Apply the checked-in additive migrations only when a valid `DATABASE_URL` is configured:

```sh
pnpm db:migrate
```

For production, run migrations as a deliberate one-off release step using the production `DATABASE_URL` stored in the hosting provider’s secret configuration. Do not run schema changes automatically on every app startup. `pnpm db:push` generates and applies a migration; use it only when intentionally changing the schema and after reviewing the generated migration. Do not run destructive reset, seed, or data-deletion commands against shared or production data.

## Development checks and CI

```sh
pnpm check       # TypeScript, no emit
pnpm test        # Vitest unit/regression suite
pnpm test:e2e    # Playwright browser suite
pnpm build       # Production client and server bundles
```

The last verified local run on 16 October 2026 passed TypeScript checking, **52 unit tests across 10 files**, the production build, and **8 Playwright tests**. The browser suite exercises map controls, event/place search, category toggles, saved-event persistence, timeline presets/scrubbing/playback, responsive layout, and recovery behavior.

The [GitHub Actions CI workflow](.github/workflows/ci.yml) runs type-checking, unit tests, build, Playwright with Chromium, a Docker image build, and a production-container smoke test on pushes to `main` and pull requests. It does not deploy the application. Playwright intercepts feed, place-search, and basemap responses with labeled synthetic fixtures; E2E tests validate application behavior, not current upstream availability. Reports, traces, screenshots, and browser artifacts are written under `.work/` and are ignored by Git.

There is no configured lint script or performance benchmark. The production build currently succeeds with non-blocking warnings about the platform config script's module attribute and the size of the MapLibre chunk; the development runtime may also log an unset OAuth configuration or a Node deprecation warning.

If port 3000 is already in use, run Playwright against a fresh isolated port instead of reusing the existing server:

```sh
SATNAV_E2E_PORT=3110 CI=true SATNAV_E2E_USE_SYSTEM_CHROME=false pnpm test:e2e
```

## Production container

The application needs a Node server; a static-only host cannot serve its tRPC API, provider adapters, or health route. Build the multi-stage container from the project root:

```sh
docker build -t satnav:local .
docker volume create satnav-data
```

Run it with a private `.env` containing only the values needed by this deployment:

```sh
docker run --rm --name satnav \
  --publish 3000:3000 \
  --env-file .env \
  --env HOST=0.0.0.0 \
  --env PORT=3000 \
  --env SATNAV_GDELT_CACHE_PATH=/var/lib/satnav/gdelt-v1.json \
  --volume satnav-data:/var/lib/satnav \
  satnav:local
```

The container uses Node.js 22, runs as an unprivileged UID 10001, binds to `0.0.0.0`, and exposes port 3000 by default. Hosting platforms may supply a dynamic `PORT`; the server reads it at runtime. The Docker health check requests `GET /api/health`. The cache directory is `/var/lib/satnav`; mount persistent, writable storage there if the GDELT last-success cache should survive container replacement. For host-provided volumes, ensure the mount is writable by UID 10001. Without persistent storage, the app still runs, but the cache may be lost on redeployment.

Set `DATABASE_URL` and any OAuth/LLM settings through the platform’s protected environment/secrets interface. Run `pnpm db:migrate` from a separate release job before directing traffic to a deployment that needs persistence. Do not bake secrets into the image or pass production secrets as Docker build arguments.

## Deployment checklist and next improvements

The container is provider-neutral, but deployment still requires choosing a host, configuring a MySQL-compatible database if persistence is wanted, adding protected environment values, and performing the first live smoke test. Prefer a container host that supports environment secrets, a health-check path, and a persistent writable volume for `/var/lib/satnav`.

Recommended order after deployment:

1. Add production rate limits and shared telemetry for public API/provider calls; current AI throttling is process-local.
2. Improve source operations with live freshness monitoring, provider-specific alerting, and a genuine GDELT cache warm-up.
3. Choose one user-facing feature—saved searches/alerts, account-synced saved events, or expanded hazard feeds—and implement it end-to-end before broadening scope.
4. Reduce initial map bundle size and add a measured performance/accessibility budget.

The package metadata declares MIT, but the repository does not currently contain a top-level `LICENSE` file. Confirm the copyright holder and add the license text before relying on MIT terms for reuse.

## Repository map

```text
client/src/pages/Home.tsx             Main map workspace and controls
client/src/features/satnav/           MapLibre canvas and event details
server/satnav/                        Feed adapters, normalization, queries, cache
shared/satnav.ts                      Shared data types and validation schemas
drizzle/                              MySQL schema and additive migrations
e2e/                                  Playwright browser tests
docs/                                 Architecture and data-source notes
outputs/full-component-audit.md       Latest component/interaction audit
```

## Project documents

- [`plan.md`](plan.md) — approved product goals and implementation boundaries.
- [`TODO.md`](TODO.md) — tracked acceptance criteria and outstanding work.
- [`docs/architecture.md`](docs/architecture.md) — architecture notes and implementation verification.
- [`docs/data-sources.md`](docs/data-sources.md) — provider behavior, attribution, limitations, and observations.
- [`outputs/full-component-audit.md`](outputs/full-component-audit.md) — latest UI/component audit and test results.

SATNAV presents sourced context with incomplete coverage; **do not use it as an emergency alert or as a safety/verification determination**.
