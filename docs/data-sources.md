# SATNAV data sources and coverage

**Scope:** this document describes the SATNAV local v0.1 implementation. “Connected” means an adapter exists; it does not promise that an upstream is currently available or that its coverage is complete. The interface exposes the last attempt/success and partial/unavailable state.

## Current source-health snapshot

Observed in the running local preview on **15 October 2026 at 13:08 UTC**, for the then-selected viewport and time window:

- **USGS:** `Checked`; last successful request at 13:08 UTC. The map contained 12 public earthquake records in that viewport.
- **GDACS:** `Unavailable`; upstream returned HTTP 404, no cached records were available for that viewport, and its prior success was 11:13 UTC. A separate bounded direct request earlier in the session timed out, despite an earlier direct request returning GeoJSON HTTP 200.
- The page correctly labeled the viewport `PARTIAL DATA`; do not describe GDACS as reliably operational until a later real request succeeds. Source health is a time-specific snapshot and may change.

On **16 October 2026 at 10:22 IST**, a live local-API query for Panama (9 October, 17:00–19:00 UTC) returned four USGS records and one GDACS historical-search record. The M7.7 event appeared once with USGS `us6000u18k` and GDACS `1570339`; GDELT was unavailable for that request, so the overall result remained `PARTIAL`. This is a single historical spot-check, not evidence of complete coverage or future upstream availability.

## Connected feeds

### USGS ComCat earthquakes

