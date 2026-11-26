/* Thailand Wohnen – PWA. Daten: data/<stadt>/listings.json (zweimal täglich per GitHub Action aktualisiert). */
'use strict';
const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CITIES = {
  thailand:{ name:'Thailand', long:'ganz Thailand', key:'krabiwohnen.th.v1', center:[11.5,100.3], fb:'Thailand',
             note:'Thailand (Küsten-Provinzen und Chiang Mai, ohne Bangkok): alle Mietinserate von DotProperty in 20 Provinzen, dazu BahtSold und Meezub für Krabi und Pattaya. Fläche und Baujahr stammen aus den Suchfiltern des Portals (in Stufen); genaue Angaben, Pool und alle Fotos werden beim Öffnen eines Inserats nachgeladen.' },
  krabi:   { name:'Krabi', long:'Krabi / Ao Nang', key:'krabiwohnen.v1', center:[8.045,98.83], fb:'Ao Nang Krabi',
             note:'Alle Inserate in Mueang Krabi bis 25 km um Ao Nang.' },
  pattaya: { name:'Pattaya', long:'Pattaya & Umgebung (Si Racha bis Ban Chang)', key:'krabiwohnen.pattaya.v1', center:[12.93,100.89], fb:'Pattaya',
             note:'Pattaya hat über 16.000 Inserate. Geladen werden nur die passenden: ab 50 m², bis 60.000 ฿ und Baujahr der letzten 10 Jahre.' },
};
let CITY = CITIES[localStorage.getItem('krabiwohnen.city')] ? localStorage.getItem('krabiwohnen.city') : 'thailand';
const KEY_OF = c => CITIES[c].key;
const DEFAULTS = { old:false, owner:false, pool:false, unknown:false, sizeUnknown:false, soon:false, maxAge:5, size:50, sizeMax:400, price:60000, beach:30, sort:'price' };
const LAYERS = { Strand:true, Moschee:true, 'Muay Thai':true, '7-Eleven':true, Markt:true, Einkauf:false, Krankenhaus:false };
const POICOL = { Strand:['#1b8cb2','🏖'], Moschee:['#2f7d4b','🕌'], 'Muay Thai':['#7d54a4','🥊'], Markt:['#d9480f','🍜'], '7-Eleven':['#ffffff','<svg class="ico711" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="6" fill="#fff"/><rect x="5" y="9" width="22" height="4" fill="#f58220"/><rect x="5" y="15" width="22" height="4" fill="#00843d"/><rect x="5" y="21" width="22" height="4" fill="#ee2737"/><path d="M10 5h13l-7 23h-5l6-18h-7z" fill="#00843d" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'], Einkauf:['#ad841a','🛒'], Krankenhaus:['#c0392b','🏥'] };
const TXTICON = c => c==='7-Eleven' ? '7-11' : POICOL[c][1];
const DISTCATS = ['Strand','Moschee','Muay Thai','7-Eleven','Markt','Einkauf','Krankenhaus'];
// Thailand: nichts vorfiltern (alles stellt man selbst ein); Krabi/Pattaya: Wunschkriterien als Start
const DEF_OF = c => c==='thailand' ? {...DEFAULTS, old:true, unknown:true, sizeUnknown:true, size:0, price:150000} : DEFAULTS;
const LAY_OF = c => c==='thailand' ? {...LAYERS, '7-Eleven':false, Markt:false} : LAYERS;
let state = load(CITY);
let DATA = null, KLIMA = null, view = 'list', map = null, layer = null, poiLayers = {};

function load(city){
  try { const s = JSON.parse(localStorage.getItem(KEY_OF(city)) || '{}');
    return { filters:{...DEF_OF(city), ...(s.filters||{})}, layers:{...LAY_OF(city), ...(s.layers||{})}, favs:Array.isArray(s.favs)?s.favs:[], own:Array.isArray(s.own)?s.own:[], thView:s.thView, region:s.region }; }
  catch { return { filters:{...DEF_OF(city)}, layers:{...LAY_OF(city)}, favs:[], own:[] }; }
}
function save(){ try { localStorage.setItem(KEY_OF(CITY), JSON.stringify(state)); } catch {} }
// Alle Inserate = Portal-Daten + eigene (z. B. von Facebook), eigene nur auf diesem Gerät gespeichert
const allListings = () => DATA ? [...state.own.map(ownToListing), ...(DATA.th ? TH.listingsIn(TH.bounds) : DATA.listings)] : [];

const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  januar:0,februar:1,märz:2,mai:4,juni:5,juli:6,oktober:9,dezember:11,march:2,june:5,july:6,october:9,december:11};
function parseAvail(s){
  if(!s) return null;
  const t = s.toLowerCase();
  if(/now|sofort|jetzt|immediately/.test(t)) return new Date(0);
  const y = t.match(/(20\d\d)/); if(!y) return null;
  const m = Object.keys(MONTHS).find(k => new RegExp('\\b'+k).test(t));
  const d = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b(?!\d)/);
  return new Date(+y[1], m!=null?MONTHS[m]:0, d && +d[1] <= 31 && +d[1] !== +y[1] ? +d[1] : 1);
}
// Anbieter-Angaben (englisch) auf Deutsch
const DE = {'house':'Haus','villa':'Villa','condo':'Eigentumswohnung (Condo)','apartment':'Wohnung','townhouse':'Reihenhaus','penthouse':'Penthouse',
  'serviced apartment':'Serviced Apartment','shophouse':'Geschäftshaus mit Wohnung','fully furnished':'voll möbliert','partly furnished':'teilmöbliert',
  'partially furnished':'teilmöbliert','unfurnished':'unmöbliert','negotiable':'verhandelbar','not allowed':'nicht erlaubt','cats only':'nur Katzen',
  'dogs only':'nur Hunde','all kind of pets allowed':'alle Haustiere erlaubt','allowed':'erlaubt','yes':'ja','no':'nein',
  'cats and dogs (small only)':'Katzen und kleine Hunde','small pets only':'nur kleine Haustiere','pets allowed':'Haustiere erlaubt'};
const deTxt = v => v == null || v === '' ? null : (DE[String(v).trim().toLowerCase()] || v);
function deDate(s){   // „Nov 9, 2026“ / „September 1st 2027“ -> 09.11.2026 (sonst Originaltext)
  if(!s) return null; const d = parseAvail(s); if(!d) return s;
  if(+d === 0) return 'sofort';
  return d.toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit', year:'numeric'});
}
function availLater(l){ const d = parseAvail(l.available); if(!d || +d === 0 || !DATA) return null;
  return (d - new Date(DATA.generated)) / 864e5 > 20 ? d : null; }
function ageInfo(l, now){
  const cutoff = new Date(now.getFullYear()-(state.filters.maxAge||5), now.getMonth(), 1);
  const built = l.built ? new Date(+l.built.slice(0,4), +l.built.slice(5,7)-1, 1) : null;
  const renovRecent = l.renovated && l.renovated >= cutoff.getFullYear();
  if(renovRecent) return {cls:'ok', label:`kernsaniert ${l.renovated}`, recent:true};
  if(!built && l.by){   // Baujahr-Stufe aus dem Portal-Filter, z. B. [2016,2020]
    const lbl = l.by[0] <= 1900 ? `Baujahr vor ${l.by[1]+1}` : l.by[1] >= now.getFullYear() ? `Baujahr ab ${l.by[0]}` : `Baujahr ${l.by[0]}–${l.by[1]}`;
    if(l.by[0] >= cutoff.getFullYear()) return {cls:'ok', label:lbl, recent:true};
    if(l.by[1] < cutoff.getFullYear()) return {cls:'old', label:lbl, recent:false};
    return {cls:'ok', label:lbl, recent:true};          // Stufe überschneidet die Grenze: lieber zeigen
  }
  if(!built) return {cls:'unknown', label:'Baujahr unbekannt', recent:null};
  const lbl = `Baujahr ${l.built.slice(0,4)}`;
  return built >= cutoff ? {cls:'ok', label:lbl, recent:true} : {cls:'old', label:lbl, recent:false};
}
// FazWaz-Bilder blockieren direktes Einbinden; eigener Cloudflare-Bildproxy (img-proxy/) liefert sie verkleinert aus.
const imgSrc = (u, w=640) => /^https:\/\/(cdn|img)\.fazwaz\.com\//.test(u)
  ? `https://krabi-wohnen-img.tugrulc.workers.dev/?w=${w}&u=${encodeURIComponent(u.replace('/576x384/','/0x0/'))}` : u;
const fmt = n => n==null ? '–' : n.toLocaleString('de-DE');
const eur = thb => DATA?.fx?.rate ? Math.round(thb / DATA.fx.rate) : null;
const isNew = l => { if(!DATA || l.own) return false; const now = new Date(DATA.generated);
  if(l.posted) return (now - new Date(l.posted)) / 864e5 <= 7;
  return !!l.first_seen && (now - new Date(l.first_seen)) / 864e5 <= 7 && (now - new Date(FIRST_RUN)) / 864e5 > 10; };
const FIRST_RUN = '2026-11-24';   // erster Abruf: davor „erstmals gefunden“ ≠ „neu eingestellt“
// Merkliste gilt für alle Gegenden; gespeichert wird eine Kopie, damit gemerkte Inserate überall sichtbar bleiben
const FKEY = 'krabiwohnen.favs.global';
let FAVS = (() => { try { return JSON.parse(localStorage.getItem(FKEY) || '{}'); } catch { return {}; } })();
const saveFavs = () => { try { localStorage.setItem(FKEY, JSON.stringify(FAVS)); } catch {} syncFavTab(); };
const isFav = id => id in FAVS || state.favs.includes(id);
// Zahl der Einschränkungen gegenüber „nichts gefiltert“ (auch die Vorauswahl ab Werk zählt mit)
const activeCount = () => { const N = DEF_OF('thailand'); return Object.keys(DEFAULTS).filter(k => k!=='sort' && state.filters[k]!==N[k]).length; };
// verdächtige Preise im Hintergrund an der Inseratseite prüfen (über den Detail-Dienst, höchstens 6 auf einmal)
let verifying = 0, verifyTimer = null;
function verifyPrices(rows){
  const todo = rows.filter(l => pCheck(l) && !l.detailTried && DETAIL_URL.test(l.url||'')).slice(0, 6 - verifying);
  for(const l of todo){ verifying++; TH.loadDetail(l).finally(() => { verifying--; clearTimeout(verifyTimer); verifyTimer = setTimeout(() => { if($('#detail').hidden) render(); }, 400); }); }
}
// Preis wirkt unplausibel (z. B. 290 m² Villa für 6.500 ฿): markieren, bis die Inseratseite geprüft ist
const pCheck = l => !l.own && !l.price_list && !l.detailLoaded && l.price && (l.size || l.sizeh) >= 80 && l.price / (l.size || l.sizeh) < 35;
// Grundstücke, Büros, Lagerhallen, Läden sind kein Wohnraum (gleiche Regel wie im Abruf; wirkt sofort auch auf ältere Daten)
const NOT_HOME_URL = /\/ads\/(?:studio-|\d+-bedroom-)?(?:warehouse|office|retail-space|land|hotel|whole-building|restaurant|factory)-for-(?:rent|sale)/;
const NOT_HOME_TITLE = /^(?!.*\b(?:houses?|villas?|condos?|apartments?|bedrooms?|beds?|br|homes?|townhouses?|studios?)\b).*\b(?:land|plot|rai|warehouse|factory|office|retail|showroom|restaurant)\b/i;
// Inserate, deren Originalseite der Detail-Dienst lesen kann (Preis, Fotos, Beschreibung)
const DETAIL_URL = /dotproperty\.co\.th\/en\/ads\/|propertyhub\.in\.th\/en\/listings\/|renthub\.in\.th\/en\//;
const srcName = l => l.own ? 'Eigenes Inserat' : /propertyhub/.test(l.url||'') ? 'PropertyHub' : /renthub/.test(l.url||'') ? 'Renthub'
  : /bahtsold/.test(l.url||'') ? 'BahtSold' : /meezub/.test(l.url||'') ? 'Meezub' : /dotproperty/.test(l.url||'') ? 'DotProperty / FazWaz' : (l.source||'').split(' ')[0] || 'Anbieter';
