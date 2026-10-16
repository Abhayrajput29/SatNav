import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Bookmark, Check, ChevronDown, Clock3, Compass, Copy, ExternalLink,
  Globe2, Layers, LocateFixed, MapPin, Navigation, Play, Pause, Radio, RefreshCw,
  RotateCcw, Search, Settings2, Shield, X,
} from "lucide-react";
import { SATNAV_CATEGORIES } from "@shared/satnav";
import type { ExplainAction, PlaceResult, ProviderHealth, SatnavCategory, SatnavEvent, ViewportBounds } from "@shared/satnav";
import { trpc } from "@/lib/trpc";
import { formatUtcDate, formatUtcTime } from "@/lib/time";
import MapCanvas, { type MapCanvasHandle, type MapStyleName } from "../features/satnav/MapCanvas";
import EventDetails from "../features/satnav/EventDetails";

const DAY = 24 * 60 * 60 * 1000;
const PRESETS = [
  { id: "1h", label: "1H", duration: 60 * 60 * 1000 },
  { id: "24h", label: "24H", duration: DAY },
  { id: "7d", label: "7D", duration: 7 * DAY },
  { id: "30d", label: "30D", duration: 30 * DAY },
] as const;
type Preset = (typeof PRESETS)[number]["id"];
type SidePanel = "layers" | "saved" | "sources" | null;
const CATEGORY_META: Record<SatnavCategory, { label: string; color: string; glyph: string }> = {
  earthquake: { label: "Earthquakes", color: "#ff9f68", glyph: "🌍" },
  flood: { label: "Floods", color: "#4ec8ed", glyph: "💧" },
  cyclone: { label: "Cyclones", color: "#9a8cff", glyph: "🌀" },
  wildfire: { label: "Fire detections", color: "#ff6b62", glyph: "🔥" },
  volcano: { label: "Volcanic activity", color: "#f48c51", glyph: "🌋" },
  tsunami: { label: "Tsunami alerts", color: "#3db9ec", glyph: "🌊" },
  drought: { label: "Drought", color: "#dbcb77", glyph: "☀" },
  news: { label: "News events", color: "#b09fff", glyph: "📰" },
  other: { label: "Other disaster alerts", color: "#a6b4c6", glyph: "⚠" },
};
const DEFAULT_BOUNDS: ViewportBounds = { west: -180, south: -85, east: 180, north: 85 };
const SAVED_KEY = "satnav:saved-events:v1";

function readSavedEvents(): SatnavEvent[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is SatnavEvent => Boolean(value && typeof value === "object" && "id" in value && "title" in value)).slice(0, 25) : [];
  } catch { return []; }
}
const fmtTime = formatUtcTime;
function fmtCount(value: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value); }
function providerLabel(provider: ProviderHealth["provider"]) {
  return provider === "usgs" ? "USGS" : provider === "gdacs" ? "GDACS" : provider === "gdelt" ? "GDELT" : provider.toUpperCase();
}
function sourceStateLabel(state: ProviderHealth["state"]) {
  return state === "available" ? "Checked" : state === "pending" ? "Waiting" : state === "degraded" ? "Cached" : state === "unconfigured" ? "Not configured" : "Unavailable";
}
function withinWindow(event: SatnavEvent, startAt: number, endAt: number) {
  const start = event.startTime ?? event.publishedAt ?? event.fetchedAt;
  const end = event.endTime ?? start;
  return start <= endAt && end >= startAt;
}
function eventSearchLabel(event: SatnavEvent) {
  return `${event.title} ${event.locationLabel ?? ""} ${event.country ?? ""}`.trim();
}

