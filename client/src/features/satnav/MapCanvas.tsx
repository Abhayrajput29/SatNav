import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Map as MapLibreMap, MapGeoJSONFeature, GeoJSONSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { SATNAV_CATEGORIES } from "@shared/satnav";
import type { SatnavCategory, SatnavEvent, ViewportBounds } from "@shared/satnav";

const STYLE_URLS = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  fiord: "https://tiles.openfreemap.org/styles/fiord",
} as const;
export type MapStyleName = keyof typeof STYLE_URLS;

export interface MapCanvasHandle {
  resetWorld: () => void;
  flyTo: (longitude: number, latitude: number, zoom?: number) => void;
  getCenter: () => { longitude: number; latitude: number; zoom: number } | undefined;
}
interface MapCanvasProps {
  events: SatnavEvent[];
  selectedEventId?: string;
  styleName: MapStyleName;
  onViewportChange: (bounds: ViewportBounds) => void;
  onSelectEvent: (eventId: string) => void;
}
type EventFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: NonNullable<SatnavEvent["geometry"]>;
    properties: Record<string, string | number | boolean | null>;
  }>;
};

const COLORS: Record<SatnavCategory, string> = {
  earthquake: "#ff9f68",
  flood: "#4ec8ed",
  cyclone: "#9a8cff",
  wildfire: "#ff6b62",
  volcano: "#f48c51",
  tsunami: "#3db9ec",
  drought: "#dbcb77",
  news: "#b09fff",
  other: "#a6b4c6",
};
const LETTERS: Record<SatnavCategory, string> = {
  earthquake: "Q",
  flood: "F",
  cyclone: "C",
  wildfire: "W",
  volcano: "V",
  tsunami: "T",
  drought: "D",
  news: "N",
  other: "•",
};
const eventLayerIds = SATNAV_CATEGORIES.flatMap(category => [
  `satnav-event-point-${category}`,
  `satnav-event-glyph-${category}`,
  `satnav-event-area-${category}`,
]);
const interactiveLayerIds = ["satnav-clusters", ...eventLayerIds];

