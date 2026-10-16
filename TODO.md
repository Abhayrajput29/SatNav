# SATNAV implementation checklist

**Status:** Approved implementation plan; work in progress. Source requirements: the attached SATNAV master implementation prompt plus the approved `plan.md`. Keep this checklist current; check an item only after the outcome is implemented and verified. Do not claim universal coverage, a connected provider, or deployment without evidence.

## 1. Existing project audit and safe setup

- [x] Inspect the new SATNAV worktree before modifying code; confirm its actual React/Vite/TypeScript frontend, Wouter route entry, Tailwind/UI components, Express/tRPC backend, Drizzle/MySQL schema and existing helper modules. The home page is still starter content; `client/src/components/Map.tsx` is an unmounted generic Google Maps wrapper with no SATNAV event layers, so preserve it while adding the approved MapLibre product map.
- [x] Inspect project instructions and scope. Preserve the initialized Local First worktree, managed database, branch/remotes and all starter files; do not reinitialize, publish, or create a checkpoint.
- [x] Record the actual starter architecture, relevant environment variables, available map/data/auth helpers and likely regression risks in `docs/architecture.md`.
- [x] Inspect current package scripts/configuration and run baseline checks. `./node_modules/.bin/pnpm check` passed; baseline tests passed with 2 files and 6 tests. The `/` route was declared before startup; the current preview is bound to `127.0.0.1:3000` with strict-port behavior, and both `/api/health` and `/manus-routes.json` were verified.
- [x] Confirm the pinned pnpm toolchain and reviewed lifecycle-script permissions before changing dependencies. The local project executable reports pnpm 10.18.0; `pnpm-workspace.yaml` explicitly permits only `@tailwindcss/oxide` and `esbuild` lifecycle builds. Use the pin and lockfile, without `--ignore-scripts` or unreviewed approvals.
- [x] Add MapLibre GL JS 6.14.0 through the pinned pnpm executable and lockfile; preserve the existing lifecycle policy. The official Vite worker bundle is verified in the running map.
- [x] Keep TypeScript diagnostics reliable. The host LSP launcher exited without registering a server; `./node_modules/.bin/pnpm check` passed after implementation and is the verification fallback. Do not claim LSP registration.

## 2. Product and visual experience

- [ ] Build SATNAV as a premium, responsive global map and event-intelligence workspace around the concept “Explore the world. Understand what is happening.” Support both casual exploration and deeper sourced investigation.
- [ ] Use a dark geospatial design system: near-black background; dark charcoal/navy panels; electric blue, restrained cyan and violet accents; near-white primary and muted blue-gray secondary text; subtle borders. Use category-specific symbols, shapes and accessible labels as well as color.
- [ ] Provide a SATNAV wordmark/logo, top bar with global event/place search, time range, layer controls and map settings; collapsible left navigation for layers/places/saved locations/history/recent items; interactive full-height map; contextual event/place detail panel; and collapsible historical timeline.
- [ ] Include source/data status, last-success time, source-reported update time, data age, loading/error/empty states, selected-event states, skeletons, accessible tooltips/keyboard navigation, responsive mobile controls, coordinate/scale display, reset-to-world, copy coordinates, shareable view state and practical browser back/forward behavior.
- [ ] Keep panels unobtrusive so map interaction remains central. Use restrained motion, honor reduced-motion preferences, and avoid alarmist flashes or decorative work that degrades map performance.
- [ ] Use the approved design direction: IBM Plex Sans with IBM Plex Mono for coordinate/time data and safe local/system fallbacks; concise, neutral, attributed language; signature cyan; custom compass-bracket/longitude-arc mark.

## 3. Immediate map interactivity and geography