const isHome = l => !(NOT_HOME_URL.test(l.url||'') || (!/dotproperty/.test(l.url||'') && NOT_HOME_TITLE.test(l.title||'')));
// kompakte Entfernungen [km, min, Name, Straße?] -> {km, min, name, road}
function unpackDist(list){
  for(const l of list){ const d = l.dist; if(!d) continue;
    for(const c in d){ const v = d[c]; if(Array.isArray(v)) d[c] = {km:v[0], min:v[1], name:v[2], road:!!v[3]}; } }
}
// Beschreibungen liegen in Teil-Dateien und werden erst beim Öffnen eines Inserats geladen
const descShards = new Map();
function descShard(id){ let h = 0; for(const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 1000003; return h % (DATA?.desc_shards || 32); }
async function loadDesc(l){
  if(l.description || !l.hasDesc || !DATA || DATA.th || l.city && l.city !== CITY) return false;
  const k = CITY + ':' + descShard(l.id);
  if(!descShards.has(k)) descShards.set(k, fetch(`data/${CITY}/d/${descShard(l.id)}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({})));
  const part = await descShards.get(k); if(part[l.id]){ l.description = part[l.id]; return true; } return false;
}
const fmtDesc = t => t.replace(/\s*([•●▪✔✅🔹🔸]|(?<=[.!?])\s+(?=[A-ZÄÖÜ]))\s*/gu, (m, b) => b && b.trim() ? '\n' + b + ' ' : '\n').replace(/\n{3,}/g,'\n\n').trim();
// Beschreibung direkt in der Liste: Vorschau sofort, „Mehr lesen“ klappt den ganzen Text auf (ohne das Inserat zu öffnen)
function cardDesc(l){
  const t = l.description || l.desc; if(!t) return '';
  const short = (l.desc || t.replace(/\s+/g,' ')).slice(0, 260);
  const more = l.description ? l.description.replace(/\s+/g,' ').length > 260 : / …$/.test(l.desc || '');
  return `<div class="cdesc" data-descbox="${esc(l.id)}"><p>${esc(short)}</p>${more ? `<button type="button" class="morebtn" data-more="${esc(l.id)}">Mehr lesen ▾</button>` : ''}</div>`;
}
// ---- Sehenswürdigkeiten (OSM, nur mit Wikipedia-/Wikidata-Eintrag) – Zellen à 1°, bei Bedarf geladen ----
const SIGHTS = {cells:new Map(), idx:null, loading:new Map()};
const hav = (a, b, c, d) => { const R = 6371, x = (c-a)*Math.PI/180, y = (d-b)*Math.PI/180;
  const h = Math.sin(x/2)**2 + Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(y/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
function sightCellsAround(lat, lng){ const ids = []; for(let a = Math.floor(lat-0.15); a <= Math.floor(lat+0.15); a++) for(let b = Math.floor(lng-0.15); b <= Math.floor(lng+0.15); b++) ids.push(`${a}_${b}`); return ids; }
async function ensureSights(rows){
  if(!SIGHTS.idx) SIGHTS.idx = fetch('data/sights/index.json').then(r => r.ok ? r.json() : {cells:[]}).then(j => new Set(j.cells)).catch(() => new Set());
  const have = await SIGHTS.idx; const need = new Set();
  for(const l of rows){ if(l.lat == null) continue; for(const id of sightCellsAround(+l.lat, +l.lng)) if(have.has(id) && !SIGHTS.cells.has(id)) need.add(id); }
  if(!need.size) return false;
  await Promise.all([...need].map(id => { if(!SIGHTS.loading.has(id)) SIGHTS.loading.set(id, fetch(`data/sights/${id}.json`).then(r => r.json()).catch(() => []).then(v => SIGHTS.cells.set(id, v)));
    return SIGHTS.loading.get(id); }));
  return true;
}
function nearSights(l, max = 2, within = 15){
  if(l.lat == null || !SIGHTS.cells.size) return [];
  const la = +l.lat, ln = +l.lng, out = [];
  for(const id of sightCellsAround(la, ln)) for(const s of SIGHTS.cells.get(id) || []){
    if(s[3] === 'Insel' || s[3] === 'Inselgruppe') continue;    // Insel-Mittelpunkt ist kein Ausflugsziel „in der Nähe“
    const km = hav(la, ln, s[0], s[1]); if(km <= within) out.push({lat:s[0], lng:s[1], name:s[2], kind:s[3], km: Math.round(km*1.3*10)/10});
  }
  return out.sort((a, b) => a.km - b.km).slice(0, max);
}
let sightTimer = null;
function loadSightsFor(rows){ ensureSights(rows.slice(0, 400)).then(nw => { if(nw){ clearTimeout(sightTimer); sightTimer = setTimeout(() => { if($('#detail').hidden && $('#lightbox')?.hidden !== false) render(); }, 150); } }); }
function markCoarse(list){
  const g = new Map();
  for(const l of list){ if(l.lat==null) continue; const k = (+l.lat).toFixed(5)+','+(+l.lng).toFixed(5); (g.get(k) || g.set(k, []).get(k)).push(l); }
  for(const arr of g.values()){
    if(arr.length < 3) continue;
    const names = new Set(arr.map(l => (l.title||'').toLowerCase().replace(/[^a-z0-9ก-๙ ]/g,'').split(' ').filter(w=>w.length>3).slice(0,2).join(' ')));
    if(names.size >= Math.max(2, arr.length/3)) for(const l of arr){ l.approx = true; l.coarse = true; }
  }
  return list;
}
function favSnap(l){ const keep = ['id','url','title','price','lat','lng','beds','baths','size','sizeh','sz','built','by','built_src','images','source','first_seen','posted','pool','approx','prov','furniture','available','dist','seller','type','area','description','own','th'];
  const o = {}; for(const k of keep) if(l[k] !== undefined) o[k] = k==='images' ? (l.images||[]).slice(0,6) : l[k]; o.city = CITY; o.saved = new Date().toISOString().slice(0,10); return o; }
function toggleFav(id){
  const l = getListing(id); if(!l) return;
  if(isFav(id)){ delete FAVS[id]; for(const c of Object.keys(CITIES)){ const st = c===CITY ? state : load(c); if(st.favs.includes(id)){ st.favs = st.favs.filter(x=>x!==id); localStorage.setItem(KEY_OF(c), JSON.stringify(st)); } } }
  else FAVS[id] = favSnap(l);
  saveFavs();
}
function getListing(id){ return allListings().find(x=>x.id===id) || (FAVS[id] ? {...FAVS[id]} : null); }
function migrateFavs(){   // alte Merklisten (je Stadt) übernehmen, sobald das Inserat geladen ist
  let ch = false; for(const id of state.favs){ if(!FAVS[id]){ const l = allListings().find(x=>x.id===id); if(l){ FAVS[id] = favSnap(l); ch = true; } } }
  if(ch) saveFavs();
}
function favRows(){
  const here = new Map(allListings().map(l=>[l.id,l]));
  const ids = new Set([...Object.keys(FAVS), ...state.favs]);
  return [...ids].map(id => here.get(id) || (FAVS[id] && {...FAVS[id], elsewhere: FAVS[id].city !== CITY})).filter(Boolean);
}
function syncFavTab(){ const t = $('#tabFav'); if(t){ const n = new Set([...Object.keys(FAVS), ...state.favs]).size; t.textContent = n ? `★ Merken (${n})` : '★ Merken'; } }
function favEmpty(){ return '<p class="empty">Noch nichts gemerkt – tippe ☆ auf einem Inserat. Die Merkliste gilt für alle Gegenden.</p>'; }
// Seit wann online: DotProperty nennt das Einstelldatum; sonst „bei uns seit“ (erstmals von der App gefunden)
function onlineInfo(l){
  const d = l.posted || l.first_seen; if(!d || l.own) return null;
  const days = Math.max(0, Math.round((new Date(DATA?.generated || Date.now()) - new Date(d)) / 864e5));
  const dt = new Date(d).toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit', year:'numeric'});
  const ago = days === 0 ? 'heute' : days === 1 ? '1 Tag' : days < 60 ? `${days} Tage` : days < 730 ? `${Math.floor(days/30.4)} Monate` : `über ${Math.floor(days/365)} Jahre`;
  return { posted: !!l.posted, date: dt, days, label: l.posted ? `online seit ${dt}` : `bei uns seit ${dt}`, ago };
}
const sizeOf = l => l.size ?? l.sizeh ?? (l.sz ? (l.sz[1] >= 9999 ? l.sz[0] : (l.sz[0]+l.sz[1])/2) : null);
const sizeTxt = l => l.size ? `${fmt(l.size)} m²` : l.sizeh ? `≈ ${fmt(l.sizeh)} m²` : l.sz ? (l.sz[1] >= 9999 ? `ab ${l.sz[0]} m²` : l.sz[0] === 0 ? `bis ${l.sz[1]} m²` : `${l.sz[0]}–${l.sz[1]} m²`) : null;
const PROVNAME = k => (k||'').replace(/-/g,' ').replace(/\b\w/g, c => c.toUpperCase());

function filtered(onlyFav=false){
  if(!DATA) return {rows:[], hidden:{}};
  const f = state.filters, now = new Date(DATA.generated), soonLimit = new Date(now); soonLimit.setMonth(soonLimit.getMonth()+2);
  const hidden = {old:0, unknown:0, pool:0, size:0, sizeMax:0, price:0, beach:0, soon:0};
  const rows = onlyFav ? favRows() : [];
  for(const l of onlyFav ? [] : allListings()){
    if(onlyFav) continue;
    if(l.own){ rows.push(l); continue; }          // eigene Inserate immer zeigen
    const a = ageInfo(l, now);
    if(a.recent===false && !f.old){ hidden.old++; continue; }
    if(a.recent===null && !f.unknown){ hidden.unknown++; continue; }
    if(f.owner && l.seller!=='Eigentümer'){ hidden.owner=(hidden.owner||0)+1; continue; }
    if(f.pool && !l.pool){ hidden.pool++; continue; }
    const sv = l.size ?? l.sizeh;
    if(sv == null && !l.sz){
      if((f.size || f.sizeMax < 400) && !f.sizeUnknown){ hidden.sizeUnknown=(hidden.sizeUnknown||0)+1; continue; }
    } else if(sv != null){
      if(f.size && !(sv >= f.size)){ hidden.size++; continue; }
      if(f.sizeMax < 400 && sv > f.sizeMax){ hidden.sizeMax++; continue; }
    } else {
      if(f.size && l.sz[1] < f.size){ hidden.size++; continue; }
      if(f.sizeMax < 400 && l.sz[0] > f.sizeMax){ hidden.sizeMax++; continue; }
    }
    if(f.price < 150000 && !(l.price <= f.price)){ hidden.price++; continue; }
    const b = l.dist?.Strand?.km;
    if(f.beach < 30 && b != null && b > f.beach){ hidden.beach++; continue; }
    if(f.soon){ const av = parseAvail(l.available); if(av && av > soonLimit){ hidden.soon++; continue; } }
    rows.push(l);
  }
  const by = {
    price:(a,b)=>(a.price||1e9)-(b.price||1e9),
    priceDesc:(a,b)=>(b.price||0)-(a.price||0),
    sqm:(a,b)=>((a.price||1e9)/(sizeOf(a)||1e9))-((b.price||1e9)/(sizeOf(b)||1e9)),
    new:(a,b)=>String(b.posted||b.first_seen).localeCompare(String(a.posted||a.first_seen)) || (a.price-b.price),
    beach:(a,b)=>(a.dist?.Strand?.km??99)-(b.dist?.Strand?.km??99),
    mosque:(a,b)=>(a.dist?.Moschee?.km??99)-(b.dist?.Moschee?.km??99),
    market:(a,b)=>(a.dist?.Markt?.km??99)-(b.dist?.Markt?.km??99),
    seven:(a,b)=>(a.dist?.['7-Eleven']?.km??99)-(b.dist?.['7-Eleven']?.km??99),
    gym:(a,b)=>(a.dist?.['Muay Thai']?.km??99)-(b.dist?.['Muay Thai']?.km??99),
    size:(a,b)=>(sizeOf(b)||0)-(sizeOf(a)||0),
  }[state.filters.sort] || ((a,b)=>a.price-b.price);
  rows.sort(by);
  if(state.filters.sort === 'price'){ const ok = rows.filter(l => !pCheck(l)), chk = rows.filter(pCheck); rows.length = 0; rows.push(...ok, ...chk); }
  verifyPrices(rows);
  loadSightsFor(rows);
  return {rows, hidden};
}

function card(l){
  const a = ageInfo(l, new Date(DATA.generated));
  const pics = (l.images||[]).slice(0,6);
  const img = pics.length ? `<div class="media"><div class="cgal" data-gal>${pics.map((u,i)=>`<img loading="lazy" ${i?'data-src':'src'}="${esc(imgSrc(u,640))}" decoding="async" alt="Foto ${i+1} von ${pics.length}" draggable="false">`).join('')}</div>
      ${pics.length>1?`<div class="cdots" aria-hidden="true">${pics.map((_,i)=>`<i class="${i?'':'on'}"></i>`).join('')}</div><span class="ccount">1/${pics.length}</span>
      <button class="cnav prev" data-nav="-1" aria-label="Vorheriges Foto">‹</button><button class="cnav next" data-nav="1" aria-label="Nächstes Foto">›</button>`:''}</div>` : `<div class="noimg">🏠</div>`;
  const e = eur(l.price);
  const d = l.dist || {};
  // alle Entfernungen direkt in der Liste (bei grober Lage nur „ca.“)
  const distTxt = DISTCATS.filter(k=>d[k]).map(k=>`<span class="dchip" title="${esc(k)}: ${esc(d[k].name||'')}">${k==='7-Eleven'?'<b class="d711">7-11</b>':TXTICON(k)} ${l.approx?'ca. ':''}${String(d[k].km).replace('.',',')} km${d[k].min!=null && !l.approx?` <small>${d[k].min} min</small>`:''}</span>`).join('');
  const sg = nearSights(l, 2, 15);
  return `<article class="card" data-id="${esc(l.id)}" tabindex="0" aria-label="${esc(l.title)}">
    ${img}
    <div class="badges">${l.seller==='Eigentümer'?'<span class="badge owner">Eigentümer</span>':''}${l.approx&&!l.own&&l.lat!=null?'<span class="badge approx" title="Lage nur ungefähr: der Anbieter nennt nur den Ortsteil">Lage ≈</span>':''}${l.own?`<span class="badge own">Eigenes${/facebook\.com|fb\.me/i.test(l.url||'')?' · Facebook':''}</span>`:''}${isNew(l)?'<span class="badge new" title="in den letzten 7 Tagen eingestellt">NEU eingestellt</span>':''}${l.price_before && l.price_before>l.price?'<span class="badge drop">Preis ↓</span>':''}${pCheck(l)?'<span class="badge warnb" title="Ungewöhnlich günstig für die Fläche – Preis beim Anbieter prüfen">Preis prüfen</span>':''}${l.price_list && l.price_list !== l.price ? `<span class="badge fixp" title="Die Suchliste nannte ${fmt(l.price_list)} ฿ – übernommen wurde der Preis der Inseratseite">Preis laut Inserat</span>` : ''}${l.gone ? '<span class="badge warnb">nicht mehr online</span>' : ''}</div>
    <button class="fav" data-fav="${esc(l.id)}" aria-label="Merken" aria-pressed="${isFav(l.id)}">${isFav(l.id)?'★':'☆'}</button>
    <div class="body">
      <div class="price">${l.price_max > l.price ? '<small>ab</small> ' : ''}${fmt(l.price)} ฿ <small>/ Monat${e?` · ≈ ${fmt(e)} €`:''}</small></div>
      <div class="title">${esc(l.title)}</div>
      <div class="srcline">${esc(srcName(l))}${l.kind ? ` · ${esc(l.kind)}` : ''}</div>
      ${(o => o ? `<div class="online ${o.days<=7?'fresh':''}" title="${o.posted?'Einstelldatum beim Anbieter':'Datum, an dem die App das Inserat zuerst gefunden hat'}">🕒 ${esc(o.label)} (${esc(o.ago)})</div>` : '')(onlineInfo(l))}
      <div class="facts">
        ${l.elsewhere?`<span class="tag area">${esc(CITIES[l.city]?.name||l.city)}</span>`:''}${sizeTxt(l)?`<span class="tag">${sizeTxt(l)}</span>`:''}${l.th && l.prov && !l.full?`<span class="tag area">📍 ${esc(PROVNAME(l.prov))}</span>`:''}${l.area && !['Pattaya','Krabi'].includes(l.area)?`<span class="tag area">📍 ${esc(l.area.split(' / ')[0])}</span>`:''}
        ${l.beds!=null?`<span class="tag grey" title="Schlafzimmer">${l.beds===0?'Studio':l.beds+' Schlafz.'}</span>`:''}
        <span class="tag ${a.cls==='ok'?'':a.cls==='old'?'warn':'grey'}">${esc(a.label)}</span>
        ${l.pool?`<span class="tag">${l.pool==='privat'?'Privatpool':'Pool'}</span>`:''}
        ${/for sale|sale\s*(?:&|and|\/)\s*rent|rent\s*(?:&|and|\/)\s*sale/i.test(l.title||'') && !l.own ? '<span class="tag grey" title="Laut Titel auch zum Kauf – angezeigt wird die Monatsmiete">auch zu kaufen</span>' : ''}
        ${(d => d ? `<span class="tag avail">frei ab ${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}</span>` : '')(availLater(l))}
        ${/fully/i.test(l.furniture||'')?'<span class="tag grey">möbliert</span>':''}
      </div>
      ${cardDesc(l)}
      ${distTxt?`<div class="dist">${distTxt}${l.th && !l.full?' <small class="est">(geschätzt)</small>':''}</div>`:'<div class="dist">Lage im Inserat nicht verortet</div>'}
      ${sg.length ? `<div class="csights">${sg.map(x => `<span>${esc(x.name)} <small>${esc(x.kind)} · ${l.approx?'ca. ':''}${String(x.km).replace('.',',')} km</small></span>`).join('')}</div>` : ''}
    </div></article>`;
}

const PROV_HINT = {'surat-thani':'Koh Samui, Koh Phangan', chonburi:'Pattaya, Si Racha', 'prachuap-khiri-khan':'Hua Hin', 'phang-nga':'Khao Lak',
  trat:'Koh Chang', songkhla:'Hat Yai', krabi:'Ao Nang, Koh Lanta', phetchaburi:'Cha-am', rayong:'Ban Chang, Koh Samet', phuket:'Patong, Rawai'};
function thPicker(){
  const provs = TH.idx?.provinces || [];
  return `<div class="thpick"><p class="intro"><b>Mietwohnungen und -häuser in Thailand</b> – mit Preis in Euro und dem Weg zu Strand, Moschee, Muay Thai, 7-Eleven und Markt.</p><div class="quick"><button type="button" class="primary" data-city="krabi">Krabi / Ao Nang ›</button><button type="button" class="primary" data-city="pattaya">Pattaya & Umgebung ›</button></div><p class="muted small">Diese zwei Gegenden sind am ausführlichsten (Straßen-km, Fahrzeit, mehr Fotos).</p><p class="empty">Oder wähle eine Gegend – oder zoome auf der <b>Karte</b> hinein. Die Zahl nennt alle Inserate der Provinz (vor deinen Filtern).</p>
    <div class="provs">${provs.map(p=>`<button type="button" data-prov="${esc(p.key)}">${esc(p.name)}${PROV_HINT[p.key]?` <em>${PROV_HINT[p.key]}</em>`:''} <small>${fmt(p.n)}</small></button>`).join('')}</div></div>`;
}
function regionBar(){   // über der Liste: welche Gegend gezeigt wird + zurück zur Übersicht
  if(!DATA?.th || !TH.bounds) return '';
  const r = state.region, inView = TH.listingsIn(TH.bounds).length;
  return `<div class="regionbar"><span>📍 <b>${esc(r?.name || 'Kartenausschnitt')}</b> <small>${r?.n && r.n > inView ? `– Umkreis um das Zentrum, ${fmt(inView)} von ${fmt(r.n)} Inseraten der Provinz. Auf der Karte verschieben zeigt mehr.` : ''}</small></span>
    <button type="button" class="linkbtn" data-overview>✕ Alle Gegenden</button>
    ${({krabi:'krabi', chonburi:'pattaya'})[r?.key] ? `<button type="button" class="linkbtn" data-city="${({krabi:'krabi', chonburi:'pattaya'})[r.key]}">Ausführlich mit Straßen-km: ${r.key==='krabi'?'Krabi':'Pattaya'} ›</button>` : ''}</div>`;
}
function render(){
  if(!DATA) return;
  const onlyFav = view==='fav';
  if(DATA.th && !onlyFav && view!=='map' && view!=='info'){
    const inView = TH.bounds ? TH.countIn(TH.bounds) : 0;
    if(!TH.bounds || inView > TH.LOAD_LIMIT || !TH.listingsIn(TH.bounds).length && !TH.loadingT.size){
      $('#summary').textContent = TH.bounds && inView > TH.LOAD_LIMIT ? `${fmt(inView)} Inserate im Kartenausschnitt – bitte näher heranzoomen oder eine Gegend wählen` : `${fmt(TH.idx?.count||0)} Inserate an Thailands Küsten und in Chiang Mai`;
      $('#list').innerHTML = thPicker(); return;
    }
  }
  setTimeout(renderPlaces, 0);
  setTimeout(() => { const l = $('#list'); if(DATA?.th && !onlyFav && view!=='map' && view!=='info' && !l.querySelector('.regionbar')) l.insertAdjacentHTML('afterbegin', regionBar()); }, 0);
  const {rows, hidden} = filtered(onlyFav);
  const parts = [];
  if(hidden.old) parts.push(`${hidden.old} älter als ${state.filters.maxAge} J.`);
  if(hidden.unknown) parts.push(`${hidden.unknown} ohne Baujahr`);
  if(hidden.pool) parts.push(`${hidden.pool} ohne Pool`);
  if(hidden.owner) parts.push(`${hidden.owner} von Maklern`);
  if(hidden.size) parts.push(`${hidden.size} zu klein`);
  if(hidden.sizeMax) parts.push(`${hidden.sizeMax} zu groß`);
  if(hidden.sizeUnknown) parts.push(`${hidden.sizeUnknown} ohne m²-Angabe`);
  if(hidden.price) parts.push(`${hidden.price} zu teuer`);
  if(hidden.beach) parts.push(`${hidden.beach} zu weit vom Strand`);
  if(hidden.soon) parts.push(`${hidden.soon} erst später frei`);
  $('#summary').textContent = onlyFav ? (rows.length===1 ? '1 gemerktes Inserat' : `${rows.length} gemerkte Inserate`) + ' · aus allen Gegenden' :
    `${fmt(rows.length)} von ${DATA.th ? fmt(allListings().length) + ' im Ausschnitt' : fmt(DATA.count + state.own.length) + ' Inseraten'}` + (parts.length ? ` · ausgeblendet: ${parts.join(', ')}` : '');
  listRows = rows; shown = 0;
  const hidN = Object.values(hidden).reduce((a,b)=>a+(b||0),0);
  $('#list').innerHTML = rows.length ? '' : onlyFav ? favEmpty() :
    `<div class="emptybox"><p class="empty">Keine Treffer${hidN?` – ${fmt(hidN)} Inserate sind durch deine Filter ausgeblendet`:''}.</p>
      ${hidN?`<div class="emptyacts">${hidden.unknown?`<button type="button" class="primary" data-relax="unknown">Auch ohne Baujahr zeigen (${fmt(hidden.unknown)})</button>`:''}
      ${hidden.old?`<button type="button" class="ghost" data-relax="old">Auch ältere zeigen (${fmt(hidden.old)})</button>`:''}
      <button type="button" class="ghost" data-relax="all">Alle Filter aus</button></div>`:''}</div>`;
  if(rows.length && view!=='map' && view!=='info') moreCards();
  if(rows.length && !onlyFav && hidN) $('#list').insertAdjacentHTML('afterbegin',
    `<div class="hidehint"><span>Filter aktiv (${activeCount()}): ${fmt(hidN)} von ${fmt(rows.length + hidN)} Inseraten ausgeblendet${hidden.unknown ? ` – ${fmt(hidden.unknown)} davon nennen kein Baujahr` : ''}.</span>
      <span>${hidden.unknown?`<button type="button" class="linkbtn" data-relax="unknown">Ohne Baujahr auch zeigen</button> · `:''}<button type="button" class="linkbtn" data-relax="all">Alle ${fmt(rows.length + hidN)} zeigen</button></span></div>`);
  const active = activeCount();
  $('#filterCount').textContent = active || '';
  const fc = $('#fClose'); if(fc && !onlyFav) fc.textContent = rows.length ? `${fmt(rows.length)} ${rows.length===1?'Inserat':'Inserate'} zeigen` : 'Keine Treffer – Filter lockern';
  if(view==='map') drawMap(rows);
  if(view==='info') renderInfo();
  const sub = document.getElementById('oldSub'); if(sub) sub.textContent = `Baujahr vor ${new Date(DATA.generated).getFullYear()-state.filters.maxAge} und nicht kernsaniert`;
}

// Liste in Portionen: Safari auf dem iPhone stürzt sonst bei Hunderten Karten mit Fotos ab.
const PAGE = 30; let listRows = [], shown = 0, moreObs = null;
function moreCards(){
  const list = $('#list'); list.querySelector('.more')?.remove();
  const next = listRows.slice(shown, shown + PAGE); shown += next.length;
  list.insertAdjacentHTML('beforeend', next.map(card).join(''));
  if(shown < listRows.length){
    list.insertAdjacentHTML('beforeend', `<button class="more" type="button">${listRows.length-shown <= PAGE ? `Letzte ${listRows.length-shown} anzeigen` : `Weitere ${PAGE} anzeigen (noch ${fmt(listRows.length-shown)})`}</button>`);
    const btn = list.querySelector('.more'); btn.onclick = moreCards;
    if('IntersectionObserver' in window){
      moreObs?.disconnect();
      moreObs = new IntersectionObserver(es => { if(es.some(x=>x.isIntersecting)){ moreObs.disconnect(); moreCards(); } }, {rootMargin:'600px'});
      moreObs.observe(btn);
    }
  }
  bindGalleries();
  watchPhotoCards();
}
// Thailand-Inserate haben in der Liste zunächst nur 1 Foto. Sichtbare Karten laden die weiteren Fotos
// (und Fläche/Baujahr) beim Detail-Dienst nach – dann kann man wie gewohnt wischen.
let photoObs = null, photoBusy = 0; const photoQ = [];
function photoPump(){
  while(photoBusy < 3 && photoQ.length){
    const l = photoQ.shift(); if(l.detailTried) continue; photoBusy++;
    TH.loadDetail(l).finally(() => { photoBusy--; refreshCard(l); photoPump(); });
  }
}
function refreshCard(l){
  const el = document.querySelector(`.card[data-id="${CSS.escape(l.id)}"]`); if(!el) return;
  if(!l.price_list && !l.gone && (l.images||[]).length === el.querySelectorAll('[data-gal] img').length && (!l.description || el.querySelector('.cdesc'))) return;   // nichts geändert
  const wasOpen = el.querySelector('.cdesc.open'), pos = el.querySelector('[data-gal]')?.scrollLeft || 0;
  const x = document.createElement('div'); x.innerHTML = card(l); const nu = x.firstElementChild; el.replaceWith(nu); bindGalleries();
  if(wasOpen){ const box = nu.querySelector('.cdesc'); box?.classList.add('open'); if(box){ box.querySelector('p').textContent = fmtDesc(l.description || l.desc); const mb = box.querySelector('.morebtn'); if(mb) mb.textContent = 'Weniger ▴'; } }
  if(pos){ const g = nu.querySelector('[data-gal]'); if(g){ wakeImgs(g); g.scrollLeft = pos; } }
}
function watchPhotoCards(){
  if(!DATA || !('IntersectionObserver' in window)) return;
  photoObs ||= new IntersectionObserver(es => { for(const e of es){ if(!e.isIntersecting) continue; photoObs.unobserve(e.target);
    const l = getListing(e.target.dataset.id); if(!l) continue;
    if(l.hasDesc && !l.desc && !l.description) loadDesc(l).then(ok => ok && refreshCard(l));      // Beschreibung für die Liste
    if(!l.detailTried && !l.own && DETAIL_URL.test(l.url||'')){ photoQ.push(l); photoPump(); } } }, {rootMargin:'900px 0px'});
  document.querySelectorAll('#list .card:not([data-pw])').forEach(c => { c.dataset.pw = 1; photoObs.observe(c); });
}

function buildPoiLayers(){
  for(const g of Object.values(poiLayers)) { g.clearLayers(); }
  for(const c of Object.keys(POICOL)) poiLayers[c] = poiLayers[c] || L.layerGroup();
  for(const p of DATA.pois){
    const [c,e] = POICOL[p.cat] || ['#555','•'];
    const boat = p.cat==='Strand' && p.boat;
    L.marker([p.lat,p.lng], {icon:L.divIcon({className:'', html:`<div class="poi${boat?' boat':''}${p.cat==='7-Eleven'?' seven':''}" style="background:${c}">${e}</div>`, iconSize:[26,26], iconAnchor:[13,13]}), zIndexOffset:-100})
      .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.cat)}${boat?' – nur mit dem Boot erreichbar':''}${p.note?`<br>${esc(p.note)}`:''}<br><a target="_blank" rel="noopener" href="${esc(gmPlace(p.lat,p.lng))}">📍 Google Maps</a>`)
      .addTo(poiLayers[p.cat] || (poiLayers[p.cat]=L.layerGroup()));
  }
}
// ---- Thailand: Ausschnitt laden ----
let thTimer = 0, thBubbles = null, canvasR = null;
function thBoundsOf(m){ const b = m.getBounds(); return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]; }
async function thMoved(){
  if(!DATA?.th || !map || $('#viewMap').hidden) return;     // versteckte Karte hat keine Größe
  const q = thBoundsOf(map);
  if(TH.bounds && state.region && (Math.abs(q[0]-TH.bounds[0]) > 0.02 || Math.abs(q[1]-TH.bounds[1]) > 0.02) && !map._fromGoTo) state.region = null;
  map._fromGoTo = false; TH.bounds = q;
  state.thView = {c:[map.getCenter().lat, map.getCenter().lng], z:map.getZoom()}; save();
  const n = TH.countIn(q);
  if(n <= TH.LOAD_LIMIT){ await TH.ensureTiles(q); }
  if(map.getZoom() >= 10 && await TH.ensurePois(q)){ DATA.pois = TH.poisIn(q); buildPoiLayers(); syncLayers(); }
  else { DATA.pois = []; buildPoiLayers(); syncLayers(); }
  if(DATA.th) render();
}
function drawMap(rows){
  if(!map){
    const tv = DATA.th && state.thView;
    map = L.map('map', {zoomControl:true, preferCanvas:false}).setView(tv ? tv.c : CITIES[CITY].center, tv ? tv.z : (DATA.th ? 6 : 12));
    map.on('click', ev => { if(pickFor){ setOwnPos(pickFor, ev.latlng); } });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {maxZoom:19, attribution:'Karte © Esri, HERE, Garmin, © OpenStreetMap-Mitwirkende'}).addTo(map);
    buildPoiLayers();
    const chips = L.control({position:'topright'});
    chips.onAdd = () => { const d = L.DomUtil.create('div','layerchips'); L.DomEvent.disableClickPropagation(d); return d; };
    chips.addTo(map);
    layer = L.layerGroup().addTo(map);
    const zcls = () => map.getContainer().classList.toggle('far', map.getZoom() < 13);
    map.on('zoomend', zcls); zcls();
    let zt = null; map.on('zoomend', () => { if(!DATA?.th && (view==='map')){ clearTimeout(zt); zt = setTimeout(render, 120); } });
    if(DATA.th){ thBubbles = L.layerGroup().addTo(map); canvasR = L.canvas({padding:0.3});
      map.on('moveend', () => { clearTimeout(thTimer); thTimer = setTimeout(thMoved, 250); });
      setTimeout(thMoved, 60); }
  }
  syncLayers();
  layer.clearLayers();
  const pts = [];
  if(DATA.th){
    thBubbles.clearLayers();
    const q = TH.bounds || thBoundsOf(map), n = TH.countIn(q);
    if(n > TH.LOAD_LIMIT || map.getZoom() < 9){
      // Übersicht: Zahl der Inserate pro Provinz (herausgezoomt) bzw. pro Kachel
      const groups = map.getZoom() < 9 ? (TH.idx?.provinces||[]).map(p=>({lat:p.lat,lng:p.lng,n:p.n,name:p.name})) :
        TH.tilesIn(q).map(t=>({lat:(t.b[0]+t.b[2])/2, lng:(t.b[1]+t.b[3])/2, n:t.n}));
      // Blasen, die sich überdecken würden, zusammenlegen (Mittelpunkt nach Anzahl gewichtet)
      const zz = map.getZoom(), R = n => zz <= 6 ? Math.round(12 + Math.min(9, Math.sqrt(n)/9)) : Math.round(16 + Math.min(26, Math.sqrt(n)/3));
      let gl = groups.filter(g => g.n && g.lat).map(g => ({...g, p: map.latLngToLayerPoint([g.lat, g.lng])}));
      for(let again = true; again;){ again = false;
        outer: for(let i = 0; i < gl.length; i++) for(let j = i+1; j < gl.length; j++){
          const a = gl[i], b = gl[j];
          if(a.p.distanceTo(b.p) < (R(a.n) + R(b.n)) * 0.92){
            const n = a.n + b.n, big = a.n >= b.n ? a : b, lat = big.lat, lng = big.lng;
            gl[i] = {lat, lng, n, name:[a.name, b.name].filter(Boolean).join(' + '), p: map.latLngToLayerPoint([lat, lng])}; gl.splice(j, 1); again = true; break outer;
          }
        }
      }
      for(const g of gl){
        const r = R(g.n);
        L.marker([g.lat,g.lng], {icon:L.divIcon({className:'', html:`<div class="bubble" style="width:${r*2}px;height:${r*2}px">${g.n>=1000?Math.round(g.n/100)/10+'k':g.n}</div>`, iconSize:[r*2,r*2], iconAnchor:[r,r]}), title:g.name||''})
          .on('click', () => map.setView([g.lat,g.lng], Math.max(map.getZoom()+2, g.name?.includes(' + ') ? map.getZoom()+2 : 10))).addTo(thBubbles);
      }
      $('#mapHint') && ($('#mapHint').textContent = `${fmt(n)} Inserate hier (Zahlen vor deinen Filtern) – zum Anzeigen hineinzoomen oder eine Blase antippen`);
      return;
    }

    if(rows.length > 700){   // viele Inserate: schnelle Punkte statt Preisschilder
      const gs = new Map();
      for(const l of rows){ if(l.lat==null) continue; const key = l.lat.toFixed(4)+','+l.lng.toFixed(4); (gs.get(key) || gs.set(key, []).get(key)).push(l); }
      for(const g of gs.values()){
        L.circleMarker([g[0].lat,g[0].lng], {renderer:canvasR, radius: g.length>1 ? Math.min(12, 5+Math.sqrt(g.length)) : 5, weight:1, color:'#fff', fillColor: g[0].approx?'#b0603f':'#0e7a69', fillOpacity:0.9})
          .on('click', () => g.length>1 ? openGroup(g) : openDetail(g[0].id)).addTo(layer); }
      $('#mapHint') && ($('#mapHint').textContent = `${fmt(rows.length)} Inserate auf ${fmt(gs.size)} Punkten – Punkte antippen`);
      drawHighlight();
      return;
    }
  }
  // Inserate am selben Punkt (gleiches Gebäude / nur Ortsteil bekannt) zu einem Pin bündeln – sonst verdecken sie sich
  const exact = new Map();
  for(const l of rows){
    if(l.lat==null || l.lng==null) continue;
    const key = l.lat.toFixed(4)+','+l.lng.toFixed(4);
    (exact.get(key) || exact.set(key, []).get(key)).push(l);
  }
  // Preisschilder, die sich bei dieser Zoomstufe überdecken würden, zu einem Schild zusammenfassen
  const z = map.getZoom(), kf = p => p==null ? '?' : p>=1000 ? Math.round(p/1000)+'k' : String(p);
  const wOf = g => (g.length > 1 ? `${g.length}× ab ${kf(Math.min(...g.map(x=>x.price||1e9)))} ฿` : `${kf(g[0].price)} ฿`).length * 7.5 + 22;
  // ein Durchgang: größere Gruppen zuerst platzieren, überdeckende kleinere hineinlegen (Raster für schnelle Nachbarsuche)
  const src = [...exact.values()].sort((a,b) => b.length - a.length), placed = [], grid = new Map(), CW = 140, CH = 30;
  for(const g of src){
    const p = map.project([g[0].lat, g[0].lng], z), cx = Math.floor(p.x/CW), cy = Math.floor(p.y/CH);
    let hit = null;
    if(z < 18) for(let dx = -1; dx <= 1 && !hit; dx++) for(let dy = -1; dy <= 1 && !hit; dy++)
      for(const c of grid.get((cx+dx)+':'+(cy+dy)) || []) if(Math.abs(c.p.x - p.x) < (c.w + wOf(g))/2 + 2 && Math.abs(c.p.y - p.y) < 28){ hit = c; break; }
    if(hit){ hit.push(...g); hit.spots++; hit.w = wOf(hit); }
    else { const a = [...g]; a.spots = 1; a.p = p; a.w = wOf(a); placed.push(a); const k = cx+':'+cy; (grid.get(k) || grid.set(k, []).get(k)).push(a); }
  }
  const groups = new Map(placed.map((g, i) => [i, g]));
  const kfmt = p => p==null ? '?' : p>=1000 ? Math.round(p/1000)+'k' : p;
  for(const g of groups.values()){
    const l = g[0], many = g.length > 1, min = Math.min(...g.map(x=>x.price||1e9));
    const fav = g.some(x=>isFav(x.id)), approx = g.every(x=>x.approx);
    const html = many ? `<span class="pin grp ${fav?'pfav':''} ${approx?'approx':''}"><b>${g.length}×</b> ab ${kfmt(min<1e9?min:null)} ฿</span>`
                      : `<span class="pin ${fav?'pfav':''} ${approx?'approx':''}">${approx?'≈':''}${kfmt(l.price)} ฿</span>`;
    const m = L.marker([l.lat,l.lng], {icon:L.divIcon({className:'', html, iconSize:[0,0]}), zIndexOffset: many ? 1200 : 1000});
    m.on('click', ev => { if(pickFor){ setOwnPos(pickFor, ev.latlng); return; }
      many ? openGroup(g) : openDetail(l.id); });
    m.addTo(layer); pts.push([l.lat,l.lng]);
  }
  const noPos = rows.filter(l => l.lat==null || l.lng==null).length;
  const hint = $('#mapHint');
  if(hint){
    const raw = DATA.th ? TH.listingsIn(TH.bounds || thBoundsOf(map)).length : DATA.listings.length;
    if(!rows.length && raw && view!=='fav') hint.innerHTML = `Alle ${fmt(raw)} Inserate hier sind durch deine Filter ausgeblendet. <button type="button" class="linkbtn" data-relax="all">Filter aus</button>`;
    else hint.textContent = `${fmt(rows.length - noPos)} Inserate auf ${fmt(groups.size)} Punkten${noPos?` · ${noPos} ohne Kartenpunkt (nur in der Liste)`:''}${raw > rows.length && view!=='fav' ? ` · ${fmt(raw - rows.length)} durch Filter ausgeblendet` : ''}`;
  }
  drawHighlight();
  const doFit = map._fitCity !== CITY + (view==='fav'?':fav':''); map._fitCity = CITY + (view==='fav'?':fav':'');
  setTimeout(()=>{ map.invalidateSize(); if(pts.length && !DATA.th && !hiId && doFit){
    // Ausreißer (falsche Koordinaten beim Anbieter) nicht in den Zoom einbeziehen
    const med = i => [...pts].map(p=>p[i]).sort((a,b)=>a-b)[pts.length>>1], c = [med(0), med(1)];
    const core = pts.filter(p => haversine(p, c) < 60);
    map.fitBounds(core.length ? core : pts, {padding:[30,30], maxZoom:14}); } }, 50);
}
function mapShown(){   // Karte wurde sichtbar (Thailand: Größe neu messen, ggf. gewählte Gegend anfahren)
  if(!map || !DATA?.th) return;
  setTimeout(() => { map.invalidateSize(); const p = map._thPending; map._thPending = null;
    if(p){ map._fromGoTo = true; map.setView(p.c, p.z); } else if(!TH.bounds && !map._thOv){ map._thOv = 1; thOverview(); } else thMoved(); }, 60);
}

