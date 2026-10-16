# SATNAV external-provider integration test

**Run time:** 16 October 2026, 11:48–11:49 IST  
**Scope:** One bounded 24-hour viewport request around Panama through the local SATNAV API, one explicit Nominatim place lookup, one OpenFreeMap style request, and one representative vector-tile request. The app's live viewport route runs the enabled event-feed adapters concurrently.

## Results

| Integration | Result | Observation |
| --- | --- | --- |
| SATNAV live viewport route | Pass | HTTP 200; mode `partial`; returned two unified events. |
| USGS ComCat | Pass | `available`; two source records for this viewport/window. |
| GDACS | Pass | `available`; one source record via the rolling-area endpoint. |
| GDELT DOC | **Fail / upstream unavailable** | `unavailable`; DOC request timed out and no persisted records were available for this viewport. The request now sends an explicit 24-hour `timespan`, so the former broad default window is no longer used; the upstream still timed out. |
| Nominatim place search | Pass | One result for the explicit query `Reykjavik`; adapter attribution returned. |
| OpenFreeMap Dark style | Pass | HTTP 200; MapLibre style version 8 with two sources. |
| OpenFreeMap vector tile | Pass | Representative Iceland tile returned HTTP 200, 33,638 bytes, Mapbox Vector Tile content type. |

The live viewport therefore remains **partial**, because GDELT did not respond. The overall report script returned a nonzero status to make that integration failure visible; this was not a test harness crash. The provider-specific results above were still collected independently.

## Not included

NASA FIRMS is not integrated because no `MAP_KEY` is configured. ACLED is intentionally excluded pending explicit licensing/use authorization. Conflict, weather, health, humanitarian, transport and other future feeds have no active adapters, so there was no endpoint to test. AI explanations are outside the external data-provider scope.

## Interpretation

This is a live, time-bounded connectivity and response-shape check, not a coverage or availability guarantee. Provider counts apply only to the tested viewport and time range. GDACS and USGS succeeded in this run; GDELT remains an upstream timeout. The status panel correctly exposed the partial result rather than masking the failure.


## GDELT offline-cache follow-up (2026-10-16)

SATNAV now writes only validated successful GDELT responses to a bounded local JSON cache and, after a later timeout/rate limit, filters a matching snapshot to the selected viewport and event-time window. Cached output is reported as degraded/offline data and expires after 72 hours. Successful empty responses are also cached; failures are never recorded as successful. The cache is not pre-seeded, so it needs at least one successful GDELT response before it can serve real cached articles. A later low-volume GDELT probe returned HTTP 429 after 11.7 seconds, so no genuine snapshot could be seeded during this task. Cache round-trip/filtering/expiry and service fallback are covered by deterministic tests; no synthetic article is added to live application data.


## App-level cache verification (2026-10-16 12:22 IST)

With the live GDELT request timing out, the local app returned HTTP 200 / `PARTIAL`; GDELT was `DEGRADED` with zero items and the message that its last successful request had no records for this viewport. The cache was a temporary, exact-query empty snapshot in `.work`, used solely to exercise the file-cache path; no article records were injected and this does not mean a real GDELT last-good snapshot has been seeded. Final validation: typecheck passed, all 52 unit tests across 10 files passed, production build passed, and all 3 Playwright tests passed. The build emitted its existing script-type and large-chunk warnings.
