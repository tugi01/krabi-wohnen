/* Thailand Wohnen – PWA. Daten: data/<stadt>/listings.json (zweimal täglich per GitHub Action aktualisiert). */
'use strict';
const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CITIES = {
  krabi:   { name:'Krabi', long:'Krabi / Ao Nang', key:'krabiwohnen.v1', center:[8.045,98.83], fb:'Ao Nang Krabi',
             note:'Alle Inserate in Mueang Krabi bis 25 km um Ao Nang.' },
  pattaya: { name:'Pattaya', long:'Pattaya', key:'krabiwohnen.pattaya.v1', center:[12.93,100.89], fb:'Pattaya',
             note:'Pattaya hat über 16.000 Inserate. Geladen werden nur die passenden: ab 50 m², bis 60.000 ฿ und Baujahr der letzten 10 Jahre.' },
};
let CITY = CITIES[localStorage.getItem('krabiwohnen.city')] ? localStorage.getItem('krabiwohnen.city') : 'krabi';
const KEY_OF = c => CITIES[c].key;
const DEFAULTS = { old:false, owner:false, pool:false, unknown:false, soon:false, maxAge:5, size:50, sizeMax:400, price:60000, beach:30, sort:'price' };
const LAYERS = { Strand:true, Moschee:true, 'Muay Thai':true, '7-Eleven':true, Markt:true, Einkauf:false, Krankenhaus:false };
const POICOL = { Strand:['#1b8cb2','🏖'], Moschee:['#2f7d4b','🕌'], 'Muay Thai':['#7d54a4','🥊'], Markt:['#d9480f','🍜'], '7-Eleven':['#ffffff','<svg class="ico711" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="6" fill="#fff"/><rect x="5" y="9" width="22" height="4" fill="#f58220"/><rect x="5" y="15" width="22" height="4" fill="#00843d"/><rect x="5" y="21" width="22" height="4" fill="#ee2737"/><path d="M10 5h13l-7 23h-5l6-18h-7z" fill="#00843d" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'], Einkauf:['#ad841a','🛒'], Krankenhaus:['#c0392b','🏥'] };
const TXTICON = c => c==='7-Eleven' ? '7-11' : POICOL[c][1];
const DISTCATS = ['Strand','Moschee','Muay Thai','7-Eleven','Markt','Einkauf','Krankenhaus'];
let state = load(CITY);
let DATA = null, KLIMA = null, view = 'list', map = null, layer = null, poiLayers = {};

function load(city){
  try { const s = JSON.parse(localStorage.getItem(KEY_OF(city)) || '{}');
    return { filters:{...DEFAULTS, ...(s.filters||{})}, layers:{...LAYERS, ...(s.layers||{})}, favs:Array.isArray(s.favs)?s.favs:[], own:Array.isArray(s.own)?s.own:[] }; }
  catch { return { filters:{...DEFAULTS}, layers:{...LAYERS}, favs:[], own:[] }; }
}
function save(){ try { localStorage.setItem(KEY_OF(CITY), JSON.stringify(state)); } catch {} }
// Alle Inserate = Portal-Daten + eigene (z. B. von Facebook), eigene nur auf diesem Gerät gespeichert
const allListings = () => DATA ? [...state.own.map(ownToListing), ...DATA.listings] : [];

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
function ageInfo(l, now){
  const cutoff = new Date(now.getFullYear()-(state.filters.maxAge||5), now.getMonth(), 1);
  const built = l.built ? new Date(+l.built.slice(0,4), +l.built.slice(5,7)-1, 1) : null;
  const renovRecent = l.renovated && l.renovated >= cutoff.getFullYear();
  if(renovRecent) return {cls:'ok', label:`kernsaniert ${l.renovated}`, recent:true};
  if(!built) return {cls:'unknown', label:'Baujahr unbekannt', recent:null};
  const lbl = `Baujahr ${l.built.slice(0,4)}`;
  return built >= cutoff ? {cls:'ok', label:lbl, recent:true} : {cls:'old', label:lbl, recent:false};
}
// FazWaz-Bilder blockieren direktes Einbinden; eigener Cloudflare-Bildproxy (img-proxy/) liefert sie verkleinert aus.
const imgSrc = (u, w=640) => /^https:\/\/(cdn|img)\.fazwaz\.com\//.test(u)
  ? `https://krabi-wohnen-img.tugrulc.workers.dev/?w=${w}&u=${encodeURIComponent(u.replace('/576x384/','/0x0/'))}` : u;