function syncLayers(){
  const box = document.querySelector('.layerchips'); if(!box) return;
  const cnt = c => DATA.pois.filter(p=>p.cat===c).length;
  box.innerHTML = Object.keys(POICOL).map(c=>`<button class="chip ${state.layers[c]?'on':''}" data-layer="${esc(c)}" aria-pressed="${!!state.layers[c]}" aria-label="${esc(c)} ein/aus" title="${esc(c)}">${POICOL[c][1]} <span class="lbl">${esc(c)}</span>${DATA.th ? '' : ` <small>${cnt(c)}</small>`}</button>`).join('');
  for(const [c,g] of Object.entries(poiLayers)) state.layers[c] ? map.addLayer(g) : map.removeLayer(g);
}

function renderInfo(){
  const box = $('#info'); if(!KLIMA){ box.innerHTML = '<p class="empty">Infos werden geladen …</p>'; return; }
  if(DATA?.th){
    const i = TH.idx || {}, cov = i.coverage || {};
    const pr = (i.provinces||[]).map(p=>`<tr><td><button class="linkbtn" data-prov="${esc(p.key)}">${esc(p.name)}</button></td><td>${fmt(p.n)}</td></tr>`).join('');
    const src = Object.entries(i.sources||{}).filter(([,v])=>v).map(([k,v])=>`${esc(k)} ${fmt(v)}`).join(' · ');
    const pc = TH.poiIdx?.counts || {};
    box.innerHTML = `<section class="panel"><h2>Thailand – was in der App steckt</h2>
      <p><b>${fmt(i.count)}</b> Mietinserate · ${src}</p>
      <p>Fläche bekannt (genau oder als Stufe): <b>${fmt(cov.sz)}</b> · Baujahr bekannt: <b>${fmt(cov.by)}</b>. Fehlende Angaben stehen oft auf der Inseratsseite – sie werden beim Öffnen nachgeladen.</p>
      <p>Neu seit dem letzten Lauf: ${fmt(i.new_since_last)} · entfernt: ${fmt(i.removed_since_last)}</p>
      ${Object.keys(pc).length?`<p>Auf der Karte: ${fmt(pc['Moschee'])} Moscheen · ${fmt(pc['Muay Thai'])} Muay-Thai-/Box-Gyms · ${fmt(pc['7-Eleven'])} 7-Eleven · ${fmt(pc['Markt'])} Märkte · ${fmt(pc['Strand'])} Strände · ${fmt(pc['Einkauf'])} Einkauf · ${fmt(pc['Krankenhaus'])} Krankenhäuser</p>`:''}
      <p class="muted">${esc(CITIES.thailand.note)} Nicht enthalten: Facebook (verbietet automatisches Auslesen), Livinginsider/DDproperty/Hipflat (sperren es technisch), PropertyHub (AGB). Orte aus OpenStreetMap, Moscheen in Pattaya zusätzlich aus dem CICOT-Verzeichnis.</p></section>
      <section class="panel"><h2>Inserate je Provinz</h2><div class="tablewrap"><table><tr><th>Provinz</th><th>Inserate</th></tr>${pr}</table></div></section>`;
    return;
  }
  const ci = KLIMA.cities[CITY], name = CITIES[CITY].name;
  const mon = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const k = KLIMA.places[ci.home].rain_days_month, h = KLIMA.places[ci.compare].rain_days_month;
  const cname = ci.compare.replace(/ \(.*\)$/,'').replace('Ao Nang/','');
  const bars = mon.map((m,i)=>`<div class="bar"><div class="pair"><i style="height:${k[i]*2.6}px;background:#0e7a69" title="${esc(name)} ${k[i]}"></i><i style="height:${h[i]*2.6}px;background:#c9822b" title="${esc(cname)} ${h[i]}"></i></div><small class="bv" style="color:#0e7a69">${k[i]}</small>${m}</div>`).join('');
  const notes = {'Ao Nang/Krabi (TH)':'Strände, viele Moscheen, Muay Thai','Pattaya (TH)':'Großstadt, viel Auswahl, Moscheen & Gyms','Hua Hin (TH)':'am trockensten, wenige Moscheen','Langkawi (MY)':'muslimisch, kaum Muay Thai','Lombok/Kuta (ID)':'muslimisch, Regen Nov–März','Da Nang (VN)':'kaum Moscheen'};
  const rows = Object.entries(KLIMA.places).sort((a,b)=>a[1].rain_days_year-b[1].rain_days_year)
    .map(([n,v])=>`<tr class="${n===ci.home?'win':''}"><td>${esc(n)}${notes[n]?`<small class="tnote">${esc(notes[n])}</small>`:''}</td><td>${v.rain_days_year}</td><td>${fmt(v.mm_year)}</td><td>${String(v.tmax_avg).replace('.',',')}</td></tr>`).join('');
  const drive = Object.entries(ci.drive).map(([n,[km,min]])=>`<tr><td>${esc(n)}</td><td>${String(km).replace('.',',')}</td><td>${min}</td></tr>`).join('');
  const nPois = c => DATA ? DATA.pois.filter(p=>p.cat===c && !p.boat).length : 0;
  box.innerHTML = `
    <section class="panel"><h2>Wann ist es in ${esc(name)} trocken?</h2>
      <div class="bars">${bars}</div>
      <p class="muted"><b style="color:#0e7a69">■ ${esc(name)}</b> · <b style="color:#c9822b">■ ${esc(cname)}</b> – Regentage pro Monat. <b>Beste Zeit in ${esc(name)}: ${esc(ci.best)}</b></p></section>
    <section class="panel"><h2>${esc(ci.drive_title)}</h2><table><tr><th>Ziel</th><th>km</th><th>min</th></tr>${drive}</table>
      <p class="muted">${esc(KLIMA.drive_source)}. Mit dem Roller ähnlich.</p></section>
    <section class="panel"><h2>Was in ${esc(name)} auf der Karte ist</h2>
      <p>${nPois('Moschee')} Moscheen · ${nPois('Muay Thai')} Muay-Thai-/Box-Gyms · ${nPois('7-Eleven')} 7-Eleven · ${nPois('Markt')} Nacht- und Essensmärkte · ${nPois('Einkauf')} Supermärkte und Einkaufszentren · ${nPois('Krankenhaus')} Krankenhäuser · ${nPois('Strand')} Strände ohne Boot erreichbar</p>
      <p class="muted">Orte aus OpenStreetMap (dort fehlende Orte fehlen auch hier). ${CITY==="pattaya"?"Moscheen zusätzlich aus dem offiziellen Moschee-Verzeichnis des Zentralen Islamkomitees Thailands (CICOT) und Gebets-Verzeichnissen ergänzt, Lage mit mindestens einer Kartenquelle geprüft. ":""}${esc(CITIES[CITY].note)}</p></section>
    <section class="panel"><h2>Wetter-Vergleich der geprüften Orte</h2>
      <div class="tablewrap"><table><tr><th>Ort</th><th>Regen&shy;tage</th><th>mm</th><th>Ø max °C</th></tr>${rows}</table></div>
      <p class="muted">${esc(KLIMA.source)}. Modelldaten zählen eher zu viele Regentage; für den Vergleich untereinander taugen sie.</p></section>`;
}

