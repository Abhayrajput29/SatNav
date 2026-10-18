import { expect, test } from "@playwright/test";

const timestamp = Date.now();
const eventFixture = {
  id: "usgs:us6000u18k",
  clusterId: "incident:usgs:us6000u18k",
  providerId: "us6000u18k",
  category: "earthquake",
  title: "Synthetic matched earthquake fixture (E2E only)",
  description: "Synthetic Playwright test data only. These linked USGS and GDACS records are not live reports.",
  locationLabel: "Test point",
  country: "Test",
  longitude: 12,
  latitude: 24,
  geometry: { type: "Point", coordinates: [12, 24] },
  locationPrecision: "point",
  status: "observed",
  verification: "official-feed",
  startTime: timestamp - 60 * 60 * 1000,
  fetchedAt: timestamp,
  sources: [
    {
      provider: "usgs",
      providerId: "us6000u18k",
      label: "USGS synthetic fixture record",
      publisher: "Playwright test fixture",
      attribution: "Synthetic browser-test data; not a source report.",
      metadata: { depthKm: 12.6, tsunamiFlag: true, pagerAlert: "orange", reviewStatus: "reviewed", feltReports: 19 },
    },
    {
      provider: "gdacs",
      providerId: "1570339",
      label: "GDACS synthetic fixture alert",
      publisher: "Playwright test fixture",
      attribution: "Synthetic browser-test data; not a source report.",
      metadata: { eventType: "EQ", episodeId: "1738684", alertLevel: "Orange", severityText: "Magnitude 7.7M", providerSource: "NEIC", providerSourceId: "fixture-usgs-event" },
    },
  ],
  sourceCount: 2,
  incidentMembers: [
    { id: "usgs:us6000u18k", provider: "usgs", providerId: "us6000u18k", title: "Synthetic USGS earthquake record", locationLabel: "Test point", country: "Test", longitude: 12, latitude: 24, locationPrecision: "point", startTime: timestamp - 60 * 60 * 1000, severityLabel: "M 7.7", severityValue: 7.7, severityScale: "mww" },
    { id: "gdacs:1570339:1738684", provider: "gdacs", providerId: "1570339", title: "Synthetic GDACS earthquake alert", locationLabel: "Test point", country: "Test", longitude: 12, latitude: 24, locationPrecision: "centroid", startTime: timestamp - 59 * 60 * 1000, severityLabel: "Magnitude 7.7M", severityValue: 7.7, severityScale: "M" },
  ],
};

const fixtureSources = [
  {
    provider: "usgs",
    label: "USGS (test fixture)",
    state: "available",
    lastAttemptAt: timestamp,
    lastSuccessAt: timestamp,
    itemCount: 1,
    coverageNote: "Synthetic Playwright fixture only; not live data.",
  },
  {
    provider: "gdacs",
    label: "GDACS (test fixture)",
    state: "available",
    lastAttemptAt: timestamp,
    lastSuccessAt: timestamp,
    itemCount: 1,
    message: "Test-only source status; no live request was made.",
    coverageNote: "Synthetic Playwright fixture only; not live data.",
  },
];

const viewportFixture = {
  events: [eventFixture],
  sources: fixtureSources,
  fetchedAt: timestamp,
  truncated: false,
  coverageNote: "Playwright synthetic fixture only. This response is intercepted and is not live event data.",
  mode: "partial",
};

const testStyle = {
  version: 8,
  name: "SATNAV deterministic E2E style",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {},
  layers: [{ id: "test-background", type: "background", paint: { "background-color": "#0b1017" } }],
};

