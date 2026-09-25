import tzLookup from "@photostructure/tz-lookup";
import data from "./zones.json";
import { hasDst, isInDst, utcOffsetSeconds, type ParsedTimezone } from "./rules";

const ZONES: Record<string, string> = data.zones;
interface ZoneRules extends ParsedTimezone {
  std_abbreviation: string;
  dst_abbreviation: string;
}

const RULES = data.rules as unknown as Record<string, ZoneRules>;
const ZONES_BY_LOWER_CASE = new Map(Object.keys(ZONES).map((name) => [name.toLowerCase(), name]));

export const API_PATH = "/v1/timezone";
const MAX_BODY_BYTES = 1024;

type Source = "ip" | "zone" | "location";

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

/** Read the body parameters, sent either as JSON or as a form. */
async function readParams(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new RequestError(413, "Request body is too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new RequestError(413, "Request body is too large");
  const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (type === "application/x-www-form-urlencoded") {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (type === "application/json" || type === "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new RequestError(400, "Request body is not valid JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new RequestError(400, "Request body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  }
  throw new RequestError(415, "Send the body as application/json or application/x-www-form-urlencoded");
}

function readCoordinate(value: unknown, name: string, limit: number): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > limit) {
    throw new RequestError(400, `'${name}' must be a number from -${limit} to ${limit}`);
  }
  return number;
}

/** Work out which zone the request asks for. */
function resolveZone(params: Record<string, unknown>, request: Request): { zone: string; source: Source } {
  const hasZone = params.zone !== undefined;
  const hasLocation = params.latitude !== undefined || params.longitude !== undefined;
  if (hasZone === hasLocation) {
    throw new RequestError(400, "Send either 'zone', or both 'latitude' and 'longitude'");
  }

  if (hasLocation) {
    const latitude = readCoordinate(params.latitude, "latitude", 90);
    const longitude = readCoordinate(params.longitude, "longitude", 180);
    return { zone: tzLookup(latitude, longitude), source: "location" };
  }

  if (typeof params.zone !== "string" || params.zone.trim() === "") {
    throw new RequestError(400, "'zone' must be 'ip' or a zone name such as 'Europe/London'");
  }
  const zone = params.zone.trim();
  if (zone.toLowerCase() === "ip") {
    const fromIp = (request as Request & { cf?: { timezone?: string } }).cf?.timezone;
    if (!fromIp) throw new RequestError(422, "Could not find the zone for this IP address");
    return { zone: fromIp, source: "ip" };
  }
  const name = ZONES_BY_LOWER_CASE.get(zone.toLowerCase());
  if (name === undefined) throw new RequestError(404, `Unknown zone '${zone}'`);
  return { zone: name, source: "zone" };
}

export function describeZone(zone: string, source: Source, nowMs: number) {
  const posix = ZONES[zone];
  if (posix === undefined) {
    // The IP and location lookups can name a zone that this build's tzdata lacks
    throw new RequestError(422, `No rules for zone '${zone}'`);
  }
  const rules = RULES[posix];
  const dst = isInDst(nowMs, rules);
  return {
    zone,
    source,
    posix,
    ...rules,
    has_dst: hasDst(rules),
    dst,
    abbreviation: dst ? rules.dst_abbreviation : rules.std_abbreviation,
    utc_offset_seconds: utcOffsetSeconds(nowMs, rules),
    unixtime: Math.floor(nowMs / 1000),
    tzdata_version: data.tzdata_version,
  };
}

export async function handleRequest(request: Request, nowMs: number = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== API_PATH) return json({ error: "Not found" }, 404);
  if (request.method !== "POST") return json({ error: "Use POST" }, 405, { Allow: "POST" });
  try {
    const { zone, source } = resolveZone(await readParams(request), request);
    return json(describeZone(zone, source, nowMs));
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    throw error;
  }
}