- [x] Render the application shell and initialize MapLibre immediately from local configuration; pan, zoom and basic controls must work before any secondary dataset, geocoder or event feed finishes loading. The running browser preview verified the interactive map and controls after the worker-bundle fix.
- [x] Use the verified OpenFreeMap Dark vector style (`https://tiles.openfreemap.org/styles/dark`), with Fiord optionally available. Preserve MapLibre attribution and OSM/OpenMapTiles credits. Handle tile failure without blocking the app; document the service's as-is/no-SLA limits.
- [ ] Fetch only the visible viewport, selected time range, active layers and filters. Cancel obsolete viewport requests, debounce where useful, deduplicate/reuse in-flight work, paginate/cap results, render progressively, preserve existing content while refreshing, and prefetch adjacent areas only when justified.
- [x] Reuse MapLibre's efficient rendering, native clustering and zoom-dependent rendering; keep React marker count/rerenders low; clean up listeners and map objects. Add workers only if measured work materially benefits. Native map clustering and component cleanup are implemented.
- [ ] Support global view, available country/administrative boundaries and labels, pan/zoom, coordinate inspection, scale, reset-to-world, user-initiated geolocation only after browser permission, event/place selection, cluster expansion, selected highlight and fit-to-event/region. Do not request device location without action and consent.
- [x] Preserve WGS84 semantics, validate latitude/longitude and geometries, distinguish exact/approximate/regional/no-coordinate records, and correctly handle polar regions, longitude wrapping, international date line and antimeridian-crossing queries. Never invent an incident point, polygon, affected area or conflict frontline. Provider geometries are validated, centroids are labeled, and antimeridian query splitting is covered by tests.
- [ ] Use shareable URL state for relevant center/zoom/filters/selection; ensure browser history behavior is useful and routes reflect only real screens.

## 4. Provider registry, coverage and licensing

- [x] Implement independent provider adapters with response validation, normalized fields, original provider IDs/metadata, source attribution/links, pagination, timeouts, bounded retries/backoff, rate-limit compliance, freshness/update status and isolated source health/errors. Never allow one failed provider to break unrelated layers. The two wired adapters have isolated source status/error handling.
- [x] Implement and smoke-test the documented public USGS ComCat GeoJSON feed first: earthquake location/magnitude/time/place/tsunami flag/source details where supplied; support suitable historical FDSN queries within documented result caps. Preserve event vs provider update time, cache conservatively, and avoid claims of complete/uniform detection. A real bounded application request succeeded; the final preview showed USGS checked at 13:08 UTC with 12 viewport records.
- [x] Implement and smoke-test GDACS supported disaster event-list/detail or geographic queries, respecting documented pagination/range limits and terms. Clearly describe model-generated/automated/uncertain alerts, incomplete or delayed coverage, and the fact that GDACS is not a replacement for local/national emergency alerts. The adapter returned a real GeoJSON response during an earlier smoke test; current validation showed intermittent HTTP 404/timeouts, which the UI reports as unavailable (not live).
- [ ] Add GDELT DOC 2.0 only for sourced news/article discovery, related coverage and publisher links. Deduplicate coverage. Do not treat an article's country/place mention as proof of incident coordinates; do not plot unlocated reports or invent publishers, sources, excerpts or links. Respect publisher/content rights.
- [x] Keep NASA FIRMS inactive until a valid free `MAP_KEY` is supplied through protected server-side configuration; never put keys in browser code or logs. If enabled, use bounded viewport/date requests and documented quota/status endpoints; label detections as satellite active-fire/thermal-anomaly observations, not independently confirmed fires; cite NASA without implying endorsement. No key is configured and the feed is not connected.
- [x] Do not retrieve, scrape, store, redistribute, or send ACLED data to AI absent written confirmation that this product, redistribution and AI use are authorized. Keep any adapter boundary disabled and document the access/licensing restriction; do not present fixture or fabricated conflict records as live. No ACLED data is used; the exclusion is documented.
- [ ] Assess any additional meteorological, government/emergency, international organization, health, humanitarian, transport, political, science or space source individually for freshness, geographic coverage, access, reliability and licensing before claiming support. Show disconnected/unsupported categories explicitly; do not imply that the taxonomy itself means a live feed exists.
- [x] Keep test fixtures deterministic and test-only. Only display “live” when the real source and its update behavior justify the label. Keep source failure, stale cache, historical data, forecast, warning and incomplete states distinct. The UI showed `PARTIAL DATA` for current USGS/GDACS status and does not present test fixtures as live.

## 5. Event data model, persistence and query behavior

