import { AlertTriangle, Bookmark, Clock3, ExternalLink, MapPin, Sparkles, X } from "lucide-react";
import type { ExplainAction, SatnavEvent, SatnavSourceRef } from "@shared/satnav";
import { formatUtcTime } from "@/lib/time";

interface Explanation {
  action: ExplainAction;
  content: string;
  citations: SatnavSourceRef[];
  model: string;
  createdAt: number;
}
interface EventDetailsProps {
  event: SatnavEvent;
  saved: boolean;
  aiAvailable: boolean;
  aiMessage: string;
  explanation?: Explanation;
  explanationError?: string;
  explanationLoading: boolean;
  onClose: () => void;
  onToggleSaved: () => void;
  onExplain: (action: ExplainAction) => void;
}

const categoryLabels: Record<string, string> = {
  earthquake: "Earthquake",
  flood: "Flood",
  cyclone: "Cyclone",
  wildfire: "Fire detection",
  volcano: "Volcanic activity",
  tsunami: "Tsunami",
  drought: "Drought",
  news: "News report",
  other: "Disaster report",
};
const providerLabels: Record<string, string> = { usgs: "USGS", gdacs: "GDACS", gdelt: "GDELT (article metadata)", nominatim: "OpenStreetMap" };

function formatTime(value?: number) {
  return formatUtcTime(value);
}
function precisionLabel(value: SatnavEvent["locationPrecision"]) {
  if (value === "centroid") return "Provider-supplied centroid · approximate";
  if (value === "area") return "Provider-supplied affected area";
  if (value === "regional") return "Regional location · approximate";
  if (value === "point") return "Source-reported point";
  return "Location precision unavailable";
}

function metadataRows(source: SatnavSourceRef): Array<[string, string]> {
  const metadata = source.metadata ?? {};
  const rows: Array<[string, string]> = [];
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) rows.push([label, value]);
    else if (typeof value === "number" && Number.isFinite(value)) rows.push([label, String(value)]);
  };
  if (source.provider === "usgs") {
    if (typeof metadata.depthKm === "number") rows.push(["Depth", `${metadata.depthKm.toFixed(1)} km`]);
    if (typeof metadata.tsunamiFlag === "boolean") rows.push(["USGS tsunami flag", metadata.tsunamiFlag ? "Yes" : "No"]);
    add("PAGER alert", metadata.pagerAlert);
    add("Review status", metadata.reviewStatus);
    add("Felt reports", metadata.feltReports);
    add("MMI", metadata.mmi);
    add("CDI", metadata.cdi);
    add("Significance", metadata.significance);
    add("USGS event type", metadata.eventType);
  } else if (source.provider === "gdacs") {
    add("GDACS event type", metadata.eventType);
    add("GDACS event ID", source.providerId);
    add("GDACS episode ID", metadata.episodeId);
    add("Alert level", metadata.alertLevel);
    add("Reported severity", metadata.severityText);
    add("GDACS upstream source", metadata.providerSource);
    add("GDACS upstream source ID", metadata.providerSourceId);
  }
  if (source.updatedAt) rows.push(["Feed updated", formatTime(source.updatedAt)]);
  return rows;
}