// Google Maps: Position als Pin anzeigen (von dort Route starten) bzw. Route vom Objekt zum Ziel (Roller)
function gmPlace(lat, lng){ return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`; }
function gmRoute(from, to){ return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=two-wheeler`; }
const APP_URL = 'https://tugi01.github.io/krabi-wohnen/';
function toast(msg, ms = 2200){
  let el = $('#toast'); if(!el){ el = document.createElement('div'); el.id='toast'; el.className='toast'; el.setAttribute('role','status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(()=>el.classList.remove('show'), ms);
}
async function shareData(data){
  if(navigator.share){ try { await navigator.share(data); return; } catch(err){ if(err && err.name==='AbortError') return; } }
  const txt = `${data.text}\n${data.url}`;
  try { await navigator.clipboard.writeText(txt); toast('Link kopiert – jetzt einfügen und senden'); }
  catch { prompt('Link kopieren:', data.url); }
}
function shareListing(id){
  const l = getListing(id); if(!l) return;
  const e = eur(l.price), a = ageInfo(l, new Date(DATA.generated)), d = l.dist || {};
  const bits = [`${fmt(l.price)} ฿/Monat${e?` (≈ ${fmt(e)} €)`:''}`, l.size?`${fmt(l.size)} m²`:null, l.beds!=null?`${l.beds} Schlafzimmer`:null, a.label, l.pool?(l.pool==='privat'?'Privatpool':'Pool'):null].filter(Boolean).join(' · ');
  const near = ['Strand','Moschee','Muay Thai'].filter(k=>d[k]).map(k=>`${k} ${String(d[k].km).replace('.',',')} km`).join(', ');
  shareData({ title: l.title, text: `🏠 ${l.title}\n${bits}${near?`\n${near}`:''}\nIn der App: ${APP_URL}${linkOf(l)}`, url: l.url });
}
function shareApp(){ shareData({ title:'Thailand Wohnen', text:'🏝 Thailand Wohnen – Mietwohnungen in ganz Thailand auf einer Karte, täglich aktualisiert', url: APP_URL }); }

function openDetail(id){
  const l = getListing(id); if(!l) return;
  const a = ageInfo(l, new Date(DATA.generated)), e = eur(l.price), d = l.dist || {};
  const gal = (l.images||[]).map(u=>`<img loading="lazy" src="${esc(imgSrc(u,828))}" alt="">`).join('');
  const rows = [
    ['Miete', `${fmt(l.price)} ฿ / Monat${e?` (≈ ${fmt(e)} €)`:''}${l.price_before?` · vorher ${fmt(l.price_before)} ฿`:''}`],
    ['Fläche', sizeTxt(l)?`${sizeTxt(l)}${l.price&&sizeOf(l)?` · ca. ${fmt(Math.round(l.price/sizeOf(l)))} ฿/m²`:''}`:'–'],
    ['Zimmer', `${l.beds??'–'} Schlafzimmer · ${l.baths??'–'} Bad`],
    ['Gebäude', `${a.label}${l.built_src?` (Quelle: ${l.built_src})`:''}`],
    ['Typ', deTxt(l.type)||'–'], ['Möbliert', deTxt(l.furniture)||'–'], ['Pool', l.pool?(l.pool==='privat'?'privater Pool':'Gemeinschaftspool'):'kein Pool angegeben'],
    ...(l.price_list && l.price_list !== l.price ? [['Preis-Hinweis', `Die Suchliste des Anbieters nannte ${fmt(l.price_list)} ฿ – auf der Inseratseite stehen ${fmt(l.price)} ฿.`]] : []),
    ...(pCheck(l) ? [['Preis-Hinweis', 'Ungewöhnlich günstig für die Fläche – bitte beim Anbieter prüfen.']] : []),
    ['Frei ab', l.available ? deDate(l.available) : 'nicht angegeben'], ['Haustiere', deTxt(l.pets)||'–'],
    ...(l.area ? [['Gegend', l.area]] : []),
    ...(l.rooms?.length ? [['Zimmer im Haus', l.rooms.map(r => `${deTxt((r[0]||'').replace(/_/g,' ').toLowerCase())||'Zimmer'}: ${r[2] && r[2] !== r[1] ? `${r[1]}–${r[2]}` : (r[1]||'?')} m², ${fmt(r[3])}${r[4] && r[4] !== r[3] ? `–${fmt(r[4])}` : ''} ฿`).join(' · ')]] : []),
    ['Portal', srcName(l)], ['Anbieter', l.seller||'–'], ['Online seit', l.posted ? `${onlineInfo(l).date} (${onlineInfo(l).ago}, laut Anbieter)` : 'Anbieter nennt kein Einstelldatum'], ['Aktualisiert', l.updated ? deDate(l.updated) : '–'], ['Bei uns seit', l.first_seen ? new Date(l.first_seen).toLocaleDateString('de-DE') : '–'], ['Quelle', (l.source||'–') + (l.also?.length ? ` (auch bei ${l.also.map(a=>a.source + (a.price ? ` für ${fmt(a.price)} ฿` : '')).join(', ')})` : '')],
    ...(l.approx && !l.own ? [['Lage', 'nur ungefähr (Ortsteil) – genaue Adresse beim Anbieter erfragen']] : []),
    ...(l.th && !l.full ? [['Provinz', PROVNAME(l.prov)]] : []),
    ...(l.gone ? [['Status', 'Beim Anbieter nicht mehr online – wird beim nächsten Lauf entfernt']] : []),
  ];
  const dist = DISTCATS.filter(k=>d[k]).map(k=>{
    const poi = d[k].lat!=null ? {lat:d[k].lat, lng:d[k].lng} : l.lat!=null ? (DATA.pois||[]).filter(p=>p.cat===k && p.name===d[k].name)
      .sort((a,b)=>Math.hypot(a.lat-l.lat,a.lng-l.lng)-Math.hypot(b.lat-l.lat,b.lng-l.lng))[0] : null;
    return [`${TXTICON(k)==='7-11'?'🏪':TXTICON(k)} ${k}`, `${l.approx?'ca. ':''}${String(d[k].km).replace('.',',')} km${d[k].min!=null && !l.approx?`, ca. ${d[k].min} min`:''}${l.approx?' (Lage nur ungefähr)':d[k].road?'':' (geschätzt)'} – ${d[k].name}`,
      poi ? gmRoute(l, poi) : null];
  });
  const sights = nearSights(l, 5, 20).map(x => [`⭐ ${x.kind}`, `ca. ${String(x.km).replace('.',',')} km – ${x.name}`, gmRoute(l, x)]);
  if(!sights.length && l.lat != null) ensureSights([l]).then(nw => { if(nw && !$('#detail').hidden && $('#detail [data-fav]')?.dataset.fav === l.id) openDetail(l.id); });
  const nav = l.lat!=null ? gmPlace(l.lat, l.lng) : null;
  const back = lastGroup ? `<button class="close back" aria-label="Zurück zur Liste">‹ ${lastGroup.length}</button>` : `<button class="close" aria-label="Schließen">✕</button>`;
  $('#detail').innerHTML = `<div class="grab"></div>${back}
    ${gal?`<div class="gallery">${gal}</div>`:''}
    <h2 id="dTitle">${esc(l.title)}</h2>
    <dl>${[...rows, ...dist, ...sights].map(([k,v,u])=>`<dt>${esc(k)}</dt><dd>${esc(v)}${u?` <a class="rlink" href="${esc(u)}" target="_blank" rel="noopener" aria-label="Route vom Objekt zu ${esc(k)} in Google Maps">Route ↗</a>`:''}</dd>`).join('')}</dl>
    ${l.description?`<p class="desc">${esc(fmtDesc(l.description))}</p>`:''}
    <p class="note">${l.own ? 'Von dir eingetragen. Entfernungen sind Schätzungen (Luftlinie × 1,3) ab dem Ort, den du auf der Karte gesetzt hast.'
      : `Angaben aus dem Inserat, nicht vom Vermieter bestätigt. Vor jeder Zahlung besichtigen und Vertrag prüfen. ${l.th && !l.full || l.approx ? 'Entfernungen sind Schätzungen (Luftlinie × 1,3)' : 'Entfernungen: Straßen-km und Fahrzeit (Auto-Profil, Roller ähnlich)'} ab dem Kartenpunkt des Inserats zum nächstgelegenen Ort; Strände nur, wenn ohne Boot erreichbar.`}</p>
    <div class="actions">
      ${l.url ? `<a class="primary" href="${esc(l.url)}" target="_blank" rel="noopener">Inserat ↗</a>` : ''}
      ${(l.also||[]).slice(0,1).map(a=>`<a class="ghost" href="${esc(a.url)}" target="_blank" rel="noopener">${esc((a.source||'').split(' ')[0])}${a.price?` ${fmt(a.price)} ฿`:''} ↗</a>`).join('')}
      ${l.lat!=null?`<button class="ghost" type="button" data-showmap="${esc(l.id)}">🗺 Auf Karte</button>`:''}
      ${nav?`<a class="ghost" href="${esc(nav)}" target="_blank" rel="noopener">${l.approx?'Ungefähre Lage':'📍 Maps'}</a>`:''}
      <button class="ghost" data-share="${esc(l.id)}" aria-label="Teilen"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/></svg></button>
      <button class="ghost" data-fav="${esc(l.id)}">${isFav(l.id)?'★':'☆'}</button>
    </div>
    ${l.own?`<div class="sheetActions"><button class="ghost" data-ownedit="${esc(l.id)}">Bearbeiten</button><button class="ghost" data-ownpos="${esc(l.id)}">Ort auf Karte setzen</button><button class="ghost danger" data-owndel="${esc(l.id)}">Löschen</button></div>`:''}`;
  if($('#detail').hidden) openSheet('#detail', linkOf(l)); else { try { history.replaceState({sheet:1}, '', location.pathname + linkOf(l)); } catch {} }
  if(l.hasDesc && !l.description) loadDesc(l).then(ok => { if(ok && !$('#detail').hidden && $('#detail [data-fav]')?.dataset.fav === l.id) openDetail(l.id); });
  if(!l.own && !l.detailLoaded && !l.detailTried && !l.gone && DETAIL_URL.test(l.url||'')){
    $('#detail h2').insertAdjacentHTML('afterend', '<p class="loading">Lade Details vom Anbieter …</p>');
    TH.loadDetail(l).then(() => { if(!$('#detail').hidden && $('#detail [data-fav]')?.dataset.fav === l.id) openDetail(l.id); });
  }
}

let lastGroup = null, curGroup = null;
function openGroup(g){
  curGroup = g;
  const sorted = [...g].sort((a,b)=>(a.price||1e9)-(b.price||1e9));
  const approx = g.every(x=>x.approx);
  $('#detail').innerHTML = `<div class="grab"></div><button class="close" aria-label="Schließen">✕</button>
 <h2 id="dTitle">${g.length} Inserate ${g.spots > 1 ? 'in diesem Bereich' : 'an diesem Punkt'}</h2>
    ${g.spots > 1 ? `<p class="muted">An ${g.spots} nahe beieinander liegenden Orten – zusammengefasst, damit sich die Preisschilder nicht überdecken. <button type="button" class="linkbtn" data-zoomgrp>Auf der Karte hineinzoomen</button></p>` : ''}
    <p class="muted">${g.spots > 1 ? '' : approx ? 'Verschiedene Objekte: Die Anbieter nennen nur einen ungefähren Ort (Ortsteil). Die genaue Lage steht im Inserat – Entfernungen sind deshalb nur grob.' : 'Mehrere Wohnungen im selben Gebäude bzw. derselben Anlage.'}</p>
    <ul class="glist">${sorted.map(l=>`<li><button type="button" data-open="${esc(l.id)}"><b>${fmt(l.price)} ฿</b><span>${esc([sizeTxt(l), l.beds!=null?l.beds+' Schlafz.':null].filter(Boolean).join(' · '))}</span><small>${esc(l.title)}</small></button></li>`).join('')}</ul>`;
  if($('#detail').hidden) openSheet('#detail');
}
let hiLayer = null, hiId = null;
function drawHighlight(){
  if(!map) return;
  if(!hiLayer) hiLayer = L.layerGroup().addTo(map);
  hiLayer.clearLayers();
  const l = hiId && allListings().find(x=>x.id===hiId);
  if(!l || l.lat==null) return;
  L.marker([l.lat,l.lng], {icon:L.divIcon({className:'', html:'<div class="hiring"><i></i></div>', iconSize:[64,64], iconAnchor:[32,32]}), interactive:false, zIndexOffset:2900}).addTo(hiLayer);
  const k = l.price>=1000 ? Math.round(l.price/1000)+'k' : l.price;
  L.marker([l.lat,l.lng], {icon:L.divIcon({className:'', html:`<span class="pin hipin">★ ${k} ฿</span>`, iconSize:[0,0]}), zIndexOffset:3000})
    .on('click', () => openDetail(l.id)).addTo(hiLayer);
}
function showOnMap(id){
  const l = allListings().find(x=>x.id===id); if(!l || l.lat==null){ toast('Für dieses Inserat gibt es keinen Kartenpunkt'); return; }
  hiId = id; closeSheets();
  if(DATA.th){ state.thView = {c:[l.lat,l.lng], z:16}; save(); if(map) map._thPending = {c:[l.lat,l.lng], z:16}; }
  document.querySelector('.seg [data-view="map"]').click();
  setTimeout(() => { if(!map) return; map.invalidateSize(); map.setView([l.lat,l.lng], 16); drawHighlight(); }, DATA.th ? 200 : 120);
  toast(l.approx ? 'Markiert – Lage nur ungefähr (Ortsteil)' : 'Objekt auf der Karte markiert');
}
let lastFocus = null;
function openSheet(sel, hash){
  lastFocus = document.activeElement; $('#scrim').hidden=false; $(sel).hidden=false; $(sel).querySelector('button,input,a')?.focus({preventScroll:true});
  const url = location.pathname + location.search + (hash || '');
  try { history.state?.sheet ? history.replaceState({sheet:1}, '', url) : history.pushState({sheet:1}, '', url); } catch {}
}
// vom Nutzer geschlossen (✕, Hintergrund, Esc, Abbrechen): Verlaufseintrag mit zurücknehmen
function userClose(){ if(history.state?.sheet) history.back(); else closeSheets(); }
window.addEventListener('popstate', e => {
  if(lbPop){ lbPop = false; return; }      // nur das Vollbild war offen
  const open = !$('#detail').hidden || !$('#filters').hidden || !$('#own').hidden || !$('#places').hidden;
  if(open){ closeSheets(); return; }
  if(e.state?.nav) navApply(e.state);
  else navApply({v:'list', c:CITY, r:null});
});
const linkOf = l => `#i=${encodeURIComponent(l.id)}&c=${CITY}${l.lat!=null?`&ll=${(+l.lat).toFixed(5)},${(+l.lng).toFixed(5)}`:''}`;
function closeSheets(){ if(/#i=/.test(location.hash)) { try { history.replaceState(history.state, '', location.pathname + location.search); } catch {} }
  $('#scrim').hidden=true; $('#filters').hidden=true; $('#detail').hidden=true; $('#own').hidden=true; $('#places').hidden=true; lastFocus?.focus?.({preventScroll:true}); }

let setFilterUi = () => {};
function bindFilters(){
  const set = setFilterUi = () => { const f = state.filters;
    $('#fOwner').checked=f.owner; $('#fOld').checked=f.old; $('#fPool').checked=f.pool; $('#fUnknown').checked=f.unknown; $('#fSizeUnknown').checked=f.sizeUnknown; $('#fSoon').checked=f.soon;
    $('#fAge').value=f.maxAge;
    $('#fSize').value=f.size; $('#fPrice').value=f.price; $('#fBeach').value=f.beach; $('#fSort').value=f.sort;
    $('#oSize').textContent = f.size ? `${f.size} m²` : 'alle';
    $('#fSizeMax').value=f.sizeMax; $('#oSizeMax').textContent = f.sizeMax>=400 ? 'unbegrenzt' : `${f.sizeMax} m²`;
    $('#oPrice').textContent = f.price>=150000 ? 'egal' : `${fmt(+f.price)} ฿${eur(f.price)?` (≈ ${fmt(eur(f.price))} €)`:''}`;
    document.querySelectorAll('#sortbar [data-sort]').forEach(b => { const on = b.dataset.sort===f.sort || (b.dataset.sort==='price' && f.sort==='priceDesc');
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
      if(b.dataset.sort==='price') b.textContent = f.sort==='priceDesc' ? 'Preis ↓ teuer zuerst' : 'Preis ↑ günstig zuerst'; });
    $('#oBeach').textContent = f.beach>=30 ? 'egal' : `${f.beach} km`;
  };
  const upd = (k, v) => { state.filters[k]=v; save(); set(); render(); };
  $('#fOld').onchange = e => upd('old', e.target.checked);
  $('#fPool').onchange = e => upd('pool', e.target.checked);
  $('#fOwner').onchange = e => upd('owner', e.target.checked);
  $('#fUnknown').onchange = e => upd('unknown', e.target.checked);
  $('#fSizeUnknown').onchange = e => upd('sizeUnknown', e.target.checked);
  $('#fSoon').onchange = e => upd('soon', e.target.checked);
  $('#fAge').onchange = e => upd('maxAge', +e.target.value);
  $('#fSize').oninput = e => { upd('size', +e.target.value); if(state.filters.sizeMax < state.filters.size){ upd('sizeMax', Math.min(400, Math.ceil(state.filters.size/10)*10)); } };
  $('#fSizeMax').oninput = e => { upd('sizeMax', +e.target.value); if(state.filters.size > state.filters.sizeMax){ upd('size', Math.floor(state.filters.sizeMax/5)*5); } };
  $('#fPrice').oninput = e => upd('price', +e.target.value);
  $('#fBeach').oninput = e => upd('beach', +e.target.value);
  $('#fSort').onchange = e => upd('sort', e.target.value);
  $('#sortbar').onclick = e => { const b = e.target.closest('[data-sort]'); if(!b) return;
    let v = b.dataset.sort; if(v==='price') v = state.filters.sort==='price' ? 'priceDesc' : 'price';
    upd('sort', v); };
  $('#fReset').onclick = () => { Object.assign(state.filters, DEF_OF(CITY)); save(); set(); render(); };
  $('#fClose').onclick = userClose;
  $('#filterBtn').onclick = () => openSheet('#filters');
  $('#scrim').onclick = () => { lastGroup = null; userClose(); };
  document.addEventListener('keydown', e => { if(e.key==='Escape'){ lastGroup = null; userClose(); } });
  set();
}

function wakeImgs(g){ g.querySelectorAll('img[data-src]').forEach(i => { i.src = i.dataset.src; i.removeAttribute('data-src'); }); }
// ---- Vollbild-Fotos ----
async function openLightbox(id, start = 0){
  const l = getListing(id); if(!l) return;
  let lb = $('#lightbox');
  if(!lb){ lb = document.createElement('div'); lb.id = 'lightbox'; lb.className = 'lightbox'; lb.setAttribute('role','dialog'); lb.setAttribute('aria-modal','true'); lb.setAttribute('aria-label','Fotos');
    document.body.appendChild(lb);
    lb.addEventListener('click', e => { if(e.target.closest('.lbclose')) { userCloseLb(); return; }
      const nv = e.target.closest('[data-lbnav]'); if(nv){ const t = lb.querySelector('.lbtrack'); t.scrollBy({left: t.clientWidth * +nv.dataset.lbnav, behavior:'smooth'}); return; }
      const lk = e.target.closest('[data-lbopen]'); if(lk){ const i = lk.dataset.lbopen; closeLb(); if(history.state?.lb) history.back(); setTimeout(() => openDetail(i), 50); } });
    // nach unten wischen schließt
    let y0 = null; lb.addEventListener('touchstart', e => { y0 = e.touches.length === 1 ? e.touches[0].clientY : null; }, {passive:true});
    lb.addEventListener('touchend', e => { if(y0 != null && e.changedTouches[0].clientY - y0 > 110) userCloseLb(); y0 = null; }, {passive:true});
  }
  const draw = () => {
    const pics = l.images || [];
    lb.innerHTML = `<div class="lbtop"><span class="lbcnt">${pics.length ? `1 / ${pics.length}` : ''}</span><b class="lbtitle">${esc(fmt(l.price))} ฿ · ${esc(l.title || '')}</b><button class="lbclose" aria-label="Schließen">✕</button></div>
      <div class="lbtrack">${pics.map((u, i) => `<div class="lbslide"><img src="${Math.abs(i - start) <= 1 ? esc(imgSrc(u, 1280)) : ''}" data-src="${esc(imgSrc(u, 1280))}" alt="Foto ${i+1} von ${pics.length}" draggable="false"></div>`).join('')}</div>
      ${pics.length > 1 ? '<button class="lbnav prev" data-lbnav="-1" aria-label="Vorheriges Foto">‹</button><button class="lbnav next" data-lbnav="1" aria-label="Nächstes Foto">›</button>' : ''}
      <div class="lbbottom">${l.th && !l.detailLoaded && !l.full && !l.detailTried ? '<span class="lbload">Weitere Fotos werden geladen …</span>' : ''}<button class="lbopen" data-lbopen="${esc(l.id)}">Zum Inserat ›</button></div>`;
    const t = lb.querySelector('.lbtrack'), cnt = lb.querySelector('.lbcnt'); let raf = 0;
    t.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const i = Math.round(t.scrollLeft / t.clientWidth); cnt.textContent = `${i+1} / ${pics.length}`;
      t.querySelectorAll('img').forEach((im, k) => { if(Math.abs(k - i) <= 1 && !im.getAttribute('src')) im.src = im.dataset.src; }); }); }, {passive:true});
    requestAnimationFrame(() => { t.scrollLeft = t.clientWidth * start; });
  };
  draw();
  lb.hidden = false; document.body.classList.add('lbopen-body');
  try { history.pushState({lb:1}, '', location.href); } catch {}
  if(l.th && !l.detailLoaded && !l.full && !l.detailTried){ const n0 = (l.images||[]).length; await TH.loadDetail(l); if(!lb.hidden && (l.images||[]).length > n0){ start = lb.querySelector('.lbtrack') ? Math.round(lb.querySelector('.lbtrack').scrollLeft / lb.querySelector('.lbtrack').clientWidth) : 0; draw(); refreshCard(l); } else lb.querySelector('.lbload')?.remove(); }
}
function closeLb(){ const lb = $('#lightbox'); if(lb){ lb.hidden = true; lb.innerHTML = ''; } document.body.classList.remove('lbopen-body'); }
function userCloseLb(){ if(history.state?.lb) history.back(); else closeLb(); }
let lbPop = false;
window.addEventListener('popstate', () => { if($('#lightbox') && !$('#lightbox').hidden){ closeLb(); lbPop = true; } }, true);
document.addEventListener('keydown', e => { const lb = $('#lightbox'); if(!lb || lb.hidden) return;
  if(e.key === 'Escape'){ e.stopImmediatePropagation(); userCloseLb(); }
  if(e.key === 'ArrowRight' || e.key === 'ArrowLeft'){ const t = lb.querySelector('.lbtrack'); t.scrollBy({left: t.clientWidth * (e.key === 'ArrowRight' ? 1 : -1), behavior:'smooth'}); } }, true);

