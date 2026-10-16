import { expect, test } from "@playwright/test";

const now = Date.now();
const eventFixture = {
  id: "usgs:audit-event",
  clusterId: "incident:audit-event",
  providerId: "audit-event",
  category: "earthquake",
  title: "Synthetic matched earthquake fixture (control audit)",
  description: "Synthetic browser-test data only; not a live incident report.",
  locationLabel: "Test point",
  country: "Test",
  longitude: 12,
  latitude: 24,
  geometry: { type: "Point", coordinates: [12, 24] },
  locationPrecision: "point",
  status: "observed",
  verification: "official-feed",
  startTime: now - 60 * 60 * 1000,
  fetchedAt: now,
  sources: [{ provider: "usgs", providerId: "audit-event", label: "Synthetic test source", attribution: "Test only" }],
  sourceCount: 1,
};
const sources = [
  { provider: "usgs", label: "USGS (test fixture)", state: "available", lastAttemptAt: now, lastSuccessAt: now, itemCount: 1, coverageNote: "Synthetic fixture only; not live data." },
  { provider: "gdacs", label: "GDACS (test fixture)", state: "available", lastAttemptAt: now, lastSuccessAt: now, itemCount: 1, coverageNote: "Synthetic fixture only; not live data." },
];
const viewportFixture = { events: [eventFixture], sources, fetchedAt: now, truncated: false, coverageNote: "Synthetic browser-test fixture only; not live data.", mode: "partial" };
const testStyle = { version: 8, name: "SATNAV controls audit", glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf", sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#0b1017" } }] };
function responseFor(path: string): unknown {
  const procedure = path.split(".").at(-1);
  if (procedure === "viewport") return viewportFixture;
  if (procedure === "sources") return sources;
  if (procedure === "aiStatus") return { available: false, model: "e2e-fixture", message: "Disabled in browser tests." };
  if (procedure === "searchEvents") return [];
  return null;
}

test.beforeEach(async ({ page }) => {
  await page.route("https://tiles.openfreemap.org/styles/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(testStyle) }));
  await page.route("https://tiles.openfreemap.org/fonts/**", route => route.fulfill({ status: 200, contentType: "application/x-protobuf", body: Buffer.alloc(0) }));
  await page.route("**/api/trpc/**", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname.slice(url.pathname.indexOf("/api/trpc/") + "/api/trpc/".length));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(path.split(",").filter(Boolean).map(procedure => ({ result: { data: { json: responseFor(procedure) } } }))) });
  });
});

