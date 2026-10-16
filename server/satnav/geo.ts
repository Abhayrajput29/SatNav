import type { SatnavGeometry, ViewportBounds } from "@shared/satnav";

export interface BBoxPart extends ViewportBounds {}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizeLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function splitViewport(bounds: ViewportBounds): BBoxPart[] {
  const { west, east, south, north } = bounds;
  if (![west, east, south, north].every(Number.isFinite)) throw new Error("Viewport coordinates must be finite");
  if (north <= south || north > 90 || south < -90) throw new Error("Invalid viewport latitude bounds");
  const width = east - west;
  if (width <= 0) throw new Error("Viewport east must be east of west before longitude wrapping");
  if (width >= 359.999) return [{ west: -180, east: 180, south, north }];
  const left = normalizeLongitude(west);
  const right = normalizeLongitude(east);
  if (left <= right) return [{ west: left, east: right, south, north }];
  return [
    { west: left, east: 180, south, north },
    { west: -180, east: right, south, north },
  ];
}

export function viewportToWkt(bounds: BBoxPart): string {
  const south = clamp(bounds.south, -90, 90);
  const north = clamp(bounds.north, -90, 90);
  return `POLYGON((${bounds.west} ${south},${bounds.east} ${south},${bounds.east} ${north},${bounds.west} ${north},${bounds.west} ${south}))`;
}

export function validPosition(value: unknown): value is [number, number, ...number[]] {
  return Array.isArray(value) && value.length >= 2 &&
    typeof value[0] === "number" && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180 &&
    typeof value[1] === "number" && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
}

export function isSatnavGeometry(value: unknown): value is SatnavGeometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as Record<string, unknown>;
  if (geometry.type === "GeometryCollection") {
    return Array.isArray(geometry.geometries) && geometry.geometries.every(isSatnavGeometry);
  }
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates)) return false;
  const positions: unknown[] = [];
  const collect = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (validPosition(node)) positions.push(node);
    else node.forEach(collect);
  };
  collect(coordinates);
  return positions.length > 0;
}

export function pointFromGeometry(geometry: SatnavGeometry | undefined): { longitude: number; latitude: number } | undefined {
  if (!geometry || geometry.type !== "Point" || !validPosition(geometry.coordinates)) return undefined;
  return { longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] };
}

export function geometryIntersectsViewport(geometry: SatnavGeometry | undefined, bounds: ViewportBounds): boolean {
  if (!geometry) return false;
  const positions: [number, number][] = [];
  const collect = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (validPosition(node)) {
      positions.push([node[0], node[1]]);
      return;
    }
    node.forEach(collect);
  };
  const collectGeometry = (item: SatnavGeometry) => {
    if (item.type === "GeometryCollection") item.geometries.forEach(collectGeometry);
    else collect(item.coordinates);
  };
  collectGeometry(geometry);
  if (!positions.length) return false;
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  for (const [, latitude] of positions) {
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
  }
  return splitViewport(bounds).some(part => {
    const centerLongitude = (part.west + part.east) / 2;
    let minLongitude = Infinity;
    let maxLongitude = -Infinity;
    for (const [longitude] of positions) {
      const unwrapped = centerLongitude + normalizeLongitude(longitude - centerLongitude);
      minLongitude = Math.min(minLongitude, unwrapped);
      maxLongitude = Math.max(maxLongitude, unwrapped);
    }
    return minLongitude <= part.east && maxLongitude >= part.west && minLatitude <= part.north && maxLatitude >= part.south;
  });
}

export function bboxKey(bounds: ViewportBounds): string {
  const round = (n: number) => Math.round(n * 10) / 10;
  return [round(bounds.west), round(bounds.south), round(bounds.east), round(bounds.north)].join(",");
}

export function haversineKm(a: { longitude: number; latitude: number }, b: { longitude: number; latitude: number }): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(normalizeLongitude(b.longitude - a.longitude));
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