function bindGalleries(){
  document.querySelectorAll('[data-gal]').forEach(g => {
    if(g.dataset.bound) return; g.dataset.bound = 1;
    const card = g.closest('.card'), dots = card.querySelectorAll('.cdots i'), cnt = card.querySelector('.ccount');
    let raf = 0;
    g.addEventListener('scroll', () => { wakeImgs(g); cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const i = Math.round(g.scrollLeft / g.clientWidth);
      dots.forEach((d,k)=>d.classList.toggle('on', k===i)); if(cnt) cnt.textContent = `${i+1}/${dots.length}`;
    }); }, {passive:true});
  });
}

function bindUi(){
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { if(b.dataset.view !== view){ setTab(b.dataset.view); navPush(); } });
  document.addEventListener('click', e => {
    const nb = e.target.closest('[data-nav]');
    if(nb){ e.stopPropagation(); const g = nb.closest('.media').querySelector('[data-gal]'); wakeImgs(g); g.scrollBy({left: g.clientWidth * +nb.dataset.nav, behavior:'smooth'}); return; }
    const sb = e.target.closest('[data-share]');
    if(sb){ e.stopPropagation(); shareListing(sb.dataset.share); return; }
    if(e.target.closest('#shareApp')){ shareApp(); return; }
    const sm = e.target.closest('[data-showmap]'); if(sm){ showOnMap(sm.dataset.showmap); return; }
    const rx = e.target.closest('[data-relax]'); if(rx){ const k = rx.dataset.relax, f = state.filters;
      if(k==='unknown'){ f.unknown = true; f.sizeUnknown = true; } else if(k==='old') f.old = true;
      else Object.assign(f, {...DEF_OF('thailand'), sort:f.sort});
      save(); setFilterUi(); render(); toast('Filter gelockert'); return; }
    if(e.target.closest('[data-zoomgrp]') && curGroup){ const g = curGroup; userClose(); setTimeout(() => map.fitBounds(L.latLngBounds(g.map(x=>[x.lat,x.lng])), {padding:[60,60], maxZoom:17}), 150); return; }
    const mo = e.target.closest('[data-more]');
    if(mo){ const l = getListing(mo.dataset.more), box = mo.closest('.cdesc'); if(!l || !box) return;
      if(box.classList.toggle('open')){ mo.textContent = 'Weniger ▴';
        const show = () => { if(box.classList.contains('open')) box.querySelector('p').textContent = fmtDesc(l.description || l.desc); };
        show(); if(!l.description) (l.hasDesc ? loadDesc(l) : TH.loadDetail(l)).then(show); }
      else { mo.textContent = 'Mehr lesen ▾'; box.querySelector('p').textContent = (l.desc || (l.description||'').replace(/\s+/g,' ')).slice(0, 260); }
      return; }
    const pl = e.target.closest('[data-pl]');
    if(pl){ const k = pl.dataset.pl;
      if(k === '__add'){ renderPlaceSheet(); $('#plHits').innerHTML = ''; openSheet('#places'); return; }
      if(k === '__all'){ switchCity('thailand'); if(CITY === 'thailand'){ TH.bounds = null; state.region = null; state.thView = null; save(); thOverview(); render(); navPush(); } renderPlaces(); return; }
      openPlace(PLACES[+k]); return; }
    const pa = e.target.closest('[data-pladd]');
    if(pa){ const p = JSON.parse(pa.dataset.pladd); if(!PLACES.some(x => x.name === p.name)){ PLACES.push(p); savePlaces(); toast(`„${p.name}“ oben hinzugefügt`); } return; }
    const pd = e.target.closest('[data-pldel]');
    if(pd){ PLACES.splice(+pd.dataset.pldel, 1); savePlaces(); return; }
    const go = e.target.closest('[data-open]'); if(go){ lastGroup = curGroup; openDetail(go.dataset.open); return; }
    const pv = e.target.closest('[data-prov]');
    if(pv && DATA?.th){ const p = (TH.idx.provinces||[]).find(x=>x.key===pv.dataset.prov); if(p){ state.region = {key:p.key, name:p.name, n:p.n}; save(); goTo(p.lat, p.lng, p.key); navPush(); } return; }
    if(e.target.closest('[data-overview]')){ TH.bounds = null; state.region = null; state.thView = null; save(); if(map){ thOverview(); } render(); window.scrollTo({top:0}); navPush(); return; }
    const cb = e.target.closest('[data-city]');
    if(cb){ switchCity(cb.dataset.city); return; }
    if(e.target.closest('#fbSearch')){ openFacebook(); return; }
    if(e.target.closest('#ownAdd')){ openOwnForm(); return; }
    const oe = e.target.closest('[data-ownedit]'); if(oe){ openOwnForm(oe.dataset.ownedit); return; }
    const od = e.target.closest('[data-owndel]'); if(od){ if(confirm('Eigenes Inserat löschen?')){ state.own = state.own.filter(o=>o.id!==od.dataset.owndel); state.favs = state.favs.filter(x=>x!==od.dataset.owndel); save(); closeSheets(); render(); } return; }
    const op = e.target.closest('[data-ownpos]'); if(op){ startPick(op.dataset.ownpos); return; }
    const lb = e.target.closest('[data-layer]');
    if(lb){ const c = lb.dataset.layer; state.layers[c] = !state.layers[c]; save(); syncLayers(); return; }
    const fb = e.target.closest('[data-fav]');
    if(fb){ e.stopPropagation(); const id = fb.dataset.fav;
      toggleFav(id); render();
      if(!$('#detail').hidden) openDetail(id); return; }
    if(e.target.closest('#detail .close')) { if(lastGroup){ const g = lastGroup; lastGroup = null; openGroup(g); return; } userClose(); return; }
    // Foto antippen (Liste oder Inserat) -> Vollbild mit allen Fotos, ohne das Inserat zu öffnen
    const ph = e.target.closest('.card [data-gal] img, #detail .gallery img');
    if(ph){ const id = ph.closest('.card')?.dataset.id || $('#detail [data-fav]')?.dataset.fav;
      const imgs = [...ph.parentElement.querySelectorAll('img')]; openLightbox(id, imgs.indexOf(ph)); return; }
    const c = e.target.closest('.card'); if(c) openDetail(c.dataset.id);
  });
  $('#ownForm').addEventListener('submit', saveOwnForm);
  $('#ownPaste').onclick = async () => { try { const t = await navigator.clipboard.readText(); if(t){ $('#wUrl').value = t.trim(); } } catch { toast('Einfügen nicht erlaubt – bitte lange tippen und „Einfügen“ wählen'); } };
  $('#ownCancel').onclick = userClose;
  $('#plClose').onclick = userClose;
  $('#plForm').onsubmit = e => { e.preventDefault(); searchPlace($('#plInput').value); };
  $('#wPrice').addEventListener('invalid', e => { e.preventDefault(); $('#wPrice').classList.add('bad'); toast('Bitte die Monatsmiete in ฿ eintragen'); $('#wPrice').focus(); });
  $('#wPrice').addEventListener('input', () => $('#wPrice').classList.remove('bad'));
  document.addEventListener('keydown', e => { const c = e.target.closest?.('.card'); if(c && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); openDetail(c.dataset.id); } });
}