test("toolbar, map controls, layers, and source settings respond", async ({ page, context }) => {
  await context.grantPermissions(["geolocation", "clipboard-read", "clipboard-write"]);
  await context.setGeolocation({ latitude: 51.5072, longitude: -0.1276 });
  await page.goto("/");
  await expect(page.getByRole("application", { name: "Interactive world event map" })).toBeVisible();
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const initialZoom = Number(new URL(page.url()).searchParams.get("z") ?? 1.9);
  await zoomIn.click();
  await expect.poll(() => Number(new URL(page.url()).searchParams.get("z")), { timeout: 8_000 }).toBeGreaterThan(initialZoom);
  const zoomedIn = Number(new URL(page.url()).searchParams.get("z"));
  await zoomOut.click();
  await expect.poll(() => Number(new URL(page.url()).searchParams.get("z")), { timeout: 8_000 }).toBeLessThan(zoomedIn);

  await page.getByRole("button", { name: "Switch basemap style from dark" }).click();
  await expect(page.getByRole("button", { name: "Switch basemap style from fiord" })).toBeVisible();
  await page.getByRole("button", { name: "Switch basemap style from fiord" }).click();
  await expect(page.getByRole("button", { name: "Switch basemap style from dark" })).toBeVisible();
  await page.getByRole("button", { name: "Copy map-center coordinates" }).click();
  await expect(page.locator('button[title="Coordinates copied"]')).toBeVisible({ timeout: 1_500 });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^-?\d+\.\d{4}, -?\d+\.\d{4}$/);
  await page.getByRole("button", { name: "Center on my location" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Centered on your device location" })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("lat"), { timeout: 8_000 }).toBe("51.5072");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.getByRole("button", { name: "Reset to world view" }).click();
  await expect.poll(() => Number(new URL(page.url()).searchParams.get("z")), { timeout: 8_000 }).toBeCloseTo(1.8, 1);

  await page.getByRole("button", { name: "Open map settings" }).click();
  const sourcePanel = page.getByRole("region", { name: "Source status" });
  await expect(sourcePanel.getByRole("heading", { name: "Source health" })).toBeVisible();
  await expect(sourcePanel.getByText("USGS", { exact: true })).toBeVisible();
  await expect(sourcePanel.getByRole("link", { name: "Basemap service terms" })).toHaveAttribute("href", "https://openfreemap.org/tos/");
  await sourcePanel.getByRole("button", { name: "Close panel" }).click();

  await page.getByRole("button", { name: "Map layers and events" }).click();
  const layers = page.getByRole("region", { name: "Map layers" });
  for (const name of ["Earthquakes", "Floods", "Cyclones", "Fire detections", "Volcanic activity", "Tsunami alerts", "Drought", "News events", "Other disaster alerts"]) {
    const checkbox = layers.locator(".layer-row").filter({ hasText: name }).getByRole("checkbox");
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
  }
  await layers.getByRole("button", { name: "Reset", exact: true }).click();
  await layers.getByRole("button", { name: "Sort: Time" }).click();
  await expect(layers.getByRole("button", { name: "Sort: Severity" })).toBeVisible();
  await layers.getByRole("button", { name: "Sort: Severity" }).click();
  await expect(layers.getByRole("button", { name: "Sort: Time" })).toBeVisible();
  await layers.getByRole("button", { name: "Close panel" }).click();

  await page.getByRole("button", { name: "Source health" }).click();
  await expect(page.getByRole("region", { name: "Source status" }).getByText("NOT CONNECTED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Source health" }).click();
  await expect(page.getByRole("region", { name: "Source status" })).toHaveCount(0);
});

test("place search waits for submit; event lookup and detail/explainer actions behave", async ({ page }) => {
  let placeSearchCalls = 0;
  await page.route("**/api/trpc/satnav.searchPlace**", async route => {
    placeSearchCalls++;
    const place = { id: "place-test-reykjavik", label: "Reykjavík, Iceland", longitude: -21.9426, latitude: 64.1466, precision: "place", attribution: "© OpenStreetMap contributors · Test fixture" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ result: { data: { json: [place] } } }]) });
  });
  await page.goto("/");
  const search = page.getByRole("textbox", { name: "Search places and events" });
  await search.fill("Reykjavik");
  await page.waitForTimeout(400);
  expect(placeSearchCalls).toBe(0);
  await page.getByRole("button", { name: "Submit search" }).click();
  await expect.poll(() => placeSearchCalls).toBe(1);
  await page.locator(".search-results").getByRole("button", { name: /Reykjavík/ }).click();
  await expect(page.locator(".place-card")).toContainText("Iceland");
  await page.getByRole("button", { name: "Close place details" }).click();
  await expect(page.locator(".place-card")).toHaveCount(0);

  await search.fill("Synthetic matched earthquake");
  await page.getByRole("button", { name: "Submit search" }).click();
  await expect(page.getByRole("heading", { name: eventFixture.title })).toBeVisible();
  for (const action of ["Explain", "Known / unknown", "Context"]) await expect(page.getByRole("button", { name: action, exact: true })).toBeDisabled();
  await expect(page.getByText("Disabled in browser tests.")).toBeVisible();
  await page.getByRole("button", { name: "Close event details" }).click();
});

