// Krabi Wohnen – Bild-Proxy + Detail-Dienst.
// 1) GET /?u=<fazwaz-bild>&w=640: Lädt FazWaz-Inseratfotos verkleinert über den Bildserver von
//    DotProperty und gibt sie mit Cache + CORS-Freigabe an die App weiter.
//    Nur Bilder von cdn.fazwaz.com / img.fazwaz.com sind erlaubt (kein offener Proxy).
// 2) GET /detail?u=<DotProperty-Inserat-URL>: lädt die Inseratseite und liefert Fläche, Baujahr,
//    Pool, Möblierung, Fotos usw. als JSON (Portierung von parse_detail() aus scraper/scrape.py).
const ALLOWED = /^https:\/\/(cdn|img)\.fazwaz\.com\//;
const WIDTHS = new Set(['384', '640', '828']);
const AD_URL = /^https:\/\/www\.dotproperty\.co\.th\/en\/ads\/[^?#]+$/;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MONTHS = Object.fromEntries(
  ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((m, i) => [m, i + 1]));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (url.pathname === '/detail') return detail(url, ctx);
    const src = url.searchParams.get('u') || '';
    const w = WIDTHS.has(url.searchParams.get('w')) ? url.searchParams.get('w') : '640';
    if (!ALLOWED.test(src) || src.length > 2000) return new Response('Bad request', { status: 400 });
    const cache = caches.default;
    const key = new Request(`https://img-cache.local/${w}/${encodeURIComponent(src)}`);
    let res = await cache.match(key);
    if (!res) {
      const upstream = `https://www.dotproperty.co.th/_next/image?url=${encodeURIComponent(src)}&w=${w}&q=60`;
      const r = await fetch(upstream, { headers: { 'User-Agent': 'Mozilla/5.0 KrabiWohnen-ImageProxy', 'Accept': 'image/avif,image/webp,image/jpeg,*/*' } });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) return new Response('Upstream error', { status: 502 });
      res = new Response(r.body, { headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=604800, immutable',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      } });
      ctx.waitUntil(cache.put(key, res.clone()));
    }
    return res;
  },
};

// ---------- Detail-Dienst ----------

function json(obj, status = 200, maxAge = 86400) {
  return new Response(JSON.stringify(obj), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': `public, max-age=${maxAge}`,
    'X-Content-Type-Options': 'nosniff',
  } });
}

// caches.default richtet sich nach Cache-Control der gespeicherten Antwort; der Browser bekommt immer 1 Tag.
function withMaxAge(res, maxAge) {
  const h = new Headers(res.headers);
  h.set('Cache-Control', `public, max-age=${maxAge}`);
  return new Response(res.body, { status: res.status, headers: h });
}

async function detail(url, ctx) {
  const u = url.searchParams.get('u') || '';
  if (u.length >= 400 || !AD_URL.test(u)) return json({ ok: false, error: 'bad url' }, 400);
  const cache = caches.default;
  const key = new Request(`https://detail-cache.local/v2/${encodeURIComponent(u)}`);
  const hit = await cache.match(key);
  if (hit) return withMaxAge(hit, 86400);
  let r;
  try {
    r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en' } });
  } catch {
    return json({ ok: false }, 502);
  }
  if (r.status === 404 || r.status === 410) {
    const out = { ok: false, gone: true };
    ctx.waitUntil(cache.put(key, json(out, 200, 86400)));   // 1 Tag
    return json(out);
  }
  if (!r.ok) return json({ ok: false }, 502);
  let d;
  try { d = parseDetail(await r.text()); } catch { return json({ ok: false }, 502); }
  const out = { ok: true, ...d };
  ctx.waitUntil(cache.put(key, json(out, 200, 604800)));     // 7 Tage
  return json(out);
}

// ---------- Parser (Portierung von scraper/scrape.py: parse_detail & Co.) ----------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '\u2013', mdash: '\u2014',
  hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', bull: '\u2022',
  middot: '\u00b7', sup2: '\u00b2', deg: '\u00b0', times: '\u00d7', copy: '\u00a9', reg: '\u00ae',
  trade: '\u2122', euro: '\u20ac' };
function unescapeHtml(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);?/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
  });
}

function* ldBlocks(page) {
  for (const m of page.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { yield JSON.parse(m[1]); } catch { /* ungültiges JSON überspringen */ }
  }
}

function visibleText(page) {
  const t = page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  return unescapeHtml(t.replace(/<[^>]+>/g, '|')).replace(/\s*\|[\s|]*/g, '|');
}

const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function field(vis, label) {
  const m = vis.match(new RegExp('\\|' + reEsc(label) + '\\|([^|]+)\\|'));
  if (!m) return null;
  const v = m[1].trim();
  return v === 'N/A' || v === '-' || v === '' ? null : v;
}

// 'Aug 2022' / 'May 2021' / '2022' -> 'YYYY-MM' (Monat 01 wenn unbekannt)
function parseMonthYear(s) {
  if (!s) return null;
  let m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}`;
  m = s.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  return m ? `${m[1]}-01` : null;
}

function parseDetail(page) {
  const d = { size: null, built: null, built_src: null, pool: null, furniture: null, images: [],
    description: '', available: null, pets: null, updated: null, amenities: [] };
  for (const j of ldBlocks(page)) {
    if (!j || j['@type'] !== 'RealEstateListing') continue;
    const me = j.mainEntity || {};
    d.size = (me.floorSize || {}).value ?? null;
    { const pr = parseFloat((me.offers || j.offers || {}).price); if (pr > 0) d.price = Math.round(pr); }
    d.amenities = (Array.isArray(me.amenityFeature) ? me.amenityFeature : [])
      .filter(a => a && a.value).map(a => a.name ?? null);
    let imgs = me.image || [];
    if (!Array.isArray(imgs)) imgs = [imgs];
    // Original-URLs; die App leitet FazWaz-Bilder selbst über den Bild-Proxy
    d.images = imgs.map(i => (i && typeof i === 'object' ? i.url || i.contentUrl : i))
      .filter(i => typeof i === 'string').slice(0, 6);
    d.description = [...unescapeHtml(me.description || '')].slice(0, 1500).join('');
  }
  const vis = visibleText(page);
  d.furniture = field(vis, 'Furniture Status');
  d.updated = field(vis, 'Updated At');
  d.pets = field(vis, 'Pets');
  // Baujahr: Satz "completed in Aug 2022" > "Year Built" > Projekt-Fertigstellung
  const m = vis.match(/was completed in ([A-Za-z]{3,9}\.? \d{4})/);
  let built = m ? parseMonthYear(m[1]) : null;
  let src = built ? 'Inserat' : null;
  if (!built) {
    built = parseMonthYear(field(vis, 'Year Built'));
    src = built ? 'Baujahr-Feld' : null;
  }
  if (!built) {
    const c = field(vis, 'Construction');
    built = c && c.includes('Completed') ? parseMonthYear(c) : null;
    src = built ? 'Projekt' : null;
  }
  d.built = built;
  d.built_src = src;
  d.available = field(vis, 'Available From') || field(vis, 'Availability');
  const am = d.amenities.join(' ').toLowerCase() + ' ' + d.description.toLowerCase();
  if (am.includes('private pool') || am.includes('privater pool')) d.pool = 'privat';
  else if (['communal pool', 'pool access', 'swimming pool', 'infinity pool'].some(k => am.includes(k))) d.pool = 'gemeinschaft';
  return d;
}