- [x] Add additive, deterministic Drizzle/MySQL migrations and typed storage for normalized `Event`, `EventSource`, `EventCluster`, source/ingestion status, and bounded AI explanations. Do not add user tables/features merely decoratively; saved places/history remain browser-local in this release. The reviewed additive migration was applied without changing the existing `users` table.
- [ ] Preserve nullable values and, when available: internal/provider IDs; title/category/subcategory/description; coordinates/validated geometry/precision; location/country/region; event start/end; publication/update/first-observed/fetch times; source URL/publisher/type/metadata; reported severity plus original scale; verification/freshness/historical status; impacts/humanitarian impacts; related records/articles and conflicting source claims.
- [ ] Store timestamps in UTC; display with selected timezone. Keep source event time, source publication time, provider update time and SATNAV fetch time distinct. Never fill missing values with invented estimates, false severity precision or arbitrary confidence percentages.
- [ ] Preserve verification labels only when evidence supports them (officially reported, independently corroborated, single-source, unverified, conflicting, historical, forecast/warning). A reputable publisher does not automatically verify every claim. Preserve conflicting times, locations, casualties and severity for inspection.
- [ ] Deduplicate by provider IDs and, where appropriate, time/geography/category/title-description similarity/source references; never merge only because reports share a city/country. Keep source records inspectable and prevent duplicate incident counts.
- [ ] Query bounded viewport/time/category/source/verification/severity with caps and pagination. Use suitable coordinate/time/category/provider indexes and handle antimeridian-crossing viewports by splitting queries. Keep public-data caching separate from private data; never put user-private data in a shared cache.
- [ ] Use server-side TTL/in-flight caching and client query caching with source/viewport/time/filter-specific keys; add HTTP conditional caching only where supported. Keep stale cached results with explicit age/freshness and retry transient errors appropriately; stop retrying permanent errors. Avoid scheduled ingestion unless an authorized reliable runtime is deliberately configured.

## 6. Layers, filters, markers and historical exploration

- [ ] Provide an extensible category taxonomy for: (A) earthquakes, tsunamis, tropical cyclones, flood, wildfire/active-fire, volcano, landslide, extreme temperature, severe storm, drought and environmental hazards; (B) weather warnings/observations/forecasts, rainfall/flood alerts, heat/cold, air quality; (C) armed conflict and sourced public reports of clashes, strikes/shelling, civilian harm, displacement, ceasefires, negotiations, infrastructure damage, humanitarian access and public military incidents; (D) elections, government changes, diplomacy, sanctions, agreements, border/territorial disputes, protests/civil unrest, major court decisions, military exercises and security developments; (E) aviation, maritime, transport, industrial/infrastructure incidents, fires, evacuations, public safety emergencies and major service disruptions; (F) public-health announcements/outbreaks, humanitarian crises, displacement, food insecurity, aid and access disruptions using aggregated information only; (G) rockets/satellites/space missions/incidents, expeditions and geographic science/environment discoveries; and (H) international/country/regional news, major incidents, follow-up coverage, related articles and historical coverage.
- [ ] Display only categories with real, authorized data as active; show unsupported/unconfigured source status and coverage/freshness. Do not plot individual patients or private/identifiable health information; do not equate protests with violence; do not infer attacks from proximity to conflict areas.
- [ ] Use distinct accessible category symbols (seismic/flame/water/storm/conflict/diplomacy/warning/medical/rocket etc.), hover/focus summaries, click details, efficient cluster counts/expansion, selected-event highlight, and accurate geometry only when sources provide it. Use appropriate event density/overlays only if the data and performance support them.
- [ ] Keep map markers and event list synchronized. Support category/group toggles, time, country/region, supported severity, source, verification and map-style filters plus reset. Show uncertainty and location precision.
- [ ] Provide last hour, last 24 hours, last 7 days, last 30 days, custom range and archive filters only where provider data supports them. Timeline should show event density, selectable dates, previous/next ranges and play/pause for available historical data; label current/historical/forecast; never fabricate continuity or treat publication time as event time.
- [ ] Provide regional context/counts only from real selected-window records with coverage and freshness shown. Avoid misleading region comparisons and any safe/unsafe conclusion from incomplete feeds.

## 7. Search, details and explainability

