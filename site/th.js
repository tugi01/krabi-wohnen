/* Thailand Wohnen – Modus „Ganz Thailand“: lädt nur die Kacheln im Kartenausschnitt (data/th/…).
   Datenvertrag: docs/thailand-data.md. Wird von app.js genutzt (DATA.th === true). */
'use strict';
const TH = {
  idx: null, tiles: new Map(), cells: new Map(), loadingT: new Set(), loadingC: new Set(),
  MAX_TILES: 14,           // höchstens so viele Kacheln im Speicher (je ≤ 1500 Inserate)
  LOAD_LIMIT: 4500,        // Inserate im Ausschnitt, ab denen erst „näher heranzoomen“ kommt
  bounds: null,            // [s,w,n,e] aktueller Ausschnitt (auch für die Liste)
  detail: new Map(),       // nachgeladene Details je URL

  async loadIndex(){
    const r = await fetch('data/th/index.json', {cache:'no-cache'});
    if(!r.ok) throw new Error(r.status);
    TH.idx = await r.json();
    try { TH.poiIdx = await (await fetch('data/th/pois/index.json', {cache:'no-cache'})).json(); } catch { TH.poiIdx = null; }
    return TH.idx;
  },
  inter(b, q){ return !(b[2] < q[0] || b[0] > q[2] || b[3] < q[1] || b[1] > q[3]); },
  tilesIn(q){ return (TH.idx?.tiles || []).filter(t => TH.inter(t.b, q)); },
  countIn(q){ return TH.tilesIn(q).reduce((s,t)=>s+t.n, 0); },

  norm(x){   // Kachel-Format -> App-Format (wie Krabi/Pattaya)
    const l = { id:x.id, url:x.url, title:x.title || 'Mietobjekt', price:x.price, lat:x.lat, lng:x.lng, beds:x.beds,
      size:x.size ?? null, sizeh:x.sizeh ?? null, sz:x.sz || null, built:x.built || null, by:x.by || null,
      images:x.img ? [x.img] : [], source:x.src==='DotProperty' ? 'DotProperty / FazWaz' : x.src, first_seen:x.first,
      posted:x.posted, pool:x.pool || null, approx:!!x.approx, prov:x.prov, full:!!x.full, th:true };
    if(x.d){ l.dist = {}; for(const [c,v] of Object.entries(x.d)) l.dist[c] = {km:v[0], min:null, name:v[1], lat:v[2], lng:v[3], road:false}; }
    const det = TH.detail.get(l.url); if(det) TH.merge(l, det);
    return l;
  },
  merge(l, d){
    if(!d || !d.ok) return l;
    if(d.size) l.size = d.size; if(d.built){ l.built = d.built; l.built_src = d.built_src; }
    if(d.pool !== undefined && d.pool !== null) l.pool = d.pool;
    if(d.furniture) l.furniture = d.furniture; if(d.images?.length) l.images = d.images;
    for(const k of ['description','available','pets','updated']) if(d[k]) l[k] = d[k];
    l.detailLoaded = true; return l;
  },

  async ensureTiles(q){
    const need = TH.tilesIn(q).filter(t => !TH.tiles.has(t.id) && !TH.loadingT.has(t.id));
    await Promise.all(need.map(async t => {
      TH.loadingT.add(t.id);
      try { const j = await (await fetch(`data/th/t/${t.id}.json`)).json(); TH.tiles.set(t.id, {at:Date.now(), b:t.b, listings:markCoarse(j.listings.map(TH.norm))}); }
      catch {} finally { TH.loadingT.delete(t.id); }
    }));
    // Speicher begrenzen: älteste Kacheln außerhalb des Ausschnitts verwerfen
    if(TH.tiles.size > TH.MAX_TILES){
      const out = [...TH.tiles.entries()].filter(([,v]) => !TH.inter(v.b, q)).sort((a,b)=>a[1].at-b[1].at);
      while(TH.tiles.size > TH.MAX_TILES && out.length) TH.tiles.delete(out.shift()[0]);
    }
    for(const t of TH.tilesIn(q)) if(TH.tiles.has(t.id)) TH.tiles.get(t.id).at = Date.now();
  },
  cellIds(q){
    const ids = [];
    for(let la = Math.floor(q[0]); la <= Math.floor(q[2]); la++) for(let ln = Math.floor(q[1]); ln <= Math.floor(q[3]); ln++) ids.push(`${la}_${ln}`);
    return ids.filter(id => !TH.poiIdx || TH.poiIdx.cells?.[id]);
  },
  async ensurePois(q){
    const ids = TH.cellIds(q).filter(id => !TH.cells.has(id) && !TH.loadingC.has(id));
    if(ids.length > 12) return false;      // zu weit herausgezoomt
    await Promise.all(ids.map(async id => {
      TH.loadingC.add(id);
      try { const j = await (await fetch(`data/th/pois/${id}.json`)).json(); TH.cells.set(id, j.pois); } catch { TH.cells.set(id, []); }
      finally { TH.loadingC.delete(id); }
    }));
    return true;
  },
  // Inserate im Ausschnitt (nur aus geladenen Kacheln)
  listingsIn(q){
    if(!q) return [];
    const out = [];
    for(const t of TH.tiles.values()){
      if(!TH.inter(t.b, q)) continue;
      for(const l of t.listings) if(l.lat >= q[0] && l.lat <= q[2] && l.lng >= q[1] && l.lng <= q[3]) out.push(l);
    }
    return out;
  },
  poisIn(q){
    if(!q) return [];
    const out = [];
    for(const id of TH.cellIds(q)) for(const p of TH.cells.get(id) || []) if(p.lat >= q[0]-0.05 && p.lat <= q[2]+0.05 && p.lng >= q[1]-0.05 && p.lng <= q[3]+0.05) out.push(p);
    return out;
  },
  // Region um einen Punkt (für die Provinz-Auswahl ohne Karte)
  around(lat, lng, km=18){ const dl = km/111, dn = km/(111*Math.cos(lat*Math.PI/180)); return [lat-dl, lng-dn, lat+dl, lng+dn]; },

  async loadDetail(l){
    l.detailTried = true;
    if(l.full || l.detailLoaded || !/dotproperty\.co\.th\/en\/ads\//.test(l.url||'')) return null;
    if(TH.detail.has(l.url)) return TH.merge(l, TH.detail.get(l.url));
    try {
      const r = await fetch(`https://krabi-wohnen-img.tugrulc.workers.dev/detail?u=${encodeURIComponent(l.url)}`);
      const d = await r.json(); TH.detail.set(l.url, d);
      if(d.gone){ l.gone = true; return l; }
      return TH.merge(l, d);
    } catch { return null; }
  },
};
