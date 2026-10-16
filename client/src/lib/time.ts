export function formatUtcTime(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "Time not supplied";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(value));
  return `${formatted} UTC`;
}

export function formatUtcDate(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "Date not supplied";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
  return `${formatted} UTC`;
}