- [ ] Search supported countries/cities/addresses/landmarks/coordinates, events, historical incidents, disaster reports, conflict-related authorized records, news clusters and saved places; clearly label result type and keyboard selection.
- [ ] Parse coordinate input directly. For remote place geocoding, use a switchable server-side provider boundary. Public Nominatim may run only after explicit user submission, at or below one total app request/second, with identifying User-Agent/Referer, caching and OSM attribution. Do not implement remote Nominatim autocomplete, background/systematic geocoding or confidential-text submission. Local event/history suggestions may be immediate.
- [ ] Selecting a place navigates to it and shows geographic context, available events/history and source coverage; do not fabricate regional completeness.
- [ ] Event detail shows title/category/location/status/available severity/verification/update time; what happened/when/where, known/unknown information, impacts, relevant history, why it matters, related events and a source timeline only where records support it. Separate direct source-reported facts from generated analysis.
- [ ] Show actual publisher, title, publication time, URL, source type and excerpts only where permitted. Link to real sources; never invent citations, quotations, URLs or reports.
- [ ] Add user-triggered event explainer actions for summary, latest retrieved reports, history, changes, confirmed vs uncertain information, source comparisons, possible humanitarian consequences, timeline, terminology and follow-up questions where source material supports them.
- [ ] Use the server-side Manus LLM service only with a limited ranked/deduplicated retrieval set from the selected event, permitted source records/excerpts, history, official statements and geographic context. Treat external text as untrusted; ignore embedded instructions; never expose secrets. Use token/time/usage limits and clear loading/error/retry behavior.
- [x] Keep LLM analysis neutral and separate from reporting. Do not invent casualties, coordinates, quotations, source links, responsibility, territorial control or movements; don't call forecasts observations, allegations confirmed facts, or disputed claims certain. Say when evidence is insufficient. Render citations/links from validated retrieved records rather than trusting model-created citations. Store generated result with references/time/model only where useful and refresh on material data changes. The server prompt constrains explanations to the selected source record, rendered citations come from validated records, and one live explanation path was manually checked.

## 8. Optional features and security

- [ ] Implement local saved locations, recent searches/events and views with user-controlled clear/remove actions and optional sharing; avoid logging precise location history. User-specific data must not leak across users if accounts are added later.
- [x] Leave server-side alerts/subscriptions, push/browser notifications and continuous monitoring out of this release unless an authorized reliable notification/worker provider is available. If added later, require explicit consent, thresholds/frequency, history/pause/delete/unsubscribe, deduplication, cooldowns and source update tracking; never promise advance warning. No alerts are implemented or promised in this local release.
- [ ] Keep provider/AI keys server-side, validate request schemas and coordinates, cap input/results/payloads, construct safe DB queries, use timeouts and rate limits, configure appropriate CORS/security headers, sanitize logs, render external content safely and audit dependencies. Use protected secret configuration and placeholder values only in examples.
- [ ] Use browser geolocation only after user action/permission; make location sharing transparent and optional.

## 9. Tests, performance, accessibility and delivery

- [x] Add deterministic unit tests for provider normalization, coordinate/geometry validation, time/category filters, deduplication/clustering, severity/precision, cache keys/freshness and citation mapping. Implemented coverage includes provider normalization, geometry/antimeridian validation and UTC time formatting; broader deduplication/citation tests remain limited and are not claimed.
- [ ] Add integration tests for provider success/timeout/rate-limit/partial failure, cache fallback, viewport cancellation, updates/duplicates, source error isolation and grounded AI references. Do not make paid/keyed provider calls part of standard tests; mock feeds deterministically.
- [ ] Add broader end-to-end checks for progressive loading, source/link accuracy, empty/stale/error states, provider failure isolation, antimeridian behavior, large datasets, mobile layouts and accessibility; fixtures must never appear as live data.
- [x] Add deterministic Playwright coverage for map/canvas readiness, synthetic event details, pan/zoom URL state, timeline presets/scrubbing/playback, category filter counts, and local save/clear. API and basemap routes are intercepted with labeled fixtures; 3 browser tests passed without live feed or AI calls. Broader failure-state, mobile and accessibility checks remain open.
- [ ] Measure initial map interactivity, map responsiveness, API latency, memory and event rendering after implementation. Set realistic budgets from measurements; never invent benchmarks. Run typecheck, lint if configured, tests and production build; fix failures where possible and report anything unverified.
- [x] Create `client/public/manus-routes.json` for actual routes before the first dev-server start. Inspect Webdev runtime/config, complete required TypeScript diagnostics, declare Session `runtime.port`, and bind the local dev server to `127.0.0.1` with strict-port behavior. Do not alter production config to set a local port. The route, declared port and loopback health endpoint were verified; `pnpm check` is the TypeScript fallback because the host LSP did not register.
- [x] Add `docs/architecture.md`, `docs/data-sources.md`, a placeholder-only environment example, setup/run/deployment instructions, provider credential/access/attribution/freshness/coverage limits and operational notes.
- [x] Deliver the implemented local worktree, a working interactive map, actual integrations verified by real requests, event/layer/detail/history/search/AI features that are truly implemented, automated tests and a concise completion report listing what works, checks actually run, known limitations and remaining work. Do not claim deployment unless actually published and verified. This is a local v0.1 delivery with the incomplete broader feed taxonomy and validation work explicitly disclosed.