function toFeatureCollection(events: SatnavEvent[]): EventFeatureCollection {
  const features: EventFeatureCollection["features"] = [];
  for (const event of events) {
    const geometry = event.geometry ?? (event.longitude !== undefined && event.latitude !== undefined
      ? { type: "Point" as const, coordinates: [event.longitude, event.latitude] as [number, number] }
      : undefined);
    if (!geometry) continue;
    features.push({
      type: "Feature",
      geometry,
      properties: {
        eventId: event.id,
        category: event.category,
        title: event.title,
        precision: event.locationPrecision,
        sourceCount: event.sourceCount,
        status: event.status,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas({ events, selectedEventId, styleName, onViewportChange, onSelectEvent }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const featureRef = useRef<EventFeatureCollection>(toFeatureCollection(events));
  const viewportCallback = useRef(onViewportChange);
  const selectCallback = useRef(onSelectEvent);
  const selectedIdRef = useRef(selectedEventId);
  const styleNameRef = useRef(styleName);
  const mapLoadedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  viewportCallback.current = onViewportChange;
  selectCallback.current = onSelectEvent;
  selectedIdRef.current = selectedEventId;
  styleNameRef.current = styleName;
  featureRef.current = toFeatureCollection(events);

  const readBounds = useCallback((map: MapLibreMap) => {
    const bounds = map.getBounds();
    viewportCallback.current({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() });
  }, []);

  useImperativeHandle(ref, () => ({
    resetWorld() { mapRef.current?.flyTo({ center: [0, 20], zoom: 1.8, essential: true }); },
    flyTo(longitude, latitude, zoom = 7) { mapRef.current?.flyTo({ center: [longitude, latitude], zoom, essential: true }); },
    getCenter() {
      const map = mapRef.current;
      if (!map) return undefined;
      const center = map.getCenter();
      return { longitude: center.lng, latitude: center.lat, zoom: map.getZoom() };
    },
  }), []);

  useEffect(() => {
    let disposed = false;
    let mapForCleanup: MapLibreMap | null = null;
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    const container = containerRef.current;
    if (!container) return;

    void import("maplibre-gl").then(module => {
      if (disposed) return;
      module.setWorkerUrl(workerUrl);
      const params = new URLSearchParams(window.location.search);
      const urlLon = Number(params.get("lon"));
      const urlLat = Number(params.get("lat"));
      const urlZoom = Number(params.get("z"));
      const validUrlView = params.has("lon") && params.has("lat") && Number.isFinite(urlLon) && Math.abs(urlLon) <= 180 && Number.isFinite(urlLat) && Math.abs(urlLat) <= 85;
      const map = new module.Map({
        container,
        style: STYLE_URLS[styleNameRef.current],
        center: validUrlView ? [urlLon, urlLat] : [12, 24],
        zoom: params.has("z") && Number.isFinite(urlZoom) ? Math.min(17, Math.max(1, urlZoom)) : 1.9,
        minZoom: 1,
        maxZoom: 18,
        renderWorldCopies: true,
        attributionControl: false,
        fadeDuration: 150,
        cooperativeGestures: true,
      });
      mapForCleanup = map;
      mapRef.current = map;
      map.addControl(new module.NavigationControl({ showCompass: true, visualizePitch: false }), "top-right");
      map.addControl(new module.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
      map.addControl(new module.AttributionControl({ compact: true, customAttribution: "© OpenFreeMap · © OpenStreetMap contributors" }), "bottom-right");

      const installLayers = () => {
        if (!map.isStyleLoaded()) return;
        if (!map.getSource("satnav-events")) {
          map.addSource("satnav-events", {
            type: "geojson",
            data: featureRef.current as never,
            cluster: true,
            clusterRadius: 42,
            clusterMaxZoom: 10,
          });
        }
        if (!map.getLayer("satnav-clusters")) {
          map.addLayer({
            id: "satnav-clusters",
            type: "circle",
            source: "satnav-events",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": ["step", ["get", "point_count"], "#2979ff", 20, "#7265db", 60, "#e18354"],
              "circle-radius": ["step", ["get", "point_count"], 17, 20, 21, 60, 26],
              "circle-opacity": 0.88,
              "circle-stroke-color": "#d9e7ff",
              "circle-stroke-width": 1.2,
            },
          });
          map.addLayer({
            id: "satnav-cluster-count",
            type: "symbol",
            source: "satnav-events",
            filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11, "text-font": ["Noto Sans Regular"] },
            paint: { "text-color": "#fff" },
          });
        }
        for (const category of SATNAV_CATEGORIES) {
          const areaId = `satnav-event-area-${category}`;
          if (!map.getLayer(areaId)) {
            map.addLayer({
              id: areaId,
              type: "fill",
              source: "satnav-events",
              filter: ["==", ["get", "category"], category],
              paint: { "fill-color": COLORS[category], "fill-opacity": 0.2 },
            });
            map.addLayer({
              id: `satnav-event-area-outline-${category}`,
              type: "line",
              source: "satnav-events",
              filter: ["==", ["get", "category"], category],
              paint: { "line-color": COLORS[category], "line-width": 1.5, "line-opacity": 0.75 },
            });
          }
          const pointId = `satnav-event-point-${category}`;
          if (!map.getLayer(pointId)) {
            map.addLayer({
              id: pointId,
              type: "circle",
              source: "satnav-events",
              filter: ["all", ["==", ["get", "category"], category], ["!", ["has", "point_count"]]],
              paint: {
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 5, 5, 7, 10, 9],
                "circle-color": COLORS[category],
                "circle-opacity": ["case", ["==", ["get", "precision"], "centroid"], 0.68, 0.96],
                "circle-stroke-color": "#101722",
                "circle-stroke-width": 1.6,
              },
            });
            map.addLayer({
              id: `satnav-event-glyph-${category}`,
              type: "symbol",
              source: "satnav-events",
              filter: ["all", ["==", ["get", "category"], category], ["!", ["has", "point_count"]]],
              layout: { "text-field": LETTERS[category], "text-font": ["Noto Sans Regular"], "text-size": 9, "text-allow-overlap": true, "text-ignore-placement": true },
              paint: { "text-color": "#111821" },
            });
          }
        }
        if (!map.getLayer("satnav-selected-event")) {
          map.addLayer({
            id: "satnav-selected-event",
            type: "circle",
            source: "satnav-events",
            filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "eventId"], selectedIdRef.current ?? ""]],
            paint: { "circle-radius": 13, "circle-color": "#56d8e5", "circle-opacity": 0.18, "circle-stroke-color": "#76e6f2", "circle-stroke-width": 2 },
          });
        }
        const source = map.getSource("satnav-events") as GeoJSONSource | undefined;
        source?.setData(featureRef.current as never);
        if (map.getLayer("satnav-selected-event")) map.setFilter("satnav-selected-event", ["all", ["!", ["has", "point_count"]], ["==", ["get", "eventId"], selectedIdRef.current ?? ""]]);
      };

      const markStyleReady = () => {
        if (disposed) return;
        mapLoadedRef.current = true;
        setMapReady(true);
        setMapError(null);
        installLayers();
      };
      map.on("style.load", markStyleReady);
      map.on("load", () => {
        if (disposed) return;
        markStyleReady();
        readBounds(map);
      });
      map.on("moveend", () => {
        if (disposed) return;
        if (moveTimer) clearTimeout(moveTimer);
        moveTimer = setTimeout(() => {
          if (disposed) return;
          readBounds(map);
          const center = map.getCenter();
          const url = new URL(window.location.href);
          url.searchParams.set("lon", center.lng.toFixed(4));
          url.searchParams.set("lat", center.lat.toFixed(4));
          url.searchParams.set("z", map.getZoom().toFixed(2));
          window.history.replaceState({ ...window.history.state, satnavView: true }, "", url);
        }, 280);
      });
      map.on("click", event => {
        const layers = interactiveLayerIds.filter(id => Boolean(map.getLayer(id)));
        if (!layers.length) return;
        const features = map.queryRenderedFeatures(event.point, { layers });
        const feature = features[0] as MapGeoJSONFeature | undefined;
        if (!feature) return;
        const properties = feature.properties ?? {};
        if (properties.point_count !== undefined && properties.cluster_id !== undefined) {
          const source = map.getSource("satnav-events") as GeoJSONSource | undefined;
          void source?.getClusterExpansionZoom(Number(properties.cluster_id)).then(zoom => {
            if (feature.geometry.type === "Point") map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom: Math.min(zoom + 0.25, 18), duration: 500 });
          }).catch(() => undefined);
          return;
        }
        if (typeof properties.eventId === "string") selectCallback.current(properties.eventId);
      });
      map.on("mousemove", event => {
        const layers = interactiveLayerIds.filter(id => Boolean(map.getLayer(id)));
        container.style.cursor = layers.length && map.queryRenderedFeatures(event.point, { layers }).length ? "pointer" : "";
      });
      map.on("error", () => {
        if (!disposed && !mapLoadedRef.current) setMapError("Basemap tiles are not responding. Event queries and map controls remain available.");
      });
    }).catch(() => {
      if (!disposed) setMapError("The interactive map could not initialize in this browser. Check WebGL support and reload.");
    });

    return () => {
      disposed = true;
      if (moveTimer) clearTimeout(moveTimer);
      mapForCleanup?.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
    };
    // The map is initialized once; current values flow through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    mapLoadedRef.current = false;
    setMapReady(false);
    setMapError(null);
    map.setStyle(STYLE_URLS[styleName]);
  }, [styleName]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("satnav-events") as GeoJSONSource | undefined;
    source?.setData(featureRef.current as never);
    if (map.getLayer("satnav-selected-event")) map.setFilter("satnav-selected-event", ["all", ["!", ["has", "point_count"]], ["==", ["get", "eventId"], selectedEventId ?? ""]]);
  }, [events, selectedEventId]);

  return (
    <div className="map-canvas" ref={containerRef} role="application" aria-label="Interactive world event map" tabIndex={0}>
      {!mapReady && !mapError && <div className="map-loading"><span className="spinner" />Preparing interactive map</div>}
      {mapError && <div className="map-status" role="status"><span>{mapError}</span><button type="button" onClick={() => window.location.reload()}>Reload</button></div>}
    </div>
  );
});

export default MapCanvas;