export default function EventDetails({ event, saved, aiAvailable, aiMessage, explanation, explanationError, explanationLoading, onClose, onToggleSaved, onExplain }: EventDetailsProps) {
  const location = [event.locationLabel, event.country].filter(Boolean).join(", ") || "Location not supplied";
  return (
    <aside className="event-detail panel-glass" aria-label="Event details">
      <div className="detail-topline">
        <span className={`category-pill category-${event.category}`}><i aria-hidden="true" />{categoryLabels[event.category] ?? event.category}</span>
        <div className="detail-actions">
          <button type="button" className={`icon-button ${saved ? "is-active" : ""}`} aria-label={saved ? "Remove saved event" : "Save event"} title={saved ? "Remove saved event" : "Save event"} onClick={onToggleSaved}><Bookmark size={15} fill={saved ? "currentColor" : "none"} /></button>
          <button type="button" className="icon-button" aria-label="Close event details" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
      <div className="detail-scroll">
        <h2 className="event-title">{event.title}</h2>
        <div className="detail-location"><MapPin size={14} /><span>{location}</span></div>
        <p className="precision-note">{precisionLabel(event.locationPrecision)}</p>

        <div className="event-facts">
          <div className="fact-row"><span>Status</span><strong className="status-value">{event.status === "alert" ? "Alert" : event.status === "forecast" ? "Forecast" : event.status === "report" ? "Report" : "Observed"}</strong></div>
          {event.severityLabel && <div className="fact-row"><span>Severity as reported</span><strong>{event.severityLabel}{event.severityScale ? ` · ${event.severityScale}` : ""}</strong></div>}
          <div className="fact-row"><span>Verification</span><strong>{event.sourceCount > 1 ? "Multiple feed records · not independent corroboration" : event.verification === "official-feed" ? "Official feed record" : event.verification === "conflicting" ? "Conflicting source records" : event.verification === "unverified" ? "Unverified report" : "Single-source record"}</strong></div>
          <div className="fact-row"><span>Event time</span><strong>{formatTime(event.startTime)}</strong></div>
          {event.providerUpdatedAt && <div className="fact-row"><span>Provider updated</span><strong>{formatTime(event.providerUpdatedAt)}</strong></div>}
          <div className="fact-row"><span>SATNAV fetched</span><strong>{formatTime(event.fetchedAt)}</strong></div>
          <div className="fact-row"><span>Source records</span><strong>{event.sourceCount}</strong></div>
        </div>

        {event.incidentMembers && event.incidentMembers.length > 1 && <section className="detail-section">
          <h3>Related provider records</h3>
          <p className="source-description">Linked by close event time, location, category and available magnitude. This record association is not independent corroboration.</p>
          {event.incidentMembers.map(member => (
            <article className="source-card" key={member.id}>
              <div className="source-card-heading"><span className="source-brand">{providerLabels[member.provider] ?? member.provider}</span><span className="source-date">{precisionLabel(member.locationPrecision)}</span></div>
              <p>{member.title}</p>
              <small>Provider record: {member.providerId}</small>
              <small>Event time: {formatTime(member.startTime)}</small>
              {member.locationLabel && <small>Reported location: {member.locationLabel}{member.country && member.country !== member.locationLabel ? `, ${member.country}` : ""}</small>}
              {member.severityLabel && <small>Reported severity: {member.severityLabel}</small>}
            </article>
          ))}
        </section>}

        {event.description && <section className="detail-section"><h3>Source description</h3><p className="source-description">{event.description}</p></section>}

        <section className="detail-section source-section">
          <div className="section-heading"><h3>Original sources</h3><span>{event.sources.length}</span></div>
          {event.sources.length ? event.sources.map((source, index) => (
            <article className="source-card" key={`${source.provider}-${source.providerId ?? index}-${source.publishedAt ?? index}-${index}`}>
              <div className="source-card-heading"><span className="source-brand">{providerLabels[source.provider] ?? source.provider}</span><span className="source-date">{source.publishedAt ? formatTime(source.publishedAt) : "Publication time not supplied"}</span></div>
              <p>{source.label}</p>
              {source.publisher && <span className="source-publisher">{source.publisher}</span>}
              {source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="source-link">Open original source <ExternalLink size={12} /></a> : <span className="source-publisher">Source URL not supplied</span>}
              {metadataRows(source).map(([label, value]) => <small className="source-metadata" key={`${label}-${value}`}>{label}: {value}</small>)}
              <small>{source.attribution}</small>
            </article>
          )) : <p className="muted-copy">No source links were supplied for this record.</p>}
        </section>

        <section className="explainer-section">
          <div className="section-heading"><div className="explainer-title"><Sparkles size={15} /><h3>Event explainer</h3></div><span className="ai-badge">AI</span></div>
          <p className="explainer-caveat">Generated from the event record and its listed sources. It is analysis, not reporting.</p>
          <div className="explain-actions">
            <button type="button" disabled={!aiAvailable || explanationLoading} onClick={() => onExplain("summary")}>Explain</button>
            <button type="button" disabled={!aiAvailable || explanationLoading} onClick={() => onExplain("uncertainty")}>Known / unknown</button>
            <button type="button" disabled={!aiAvailable || explanationLoading} onClick={() => onExplain("background")}>Context</button>
          </div>
          {!aiAvailable && <p className="ai-status-note"><AlertTriangle size={13} />{aiMessage}</p>}
          {explanationLoading && <div className="ai-loading"><span className="spinner" />Preparing a source-grounded explanation…</div>}
          {explanationError && <p className="ai-error" role="alert">{explanationError}</p>}
          {explanation && <div className="explanation-output"><p className="explanation-meta">{explanation.action === "uncertainty" ? "Known and unknown" : explanation.action === "background" ? "Context" : "Summary"} · {formatTime(explanation.createdAt)}</p><div className="explanation-text">{explanation.content}</div><p className="explanation-footnote">Model: {explanation.model}. Review the original sources above.</p></div>}
        </section>

        <div className="detail-footnote"><Clock3 size={13} /><span>Event time and publication/update time are distinct. Feed coverage is incomplete and may be delayed.</span></div>
      </div>
    </aside>
  );
}