const fmt = n => n==null ? '–' : n.toLocaleString('de-DE');
const eur = thb => DATA?.fx?.rate ? Math.round(thb / DATA.fx.rate) : null;
const isNew = l => DATA && !l.own && l.first_seen && (new Date(DATA.generated) - new Date(l.first_seen)) / 864e5 <= 7 && DATA.listings.some(x => x.first_seen !== l.first_seen);
const isFav = id => state.favs.includes(id);

function filtered(onlyFav=false){
  if(!DATA) return {rows:[], hidden:{}};
  const f = state.filters, now = new Date(DATA.generated), soonLimit = new Date(now); soonLimit.setMonth(soonLimit.getMonth()+2);
  const hidden = {old:0, unknown:0, pool:0, size:0, sizeMax:0, price:0, beach:0, soon:0};
  const rows = [];
  for(const l of allListings()){
    if(onlyFav){ if(isFav(l.id)) rows.push(l); continue; }
    const a = ageInfo(l, now);
    if(a.recent===false && !f.old){ hidden.old++; continue; }
    if(a.recent===null && !f.unknown){ hidden.unknown++; continue; }
    if(f.owner && l.seller!=='Eigentümer'){ hidden.owner=(hidden.owner||0)+1; continue; }
    if(f.pool && !l.pool){ hidden.pool++; continue; }
    if(f.size && !(l.size >= f.size)){ hidden.size++; continue; }
    if(f.sizeMax < 400 && l.size > f.sizeMax){ hidden.sizeMax++; continue; }
    if(f.price < 150000 && !(l.price <= f.price)){ hidden.price++; continue; }
    const b = l.dist?.Strand?.km;
    if(f.beach < 30 && b != null && b > f.beach){ hidden.beach++; continue; }
    if(f.soon){ const av = parseAvail(l.available); if(av && av > soonLimit){ hidden.soon++; continue; } }
    rows.push(l);
  }
  const by = {
    price:(a,b)=>(a.price||1e9)-(b.price||1e9),
    priceDesc:(a,b)=>(b.price||0)-(a.price||0),
    sqm:(a,b)=>((a.price||1e9)/(a.size||1))-((b.price||1e9)/(b.size||1)),
    new:(a,b)=>String(b.first_seen).localeCompare(String(a.first_seen)) || (a.price-b.price),
    beach:(a,b)=>(a.dist?.Strand?.km??99)-(b.dist?.Strand?.km??99),
    mosque:(a,b)=>(a.dist?.Moschee?.km??99)-(b.dist?.Moschee?.km??99),
    market:(a,b)=>(a.dist?.Markt?.km??99)-(b.dist?.Markt?.km??99),
    seven:(a,b)=>(a.dist?.['7-Eleven']?.km??99)-(b.dist?.['7-Eleven']?.km??99),
    gym:(a,b)=>(a.dist?.['Muay Thai']?.km??99)-(b.dist?.['Muay Thai']?.km??99),
    size:(a,b)=>(b.size||0)-(a.size||0),
  }[state.filters.sort] || ((a,b)=>a.price-b.price);
  rows.sort(by);
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
  const distTxt = ['Strand','Moschee','Muay Thai','7-Eleven'].filter(k=>d[k]).map(k=>`${TXTICON(k)} ${String(d[k].km).replace('.',',')} km${d[k].min!=null?` · ${d[k].min} min`:''}`).join('   ');
  return `<article class="card" data-id="${esc(l.id)}" tabindex="0" aria-label="${esc(l.title)}">
    ${img}
    <div class="badges">${l.seller==='Eigentümer'?'<span class="badge owner">Eigentümer</span>':''}${l.approx&&!l.own?'<span class="badge approx">Lage ≈</span>':''}${l.own?'<span class="badge own">Eigenes · Facebook</span>':''}${isNew(l)?'<span class="badge new">NEU</span>':''}${l.price_before && l.price_before>l.price?'<span class="badge drop">Preis ↓</span>':''}</div>
    <button class="fav" data-fav="${esc(l.id)}" aria-label="Merken" aria-pressed="${isFav(l.id)}">${isFav(l.id)?'★':'☆'}</button>
    <div class="body">
      <div class="price">${fmt(l.price)} ฿ <small>/ Monat${e?` · ≈ ${fmt(e)} €`:''}</small></div>
      <div class="title">${esc(l.title)}</div>
      <div class="facts">
        ${l.size?`<span class="tag">${fmt(l.size)} m²</span>`:''}
        ${l.beds!=null?`<span class="tag grey">${l.beds} SZ</span>`:''}
        <span class="tag ${a.cls==='ok'?'':a.cls==='old'?'warn':'grey'}">${esc(a.label)}</span>
        ${l.pool?`<span class="tag">${l.pool==='privat'?'Privatpool':'Pool'}</span>`:''}
        ${/fully/i.test(l.furniture||'')?'<span class="tag grey">möbliert</span>':''}
      </div>
      ${distTxt?`<div class="dist">${esc(distTxt)}</div>`:'<div class="dist">Lage im Inserat nicht verortet</div>'}
    </div></article>`;
}

