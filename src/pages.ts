// The web pages served at the base URL and at /privacy.

const REPOSITORY_URL = "https://github.com/clydebarrow/esphome-timezone-worker";
const CLOUDFLARE_PRIVACY_URL = "https://www.cloudflare.com/privacypolicy/";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
  pre { overflow-x: auto; padding: 0.75rem; border-radius: 4px; background: rgba(127, 127, 127, 0.15); }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** The page at the base URL. `origin` is the address this service is reached at. */
export function homePage(origin: string): string {
  const endpoint = `${escapeHtml(origin)}/v1/timezone`;
  return layout(
    "ESPHome time zone service",
    `<h1>ESPHome time zone service</h1>
<p>This service tells an ESPHome device which time zone it is in, and the rules for daylight saving time in that
zone, so that the device can show the correct local time. It is used by the
<a href="https://esphome.io/components/time/sntp/">SNTP time platform</a> of ESPHome when its
<code>timezone</code> option is set to look up the zone at runtime.</p>
<p>Send a <code>POST</code> with a JSON body containing a zone name, <code>"ip"</code> to use the location of
the sender's IP address, or a latitude and longitude:</p>
<pre><code>curl -X POST ${endpoint} \\
  -H 'Content-Type: application/json' \\
  -d '{"zone": "Europe/London"}'

-d '{"zone": "ip"}'
-d '{"latitude": 51.5, "longitude": -0.12}'</code></pre>
<p>This service stores no logs and no data about the requests it receives.
See the <a href="/privacy">privacy statement</a>.
The source code and a description of the replies are in the
<a href="${REPOSITORY_URL}">project repository</a>.</p>`,
  );
}

/** The page at /privacy. */
export function privacyPage(): string {
  return layout(
    "Privacy - ESPHome time zone service",
    `<h1>Privacy</h1>
<p>This service stores no logs and keeps no data about the requests it receives.</p>
<h2>What is received</h2>
<p>Each request contains the public IP address of the sender, as with any request over the internet, and a body
with either a zone name, <code>"ip"</code>, or a latitude and longitude.</p>
<h2>What is done with it</h2>
<ul>
<li>A zone name is looked up in a list of zones held in the service.</li>
<li>With <code>"ip"</code>, the time zone for the IP address is found using the location Cloudflare has already worked
out for the request.</li>
<li>A latitude and longitude are turned into a zone name using a map held in the service.</li>
</ul>
<p>The result is sent back in the reply. The IP address and the location are used only to work out the reply. Nothing
is saved: there is no log, no database and no cookies, and the logging that Cloudflare offers to Workers is turned
off.</p>
<h2>Cloudflare</h2>
<p>The service runs on Cloudflare Workers, so Cloudflare handles the requests on their way to it. What Cloudflare
does with them is described in the <a href="${CLOUDFLARE_PRIVACY_URL}">Cloudflare privacy policy</a>.</p>
<h2>Avoiding the service</h2>
<p>To send nothing, use a fixed time zone in your ESPHome configuration, or run your own copy of the service
from the <a href="${REPOSITORY_URL}">project repository</a>.</p>
<p><a href="/">Back</a></p>`,
  );
}
