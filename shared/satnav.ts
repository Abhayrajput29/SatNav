export const SATNAV_CATEGORIES = [
  "earthquake",
  "flood",
  "cyclone",
  "wildfire",
  "volcano",
  "tsunami",
  "drought",
  "news",
  "other",
] as const;

export type SatnavCategory = (typeof SATNAV_CATEGORIES)[number];
export type SatnavProvider = "usgs" | "gdacs" | "gdelt" | "nominatim";
export type EventStatus = "observed" | "alert" | "forecast" | "report";
export type LocationPrecision = "point" | "centroid" | "area" | "regional" | "unknown";
export type VerificationStatus = "official-feed" | "single-source" | "unverified" | "conflicting";
export type SourceState = "pending" | "available" | "degraded" | "unavailable" | "unconfigured";
export type ExplainAction = "summary" | "uncertainty" | "background";

export type Position = [number, number, ...number[]];
export type SatnavGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "GeometryCollection"; geometries: SatnavGeometry[] };

export interface SatnavSourceRef {
  provider: SatnavProvider;
  label: string;
  url?: string;
  publisher?: string;
  providerId?: string;
  publishedAt?: number;
  updatedAt?: number;
  attribution: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface IncidentMember {
  id: string;
  provider: SatnavProvider;
  providerId: string;
  title: string;
  locationLabel?: string;
  country?: string;
  longitude?: number;
  latitude?: number;
  locationPrecision: LocationPrecision;
  startTime?: number;
  endTime?: number;
  severityLabel?: string;
  severityValue?: number;
  severityScale?: string;
}

export interface RelatedArticle {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt?: number;
  language?: string;
}

export interface SatnavEvent {
  id: string;
  clusterId: string;
  providerId: string;
  category: SatnavCategory;
  title: string;
  description?: string;
  locationLabel?: string;
  country?: string;
  longitude?: number;
  latitude?: number;
  geometry?: SatnavGeometry;
  locationPrecision: LocationPrecision;
  status: EventStatus;
  verification: VerificationStatus;
  severityLabel?: string;
  severityValue?: number;
  severityScale?: string;
  startTime?: number;
  endTime?: number;
  publishedAt?: number;
  providerUpdatedAt?: number;
  fetchedAt: number;
  sources: SatnavSourceRef[];
  relatedArticles?: RelatedArticle[];
  sourceCount: number;
  incidentMembers?: IncidentMember[];
}

export interface ProviderHealth {
  provider: SatnavProvider;
  label: string;
  state: SourceState;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  itemCount: number;
  message?: string;
  coverageNote: string;
}

export interface ViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ViewportEventsResult {
  events: SatnavEvent[];
  sources: ProviderHealth[];
  fetchedAt: number;
  truncated: boolean;
  coverageNote: string;
  mode: "live" | "partial" | "stale";
  staleAgeMs?: number;
}

export interface PlaceResult {
  id: string;
  label: string;
  longitude: number;
  latitude: number;
  precision: "address" | "place" | "region" | "unknown";
  attribution: string;
}