The server uses the public [USGS FDSN event query API](https://earthquake.usgs.gov/fdsnws/event/1/) with GeoJSON format, the current viewport, and the selected time window. Each antimeridian-safe area is fetched in 1,000-result pages, capped at 20,000; the app marks truncation if the cap is reached. It retains provider IDs, source URL, longitude/latitude/depth, event time and provider update time separately, magnitude and scale, tsunami flag, PAGER alert, review status, significance, felt reports, MMI/CDI and product types when supplied. Non-earthquake ComCat event types are labeled as `other`, not as earthquakes. Only records with valid source coordinates are plotted.

Official references: [GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php), [feed lifecycle/update policy](https://earthquake.usgs.gov/earthquakes/feed/policy.php), and [ComCat documentation](https://earthquake.usgs.gov/data/comcat/). USGS data are not uniform detection or global incident coverage.

### GDACS disaster alerts

A server adapter uses the official OpenAPI area-query route `GET /api/Events/geteventlist/eventsbyarea` with WKT `geometryArea` and a rolling `days` window (maximum 30 days). The area query's lookback is calculated from the current time to the requested start; ranges inside that rolling 30-day window use this endpoint even when they are historical. Only ranges older than 30 days—or area-query failures—use the documented time-bounded `/api/Events/geteventlist/search` route with ISO UTC bounds, page size 100 and up to five pages (500 global records maximum), then filter provider geometry to the viewport. Search uses a total 18-second budget; area calls time out after 7 seconds. HTTP 204 from search is treated as a successful empty result, not a feed failure. A full final page is marked truncated. GDACS point geometries may be centroids; the app does not convert a centroid into an affected-area polygon. Alert/severity labels stay tied to GDACS's source scale.

GDACS errors remain isolated from other feeds. The 15 October HTTP 404/timeouts were historical observations; a 16 October bounded direct area query returned HTTP 200 in 3.2 seconds, while a time-bounded search returned HTTP 204 with an empty body. A fresh local API request at 11:41 IST returned one GDACS record through the rolling area endpoint. The adapter treats 204 as a valid no-match result and caps area/fallback-search work. Valid stale data may be used only when present and labeled with its age. GDACS alerts may be automated/model-based, incomplete, delayed or uncertain; verify with appropriate national/local authorities. SATNAV is not an emergency-warning service and must not replace official alerts.

Official references: [GDACS OpenAPI](https://www.gdacs.org/gdacsapi/swagger/v1/swagger.json), [GDACS terms](https://www.gdacs.org/Documents/2025/GDACS_Terms_of_use_Mar_25.pdf), and [GDACS feed reference](https://www.gdacs.org/feed_reference.aspx).

### Cross-provider earthquake incident linking

Only USGS/GDACS earthquake records with source point coordinates and event times are candidates. When both sources report compatible magnitude scales, the match must be within 40 km and 15 minutes with magnitude difference no greater than 0.6. If either magnitude is missing or uses an incompatible scale, the stricter limit is 5 km and 2 minutes. A one-to-one best-score assignment avoids one GDACS event matching multiple USGS events. The map/API returns one representative incident with both provider records and source metadata visible in details; original event/source rows remain separate in storage under a shared incident cluster ID. This heuristic grouping is **not independent corroboration** and does not resolve conflicting claims. GDELT article centroids and other categories are deliberately excluded.

GDACS `eventid` and `episodeid` are kept separate from the upstream `source` and `sourceid`. When supplied, the Layers label shows the upstream source (for example, `GDACS (NEIC)`), and event details list each identifier separately. An upstream record ID may point to the same event already supplied by USGS; that is a linked record, not independent corroboration.

### GDELT article metadata

The GDELT DOC API adapter returns up to 75 article metadata records and sends an explicit `timespan` of at most 24 hours; without it, DOC searches its much broader default window. It stores publisher, title/link and GDELT's journalist-coded coordinates as centroid precision; it does not redistribute article text. GDELT cannot provide the requested historical date interval through this endpoint, so the service does not substitute current articles for a historical selection. There are no automatic retries on timeout or rate-limit responses.

On each valid successful provider response, SATNAV atomically stores up to 75 real GDELT article records for that viewport/time query in `.cache/satnav/gdelt-v1.json` (ignored by Git); `SATNAV_GDELT_CACHE_PATH` can override the location. It retains at most 24 snapshots and 4 MB, expires them after 72 hours, and re-filters cached records by event time and geometry before returning them as **degraded/offline cached data**. Exact successful empty responses are cached too. A timeout or rate-limit error is never saved as a successful result. This cache is populated only after a successful upstream response; it is not pre-seeded with synthetic articles. If the cache is empty or expired, the source remains unavailable and the app reports the timeout. Related-story/news coverage clustering is not implemented, and GDELT reports are not treated as verified incidents. See [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) and [Geo 2.0](https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/).

## Search and basemap services

- **Place search:** public Nominatim is called server-side only after an explicit user-submitted search, not while typing. The adapter serializes requests within this server process with at least 1.1 seconds between request starts and caches bounded results; this is not a distributed/global rate limiter. Do not run multiple app workers against the public service without adding a shared throttle. Public Nominatim prohibits autocomplete and bulk/systematic use; results are geocoder output, not incident coordinates. Attribute OpenStreetMap. See the [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) and [Search API](https://nominatim.org/release-docs/latest/api/Search/).
- **Basemap:** MapLibre GL JS renders the OpenFreeMap Dark style, with Fiord as an alternative. Visible attribution includes OpenFreeMap, OpenStreetMap and OpenMapTiles. The public tile service is provided as-is with no availability/accuracy warranty or SLA. See [OpenFreeMap quick start](https://openfreemap.org/quick_start/) and [terms](https://openfreemap.org/tos/). A tile failure must not disable event queries or map controls.

## AI explanations

A user-triggered explainer uses the project-configured server-side Manus LLM service (preferred model `gemini-3-flash-preview` when present in the live catalog). It receives the selected normalized event and its actual source metadata, not a general web search or arbitrary article body. Actions are limited to summary, uncertainty and background. The server caps output, applies a per-client rate limit, caches explanations for up to six hours, and renders citations from validated event sources rather than model-generated links. A generated explanation is analysis, not an independent report or corroboration; it must remain neutral and state when evidence is insufficient. Platform credentials are server-only.

## Not connected in this release

| Data area/source | Status and boundary |
| --- | --- |
| Related GDELT story/coverage clustering | Not implemented. Only exact article-URL duplicates are removed; the adapter does not yet group related news coverage into incidents. |
| NASA FIRMS | Not integrated; no `MAP_KEY` configured. If enabled later, label detections as satellite thermal/active-fire observations, not independently confirmed fires. See [FIRMS API use](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html) and [NASA data-use guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance). |
| ACLED | Intentionally excluded. Do not retrieve, redistribute, store or send its data to the explainer without written confirmation that this event-intelligence product and AI use are authorized. See [API access](https://acleddata.com/api-documentation/getting-started) and [content-use terms](https://acleddata.com/contentusage). |
| Conflict, political, weather, public-health, humanitarian, transport, infrastructure, space/science and general-news feeds | Not connected. Their presence in the requested taxonomy does not imply records or live coverage. The UI explicitly reports this limitation. |
| Alerts/subscriptions/push | Not implemented. There is no promise of early warning or continuous monitoring. |

## Data handling and tests

Viewport requests are bounded to a maximum 30-day window, cached in memory for 60 seconds with in-flight de-duplication, and run concurrently so one provider failure does not block the others. The service retains up to 8,000 raw-event lookup entries and 8,000 incident lookup entries; public raw event/source/status records and bounded explanations can be persisted in the managed database. Matching records share an incident cluster ID, but their raw claims and source metadata remain separate. Stale fallback is only used when cached/stored records exist and is labeled. Saved events remain local to the browser; there is no account-synced saved-place or alert data.

Deterministic provider/geometry/time/incident-linking tests use fixtures only; they do not poll or certify upstream availability. On 16 October 2026, 52 unit tests across 10 files passed, including GDELT cache round-trip, bounds/time filtering, empty-result handling, expiry and service fallback. A 12:22 IST local API check during a live GDELT timeout used a **test-only empty cache snapshot** and returned HTTP 200 / `PARTIAL`, with GDELT correctly labeled `DEGRADED` and zero cached articles. This verifies the fallback/status path, not that genuine news data is presently cached: the cache only warms after a successful GDELT response, and the upstream was still timing out/rate-limiting in this session. Recheck the source-health panel before relying on current upstream status. Preserve original source URLs, provider IDs, timestamps, location precision, category and attribution when extending integrations.


## Bounded live integration recheck (2026-10-16 11:48–11:49 IST)

One 24-hour Panama viewport request through the live app returned HTTP 200 and `PARTIAL`: USGS was available with 2 source records and GDACS with 1, while GDELT timed out with no cached records. A single explicit Nominatim search for Reykjavik returned one attributed place. The OpenFreeMap Dark style returned HTTP 200 (MapLibre style v8), and a representative Iceland vector tile returned HTTP 200 with a non-empty PBF payload. This is a point-in-time, one-area check, not a coverage or availability guarantee. NASA FIRMS remained untested because no MAP_KEY is configured; ACLED remains intentionally excluded pending authorization; other future feed categories have no active adapters.