function responseFor(path: string): unknown {
  const procedure = path.split(".").at(-1);
  if (procedure === "viewport") return viewportFixture;
  if (procedure === "sources") return fixtureSources;
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
    const routePath = decodeURIComponent(url.pathname.slice(url.pathname.indexOf("/api/trpc/") + "/api/trpc/".length));
    const paths = routePath.split(",").filter(Boolean);
    const result = paths.map(path => ({ result: { data: { json: responseFor(path) } } }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
});

test("map renders, selects a synthetic matched USGS/GDACS event, pans and zooms with shareable view state", async ({ page }) => {
  await page.goto("/");
  const map = page.getByRole("application", { name: "Interactive world event map" });
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(map).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(page.getByText("1 records", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset to world view" })).toBeVisible();

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const centerX = box!.x + box!.width / 2;
  const centerY = box!.y + box!.height / 2;
  await page.mouse.click(centerX, centerY);
  await expect(page.getByRole("heading", { name: eventFixture.title })).toBeVisible();
  await expect(page.getByText(/Synthetic Playwright test data/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Related provider records" })).toBeVisible();
  await expect(page.getByText("Multiple feed records · not independent corroboration")).toBeVisible();
  await expect(page.getByText("USGS tsunami flag: Yes")).toBeVisible();
  await expect(page.getByText("GDACS event type: EQ")).toBeVisible();
  await expect(page.getByText("GDACS event ID: 1570339")).toBeVisible();
  await expect(page.getByText("GDACS episode ID: 1738684")).toBeVisible();
  await expect(page.getByText("GDACS upstream source: NEIC")).toBeVisible();
  await expect(page.getByText("GDACS upstream source ID: fixture-usgs-event")).toBeVisible();

  await page.getByRole("button", { name: "Close event details" }).click();
  const previousLongitude = new URL(page.url()).searchParams.get("lon");
  await page.mouse.move(centerX - 20, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 100, centerY + 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => new URL(page.url()).searchParams.get("lon"), { timeout: 8_000 }).not.toBe(previousLongitude);

  const previousZoom = new URL(page.url()).searchParams.get("z");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("z"), { timeout: 8_000 }).not.toBe(previousZoom);
});

test("timeline presets, historical scrubbing, and play/pause update the day offset", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("application", { name: "Interactive world event map" })).toBeVisible();

  await page.getByRole("button", { name: "Explore historical data" }).click();
  const timeline = page.getByRole("region", { name: "Historical event timeline" });
  await expect(timeline.getByText("Historical exploration")).toBeVisible();
  const slider = timeline.getByRole("slider", { name: "Choose historical day offset" });
  await expect(slider).toBeEnabled();
  await expect(slider).toHaveAttribute("max", "29");

  await timeline.getByRole("button", { name: "7D", exact: true }).click();
  await expect(slider).toHaveAttribute("max", "23");
  await slider.focus();
  for (let index = 0; index < 4; index++) await slider.press("ArrowRight");
  await expect(slider).toHaveValue("4");
  await expect(timeline.getByText(/4 DAYS AGO/)).toBeVisible();

  await timeline.getByRole("button", { name: "Play historical timeline" }).click();
  await expect(timeline.getByRole("button", { name: "Pause historical playback" })).toBeVisible();
  await expect.poll(() => slider.inputValue(), { timeout: 5_000 }).toBe("5");
  await timeline.getByRole("button", { name: "Pause historical playback" }).click();
  const pausedValue = await slider.inputValue();
  await page.waitForTimeout(1_600);
  await expect(slider).toHaveValue(pausedValue);
});

test("category filters update visible records and saved events can be removed locally", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("application", { name: "Interactive world event map" })).toBeVisible();
  await expect(page.getByText("1 records", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Map layers and events" }).click();
  const earthquakeRow = page.locator(".layer-row").filter({ hasText: "Earthquakes" });
  await expect(earthquakeRow.getByRole("checkbox")).toBeChecked();
  await expect(page.locator(".recent-row").filter({ hasText: eventFixture.title }).locator(".recent-source")).toHaveText("USGS · GDACS (NEIC)");
  await earthquakeRow.getByRole("checkbox").uncheck();
  await expect(page.getByText("0 records", { exact: true })).toBeVisible();
  await earthquakeRow.getByRole("checkbox").check();
  await expect(page.getByText("1 records", { exact: true })).toBeVisible();

  const canvas = page.locator("canvas.maplibregl-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.getByRole("heading", { name: eventFixture.title })).toBeVisible();
  await page.getByRole("button", { name: "Save event" }).click();
  await page.getByRole("button", { name: "Close event details" }).click();
  await page.getByRole("button", { name: "Saved events" }).click();
  await expect(page.getByRole("heading", { name: "Saved records" })).toBeVisible();
  await expect(page.getByText(eventFixture.title, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear local saved records" }).click();
  await expect(page.getByText("No saved records yet")).toBeVisible();
});