test("all time presets, history scrub/play/pause, save/unsave, persistence, and mobile layout", async ({ page }) => {
  await page.goto("/");
  const timeline = page.getByRole("region", { name: "Historical event timeline" });
  const slider = timeline.getByRole("slider", { name: "Choose historical day offset" });
  for (const [label, max] of [["1H", "29"], ["24H", "29"], ["7D", "23"], ["30D", "0"]]) {
    await timeline.getByRole("button", { name: label, exact: true }).click();
    await expect(slider).toHaveAttribute("max", max);
    expect(new URL(page.url()).searchParams.get("preset")).toBe(label.toLowerCase());
  }
  await timeline.getByRole("button", { name: "24H", exact: true }).click();
  await page.getByRole("button", { name: "Explore historical data" }).click();
  await timeline.getByRole("button", { name: "Select historical offset 4 days ago" }).click();
  await expect(slider).toHaveValue("4");
  await slider.focus();
  await slider.press("End");
  await expect(slider).toHaveValue("29");
  await timeline.getByRole("button", { name: "Play historical timeline" }).click();
  await expect(timeline.getByRole("button", { name: "Pause historical playback" })).toBeVisible();
  await expect(timeline.getByRole("button", { name: "Play historical timeline" })).toBeVisible({ timeout: 5_000 });
  await slider.press("Home");
  await timeline.getByRole("button", { name: "Play historical timeline" }).click();
  await expect.poll(() => slider.inputValue(), { timeout: 4_000 }).toBe("1");
  await timeline.getByRole("button", { name: "Pause historical playback" }).click();
  const paused = await slider.inputValue();
  await page.waitForTimeout(1_600);
  await expect(slider).toHaveValue(paused);
  await page.getByRole("button", { name: "Exit historical exploration" }).click();
  await expect(slider).toBeDisabled();

  await page.getByRole("button", { name: "Map layers and events" }).click();
  await page.locator(".recent-row").filter({ hasText: eventFixture.title }).click();
  await expect(page.getByRole("heading", { name: eventFixture.title })).toBeVisible();
  await page.getByRole("button", { name: "Save event" }).click();
  await expect(page.getByRole("button", { name: "Remove saved event" })).toBeVisible();
  await page.getByRole("button", { name: "Remove saved event" }).click();
  await expect(page.getByRole("button", { name: "Save event" })).toBeVisible();
  await page.getByRole("button", { name: "Save event" }).click();
  await page.getByRole("button", { name: "Close event details" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Saved events" }).click();
  await expect(page.getByRole("heading", { name: "Saved records" })).toBeVisible();
  await expect(page.getByText(eventFixture.title, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const map = page.getByRole("application", { name: "Interactive world event map" });
  await expect(map).toBeVisible();
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.getByRole("button", { name: "Clear local saved records" }).click();
  await expect(page.getByText("No saved records yet")).toBeVisible();
});

test("viewport retry recovers and source-coverage details reveal the source panel", async ({ page }) => {
  let failOnce = true;
  await page.route("**/api/trpc/satnav.viewport**", async route => {
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ error: { json: { message: "Test-only temporary outage", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } } }]) });
      return;
    }
    await route.fallback();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const warning = page.getByRole("status").filter({ hasText: "Event feeds could not be refreshed" });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Retry" }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByText("1 records", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show source coverage" }).click();
  await expect(page.getByRole("region", { name: "Source status" }).getByRole("heading", { name: "Source health" })).toBeVisible();
});

test("basemap failure exposes reload recovery and location permission failures are explained", async ({ page }) => {
  let failFirstStyle = true;
  await page.route("https://tiles.openfreemap.org/styles/**", async route => {
    if (failFirstStyle) {
      failFirstStyle = false;
      await route.fulfill({ status: 503, contentType: "text/plain", body: "Test-only basemap outage" });
      return;
    }
    await route.fallback();
  });
  await page.goto("/");
  const status = page.getByRole("status").filter({ hasText: "Basemap tiles are not responding" });
  await expect(status).toBeVisible({ timeout: 12_000 });
  await status.getByRole("button", { name: "Reload" }).click();
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 12_000 });
  await page.getByRole("button", { name: "Center on my location" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Location permission|location could not|not available/ })).toBeVisible();
});
