

## Latest component audit and verification (2026-10-16)

The validation counts in the earlier snapshot above have been superseded by the final local check: `pnpm check` passed, `pnpm test` passed **52 tests across 10 files**, `pnpm build` succeeded, and `pnpm test:e2e` passed **8 browser tests**. The expanded browser suite now covers the main map controls, search, saved-record persistence, timeline presets/density-bar selection/playback, recovery states, and a 390 × 844 mobile viewport. It uses intercepted synthetic fixtures and does not establish current external feed availability. The earlier statement that mobile E2E coverage was absent is no longer current; a comprehensive accessibility audit and deployment verification remain outstanding.

The audit also found that the timeline slider overlapped the clickable event-density bars, preventing reliable mouse selection. The controls have since been separated in CSS, and the density bars now have accessible day-specific names. See [`outputs/full-component-audit.md`](../outputs/full-component-audit.md) for the detailed interaction matrix and known environment limits.
