# ESPHome timezone worker

A Cloudflare Worker that tells an ESPHome device which timezone it is in, and the
daylight saving rules for that zone.

The rules come back already parsed, in the same form as ESPHome's
`time::ParsedTimezone` struct. The device can copy them straight into the struct
and call `time::set_global_tz()`. It needs no POSIX TZ parser, and it changes
between standard and daylight time at the right moment without asking again.

## API

The base URL and `/privacy` serve web pages that describe the service and its privacy. The API is at `/v1/timezone`.

`POST /v1/timezone`

Send the parameters in the body, either as JSON (`Content-Type: application/json`)
or as a form (`Content-Type: application/x-www-form-urlencoded`). Send exactly one of:

| Parameters                | Meaning                                                                  |
|---------------------------|--------------------------------------------------------------------------|
| `zone: "ip"`              | The zone Cloudflare finds for the public IP address the request came from |
| `zone: "Europe/London"`   | A tz database name. Old names such as `US/Eastern` work, and case is ignored |
| `latitude`, `longitude`   | The zone at that location, in decimal degrees                            |

```sh
curl -X POST https://<worker>/v1/timezone -H 'Content-Type: application/json' -d '{"zone": "ip"}'
curl -X POST https://<worker>/v1/timezone -d 'latitude=-33.87&longitude=151.21'
```

### Response

```json
{
  "zone": "Europe/London",
  "source": "zone",
  "posix": "GMT0BST,M3.5.0/1,M10.5.0",
  "std_offset_seconds": 0,
  "dst_offset_seconds": -3600,
  "dst_start": {"type": 1, "month": 3, "week": 5, "day_of_week": 0, "day": 0, "time_seconds": 3600},
  "dst_end": {"type": 1, "month": 10, "week": 5, "day_of_week": 0, "day": 0, "time_seconds": 7200},
  "std_abbreviation": "GMT",
  "dst_abbreviation": "BST",
  "has_dst": true,
  "dst": true,
  "abbreviation": "BST",
  "utc_offset_seconds": 3600,
  "unixtime": 1790300486,
  "tzdata_version": "2026d"
}
```

| Field | Meaning |
|-------|---------|
| `zone` | The tz database name that was used |
| `source` | `ip`, `zone` or `location`: how the zone was chosen |
| `posix` | The zone's POSIX TZ rule |
| `std_offset_seconds`, `dst_offset_seconds` | POSIX offsets: seconds to add to local time to get UTC, so they are positive west of Greenwich |
| `dst_start`, `dst_end` | When daylight saving starts and ends. `type` is `0` none, `1` month/week/day (`Mm.w.d`, week `5` is the last), `2` Julian day 1-365 not counting 29 February (`Jn`), `3` day of year 0-365 (`n`). `time_seconds` is the local time of the change, in seconds after midnight |
| `std_abbreviation`, `dst_abbreviation` | The zone's names for standard and daylight saving time, such as `GMT` and `BST`. Zones without a name use their offset, such as `+0545`. `dst_abbreviation` is empty for zones without daylight saving |
| `has_dst` | Whether the zone uses daylight saving at all |
| `dst`, `utc_offset_seconds`, `abbreviation` | Whether daylight saving is in effect now, the current offset east of UTC, and the current abbreviation |
| `unixtime` | The time the answer was made, in seconds since 1970 |
| `tzdata_version` | The tz database release the rules came from |

The field names and values match ESPHome's `ParsedTimezone` and `DSTRule`. The
ESPHome `sntp` time platform uses this service when its `timezone` option is a
mapping, for example `timezone: {zone: ip}`.

### Errors

Errors return JSON such as `{"error": "Unknown zone 'Nowhere/Special'"}`, with these statuses:

| Status | Cause |
|--------|-------|
| 400 | Missing or conflicting parameters, a bad latitude or longitude, or a body that is not valid JSON |
| 404 | An unknown zone name, or a path other than `/v1/timezone` |
| 405 | A method other than `POST` |
| 413 | A body over 1 KB |
| 415 | A body that is neither JSON nor a form |
| 422 | No zone could be found for the IP address |

Responses are never cached.

## Accuracy

- **IP address:** this uses Cloudflare's own geolocation (`request.cf.timezone`). It
  is wrong for devices behind a VPN, and can be wrong for mobile networks and
  connections shared through a carrier.
- **Latitude and longitude:** this uses [`@photostructure/tz-lookup`](https://github.com/photostructure/tz-lookup),
  which is small enough to run in a worker but uses simplified borders. Close to a
  border between zones it can give the neighbouring zone; far from borders it is
  reliable. Over the open sea it gives the nautical `Etc/GMT±N` zones.
- **Named zones:** exact, for the tz database release in `tzdata_version`.

## How the rules are made

`scripts/generate_zones.py` reads every zone in the Python
[`tzdata`](https://pypi.org/project/tzdata/) package. It takes the POSIX rule on
the last line of each zone file and parses it with
`aioesphomeapi.posix_tz.parse_posix_tz`, the same parser ESPHome uses at build time.
The results go into `src/zones.json`, with each distinct rule stored once.

The script also writes `test/fixtures/transitions.json`: the dates of every UTC
offset change in 2028 and 2029 for one zone per rule, worked out by Python's
`zoneinfo` from the same tzdata files. The tests check the worker's daylight saving
calculation (`src/rules.ts`, a copy of ESPHome's `posix_tz.cpp`) against these dates
for every rule.

## Development

```sh
npm install
npm test               # unit tests
npm run typecheck
npm run dev            # run locally on http://localhost:8787

pip install -r requirements.txt
npm run generate       # rebuild src/zones.json and the test fixtures
```

## Keeping tzdata current

The **Update tzdata** workflow runs every Monday. It pins the newest `tzdata`
release in `requirements.txt`, regenerates the rules and opens a pull request if
anything changed. The pull request is opened with the workflow's own token, so
GitHub does not start CI on it. Close and reopen it, or push to it, to run the
checks before you merge it.

CI checks that `src/zones.json` matches the `tzdata` version in `requirements.txt`.

## Deploying

The **Deploy** workflow deploys to Cloudflare after CI passes on `main`, and can
also be started by hand. It runs in the `production` environment and needs two
secrets:

- `CLOUDFLARE_API_TOKEN`: an API token with the *Edit Cloudflare Workers* template
- `CLOUDFLARE_ACCOUNT_ID`

The worker is published at `esphome-timezone.<account>.workers.dev`. To use your
own domain, set `routes` in `wrangler.toml`. To limit requests from a single
address, add a rate limiting rule for the route in the Cloudflare dashboard.

You can also deploy from your own machine with `npx wrangler login` and then
`npm run deploy`.

## Privacy

Like any web service, the worker sees the public IP address of each device that calls it. It uses the address, and
any location sent, only to work out the reply. It stores nothing: there is no log, database or cookie, and
`wrangler.toml` turns off the logging that Cloudflare offers to Workers. The requests still pass through
Cloudflare, whose privacy policy applies to that.

The same statement is served by the worker at `/privacy`, and a short description of the service at the base URL.

## Licence

MIT. See [LICENSE](LICENSE).