function render(){
  if(!DATA) return;
  const onlyFav = view==='fav';
  const {rows, hidden} = filtered(onlyFav);
  const parts = [];
  if(hidden.old) parts.push(`${hidden.old} älter als ${state.filters.maxAge} J.`);
  if(hidden.unknown) parts.push(`${hidden.unknown} ohne Baujahr`);
  if(hidden.pool) parts.push(`${hidden.pool} ohne Pool`);
  if(hidden.owner) parts.push(`${hidden.owner} von Maklern`);
  if(hidden.size) parts.push(`${hidden.size} zu klein`);
  if(hidden.sizeMax) parts.push(`${hidden.sizeMax} zu groß`);
  if(hidden.price) parts.push(`${hidden.price} zu teuer`);
  if(hidden.beach) parts.push(`${hidden.beach} zu weit vom Strand`);
  if(hidden.soon) parts.push(`${hidden.soon} erst später frei`);
  $('#summary').textContent = onlyFav ? `${rows.length} gemerkte Inserate` :
    `${rows.length} von ${DATA.count + state.own.length} Inseraten` + (parts.length ? ` · ausgeblendet: ${parts.join(', ')}` : '');
  listRows = rows; shown = 0;
  $('#list').innerHTML = rows.length ? '' :
    `<p class="empty">${onlyFav?'Noch nichts gemerkt – tippe ☆ auf einem Inserat.':'Keine Inserate passen zu den Filtern.'}</p>`;
  if(rows.length && view!=='map' && view!=='info') moreCards();
  const active = Object.keys(DEFAULTS).filter(k => k!=='sort' && state.filters[k]!==DEFAULTS[k]).length;
  $('#filterCount').textContent = active || '';
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
    list.insertAdjacentHTML('beforeend', `<button class="more" type="button">Weitere ${Math.min(PAGE, listRows.length-shown)} von noch ${listRows.length-shown} anzeigen</button>`);
    const btn = list.querySelector('.more'); btn.onclick = moreCards;
    if('IntersectionObserver' in window){
      moreObs?.disconnect();
      moreObs = new IntersectionObserver(es => { if(es.some(x=>x.isIntersecting)){ moreObs.disconnect(); moreCards(); } }, {rootMargin:'600px'});
      moreObs.observe(btn);
    }
  }
  bindGalleries();
}