function syncCityUi(){
  document.querySelectorAll('[data-city]').forEach(b => { const on = b.dataset.city===CITY; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  document.title = CITY==='thailand' ? 'Thailand Wohnen' : `${CITIES[CITY].long} – Thailand Wohnen`;
}
async function loadCity(city){
  CITY = city; localStorage.setItem('krabiwohnen.city', city);
  localStorage.setItem('krabiwohnen.booting', city);
  state = load(city); syncCityUi();
  if(map){ map.remove(); map = null; poiLayers = {}; layer = null; }
  if(city !== 'thailand') TH.bounds = null;
  hiId = null; hiLayer = null;
  DATA = null; $('#list').innerHTML = '<p class="empty">Lade Inserate …</p>'; $('#summary').textContent = '';
  try{
    if(city === 'thailand'){
      const i = await TH.loadIndex(); if(city !== CITY) return;
      DATA = { th:true, generated:i.generated, fx:i.fx, count:i.count, listings:[], pois:[] };
      if(state.thView && !TH.bounds){ const v = state.thView; const k = 360/Math.pow(2, v.z)/1.2; TH.bounds = [v.c[0]-k/2.6, v.c[1]-k/2.2, v.c[0]+k/2.6, v.c[1]+k/2.2]; }
      if(TH.bounds && TH.countIn(TH.bounds) <= TH.LOAD_LIMIT) await TH.ensureTiles(TH.bounds);
    } else {
      const r = await fetch(`data/${city}/listings.json`, {cache:'no-cache'});
      if(!r.ok) throw new Error(r.status);
      const d = await r.json(); if(city !== CITY) return; DATA = d; DATA.listings = DATA.listings.filter(isHome); unpackDist(DATA.listings); if(!DATA.th) DATA.count = DATA.listings.length; markCoarse(DATA.listings);
    }
  }catch(err){
    $('#stand').textContent = 'Daten konnten nicht geladen werden (offline?).'; $('#list').innerHTML = ''; return;
  }
  const g = new Date(DATA.generated);
  $('#appTitle').textContent = CITY==='thailand' ? 'Thailand Wohnen' : CITIES[CITY].name==='Krabi' ? 'Krabi / Ao Nang' : 'Pattaya & Umgebung';
  renderPlaces();
  $('#stand').innerHTML = `${CITY==='thailand' ? ((TH.idx?.provinces||[]).length > 30 ? 'ganz Thailand · ' : 'Küsten & Chiang Mai · ') : CITY==='pattaya' ? 'Si Racha bis Ban Chang · ' : ''}${fmt(DATA.count)} Inserate · Stand ${g.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})} ${g.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} · <span class="fx">1&nbsp;€&nbsp;=&nbsp;${(Math.round(DATA.fx.rate*10)/10).toLocaleString('de-DE')}&nbsp;฿</span>`;
  migrateFavs(); syncFavTab(); setFilterUi(); render();
  setTimeout(() => localStorage.removeItem('krabiwohnen.booting'), 4000);
}
// Gegend wählen (Thailand-Modus): größte Inserats-Dichte um den Provinz-Mittelpunkt
async function goTo(lat, lng, prov){
  let km = 6; while(km < 60 && TH.countIn(TH.around(lat,lng,km)) < 150) km *= 1.6;
  while(km > 2 && TH.countIn(TH.around(lat,lng,km)) > TH.LOAD_LIMIT) km /= 1.6;
  TH.bounds = TH.around(lat, lng, km);
  const z = Math.max(9, Math.min(15, Math.round(Math.log2(40000 / (km*2.2)))));
  state.thView = {c:[lat,lng], z}; save();
  $('#summary').textContent = 'Lade …';
  await TH.ensureTiles(TH.bounds);
  if(map && !$('#viewMap').hidden){ map._fromGoTo = true; map.setView([lat,lng], z); }
  else { if(map) map._thPending = {c:[lat,lng], z}; render(); }
  window.scrollTo({top:0});
}
// ---- Meine Orte: selbst gewählte Orte als Knöpfe oben (lokal gespeichert) ----
// beliebte Orte, nach Gegend geordnet (nur abgedeckte Provinzen: Küsten + Chiang Mai)
const TOWN_GROUPS = [
  ['Pattaya & Ostküste', [['Pattaya Zentrum',12.935,100.883],['Jomtien',12.88,100.88],['Na Jomtien',12.80,100.91],['Pratumnak',12.917,100.866],['Naklua/Wongamat',12.965,100.888],['Huai Yai',12.84,100.99],['Bang Saray',12.75,100.91],['Sattahip',12.66,100.90],['Si Racha',13.174,100.93],['Bang Saen',13.28,100.91],['Ban Chang',12.73,101.06],['Rayong',12.68,101.27],['Koh Samet',12.56,101.45],['Chanthaburi',12.61,102.10],['Trat',12.24,102.51],['Koh Chang',12.06,102.33],['Koh Kood',11.65,102.56]]],
  ['Hua Hin & Golf West', [['Hua Hin',12.568,99.958],['Khao Takiab',12.52,99.97],['Cha-am',12.80,99.97],['Pranburi',12.39,99.91],['Sam Roi Yot',12.20,99.97],['Prachuap Khiri Khan',11.81,99.80],['Ban Krut',11.38,99.58],['Bang Saphan',11.21,99.51],['Chumphon',10.49,99.18]]],
  ['Samui & Golf Süd', [['Koh Samui',9.512,100.013],['Chaweng',9.53,100.06],['Lamai',9.47,100.04],['Bophut',9.56,100.03],['Maenam',9.57,99.99],['Koh Phangan',9.731,100.028],['Koh Tao',10.09,99.84],['Surat Thani',9.14,99.33],['Khanom',9.22,99.86],['Sichon',9.01,99.90],['Nakhon Si Thammarat',8.43,99.96],['Songkhla',7.19,100.6],['Hat Yai',7.008,100.475]]],
  ['Phuket', [['Phuket Stadt',7.884,98.391],['Patong',7.896,98.297],['Kata/Karon',7.83,98.30],['Rawai',7.778,98.326],['Nai Harn',7.78,98.31],['Chalong',7.84,98.34],['Kamala',7.95,98.28],['Bang Tao/Cherng Talay',8.0,98.30],['Surin',7.97,98.28],['Kathu',7.91,98.33],['Thalang',8.03,98.33],['Mai Khao',8.13,98.30]]],
  ['Krabi & Andamanen', [['Ao Nang',8.032,98.823],['Krabi Stadt',8.086,98.906],['Klong Muang/Tub Kaek',8.06,98.75],['Railay',8.01,98.84],['Nong Thale',8.07,98.78],['Koh Lanta',7.62,99.04],['Khao Lak',8.637,98.248],['Takua Pa',8.86,98.35],['Phang Nga',8.45,98.53],['Koh Yao',8.07,98.58],['Ranong',9.96,98.64],['Koh Phayam',9.73,98.40],['Trang',7.557,99.611],['Koh Lipe',6.49,99.30],['Satun',6.62,100.07]]],
  ['Bangkok & Umgebung', [['Bangkok Sukhumvit',13.737,100.56],['Bangkok Silom/Sathorn',13.722,100.53],['Bangkok Ari',13.78,100.545],['Bangkok Ramkhamhaeng (viele Muslime)',13.756,100.62],['Bangkok Nong Chok (muslimisch)',13.85,100.86],['Bangkok Min Buri',13.81,100.75],['Nonthaburi',13.86,100.51],['Samut Prakan/Bang Na',13.6,100.6],['Pathum Thani',14.02,100.53],['Ayutthaya',14.35,100.57]]],
  ['Norden', [['Chiang Rai',19.91,99.83],['Pai',19.36,98.44],['Lampang',18.29,99.49],['Nan',18.78,100.78],['Phitsanulok',16.82,100.26],['Sukhothai',17.01,99.82]]],
  ['Isaan & Westen', [['Khon Kaen',16.43,102.83],['Udon Thani',17.41,102.79],['Nakhon Ratchasima (Korat)',14.97,102.1],['Ubon Ratchathani',15.24,104.85],['Nong Khai',17.88,102.74],['Kanchanaburi',14.02,99.53],['Hua Hin Hinterland/Ratchaburi',13.54,99.82]]],
  ['Tiefer Süden (muslimisch)', [['Pattani',6.87,101.25],['Yala',6.54,101.28],['Narathiwat',6.43,101.82]]],
  ['Chiang Mai', [['Chiang Mai Altstadt',18.788,98.986],['Nimman',18.80,98.967],['Hang Dong',18.69,98.92],['Mae Rim',18.91,98.94],['San Sai',18.86,99.04],['San Kamphaeng',18.75,99.12],['Saraphi',18.71,99.04]]],
];
const TOWNS = TOWN_GROUPS.flatMap(g => g[1]);
const PKEY = 'krabiwohnen.places.v1';
const DEF_PLACES = [{name:'Krabi', city:'krabi'}, {name:'Pattaya', city:'pattaya'}];
let PLACES = (() => { try { const p = JSON.parse(localStorage.getItem(PKEY)); return Array.isArray(p) ? p : DEF_PLACES; } catch { return DEF_PLACES; } })();
const savePlaces = () => { try { localStorage.setItem(PKEY, JSON.stringify(PLACES)); } catch {} renderPlaces(); renderPlaceSheet(); };
const placeOn = p => p.city ? CITY === p.city : CITY === 'thailand' && state.region?.key === 'pl:' + p.name;
function renderPlaces(){
  const bar = $('#placebar'); if(!bar) return;
  const all = CITY === 'thailand' && !state.region;
  bar.innerHTML = `<button type="button" class="pl ${all?'on':''}" data-pl="__all">Ganz Thailand</button>` +
    PLACES.map((p, i) => `<button type="button" class="pl ${placeOn(p)?'on':''}" data-pl="${i}">${esc(p.name)}</button>`).join('') +
    `<button type="button" class="pl add" data-pl="__add" aria-label="Ort hinzufügen oder entfernen">＋ Ort</button>`;
  bar.querySelector('.on')?.scrollIntoView({block:'nearest', inline:'nearest'});
}
async function openPlace(p){
  if(p.city){ if(CITY !== p.city){ closeSheets(); window.scrollTo({top:0}); await loadCity(p.city); navPush(); } renderPlaces(); return; }
  if(CITY !== 'thailand') await loadCity('thailand');
  if(!TH.idx) await new Promise(r => setTimeout(r, 300));
  state.region = {key:'pl:' + p.name, name:p.name, lat:p.lat, lng:p.lng}; save();
  await goTo(p.lat, p.lng); navPush(); renderPlaces();
}
function renderPlaceSheet(){
  const mine = $('#plMine'); if(!mine) return;
  mine.innerHTML = PLACES.length ? PLACES.map((p, i) => `<span class="plchip">${esc(p.name)}<button type="button" data-pldel="${i}" aria-label="${esc(p.name)} entfernen">✕</button></span>`).join('')
    : '<p class="muted">Noch keine Orte gewählt.</p>';
  const have = new Set(PLACES.map(p => p.name));
  const btn = t => `<button type="button" class="pl" data-pladd='${esc(JSON.stringify(t[3] ? {name:t[0], city:t[3]} : {name:t[0], lat:t[1], lng:t[2]}))}'>＋ ${esc(t[0])}</button>`;
  const rich = [['Krabi', null, null, 'krabi'], ['Pattaya', null, null, 'pattaya']].filter(t => !have.has(t[0]));
  $('#plSugg').innerHTML = (rich.length ? `<h4>Ausführlich (Straßen-km)</h4><div class="plrow">${rich.map(btn).join('')}</div>` : '') +
    TOWN_GROUPS.map(([g, ts]) => { const free = ts.filter(t => !have.has(t[0])); return free.length ? `<h4>${esc(g)}</h4><div class="plrow">${free.map(btn).join('')}</div>` : ''; }).join('');
}
async function searchPlace(q){
  const hits = $('#plHits'); q = q.trim(); if(!q) return;
  const local = TOWNS.filter(t => t[0].toLowerCase().includes(q.toLowerCase()));
  hits.innerHTML = '<p class="muted">Suche …</p>';
  let web = [];
  try { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=th&accept-language=de&q=${encodeURIComponent(q)}`);
    web = (await r.json()).map(x => [x.display_name.split(',').slice(0,2).join(',').trim(), +x.lat, +x.lon]); } catch {}
  const list = [...local, ...web.filter(w => !local.some(l => Math.abs(l[1]-w[1]) < .05 && Math.abs(l[2]-w[2]) < .05))].slice(0, 6);
  hits.innerHTML = list.length ? list.map(t => `<button type="button" class="pl" data-pladd='${esc(JSON.stringify({name:t[0].split(',')[0], lat:t[1], lng:t[2]}))}'>＋ ${esc(t[0])}</button>`).join('')
    : '<p class="muted">Nichts gefunden – anders schreiben, z. B. „Samui“.</p>';
}
// ---- Zurück-Geste: Reiter, Gegend und Provinz stehen im Browser-Verlauf ----
function thOverview(){
  const pv = (TH.idx?.provinces||[]).filter(p => p.lat); if(!map) return;
  if(pv.length) map.fitBounds(pv.map(p => [p.lat, p.lng]), {padding:[40,40]}); else map.setView(CITIES.thailand.center, 6);
}
function setTab(v){
  view = v; try { localStorage.setItem('krabiwohnen.view', v); } catch {}
  document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-selected', x.dataset.view===v));
  $('#viewList').hidden = v==='map' || v==='info'; $('#viewMap').hidden = v!=='map'; $('#viewInfo').hidden = v!=='info';
  render(); if(v==='map') mapShown();
}
const navNow = () => ({nav:1, v:view, c:CITY, r:state.region?.key || null});
function navPush(){ const n = navNow(), h = history.state;
  if(h && h.nav && h.v===n.v && h.c===n.c && h.r===n.r) return;
  try { history.pushState(n, '', location.pathname + location.search); } catch {} }
async function navApply(n){
  if(n.c && n.c !== CITY && CITIES[n.c]){ closeSheets(); await loadCity(n.c); }
  if(DATA?.th){
    if(!n.r && TH.bounds){ TH.bounds = null; state.region = null; save(); if(map) thOverview(); }
    else if(n.r && n.r.startsWith('pl:') && state.region?.key !== n.r){ const p = PLACES.find(x => 'pl:' + x.name === n.r); if(p){ state.region = {key:n.r, name:p.name}; save(); goTo(p.lat, p.lng); } }
    else if(n.r && state.region?.key !== n.r){ const p = (TH.idx?.provinces||[]).find(x=>x.key===n.r); if(p){ state.region = {key:p.key, name:p.name, n:p.n}; save(); goTo(p.lat, p.lng, p.key); } }
  }
  if(n.v && n.v !== view) setTab(n.v); else render();
}
function switchCity(city){
  if(city===CITY && city==='thailand'){ TH.bounds = null; state.region = null; state.thView = null; save(); if(map) thOverview(); render(); window.scrollTo({top:0}); return; }
  if(city===CITY || !CITIES[city]) return; closeSheets(); window.scrollTo({top:0}); loadCity(city).then(navPush); }

// ---- Facebook Marketplace (nur Weiterleitung; Facebook erlaubt kein automatisches Auslesen) ----
function openFacebook(){
  const f = state.filters, c = CITIES[CITY];
  // Ort kann Facebook nur aus dem Konto übernehmen – ohne Anmeldung landet man sonst z. B. in „San Francisco“.
  // Deshalb Ort im Suchtext und ein klarer Hinweis; keine Preisgrenzen (Facebook rechnet in der Kontowährung).
  const q = encodeURIComponent(`${c.fb} for rent`);
  toast(`Facebook: bitte anmelden und oben als Ort „${c.fbPlace || c.name}“ wählen`, 6000);
  setTimeout(() => window.open(`https://www.facebook.com/marketplace/search/?query=${q}&exact=false`, '_blank', 'noopener'), 900);
}

// ---- Eigene Inserate (z. B. von Facebook) – nur lokal gespeichert ----
let pickFor = null;
function ownToListing(o){
  const l = { ...o, own:true, source:'Eigenes Inserat'+(/facebook\.com|fb\.me/i.test(o.url||'')?' (Facebook)':''), first_seen:o.added, images:[] };
  if(o.lat!=null && DATA){
    const dist = {};
    for(const p of DATA.pois){
      if(p.cat==='Strand' && p.boat) continue;
      const km = haversine([o.lat,o.lng],[p.lat,p.lng]) * 1.3;
      if(!dist[p.cat] || km < dist[p.cat].km) dist[p.cat] = {km:Math.round(km*10)/10, min:null, name:p.name, road:false};
    }
    l.dist = dist;
  }
  return l;
}
function haversine(a,b){ const r=6371, t=x=>x*Math.PI/180, dl=t(b[0]-a[0]), dn=t(b[1]-a[1]);
  const h=Math.sin(dl/2)**2+Math.cos(t(a[0]))*Math.cos(t(b[0]))*Math.sin(dn/2)**2; return 2*r*Math.asin(Math.sqrt(h)); }
function openOwnForm(id){
  const o = state.own.find(x=>x.id===id) || {};
  $('#ownTitle').textContent = id ? 'Eigenes Inserat bearbeiten' : 'Eigenes Inserat hinzufügen';
  $('#wId').value = o.id || ''; $('#wUrl').value = o.url || ''; $('#wTitle').value = o.title || '';
  $('#wPrice').value = o.price || ''; $('#wSize').value = o.size || ''; $('#wBeds').value = o.beds ?? '';
  $('#wBuilt').value = o.built ? o.built.slice(0,4) : ''; $('#wPool').value = o.pool || ''; $('#wNote').value = o.description || '';
  closeSheets(); openSheet('#own');
}
function saveOwnForm(e){
  e.preventDefault();
  const id = $('#wId').value || 'own-' + Date.now().toString(36);
  const old = state.own.find(x=>x.id===id) || {};
  const y = +$('#wBuilt').value;
  const o = { ...old, id, url: $('#wUrl').value.trim(), title: $('#wTitle').value.trim() || 'Eigenes Inserat',
    price: +$('#wPrice').value || null, size: +$('#wSize').value || null, beds: $('#wBeds').value==='' ? null : +$('#wBeds').value,
    built: y ? `${y}-01` : null, built_src: y ? 'eigene Angabe' : null, pool: $('#wPool').value || null,
    description: $('#wNote').value.trim(), added: old.added || new Date().toISOString().slice(0,10) };
  state.own = [o, ...state.own.filter(x=>x.id!==id)]; save(); closeSheets(); render();
  if(o.lat==null) startPick(id); else toast('Gespeichert');
}
function startPick(id){
  pickFor = id; closeSheets();
  document.querySelector('.seg [data-view="map"]').click();
  toast('Tippe auf der Karte auf den Ort der Wohnung'); document.body.classList.add('picking');
}
function setOwnPos(id, ll){
  const o = state.own.find(x=>x.id===id); pickFor = null; document.body.classList.remove('picking');
  if(!o) return; o.lat = +ll.lat.toFixed(6); o.lng = +ll.lng.toFixed(6); save(); render(); toast('Ort gespeichert – Entfernungen berechnet');
}

// Link zu einem Inserat (#i=<id>&c=<gegend>&ll=lat,lng) beim Start öffnen
async function openFromHash(){
  const h = new URLSearchParams(location.hash.slice(1)); const id = h.get('i'); if(!id) return;
  const c = h.get('c'); if(c && CITIES[c] && c !== CITY) await loadCity(c);
  if(DATA?.th && h.get('ll')){ const [la, ln] = h.get('ll').split(',').map(Number); TH.bounds = TH.around(la, ln, 3); await TH.ensureTiles(TH.bounds); render(); }
  if(getListing(id)) openDetail(id); else toast('Dieses Inserat ist nicht mehr online');
}
async function init(){
  // „Thailand“ erst zeigen, wenn die Landesdaten veröffentlicht sind
  const thOk = await fetch('data/th-status.json', {cache:'no-cache'}).then(r => r.json()).then(j => !!j.ready).catch(() => false);
  if(!thOk){ document.querySelector('[data-city="thailand"]')?.remove(); delete CITIES.thailand; if(CITY === 'thailand') CITY = 'krabi'; }
  const crashed = localStorage.getItem('krabiwohnen.booting');
  if(crashed && crashed !== 'krabi'){ CITY = 'krabi'; setTimeout(() => toast(`${CITIES[crashed]?.name||crashed} wurde zuletzt nicht fertig geladen – Krabi geöffnet`), 800); }
  bindUi();
  bindFilters();
  fetch('data/klima.json', {cache:'no-cache'}).then(x=>x.json()).then(k=>{ KLIMA=k; if(view==='info') renderInfo(); }).catch(()=>{});
  const hc = new URLSearchParams(location.hash.slice(1)).get('c'); if(hc && CITIES[hc]) CITY = hc;
  await loadCity(CITY);
  const sv = (() => { try { return localStorage.getItem('krabiwohnen.view'); } catch { return null; } })();
  if(sv && sv !== 'list' && ['map','info','fav'].includes(sv) && !location.hash) setTab(sv);
  try { history.replaceState(navNow(), '', location.pathname + location.search + location.hash); } catch {}
  openFromHash();
}
if('serviceWorker' in navigator){
  const hadCtrl = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // höchstens einmal pro Minute neu laden (verhindert Endlosschleifen)
    const last = +sessionStorage.getItem('kw-reload') || 0;
    if(hadCtrl && !reloaded && Date.now() - last > 60000){ reloaded = true; sessionStorage.setItem('kw-reload', Date.now()); location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(r => r.update()).catch(()=>{});
}
init();