export default function Home() {
  const mapRef = useRef<MapCanvasHandle>(null);
  const [viewport, setViewport] = useState<ViewportBounds>();
  const [styleName, setStyleName] = useState<MapStyleName>("dark");
  const [timeAnchor, setTimeAnchor] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const [preset, setPreset] = useState<Preset>(() => {
    const p = new URLSearchParams(window.location.search).get("preset");
    return p === "1h" || p === "24h" || p === "7d" || p === "30d" ? (p as Preset) : "24h";
  });
  const [historyMode, setHistoryMode] = useState(false);
  const [historyOffsetDays, setHistoryOffsetDays] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [enabledCategories, setEnabledCategories] = useState<Set<SatnavCategory>>(() => new Set(SATNAV_CATEGORIES));
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(() => {
    return new URLSearchParams(window.location.search).get("event") ?? undefined;
  });
  const [eventSort, setEventSort] = useState<"time" | "severity">("time");
  const [savedEvents, setSavedEvents] = useState<SatnavEvent[]>(readSavedEvents);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult>();
  const [copied, setCopied] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [nowLabel, setNowLabel] = useState(() => new Date().toISOString().slice(11, 19));

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTimeAnchor(Math.floor(now / 60_000) * 60_000);
      setNowLabel(new Date(now).toISOString().slice(11, 19));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedEventId) {
      url.searchParams.set("event", selectedEventId);
    } else {
      url.searchParams.delete("event");
    }
    url.searchParams.set("preset", preset);
    window.history.replaceState({ ...window.history.state, satnavMeta: true }, "", url);
  }, [selectedEventId, preset]);

  const rangeMs = PRESETS.find(item => item.id === preset)!.duration;
  const maxHistoryOffset = Math.max(0, 30 - Math.ceil(rangeMs / DAY));
  const selectedEndAt = timeAnchor - historyOffsetDays * DAY;
  const selectedStartAt = selectedEndAt - rangeMs;
  const fetchStartAt = historyMode ? timeAnchor - 30 * DAY : selectedStartAt;
  const fetchEndAt = timeAnchor;
  const viewportInput = useMemo(() => ({ bounds: viewport ?? DEFAULT_BOUNDS, startAt: fetchStartAt, endAt: fetchEndAt }), [viewport, fetchStartAt, fetchEndAt]);
  const viewportQuery = trpc.satnav.viewport.useQuery(viewportInput, {
    enabled: Boolean(viewport),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const sourceQuery = trpc.satnav.sources.useQuery(undefined, { staleTime: 60_000, retry: false });
  const aiStatusQuery = trpc.satnav.aiStatus.useQuery(undefined, { staleTime: 5 * 60_000, retry: false });
  const debouncedSearchQuery = trpc.satnav.searchEvents.useQuery({ query: debouncedSearch.length >= 2 ? debouncedSearch : "__" }, {
    enabled: debouncedSearch.length >= 2,
    staleTime: 30_000,
    retry: false,
  });
  const placeSearch = trpc.satnav.searchPlace.useMutation();
  const explainMutation = trpc.satnav.explain.useMutation();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [searchText]);
  useEffect(() => {
    if (!historyMode) setIsPlaying(false);
  }, [historyMode]);
  useEffect(() => {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(savedEvents.slice(0, 25))); } catch { /* Local saving is optional in restricted browsers. */ }
  }, [savedEvents]);
  useEffect(() => {
    if (!isPlaying || !historyMode || maxHistoryOffset <= 0) return;
    const timer = window.setInterval(() => setHistoryOffsetDays(current => {
      if (current >= maxHistoryOffset) { setIsPlaying(false); return maxHistoryOffset; }
      return current + 1;
    }), 1_400);
    return () => window.clearInterval(timer);
  }, [isPlaying, historyMode, maxHistoryOffset]);

  const allEvents = viewportQuery.data?.events ?? [];
  const activeEvents = useMemo(() => {
    const inWindow = allEvents.filter(event => withinWindow(event, selectedStartAt, selectedEndAt));
    return inWindow.filter(event => enabledCategories.has(event.category));
  }, [allEvents, selectedStartAt, selectedEndAt, enabledCategories]);
  const eventSearchResults = debouncedSearchQuery.data ?? [];
  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return undefined;
    return allEvents.find(event => event.id === selectedEventId)
      ?? eventSearchResults.find(event => event.id === selectedEventId)
      ?? savedEvents.find(event => event.id === selectedEventId);
  }, [selectedEventId, allEvents, eventSearchResults, savedEvents]);
  const visibleOnMap = useMemo(() => {
    if (!selectedEvent || activeEvents.some(event => event.id === selectedEvent.id)) return activeEvents;
    return [...activeEvents, selectedEvent];
  }, [activeEvents, selectedEvent]);
  const sources = viewportQuery.data?.sources ?? sourceQuery.data ?? [];
  const aiAvailable = Boolean(aiStatusQuery.data?.available);
  const explanationResult = explainMutation.data?.eventId === selectedEvent?.id ? explainMutation.data : undefined;
  const statusMode = viewportQuery.data?.mode ?? "stale";
  const feedLabel = statusMode === "live" ? "FEEDS CHECKED"
    : statusMode === "partial" ? "PARTIAL DATA"
    : viewportQuery.data?.events.length ? "CACHED / LIMITED"
    : !viewportQuery.data && viewportQuery.isFetching ? "CHECKING FEEDS"
    : viewportQuery.error || viewportQuery.data ? "FEEDS UNAVAILABLE"
    : "MAP READY";
  const eventCount = activeEvents.length;
  const searchOpenNow = searchOpen && searchText.trim().length > 0;
  const matchingLocalEvents = eventSearchResults.slice(0, 6);
  const placeResults = placeSearch.data ?? [];
  const density = useMemo(() => {
    const counts = Array.from({ length: 30 }, () => 0);
    for (const event of allEvents) {
      const stamp = event.startTime ?? event.publishedAt ?? event.fetchedAt;
      const daysAgo = Math.floor((timeAnchor - stamp) / DAY);
      if (daysAgo >= 0 && daysAgo < 30) counts[29 - daysAgo]++;
    }
    const peak = Math.max(1, ...counts);
    return counts.map(count => count / peak);
  }, [allEvents, timeAnchor]);

  const handleViewportChange = (bounds: ViewportBounds) => {
    const round = (value: number) => Math.round(value * 10) / 10;
    setViewport({ west: round(bounds.west), south: round(bounds.south), east: round(bounds.east), north: round(bounds.north) });
  };
  const selectEvent = (event: SatnavEvent) => {
    setSelectedEventId(event.id);
    setSelectedPlace(undefined);
    setSidePanel(null);
    setSearchOpen(false);
    if (event.longitude !== undefined && event.latitude !== undefined) mapRef.current?.flyTo(event.longitude, event.latitude, 6.5);
  };
  const selectPlace = (place: PlaceResult) => {
    setSelectedPlace(place);
    setSelectedEventId(undefined);
    setSearchOpen(false);
    placeSearch.reset();
    mapRef.current?.flyTo(place.longitude, place.latitude, place.precision === "address" ? 14 : place.precision === "region" ? 5 : 9);
  };
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = searchText.trim();
    if (term.length < 2) return;
    const firstEvent = matchingLocalEvents[0] ?? activeEvents.find(item => eventSearchLabel(item).toLowerCase().includes(term.toLowerCase()));
    if (firstEvent) { selectEvent(firstEvent); return; }
    if (placeResults[0]) { selectPlace(placeResults[0]); return; }
    if (term.length >= 3 && !placeSearch.isPending) placeSearch.mutate({ query: term });
    setSearchOpen(true);
  };
  const toggleCategory = (category: SatnavCategory) => {
    setEnabledCategories(current => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category); else next.add(category);
      return next;
    });
  };
  const toggleSaved = () => {
    if (!selectedEvent) return;
    setSavedEvents(current => current.some(event => event.id === selectedEvent.id)
      ? current.filter(event => event.id !== selectedEvent.id)
      : [selectedEvent, ...current].slice(0, 25));
  };
  const isSaved = Boolean(selectedEvent && savedEvents.some(event => event.id === selectedEvent.id));
  const locateMe = () => {
    setLocationMessage("");
    if (!navigator.geolocation) { setLocationMessage("Location is not available in this browser."); return; }
    navigator.geolocation.getCurrentPosition(position => {
      mapRef.current?.flyTo(position.coords.longitude, position.coords.latitude, 9);
      setLocationMessage("Centered on your device location; it was not saved.");
    }, error => {
      setLocationMessage(error.code === error.PERMISSION_DENIED ? "Location permission was not granted." : "Current location could not be determined.");
    }, { enableHighAccuracy: false, timeout: 8_000, maximumAge: 60_000 });
  };
  const copyCoordinates = async () => {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    const text = `${center.latitude.toFixed(4)}, ${center.longitude.toFixed(4)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch { setLocationMessage(`Coordinates: ${text}`); }
  };
  const handleExplain = (action: ExplainAction) => {
    if (!selectedEvent) return;
    explainMutation.mutate({ eventId: selectedEvent.id, action });
  };
  const selectedRangeLabel = historyMode && historyOffsetDays > 0
    ? `${historyOffsetDays}d before now · ${preset.toUpperCase()} window`
    : historyMode ? `Historical viewport · ${preset.toUpperCase()} window` : `Past ${preset.toUpperCase()}`;

  return (
    <main className="satnav-app">
      <header className="satnav-topbar">
        <a className="brand-lockup" href="/" aria-label="SATNAV home">
          <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M20 3.5 23 16.7 36.5 20l-13.5 3.3L20 36.5l-3-13.2L3.5 20l13.5-3.3L20 3.5Z"/><circle cx="20" cy="20" r="3.3"/></svg></span>
          <span className="brand-text"><strong>SATNAV</strong><small>GLOBAL EVENT INTELLIGENCE</small></span>
        </a>

        <div className="search-wrap">
        <form className="global-search" onSubmit={submitSearch} role="search">
            <Search size={16} aria-hidden="true" />
            <input value={searchText} onChange={event => { setSearchText(event.target.value); setSearchOpen(true); placeSearch.reset(); }} onFocus={() => setSearchOpen(true)} placeholder="Search places or events…" aria-label="Search places and events" aria-expanded={searchOpenNow} aria-controls="search-results" />
            <kbd>ENTER</kbd>
            <button type="submit" aria-label="Submit search"><Navigation size={15} /></button>
          </form>
          {searchOpenNow && <div className="search-results panel-glass" id="search-results">
            {matchingLocalEvents.length > 0 && <section><div className="search-section-title">EVENTS IN YOUR RECORDS</div>{matchingLocalEvents.map(event => <button type="button" className="search-result" key={event.id} onClick={() => selectEvent(event)}><span className="result-glyph" style={{ "--category-color": CATEGORY_META[event.category].color } as React.CSSProperties}>{CATEGORY_META[event.category].glyph}</span><span><strong>{event.title}</strong><small>{event.locationLabel ?? "Location not supplied"} · {fmtTime(event.startTime ?? event.fetchedAt)}</small></span></button>)}</section>}
            {placeResults.length > 0 && <section><div className="search-section-title">PLACE RESULTS · © OPENSTREETMAP</div>{placeResults.map(place => <button type="button" className="search-result" key={place.id} onClick={() => selectPlace(place)}><span className="result-glyph place-glyph"><MapPin size={14} /></span><span><strong>{place.label.split(",")[0]}</strong><small>{place.label}</small></span></button>)}</section>}
            {debouncedSearch.length >= 2 && matchingLocalEvents.length === 0 && !placeSearch.isPending && placeResults.length === 0 && <p className="search-hint">Press Enter to search public place names. Do not enter personal or confidential information.</p>}
            {placeSearch.isPending && <p className="search-hint"><span className="spinner spinner-small" /> Searching public place names…</p>}
            {placeSearch.error && <p className="search-error">{placeSearch.error.message}</p>}
            {debouncedSearch.length < 2 && <p className="search-hint">Search stored event records, or submit a public place name. Remote autocomplete is disabled.</p>}
          </div>}
        </div>

        <div className="topbar-meta">
          <div className="utc-clock"><span>UTC</span><time>{nowLabel}</time></div>
          <div className={`feed-state feed-${statusMode}`} role="status" aria-live="polite" title={viewportQuery.data?.coverageNote ?? "Public data feeds"}><span className="pulse-dot" />{feedLabel}</div>
          <button className="top-icon-button" type="button" title="Map settings" aria-label="Open map settings" onClick={() => setSidePanel(current => current === "sources" ? null : "sources")}><Settings2 size={17} /></button>
        </div>
      </header>

      <div className="satnav-workspace" onClick={() => { if (searchOpen) setSearchOpen(false); }}>
        <nav className="side-rail" aria-label="Main navigation" onClick={event => event.stopPropagation()}>
          <div className="rail-main">
            <button className={`rail-button ${sidePanel === "layers" ? "active" : ""}`} type="button" aria-label="Map layers and events" title="Layers and events" onClick={() => setSidePanel(current => current === "layers" ? null : "layers")}><Layers size={19} /><span>Layers</span></button>
            <button className={`rail-button ${historyMode ? "active" : ""}`} type="button" aria-label={historyMode ? "Exit historical exploration" : "Explore historical data"} title="History" onClick={() => { setHistoryMode(value => !value); setHistoryOffsetDays(0); setSidePanel(null); }}><Clock3 size={19} /><span>History</span></button>
            <button className={`rail-button ${sidePanel === "saved" ? "active" : ""}`} type="button" aria-label="Saved events" title="Saved" onClick={() => setSidePanel(current => current === "saved" ? null : "saved")}><Bookmark size={19} /><span>Saved</span></button>
            <button className={`rail-button ${sidePanel === "sources" ? "active" : ""}`} type="button" aria-label="Source health" title="Sources" onClick={() => setSidePanel(current => current === "sources" ? null : "sources")}><Radio size={19} /><span>Sources</span></button>
          </div>
          <div className="rail-bottom"><span className="rail-divider" /><div className="rail-product"><span className="product-dot" /><small>MAP</small></div><span className="rail-version">0.1</span></div>
        </nav>

        <section className="map-stage" aria-label="SATNAV map workspace">
          <MapCanvas ref={mapRef} events={visibleOnMap} selectedEventId={selectedEventId} styleName={styleName} onViewportChange={handleViewportChange} onSelectEvent={id => setSelectedEventId(id)} />

          <div className="map-top-left" onClick={event => event.stopPropagation()}>
            <div className="region-chip"><Globe2 size={14} /><span>{viewport ? `${viewport.south.toFixed(0)}° to ${viewport.north.toFixed(0)}°` : "WORLD VIEW"}</span><span className="chip-divider" />{viewportQuery.isFetching ? <span className="chip-loading"><span className="spinner spinner-small" />Updating</span> : <span>{fmtCount(eventCount)} records</span>}</div>
            <div className="window-chip"><Clock3 size={13} /><span>{selectedRangeLabel}</span>{viewportQuery.data?.truncated && <span className="truncated-tag">CAPPED</span>}</div>
          </div>

          <div className="map-toolbar" onClick={event => event.stopPropagation()}>
            <button type="button" className="map-tool" title="Reset to world view" aria-label="Reset to world view" onClick={() => mapRef.current?.resetWorld()}><RotateCcw size={16} /></button>
            <button type="button" className="map-tool" title="Center on my location (permission required)" aria-label="Center on my location" onClick={locateMe}><LocateFixed size={16} /></button>
            <button type="button" className="map-tool" title={copied ? "Coordinates copied" : "Copy map-center coordinates"} aria-label="Copy map-center coordinates" onClick={copyCoordinates}>{copied ? <Check size={16} /> : <Copy size={15} />}</button>
            <span className="toolbar-separator" />
            <button type="button" className="map-tool style-tool" title="Change basemap style" aria-label={`Switch basemap style from ${styleName}`} onClick={() => setStyleName(current => current === "dark" ? "fiord" : "dark")}><Compass size={16} /><span>{styleName === "dark" ? "DARK" : "FIORD"}</span></button>
          </div>
          {locationMessage && <div className="map-toast" role="status" onClick={() => setLocationMessage("")}>{locationMessage}<button type="button" aria-label="Dismiss"><X size={13} /></button></div>}

          {viewportQuery.error && <div className="data-warning" role="status" onClick={event => event.stopPropagation()}><AlertTriangle size={15} /><span>Event feeds could not be refreshed. The map remains interactive.</span><button type="button" onClick={() => viewportQuery.refetch()}><RefreshCw size={13} /> Retry</button></div>}
          {viewportQuery.data && <div className="coverage-strip" onClick={event => event.stopPropagation()}><Shield size={13} /><span>{viewportQuery.data.coverageNote}</span><button type="button" aria-label="Show source coverage" onClick={() => setSidePanel("sources")}>Details</button></div>}

          {selectedPlace && <div className="place-card panel-glass" onClick={event => event.stopPropagation()}><div className="place-card-title"><MapPin size={15} /><strong>{selectedPlace.label.split(",")[0]}</strong><button type="button" className="icon-button" aria-label="Close place details" onClick={() => setSelectedPlace(undefined)}><X size={15} /></button></div><p>{selectedPlace.label}</p><small>{selectedPlace.precision} · {selectedPlace.attribution}</small></div>}

          {sidePanel && <section className="side-drawer panel-glass" aria-label={sidePanel === "layers" ? "Map layers" : sidePanel === "saved" ? "Saved events" : "Source status"} onClick={event => event.stopPropagation()}>
            <div className="drawer-header"><div><span className="eyebrow">SATNAV / {sidePanel.toUpperCase()}</span><h2>{sidePanel === "layers" ? "Map layers" : sidePanel === "saved" ? "Saved records" : "Source health"}</h2></div><button type="button" className="icon-button" aria-label="Close panel" onClick={() => setSidePanel(null)}><X size={16} /></button></div>
            {sidePanel === "layers" && <>
              <div className="drawer-intro"><span>Toggle category overlays</span><button type="button" className="text-button" onClick={() => setEnabledCategories(new Set(SATNAV_CATEGORIES))}>Reset</button></div>
              <div className="layer-list">{SATNAV_CATEGORIES.map(category => {
                const meta = CATEGORY_META[category];
                const count = activeEvents.filter(event => event.category === category).length;
                const enabled = enabledCategories.has(category);
                return <label className={`layer-row ${enabled ? "layer-enabled" : ""}`} key={category}>
                  <input type="checkbox" checked={enabled} onChange={() => toggleCategory(category)} />
                  <span className="layer-glyph" style={{ "--category-color": meta.color } as React.CSSProperties}>{meta.glyph}</span>
                  <span className="layer-name">{meta.label}</span><span className="layer-count">{count}</span>
                </label>;
              })}</div>
              <div className="drawer-subheading">
                <span>VISIBLE RECORDS ({fmtCount(eventCount)})</span>
                <button type="button" className="text-button" onClick={() => setEventSort(s => s === "time" ? "severity" : "time")}>
                  {eventSort === "time" ? "Sort: Time" : "Sort: Severity"}
                </button>
              </div>
              <div className="recent-list">
                {[...activeEvents].sort((a, b) => {
                  if (eventSort === "severity") {
                    const valA = a.severityValue ?? 0;
                    const valB = b.severityValue ?? 0;
                    if (valB !== valA) return valB - valA;
                  }
                  const timeA = a.startTime ?? a.publishedAt ?? a.fetchedAt;
                  const timeB = b.startTime ?? b.publishedAt ?? b.fetchedAt;
                  return timeB - timeA;
                }).slice(0, 50).map(event => (
                  <button type="button" className="recent-row" key={event.id} onClick={() => selectEvent(event)}>
                    <span className="result-glyph" style={{ "--category-color": CATEGORY_META[event.category].color } as React.CSSProperties}>{CATEGORY_META[event.category].glyph}</span>
                    <span><strong>{event.title}</strong><small>{event.locationLabel ?? "Location not supplied"}{event.severityLabel ? ` · ${event.severityLabel}` : ""}</small></span>
                    <span className="recent-time">{event.startTime !== undefined ? formatUtcDate(event.startTime) : "—"}</span>
                  </button>
                ))}
              </div>
              <p className="drawer-footnote">A category toggle changes only the displayed records. It does not expand source coverage.</p>
            </>}
            {sidePanel === "saved" && <>
              <div className="drawer-intro"><span>Stored locally in this browser</span><span>{savedEvents.length}/25</span></div>
              {savedEvents.length ? <div className="recent-list">{savedEvents.map(event => <button type="button" className="recent-row" key={event.id} onClick={() => selectEvent(event)}><span className="result-glyph" style={{ "--category-color": CATEGORY_META[event.category].color } as React.CSSProperties}>{CATEGORY_META[event.category].glyph}</span><span><strong>{event.title}</strong><small>{event.locationLabel ?? "Location not supplied"}</small></span></button>)}</div> : <div className="empty-drawer"><Bookmark size={20} /><strong>No saved records yet</strong><span>Open an event and select the bookmark to keep it in this browser.</span></div>}
              {savedEvents.length > 0 && <button type="button" className="clear-saved" onClick={() => setSavedEvents([])}>Clear local saved records</button>}
            </>}
            {sidePanel === "sources" && <>
              <p className="source-coverage-note">Live integrations currently enabled in this release. Other categories are not connected.</p>
              <div className="source-health-list">{sources.map(source => <article className="health-card" key={source.provider}><div className="health-card-head"><span className={`health-dot health-${source.state}`} /><strong>{providerLabel(source.provider)}</strong><span>{sourceStateLabel(source.state)}</span></div><p>{source.coverageNote}</p>{source.message && <small>{source.message}</small>}{source.lastSuccessAt && <small>Last successful request · {fmtTime(source.lastSuccessAt)}</small>}</article>)}</div>
              <div className="not-connected"><span className="drawer-subheading">NOT CONNECTED</span><p>Conflict reporting, weather, health, humanitarian, transport and space feeds are not connected in this build. GDELT news is connected but uses centroid-level coordinates. No records are fabricated for unconnected categories.</p></div>
              <a className="source-policy-link" href="https://openfreemap.org/tos/" target="_blank" rel="noreferrer">Basemap service terms <ExternalLink size={12} /></a>
            </>}
          </section>}

          {selectedEvent && <EventDetails
            event={selectedEvent}
            saved={isSaved}
            aiAvailable={aiAvailable}
            aiMessage={aiStatusQuery.data?.message ?? "Checking the project AI service…"}
            explanation={explanationResult}
            explanationError={explainMutation.error?.message}
            explanationLoading={explainMutation.isPending}
            onClose={() => { setSelectedEventId(undefined); explainMutation.reset(); }}
            onToggleSaved={toggleSaved}
            onExplain={handleExplain}
          />}

          <section className="timeline-panel panel-glass" aria-label="Historical event timeline" onClick={event => event.stopPropagation()}>
            <div className="timeline-topline"><div className="timeline-title"><Clock3 size={14} /><strong>{historyMode ? "Historical exploration" : "Event timeline"}</strong><span>{eventCount} in window</span></div><div className="timeline-controls">
              {PRESETS.map(item => <button type="button" key={item.id} className={`range-button ${preset === item.id ? "selected" : ""}`} onClick={() => { setPreset(item.id); setHistoryOffsetDays(current => Math.min(current, Math.max(0, 30 - Math.ceil(item.duration / DAY)))); }}>{item.label}</button>)}
              {historyMode && <button type="button" className="play-button" aria-label={isPlaying ? "Pause historical playback" : "Play historical timeline"} title={isPlaying ? "Pause" : "Play"} onClick={() => setIsPlaying(value => !value)}>{isPlaying ? <Pause size={13} /> : <Play size={13} />}</button>}
              {!historyMode && <button type="button" className="history-link" onClick={() => { setHistoryMode(true); setHistoryOffsetDays(0); }}>Explore 30 days <ChevronDown size={13} /></button>}
            </div></div>
            <div className={`timeline-track ${historyMode ? "timeline-active" : ""}`}>
              <div className="density-bars">{density.map((level, index) => <button type="button" key={index} aria-label={`Select historical offset ${29 - index} ${29 - index === 1 ? "day" : "days"} ago`} title={`${30 - index} days ago`} disabled={!historyMode || maxHistoryOffset === 0} onClick={() => setHistoryOffsetDays(Math.min(maxHistoryOffset, 29 - index))} style={{ "--density": Math.max(0.13, level), "--bar-color": index > 26 ? "#4ad3d8" : "#7186a9" } as React.CSSProperties} />)}</div>
              <input aria-label="Choose historical day offset" type="range" min={0} max={maxHistoryOffset} step={1} value={Math.min(historyOffsetDays, maxHistoryOffset)} disabled={!historyMode || maxHistoryOffset === 0} onChange={event => setHistoryOffsetDays(Number(event.target.value))} />
              <div className="timeline-labels"><span>{historyMode ? "NOW" : "CURRENT WINDOW"}</span><span>{historyMode ? `${historyOffsetDays} DAYS AGO · ${fmtTime(selectedEndAt)}` : selectedRangeLabel}</span><span>{historyMode ? `${maxHistoryOffset} DAYS AGO` : "SELECT HISTORY TO SCRUB"}</span></div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
