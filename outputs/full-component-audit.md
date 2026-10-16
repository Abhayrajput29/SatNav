# SATNAV full component and interaction audit

**Run:** 16 October 2026. The audit covered the implemented map-first workspace, its active custom components, server/unit regression suite, and browser interactions. Browser fixtures are synthetic and intercepted; no synthetic record is presented as live incident data.

## Result

The complete local validation passed: TypeScript check, **52 unit tests across 10 files**, production build, and **8 of 8 Playwright end-to-end tests**. The browser suite covers desktop and a 390 × 844 mobile viewport.

The audit found and fixed a real timeline usability defect: the range input overlapped the event-density bars, intercepting clicks on those day selectors. The range control now occupies its own row; density bars are individually accessible by name. This change is in `client/src/index.css` and `client/src/pages/Home.tsx`, with an end-to-end regression in `e2e/satnav.controls.spec.ts`.

## Interactive coverage

| Area | Actions verified |
| --- | --- |
| Map and URL view | Basemap renders; map marker opens event detail; drag/pan and zoom update shareable URL state; zoom in/out and reset-to-world controls work; dark/Fiord basemap switching works. |
| Map utilities | Copy-center coordinates displays copied feedback; permitted geolocation recenters and reports that location is not saved; denied location permission produces an explanatory status; dismissing status works. |
| Categories and event list | All nine category toggles can be turned off and back on; Reset restores them; Time/Severity sort switches both ways; list selection opens the event. |
| Search and place detail | Local event search selects a fixture event; place search makes no remote request while typing and runs only after submit; selecting a place recenters and displays attributed details; place and event details close correctly. |
| Event details and saved items | Source records, related records, provenance and metadata render; save/unsave and clear-local-saved work; saved records persist through page reload and appear in the Saved drawer. |
| Time navigation | 1H, 24H, 7D and 30D presets update the window and slider limits; historical mode enters/exits; density bars and keyboard slider scrubbing change the offset; playback advances, pauses, and stops at its bound. |
| Source/settings panels | Settings and Sources open/close the source panel; health and unconnected-source status display; coverage Details opens it; the basemap-terms link has the expected destination. |
| Recovery paths | A test-only feed error exposes Retry and recovers on retry; a test-only basemap error offers Reload and recovers; the app remains interactive. |
| Responsive layout | At 390 × 844, the map and primary controls remain visible and the map workspace stays within the viewport. |
| AI actions | Explain, Known / unknown and Context are correctly disabled when the test reports the AI service unavailable; no AI call or invented explanation was used. |

## Validation evidence

| Command | Outcome |
| --- | --- |
| `pnpm check` | Passed. |
| `pnpm test` | 10 files passed; 52 tests passed. |
| `pnpm build` | Passed; client and server bundles produced. |
| `pnpm test:e2e` | 8 tests passed in 41.4 seconds. |

The browser tests stub feed, style and place-search responses to remain deterministic. They validate application behavior, not upstream availability. Current limitations remain: the GDELT upstream has timed out/rate-limited in earlier live probes and the offline cache still needs one genuine successful response to warm; FIRMS has no configured `MAP_KEY`; ACLED remains intentionally excluded pending authorization. The E2E server logs that `MANUS_OAUTH_API_URL` is unset, but the map workspace and tested flows operate without that integration.

The production build also reports existing non-blocking warnings: the platform config script lacks `type="module"` and the MapLibre JavaScript chunk exceeds 500 kB. Neither prevents a successful build. The runtime emitted a Node `module.register()` deprecation warning.
