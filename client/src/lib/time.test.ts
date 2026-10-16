import { describe, expect, it } from "vitest";
import { formatUtcTime } from "./time";

describe("formatUtcTime", () => {
  it("keeps a timestamp on its UTC calendar date across local timezones", () => {
    expect(formatUtcTime(Date.parse("2026-10-14T20:10:00.000Z"))).toBe("14 Oct 2026, 20:10 UTC");
  });

  it("formats the Unix epoch rather than treating zero as missing", () => {
    expect(formatUtcTime(0)).toBe("01 Jan 1970, 00:00 UTC");
  });

  it("labels missing and invalid timestamps explicitly", () => {
    expect(formatUtcTime(undefined)).toBe("Time not supplied");
    expect(formatUtcTime(Number.NaN)).toBe("Time not supplied");
  });
});
