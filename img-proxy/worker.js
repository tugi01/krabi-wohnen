// Krabi Wohnen – Bild-Proxy. Lädt FazWaz-Inseratfotos verkleinert über den Bildserver von
// DotProperty und gibt sie mit Cache + CORS-Freigabe an die App weiter.
// Nur Bilder von cdn.fazwaz.com / img.fazwaz.com sind erlaubt (kein offener Proxy).
const ALLOWED = /^https:\/\/(cdn|img)\.fazwaz\.com\//;
const WIDTHS = new Set(['384', '640', '828']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
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
