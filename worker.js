// DNS-over-HTTPS ad blocker for Cloudflare Workers.
// Blocked domains get a 0.0.0.0 / :: answer; everything else is forwarded upstream.
// DNS endpoint:   https://<your-worker>.workers.dev/<TOKEN>/dns-query
// iPhone/iPad profile (open in Safari to install): https://<your-worker>.workers.dev/<TOKEN>/profile

const UPSTREAM = "https://cloudflare-dns.com/dns-query";

const BLOCKLIST_URLS = [
  "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
  "https://adaway.org/hosts.txt",
];

// Add your own domains here (matches the domain and all its subdomains).
const CUSTOM_BLOCKS = [];

const LIST_TTL_MS = 24 * 60 * 60 * 1000;
let blocked = null; // Set of domains, cached while this isolate stays warm
let loadedAt = 0;
let loading = null;

async function loadBlocklist() {
  const set = new Set(CUSTOM_BLOCKS.map((d) => d.toLowerCase()));
  for (const url of BLOCKLIST_URLS) {
    try {
      // Cloudflare's edge cache keeps the raw list for a day, so cold starts are fast.
      const res = await fetch(url, { cf: { cacheTtl: 86400, cacheEverything: true } });
      if (!res.ok) continue;
      for (const raw of (await res.text()).split("\n")) {
        const line = raw.split("#")[0].trim();
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && (parts[0] === "0.0.0.0" || parts[0] === "127.0.0.1")) {
          const d = parts[1].toLowerCase();
          if (d !== "localhost" && d !== "0.0.0.0") set.add(d);
        }
      }
    } catch (_) {
      // A list that fails to load is skipped; DNS keeps working (fails open).
    }
  }
  return set;
}

async function getBlocklist() {
  if (blocked && Date.now() - loadedAt < LIST_TTL_MS) return blocked;
  if (!loading) {
    loading = loadBlocklist()
      .then((s) => {
        if (s.size > CUSTOM_BLOCKS.length || !blocked) {
          blocked = s;
          loadedAt = Date.now();
        }
        return blocked;
      })
      .finally(() => (loading = null));
  }
  return loading;
}

function isBlocked(name, set) {
  const parts = name.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    if (set.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

// Returns { name, qtype, end } for the first question, or null if malformed.
function parseQuestion(buf) {
  if (buf.length < 17) return null;
  let i = 12;
  const labels = [];
  while (i < buf.length && buf[i] !== 0) {
    const n = buf[i];
    if (n & 0xc0) return null; // compression isn't valid in a question
    if (i + 1 + n > buf.length) return null;
    labels.push(String.fromCharCode(...buf.slice(i + 1, i + 1 + n)));
    i += n + 1;
  }
  if (i + 5 > buf.length) return null;
  const qtype = (buf[i + 1] << 8) | buf[i + 2];
  return { name: labels.join(".").toLowerCase(), qtype, end: i + 5 };
}

function sinkholeResponse(query, qtype, end) {
  const question = query.slice(12, end);
  let answer = new Uint8Array(0);
  if (qtype === 1) {
    // A -> 0.0.0.0
    answer = Uint8Array.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 0, 0, 0, 0]);
  } else if (qtype === 28) {
    // AAAA -> ::
    answer = new Uint8Array(28);
    answer.set([0xc0, 0x0c, 0, 28, 0, 1, 0, 0, 0, 60, 0, 16]);
  }
  const an = answer.length ? 1 : 0;
  const out = new Uint8Array(12 + question.length + answer.length);
  out.set([query[0], query[1], 0x81, 0x80, 0, 1, 0, an, 0, 0, 0, 0]);
  out.set(question, 12);
  out.set(answer, 12 + question.length);
  return out;
}

const b64urlToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Apple configuration profile that points the device's DNS at this Worker.
function profileXml(serverUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>DNSSettings</key>
      <dict>
        <key>DNSProtocol</key><string>HTTPS</string>
        <key>ServerURL</key><string>${xmlEscape(serverUrl)}</string>
      </dict>
      <key>OnDemandRules</key>
      <array><dict><key>Action</key><string>Connect</string></dict></array>
      <key>PayloadDisplayName</key><string>Ad Blocker DNS Settings</string>
      <key>PayloadIdentifier</key><string>local.adblock.dns.profile.settings</string>
      <key>PayloadType</key><string>com.apple.dnsSettings.managed</string>
      <key>PayloadUUID</key><string>${crypto.randomUUID().toUpperCase()}</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key><string>Routes DNS through a personal ad-blocking resolver.</string>
  <key>PayloadDisplayName</key><string>Ad Blocker DNS</string>
  <key>PayloadIdentifier</key><string>local.adblock.dns.profile</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${crypto.randomUUID().toUpperCase()}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;
}

const dnsHeaders = { "content-type": "application/dns-message", "cache-control": "max-age=30" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = env.TOKEN;
    if (!token) return new Response("Not found", { status: 404 });

    // Open this URL in Safari on the iPhone/iPad to install the DNS profile.
    if (url.pathname === `/${token}/profile`) {
      return new Response(profileXml(`${url.origin}/${token}/dns-query`), {
        headers: {
          "content-type": "application/x-apple-aspen-config",
          "content-disposition": 'attachment; filename="adblock.mobileconfig"',
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname !== `/${token}/dns-query`) {
      return new Response("Not found", { status: 404 });
    }

    let query;
    if (request.method === "GET") {
      const q = url.searchParams.get("dns");
      if (!q) return new Response("Missing dns parameter", { status: 400 });
      try {
        query = b64urlToBytes(q);
      } catch (_) {
        return new Response("Bad dns parameter", { status: 400 });
      }
    } else if (request.method === "POST") {
      query = new Uint8Array(await request.arrayBuffer());
    } else {
      return new Response("Method not allowed", { status: 405 });
    }

    const parsed = parseQuestion(query);
    if (parsed) {
      const set = await getBlocklist();
      if (set && isBlocked(parsed.name, set)) {
        console.log(`BLOCK ${parsed.name}`);
        return new Response(sinkholeResponse(query, parsed.qtype, parsed.end), { headers: dnsHeaders });
      }
    }

    // Not blocked (or unparseable): forward upstream unchanged.
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/dns-message", accept: "application/dns-message" },
      body: query,
    });
    return new Response(upstream.body, { status: upstream.status, headers: dnsHeaders });
  },
};