function drawMap(rows){
  if(!map){
    map = L.map('map', {zoomControl:true}).setView(CITIES[CITY].center, 12);
    map.on('click', ev => { if(pickFor){ setOwnPos(pickFor, ev.latlng); } });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {maxZoom:19, attribution:'Karte © Esri, HERE, Garmin, © OpenStreetMap-Mitwirkende'}).addTo(map);
    for(const c of Object.keys(POICOL)) poiLayers[c] = L.layerGroup();
    for(const p of DATA.pois){
      const [c,e] = POICOL[p.cat] || ['#555','•'];
      const boat = p.cat==='Strand' && p.boat;
      L.marker([p.lat,p.lng], {icon:L.divIcon({className:'', html:`<div class="poi${boat?' boat':''}${p.cat==='7-Eleven'?' seven':''}" style="background:${c}">${e}</div>`, iconSize:[26,26], iconAnchor:[13,13]}), zIndexOffset:-100})
        .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.cat)}${boat?' – nur mit dem Longtail-Boot erreichbar':''}${p.note?`<br>${esc(p.note)}`:''}<br><a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=two-wheeler">Route</a>`)
        .addTo(poiLayers[p.cat] || (poiLayers[p.cat]=L.layerGroup()));
    }
    const chips = L.control({position:'topright'});
    chips.onAdd = () => { const d = L.DomUtil.create('div','layerchips'); L.DomEvent.disableClickPropagation(d); return d; };
    chips.addTo(map);
    layer = L.layerGroup().addTo(map);
    const zcls = () => map.getContainer().classList.toggle('far', map.getZoom() < 13);
    map.on('zoomend', zcls); zcls();
  }
  syncLayers();
  layer.clearLayers();
  const pts = [];
  for(const l of rows){
    if(l.lat==null || l.lng==null) continue;
    const k = l.price>=1000 ? Math.round(l.price/1000)+'k' : l.price;
    const m = L.marker([l.lat,l.lng], {icon:L.divIcon({className:'', html:`<span class="pin ${isFav(l.id)?'pfav':''} ${l.approx?'approx':''}">${l.approx?'≈':''}${k} ฿</span>`, iconSize:[0,0]})});
    m.on('click', ev => { if(pickFor){ setOwnPos(pickFor, ev.latlng); return; } openDetail(l.id); });
    m.addTo(layer); pts.push([l.lat,l.lng]);
  }
  setTimeout(()=>{ map.invalidateSize(); if(pts.length) map.fitBounds(pts, {padding:[30,30], maxZoom:14}); }, 50);
}

function syncLayers(){
  const box = document.querySelector('.layerchips'); if(!box) return;
  const cnt = c => DATA.pois.filter(p=>p.cat===c).length;
  box.innerHTML = Object.keys(POICOL).map(c=>`<button class="chip ${state.layers[c]?'on':''}" data-layer="${esc(c)}" aria-pressed="${!!state.layers[c]}" aria-label="${esc(c)} ein/aus" title="${esc(c)}">${POICOL[c][1]} <span class="lbl">${esc(c)}</span> <small>${cnt(c)}</small></button>`).join('');
  for(const [c,g] of Object.entries(poiLayers)) state.layers[c] ? map.addLayer(g) : map.removeLayer(g);
}

