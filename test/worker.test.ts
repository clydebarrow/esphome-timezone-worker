import { describe, expect, it } from "vitest";
import data from "../src/zones.json";
import transitions from "./fixtures/transitions.json";
import { API_PATH, handleRequest } from "../src/handler";
import { utcOffsetSeconds, type ParsedTimezone } from "../src/rules";

const URL_ = `https://example.com${API_PATH}`;
// 2026-07-01T12:00:00Z: northern summer, southern winter
const JULY = Date.UTC(2026, 6, 1, 12);
const JANUARY = Date.UTC(2026, 0, 15, 12);

function post(body: unknown, cf?: Record<string, unknown>, type = "application/json"): Request {
  const request = new Request(URL_, {
    method: "POST",
    headers: { "Content-Type": type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (cf) Object.defineProperty(request, "cf", { value: cf });
  return request;
}

async function call(request: Request, now = JULY) {
  const response = await handleRequest(request, now);
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describe("zone lookup", () => {
  it("returns parsed rules for a named zone", async () => {
    const { status, body } = await call(post({ zone: "Europe/London" }));
    expect(status).toBe(200);
    expect(body).toMatchObject({
      zone: "Europe/London",
      source: "zone",
      posix: "GMT0BST,M3.5.0/1,M10.5.0",
      std_offset_seconds: 0,
      dst_offset_seconds: -3600,
      dst_start: { type: 1, month: 3, week: 5, day_of_week: 0, time_seconds: 3600 },
      dst_end: { type: 1, month: 10, week: 5, day_of_week: 0, time_seconds: 7200 },
      std_abbreviation: "GMT",
      dst_abbreviation: "BST",
      has_dst: true,
      dst: true,
      abbreviation: "BST",
      utc_offset_seconds: 3600,
      unixtime: JULY / 1000,
      tzdata_version: data.tzdata_version,
    });
  });

  it("matches zone names without regard to case", async () => {
    const { body } = await call(post({ zone: "  america/new_york " }));
    expect(body.zone).toBe("America/New_York");
  });

  it("accepts old alias names", async () => {
    const { body } = await call(post({ zone: "US/Eastern" }));
    expect(body.posix).toBe("EST5EDT,M3.2.0,M11.1.0");
  });

  it("handles zones without daylight saving", async () => {
    const { body } = await call(post({ zone: "Asia/Kolkata" }));
    expect(body).toMatchObject({
      has_dst: false,
      dst: false,
      utc_offset_seconds: 19800,
      std_abbreviation: "IST",
      dst_abbreviation: "",
      abbreviation: "IST",
    });
    expect(body.dst_start.type).toBe(0);
  });

  it("handles southern hemisphere daylight saving", async () => {
    expect((await call(post({ zone: "Australia/Sydney" }), JANUARY)).body).toMatchObject({
      dst: true,
      utc_offset_seconds: 39600,
      abbreviation: "AEDT",
    });
    expect((await call(post({ zone: "Australia/Sydney" }), JULY)).body).toMatchObject({
      dst: false,
      utc_offset_seconds: 36000,
      abbreviation: "AEST",
    });
  });

  it("gives numeric abbreviations without the angle brackets", async () => {
    expect((await call(post({ zone: "Asia/Kathmandu" }))).body).toMatchObject({
      posix: "<+0545>-5:45",
      abbreviation: "+0545",
    });
  });

  it("rejects unknown zones", async () => {
    expect((await call(post({ zone: "Nowhere/Special" }))).status).toBe(404);
  });
});

describe("IP lookup", () => {
  it("uses the zone Cloudflare found for the IP address", async () => {
    const { status, body } = await call(post({ zone: "ip" }, { timezone: "Pacific/Auckland" }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ zone: "Pacific/Auckland", source: "ip" });
  });

  it("fails when Cloudflare gives no zone", async () => {
    expect((await call(post({ zone: "IP" }))).status).toBe(422);
  });
});

describe("location lookup", () => {
  it("finds the zone for a latitude and longitude", async () => {
    const { status, body } = await call(post({ latitude: -33.87, longitude: 151.21 }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ zone: "Australia/Sydney", source: "location" });
  });

  it("accepts form encoded bodies", async () => {
    const { body } = await call(post("latitude=40.71&longitude=-74.01", undefined, "application/x-www-form-urlencoded"));
    expect(body.zone).toBe("America/New_York");
  });

  it("accepts a zone in a form encoded body", async () => {
    const { body } = await call(post("zone=Europe%2FParis", undefined, "application/x-www-form-urlencoded"));
    expect(body.zone).toBe("Europe/Paris");
  });

  it.each([
    [{ latitude: 91, longitude: 0 }],
    [{ latitude: 0, longitude: -181 }],
    [{ latitude: "north", longitude: 0 }],
    [{ latitude: 10 }],
    [{ longitude: 10 }],
  ])("rejects bad coordinates %j", async (params) => {
    expect((await call(post(params))).status).toBe(400);
  });
});

describe("request handling", () => {
  it.each([
    [{}],
    [{ zone: "ip", latitude: 1, longitude: 1 }],
    [{ zone: 42 }],
    [{ zone: "" }],
  ])("rejects bad parameters %j", async (params) => {
    expect((await call(post(params))).status).toBe(400);
  });

  it("rejects bodies that are not JSON objects", async () => {
    expect((await call(post("not json"))).status).toBe(400);
    expect((await call(post("[1, 2]"))).status).toBe(400);
  });

  it("rejects unsupported content types", async () => {
    expect((await call(post("zone=ip", undefined, "text/plain"))).status).toBe(415);
  });

  it("rejects large bodies", async () => {
    expect((await call(post({ zone: "x".repeat(2000) }))).status).toBe(413);
  });

  it("only allows POST", async () => {
    const response = await handleRequest(new Request(URL_));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("returns 404 for other paths", async () => {
    expect((await handleRequest(new Request("https://example.com/", { method: "POST" }))).status).toBe(404);
  });

  it("is never cached", async () => {
    const response = await handleRequest(post({ zone: "UTC" }), JULY);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("daylight saving rules", () => {
  // Reference offsets from Python's zoneinfo, generated from the same tzdata by generate_zones.py:
  // one zone per distinct rule, with the start offset and each change as [epoch seconds, new offset]
  const zones = data.zones as Record<string, string>;
  const rules = data.rules as unknown as Record<string, ParsedTimezone>;
  const reference = transitions as unknown as Record<string, { start: number; offset: number; changes: [number, number][] }>;

  it("covers every rule", () => {
    expect(new Set(Object.keys(reference).map((zone) => zones[zone]))).toEqual(new Set(Object.keys(rules)));
  });

  it.each(Object.entries(reference))("agrees with zoneinfo for %s", (zone, expected) => {
    const tz = rules[zones[zone]];
    expect(utcOffsetSeconds(expected.start * 1000, tz)).toBe(expected.offset);
    let previous = expected.offset;
    for (const [when, offset] of expected.changes) {
      expect(utcOffsetSeconds(when * 1000 - 1000, tz), `just before ${when}`).toBe(previous);
      expect(utcOffsetSeconds(when * 1000, tz), `at ${when}`).toBe(offset);
      previous = offset;
    }
  });
});