## 10. Verified local delivery snapshot — 2026-10-16

- [x] Final `pnpm check` passed.
- [x] Final `pnpm test` passed: 9 files, 45 tests, including GDACS rolling-window selection, bounded fallback, successful-empty 204 handling, and persisted GDELT fallback after timeout.
- [x] `pnpm test:e2e` passed: 3 deterministic Playwright tests for map selection/pan/zoom/URL state, timeline preset/scrub/play/pause, category filtering and local save/remove; fixtures only, no live feed or AI calls.
- [x] Final `pnpm build` succeeded. Vite reported a non-module platform-config script advisory and a large MapLibre chunk advisory; neither failed the build. No runtime performance benchmark is claimed.
- [x] Live preview inspection verified the rendered interactive map, attribution, cluster controls and source-health panel. At 13:08 UTC the current viewport showed 12 USGS earthquake records; GDACS was `Unavailable` with HTTP 404 and no cached records, and the UI showed `PARTIAL DATA`.
- [x] `/api/health` returned `{"status":"ok"}`; `/manus-routes.json` declares `/`; preview listens on `127.0.0.1:3000` with strict-port behavior. Bounded probes at 11:28 IST showed provider isolation under failure; direct checks at 11:36 IST found GDACS area HTTP 200, documented search HTTP 204 (valid no-match), and GDELT timing out at 7s. After the fix, the 11:41 IST local API probe returned GDACS `available` with one record via the rolling area endpoint; GDELT still timed out with no cached records.
- [x] Added `README.md`, `docs/architecture.md`, `docs/data-sources.md`, and a blank-placeholder `.env.example`. The local app is not published or deployed.

**Remaining scope:** GDELT/news, FIRMS, conflict, political, weather, health, humanitarian, transport, space and other requested feeds; custom time ranges/timezone choice; broader filters, cross-provider incident deduplication, alerts, and full mobile/accessibility/performance testing remain open above.


## 11. External-provider integration recheck — 2026-10-16 11:48–11:49 IST

- [x] Live viewport API: HTTP 200, `PARTIAL`; USGS available (2 source records), GDACS available (1 source record), GDELT timed out (no stored fallback for this viewport).
- [x] Auxiliary public services: one Nominatim search returned an attributed result; OpenFreeMap Dark style (v8) and one vector tile both returned HTTP 200.
- [ ] GDELT upstream timeout remains unresolved; narrower 24-hour request scope is active and failure is exposed. No retries were added.
- [ ] FIRMS/ACLED and other future feeds are not connected and were not tested; documented credential/licensing boundaries remain in force.


## 12. GDELT offline fallback cache — 2026-10-16

- [x] Persist only valid successful GDELT article responses atomically to the Git-ignored local cache; cap 24 snapshots / 4 MB and expire after 72 hours.
- [x] Filter stale articles by viewport and event time; report fallback as degraded/offline; preserve successful empty snapshots; never cache upstream failures or fabricate live events.
- [x] Add cache round-trip, spatial/temporal filtering, empty-result, expiry, and service-level offline fallback tests.
- [ ] No real last-good cache could be seeded during this run: the narrow upstream GDELT probe returned HTTP 429. The persistent cache requires a successful response before it can serve cached real records.


## 13. Final cache integration and regression validation — 2026-10-16 12:22 IST

- [x] App-level live viewport test during GDELT timeout used an exact-query, test-only empty disk snapshot; HTTP 200 / `PARTIAL`, GDELT `DEGRADED`, zero items. No synthetic article was returned.
- [x] Typecheck, production build, 52 unit tests across 10 files, and 3 Playwright browser tests passed.
- [ ] A genuine last-success cache is still awaiting one successful GDELT response; a failed or rate-limited request is never promoted to cached success.