function renderInfo(){
  const box = $('#info'); if(!KLIMA){ box.innerHTML = '<p class="empty">Infos werden geladen …</p>'; return; }
  const ci = KLIMA.cities[CITY], name = CITIES[CITY].name;
  const mon = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const k = KLIMA.places[ci.home].rain_days_month, h = KLIMA.places[ci.compare].rain_days_month;
  const cname = ci.compare.replace(/ \(.*\)$/,'').replace('Ao Nang/','');
  const bars = mon.map((m,i)=>`<div class="bar"><div class="pair"><i style="height:${k[i]*2.6}px;background:#0e7a69" title="${esc(name)} ${k[i]}"></i><i style="height:${h[i]*2.6}px;background:#c9822b" title="${esc(cname)} ${h[i]}"></i></div>${m}</div>`).join('');
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
      <p class="muted">Orte aus OpenStreetMap (dort fehlende Orte fehlen auch hier). ${esc(CITIES[CITY].note)}</p></section>
    <section class="panel"><h2>Wetter-Vergleich der geprüften Orte</h2>
      <div class="tablewrap"><table><tr><th>Ort</th><th>Regen&shy;tage</th><th>mm</th><th>Ø max °C</th></tr>${rows}</table></div>
      <p class="muted">${esc(KLIMA.source)}. Modelldaten zählen eher zu viele Regentage; für den Vergleich untereinander taugen sie.</p></section>`;
}

const APP_URL = 'https://tugi01.github.io/krabi-wohnen/';
function toast(msg){
  let el = $('#toast'); if(!el){ el = document.createElement('div'); el.id='toast'; el.className='toast'; el.setAttribute('role','status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(()=>el.classList.remove('show'), 2200);
}
async function shareData(data){
  if(navigator.share){ try { await navigator.share(data); return; } catch(err){ if(err && err.name==='AbortError') return; } }
  const txt = `${data.text}\n${data.url}`;
  try { await navigator.clipboard.writeText(txt); toast('Link kopiert – jetzt einfügen und senden'); }
  catch { prompt('Link kopieren:', data.url); }
}
function shareListing(id){
  const l = allListings().find(x=>x.id===id); if(!l) return;
  const e = eur(l.price), a = ageInfo(l, new Date(DATA.generated)), d = l.dist || {};
  const bits = [`${fmt(l.price)} ฿/Monat${e?` (≈ ${fmt(e)} €)`:''}`, l.size?`${fmt(l.size)} m²`:null, l.beds!=null?`${l.beds} SZ`:null, a.label, l.pool?(l.pool==='privat'?'Privatpool':'Pool'):null].filter(Boolean).join(' · ');
  const near = ['Strand','Moschee','Muay Thai'].filter(k=>d[k]).map(k=>`${k} ${String(d[k].km).replace('.',',')} km`).join(', ');
  shareData({ title: l.title, text: `🏠 ${l.title}\n${bits}${near?`\n${near}`:''}`, url: l.url });
}
function shareApp(){ shareData({ title:'Thailand Wohnen', text:'🏝 Thailand Wohnen – Mietwohnungen in Krabi und Pattaya, zweimal täglich aktualisiert', url: APP_URL }); }

function openDetail(id){
  const l = allListings().find(x=>x.id===id); if(!l) return;
  const a = ageInfo(l, new Date(DATA.generated)), e = eur(l.price), d = l.dist || {};
  const gal = (l.images||[]).map(u=>`<img loading="lazy" src="${esc(imgSrc(u,828))}" alt="">`).join('');
  const rows = [
    ['Miete', `${fmt(l.price)} ฿ / Monat${e?` (≈ ${fmt(e)} €)`:''}${l.price_before?` · vorher ${fmt(l.price_before)} ฿`:''}`],
    ['Fläche', l.size?`${fmt(l.size)} m²${l.price&&l.size?` · ${fmt(Math.round(l.price/l.size))} ฿/m²`:''}`:'–'],
    ['Zimmer', `${l.beds??'–'} SZ · ${l.baths??'–'} Bad`],
    ['Gebäude', `${a.label}${l.built_src?` (Quelle: ${l.built_src})`:''}`],
    ['Typ', l.type||'–'], ['Möbliert', ({'Fully Furnished':'voll möbliert','Partly Furnished':'teilmöbliert','Unfurnished':'unmöbliert'})[l.furniture]||l.furniture||'–'], ['Pool', l.pool?(l.pool==='privat'?'privater Pool':'Gemeinschaftspool'):'kein Pool angegeben'],
    ['Frei ab', l.available||'nicht angegeben'], ['Haustiere', l.pets||'–'],
    ['Anbieter', l.seller||'–'], ['Aktualisiert', l.updated||'–'], ['Bei uns seit', l.first_seen||'–'], ['Quelle', (l.source||'–') + (l.also?.length ? ` (auch bei ${l.also.map(a=>a.source).join(', ')})` : '')],
    ...(l.approx && !l.own ? [['Lage', 'nur ungefähr (Ortsteil) – genaue Adresse beim Anbieter erfragen']] : []),
  ];
  const dist = DISTCATS.filter(k=>d[k]).map(k=>[`${TXTICON(k)==='7-11'?'🏪':TXTICON(k)} ${k}`, `${String(d[k].km).replace('.',',')} km${d[k].min!=null?`, ca. ${d[k].min} min`:''}${d[k].road?'':' (geschätzt)'} – ${d[k].name}`]);
  const nav = l.lat!=null ? `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}&travelmode=two-wheeler` : null;
  $('#detail').innerHTML = `<div class="grab"></div><button class="close" aria-label="Schließen">✕</button>
    ${gal?`<div class="gallery">${gal}</div>`:''}
    <h2 id="dTitle">${esc(l.title)}</h2>
    <dl>${[...rows, ...dist].map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${l.description?`<p class="desc">${esc(l.description)}</p>`:''}
    <p class="note">${l.own?'Von dir eingetragen – Entfernungen sind Schätzungen (Luftlinie × 1,3). ':''}Angaben aus dem Inserat, nicht vom Vermieter bestätigt. Vor jeder Zahlung besichtigen und Vertrag prüfen. Entfernungen: Straßen-km und Fahrzeit (Auto-Profil, Roller ähnlich) ab dem Kartenpunkt des Inserats zum nächstgelegenen Ort; Strände nur, wenn ohne Boot erreichbar.</p>
    <div class="actions">
      <a class="primary" href="${esc(l.url)}" target="_blank" rel="noopener">Inserat ↗</a>
      ${(l.also||[]).slice(0,1).map(a=>`<a class="ghost" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.source)} ↗</a>`).join('')}
      ${nav?`<a class="ghost" href="${nav}" target="_blank" rel="noopener">Route</a>`:''}
      <button class="ghost" data-share="${esc(l.id)}" aria-label="Teilen"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"/></svg></button>
      <button class="ghost" data-fav="${esc(l.id)}">${isFav(l.id)?'★':'☆'}</button>
    </div>
    ${l.own?`<div class="sheetActions"><button class="ghost" data-ownedit="${esc(l.id)}">Bearbeiten</button><button class="ghost" data-ownpos="${esc(l.id)}">Ort auf Karte setzen</button><button class="ghost danger" data-owndel="${esc(l.id)}">Löschen</button></div>`:''}`;
  openSheet('#detail');
}

let lastFocus = null;
function openSheet(sel){ lastFocus = document.activeElement; $('#scrim').hidden=false; $(sel).hidden=false; $(sel).querySelector('button,input,a')?.focus({preventScroll:true}); }
function closeSheets(){ $('#scrim').hidden=true; $('#filters').hidden=true; $('#detail').hidden=true; $('#own').hidden=true; lastFocus?.focus?.({preventScroll:true}); }

let setFilterUi = () => {};
function bindFilters(){
  const set = setFilterUi = () => { const f = state.filters;
    $('#fOwner').checked=f.owner; $('#fOld').checked=f.old; $('#fPool').checked=f.pool; $('#fUnknown').checked=f.unknown; $('#fSoon').checked=f.soon;
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
  $('#fReset').onclick = () => { Object.assign(state.filters, DEFAULTS); save(); set(); render(); };
  $('#fClose').onclick = closeSheets;
  $('#filterBtn').onclick = () => openSheet('#filters');
  $('#scrim').onclick = closeSheets;
  document.addEventListener('keydown', e => { if(e.key==='Escape') closeSheets(); });
  set();
}

function wakeImgs(g){ g.querySelectorAll('img[data-src]').forEach(i => { i.src = i.dataset.src; i.removeAttribute('data-src'); }); }
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
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
    view = b.dataset.view;
    document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-selected', x===b));
    $('#viewList').hidden = view==='map' || view==='info'; $('#viewMap').hidden = view!=='map'; $('#viewInfo').hidden = view!=='info';
    render();
  });
  document.addEventListener('click', e => {
    const nb = e.target.closest('[data-nav]');
    if(nb){ e.stopPropagation(); const g = nb.closest('.media').querySelector('[data-gal]'); wakeImgs(g); g.scrollBy({left: g.clientWidth * +nb.dataset.nav, behavior:'smooth'}); return; }
    const sb = e.target.closest('[data-share]');
    if(sb){ e.stopPropagation(); shareListing(sb.dataset.share); return; }
    if(e.target.closest('#shareApp')){ shareApp(); return; }
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
      state.favs = isFav(id) ? state.favs.filter(x=>x!==id) : [...state.favs, id]; save(); render();
      if(!$('#detail').hidden) openDetail(id); return; }
    if(e.target.closest('#detail .close')) { closeSheets(); return; }
    const c = e.target.closest('.card'); if(c) openDetail(c.dataset.id);
  });
  $('#ownForm').addEventListener('submit', saveOwnForm);
  $('#ownPaste').onclick = async () => { try { const t = await navigator.clipboard.readText(); if(t){ $('#wUrl').value = t.trim(); } } catch { toast('Einfügen nicht erlaubt – bitte lange tippen und „Einfügen“ wählen'); } };
  $('#ownCancel').onclick = closeSheets;
  document.addEventListener('keydown', e => { const c = e.target.closest?.('.card'); if(c && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); openDetail(c.dataset.id); } });
}

function syncCityUi(){
  document.querySelectorAll('[data-city]').forEach(b => { const on = b.dataset.city===CITY; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  document.title = `${CITIES[CITY].name} – Thailand Wohnen`;
}
async function loadCity(city){
  CITY = city; localStorage.setItem('krabiwohnen.city', city);
  localStorage.setItem('krabiwohnen.booting', city);
  state = load(city); syncCityUi();
  if(map){ map.remove(); map = null; poiLayers = {}; layer = null; }
  DATA = null; $('#list').innerHTML = '<p class="empty">Lade Inserate …</p>'; $('#summary').textContent = '';
  try{
    const r = await fetch(`data/${city}/listings.json`, {cache:'no-cache'});
    if(!r.ok) throw new Error(r.status);
    const d = await r.json(); if(city !== CITY) return; DATA = d;
  }catch(err){
    $('#stand').textContent = 'Daten konnten nicht geladen werden (offline?).'; $('#list').innerHTML = ''; return;
  }
  const g = new Date(DATA.generated);
  $('#stand').textContent = `Stand ${g.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})} ${g.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} · ${DATA.count} Inserate · 1 € = ${(Math.round(DATA.fx.rate*10)/10).toLocaleString('de-DE')} ฿`;
  setFilterUi(); render();
  setTimeout(() => localStorage.removeItem('krabiwohnen.booting'), 4000);
}
function switchCity(city){ if(city===CITY || !CITIES[city]) return; closeSheets(); window.scrollTo({top:0}); loadCity(city); }

// ---- Facebook Marketplace (nur Weiterleitung; Facebook erlaubt kein automatisches Auslesen) ----
function openFacebook(){
  const f = state.filters, c = CITIES[CITY];
  const q = encodeURIComponent(`${c.fb} house condo for rent`);
  const max = f.price < 150000 ? `&maxPrice=${f.price}` : '';
  window.open(`https://www.facebook.com/marketplace/search/?query=${q}&minPrice=5000${max}&exact=false`, '_blank', 'noopener');
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

async function init(){
  const crashed = localStorage.getItem('krabiwohnen.booting');
  if(crashed && crashed !== 'krabi'){ CITY = 'krabi'; setTimeout(() => toast(`${CITIES[crashed]?.name||crashed} wurde zuletzt nicht fertig geladen – Krabi geöffnet`), 800); }
  bindUi();
  bindFilters();
  fetch('data/klima.json', {cache:'no-cache'}).then(x=>x.json()).then(k=>{ KLIMA=k; if(view==='info') renderInfo(); }).catch(()=>{});
  await loadCity(CITY);
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
