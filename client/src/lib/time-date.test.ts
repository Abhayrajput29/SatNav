import { describe, expect, it } from "vitest";
import { formatUtcDate } from "./time";

describe("formatUtcDate", () => {
  it("keeps the source UTC day when local time would cross midnight", () => {
    expect(formatUtcDate(Date.parse("2026-10-14T20:10:00.000Z"))).toBe("14 Oct 2026 UTC");
  });

  it("formats epoch zero as a valid date", () => {
    expect(formatUtcDate(0)).toBe("01 Jan 1970 UTC");
  });
});
