/* Krabi Wohnen – PWA. Daten: data/listings.json (täglich per GitHub Action aktualisiert). */
'use strict';
const $ = s => document.querySelector(s);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'krabiwohnen.v1';
const DEFAULTS = { old:false, pool:false, unknown:false, soon:false, maxAge:5, size:50, price:60000, beach:30, sort:'price' };
const LAYERS = { Strand:true, Moschee:true, 'Muay Thai':true, Einkauf:false, Krankenhaus:false };
const POICOL = { Strand:['#1b8cb2','🏖'], Moschee:['#2f7d4b','🕌'], 'Muay Thai':['#7d54a4','🥊'], Einkauf:['#ad841a','🛒'], Krankenhaus:['#c0392b','🏥'] };
const DISTCATS = ['Strand','Moschee','Muay Thai','Einkauf','Krankenhaus'];
let state = load();
let DATA = null, KLIMA = null, view = 'list', map = null, layer = null, poiLayers = {};

function load(){
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { filters:{...DEFAULTS, ...(s.filters||{})}, layers:{...LAYERS, ...(s.layers||{})}, favs:Array.isArray(s.favs)?s.favs:[] }; }
  catch { return { filters:{...DEFAULTS}, layers:{...LAYERS}, favs:[] }; }
}
function save(){ try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }

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
const isNew = l => DATA && l.first_seen && (new Date(DATA.generated) - new Date(l.first_seen)) / 864e5 <= 7 && DATA.listings.some(x => x.first_seen !== l.first_seen);
const isFav = id => state.favs.includes(id);

function filtered(onlyFav=false){
  if(!DATA) return {rows:[], hidden:{}};
  const f = state.filters, now = new Date(DATA.generated), soonLimit = new Date(now); soonLimit.setMonth(soonLimit.getMonth()+2);
  const hidden = {old:0, unknown:0, pool:0, size:0, price:0, beach:0, soon:0};
  const rows = [];
  for(const l of DATA.listings){
    if(onlyFav){ if(isFav(l.id)) rows.push(l); continue; }
    const a = ageInfo(l, now);
    if(a.recent===false && !f.old){ hidden.old++; continue; }
    if(a.recent===null && !f.unknown){ hidden.unknown++; continue; }
    if(f.pool && !l.pool){ hidden.pool++; continue; }
    if(f.size && !(l.size >= f.size)){ hidden.size++; continue; }
    if(f.price < 150000 && !(l.price <= f.price)){ hidden.price++; continue; }
    const b = l.dist?.Strand?.km;
    if(f.beach < 30 && b != null && b > f.beach){ hidden.beach++; continue; }
    if(f.soon){ const av = parseAvail(l.available); if(av && av > soonLimit){ hidden.soon++; continue; } }
    rows.push(l);
  }
  const by = {
    price:(a,b)=>(a.price||1e9)-(b.price||1e9),
    sqm:(a,b)=>((a.price||1e9)/(a.size||1))-((b.price||1e9)/(b.size||1)),
    new:(a,b)=>String(b.first_seen).localeCompare(String(a.first_seen)) || (a.price-b.price),
    beach:(a,b)=>(a.dist?.Strand?.km??99)-(b.dist?.Strand?.km??99),
    mosque:(a,b)=>(a.dist?.Moschee?.km??99)-(b.dist?.Moschee?.km??99),
    gym:(a,b)=>(a.dist?.['Muay Thai']?.km??99)-(b.dist?.['Muay Thai']?.km??99),
    size:(a,b)=>(b.size||0)-(a.size||0),
  }[state.filters.sort] || ((a,b)=>a.price-b.price);
  rows.sort(by);
  return {rows, hidden};
}

function card(l){
  const a = ageInfo(l, new Date(DATA.generated));
  const img = l.images?.[0] ? `<img loading="lazy" src="${esc(imgSrc(l.images[0],640))}" alt="">` : `<div class="noimg">🏠</div>`;
  const e = eur(l.price);
  const d = l.dist || {};
  const distTxt = ['Strand','Moschee','Muay Thai','Einkauf'].filter(k=>d[k]).map(k=>`${POICOL[k][1]} ${String(d[k].km).replace('.',',')} km${d[k].min!=null?` · ${d[k].min} min`:''}`).join('   ');
  return `<article class="card" data-id="${esc(l.id)}" tabindex="0" aria-label="${esc(l.title)}">
    ${img}
    <div class="badges">${isNew(l)?'<span class="badge new">NEU</span>':''}${l.price_before && l.price_before>l.price?'<span class="badge drop">Preis ↓</span>':''}</div>
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
  if(hidden.size) parts.push(`${hidden.size} zu klein`);
  if(hidden.price) parts.push(`${hidden.price} zu teuer`);
  if(hidden.beach) parts.push(`${hidden.beach} zu weit vom Strand`);
  if(hidden.soon) parts.push(`${hidden.soon} erst später frei`);
  $('#summary').textContent = onlyFav ? `${rows.length} gemerkte Inserate` :
    `${rows.length} von ${DATA.count} Inseraten` + (parts.length ? ` · ausgeblendet: ${parts.join(', ')}` : '');
  $('#list').innerHTML = rows.length ? rows.map(card).join('') :
    `<p class="empty">${onlyFav?'Noch nichts gemerkt – tippe ☆ auf einem Inserat.':'Keine Inserate passen zu den Filtern.'}</p>`;
  const active = Object.keys(DEFAULTS).filter(k => k!=='sort' && state.filters[k]!==DEFAULTS[k]).length;
  $('#filterCount').textContent = active || '';
  if(view==='map') drawMap(rows);
  if(view==='info') renderInfo();
  const sub = document.getElementById('oldSub'); if(sub) sub.textContent = `Baujahr vor ${new Date(DATA.generated).getFullYear()-state.filters.maxAge} und nicht kernsaniert`;
}

function drawMap(rows){
  if(!map){
    map = L.map('map', {zoomControl:true}).setView([8.045, 98.83], 12);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      {maxZoom:19, attribution:'Karte © Esri, HERE, Garmin, © OpenStreetMap-Mitwirkende'}).addTo(map);
    for(const c of Object.keys(POICOL)) poiLayers[c] = L.layerGroup();
    for(const p of DATA.pois){
      const [c,e] = POICOL[p.cat] || ['#555','•'];
      const boat = p.cat==='Strand' && p.boat;
      L.marker([p.lat,p.lng], {icon:L.divIcon({className:'', html:`<div class="poi${boat?' boat':''}" style="background:${c}">${e}</div>`, iconSize:[26,26], iconAnchor:[13,13]}), zIndexOffset:-100})
        .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.cat)}${boat?' – nur mit dem Longtail-Boot erreichbar':''}${p.note?`<br>${esc(p.note)}`:''}<br><a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=two-wheeler">Route</a>`)
        .addTo(poiLayers[p.cat] || (poiLayers[p.cat]=L.layerGroup()));
    }
    const chips = L.control({position:'topright'});
    chips.onAdd = () => { const d = L.DomUtil.create('div','layerchips'); L.DomEvent.disableClickPropagation(d); return d; };
    chips.addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  syncLayers();
  layer.clearLayers();
  const pts = [];
  for(const l of rows){
    if(l.lat==null || l.lng==null) continue;
    const k = l.price>=1000 ? Math.round(l.price/1000)+'k' : l.price;
    const m = L.marker([l.lat,l.lng], {icon:L.divIcon({className:'', html:`<span class="pin ${isFav(l.id)?'fav':''}">${k} ฿</span>`, iconSize:[0,0]})});
    m.on('click', () => openDetail(l.id));
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
  const mon = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  const k = KLIMA.places['Ao Nang/Krabi (TH)'].rain_days_month, h = KLIMA.places['Hua Hin (TH)'].rain_days_month;
  const bars = mon.map((m,i)=>`<div class="bar"><div class="pair"><i style="height:${k[i]*2.6}px;background:#0e7a69" title="Krabi ${k[i]}"></i><i style="height:${h[i]*2.6}px;background:#c9822b" title="Hua Hin ${h[i]}"></i></div>${m}</div>`).join('');
  const notes = {'Ao Nang/Krabi (TH)':'Strände, viele Moscheen, Muay Thai','Hua Hin (TH)':'am trockensten, wenige Moscheen','Langkawi (MY)':'muslimisch, kaum Muay Thai','Lombok/Kuta (ID)':'muslimisch, Regen Nov–März','Da Nang (VN)':'kaum Moscheen'};
  const rows = Object.entries(KLIMA.places).sort((a,b)=>a[1].rain_days_year-b[1].rain_days_year)
    .map(([n,v])=>`<tr class="${n.startsWith('Ao Nang')?'win':''}"><td>${esc(n)}${notes[n]?`<small class="tnote">${esc(notes[n])}</small>`:''}</td><td>${v.rain_days_year}</td><td>${fmt(v.mm_year)}</td><td>${String(v.tmax_avg).replace('.',',')}</td></tr>`).join('');
  const drive = Object.entries(KLIMA.drive_from_aonang).map(([n,[km,min]])=>`<tr><td>${esc(n)}</td><td>${String(km).replace('.',',')}</td><td>${min}</td></tr>`).join('');
  const nPois = c => DATA ? DATA.pois.filter(p=>p.cat===c && !p.boat).length : 0;
  box.innerHTML = `
    <section class="panel"><h2>Wann ist es in Krabi trocken?</h2>
      <div class="bars">${bars}</div>
      <p class="muted"><b style="color:#0e7a69">■ Krabi</b> · <b style="color:#c9822b">■ Hua Hin</b> (trockenster Vergleichsort) – Regentage pro Monat. <b>Beste Zeit in Krabi: Januar bis März</b> (8–13 Regentage). April bis November ist Regenzeit.</p></section>
    <section class="panel"><h2>Fahrzeit ab Ao Nang</h2><table><tr><th>Ziel</th><th>km</th><th>min</th></tr>${drive}</table>
      <p class="muted">${esc(KLIMA.drive_source)}. Mit dem Roller ähnlich.</p></section>
    <section class="panel"><h2>Was rund um Ao Nang auf der Karte ist</h2>
      <p>${nPois('Moschee')} Moscheen · ${nPois('Muay Thai')} Muay-Thai-Gyms · ${nPois('Einkauf')} Supermärkte, Märkte und Einkaufszentren · ${nPois('Krankenhaus')} Krankenhäuser · ${nPois('Strand')} Strände ohne Boot erreichbar</p>
      <p class="muted">Orte aus OpenStreetMap. Gebetszeiten und Trainingszeiten vor Ort erfragen.</p></section>
    <section class="panel"><h2>Wetter-Vergleich der geprüften Orte</h2>
      <div class="tablewrap"><table><tr><th>Ort</th><th>Regen&shy;tage</th><th>mm</th><th>Ø max °C</th></tr>${rows}</table></div>
      <p class="muted">${esc(KLIMA.source)}. Modelldaten zählen eher zu viele Regentage; für den Vergleich untereinander taugen sie.</p></section>`;
}

function openDetail(id){
  const l = DATA.listings.find(x=>x.id===id); if(!l) return;
  const a = ageInfo(l, new Date(DATA.generated)), e = eur(l.price), d = l.dist || {};
  const gal = (l.images||[]).map(u=>`<img loading="lazy" src="${esc(imgSrc(u,828))}" alt="">`).join('');
  const rows = [
    ['Miete', `${fmt(l.price)} ฿ / Monat${e?` (≈ ${fmt(e)} €)`:''}${l.price_before?` · vorher ${fmt(l.price_before)} ฿`:''}`],
    ['Fläche', l.size?`${fmt(l.size)} m²${l.price&&l.size?` · ${fmt(Math.round(l.price/l.size))} ฿/m²`:''}`:'–'],
    ['Zimmer', `${l.beds??'–'} SZ · ${l.baths??'–'} Bad`],
    ['Gebäude', `${a.label}${l.built_src?` (Quelle: ${l.built_src})`:''}`],
    ['Typ', l.type||'–'], ['Möbliert', ({'Fully Furnished':'voll möbliert','Partly Furnished':'teilmöbliert','Unfurnished':'unmöbliert'})[l.furniture]||l.furniture||'–'], ['Pool', l.pool?(l.pool==='privat'?'privater Pool':'Gemeinschaftspool'):'kein Pool angegeben'],
    ['Frei ab', l.available||'nicht angegeben'], ['Haustiere', l.pets||'–'],
    ['Aktualisiert', l.updated||'–'], ['Bei uns seit', l.first_seen||'–'], ['Quelle', l.source||'–'],
  ];
  const dist = DISTCATS.filter(k=>d[k]).map(k=>[`${POICOL[k][1]} ${k}`, `${String(d[k].km).replace('.',',')} km${d[k].min!=null?`, ca. ${d[k].min} min`:''}${d[k].road?'':' (geschätzt)'} – ${d[k].name}`]);
  const nav = l.lat!=null ? `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}&travelmode=two-wheeler` : null;
  $('#detail').innerHTML = `<div class="grab"></div><button class="close" aria-label="Schließen">✕</button>
    ${gal?`<div class="gallery">${gal}</div>`:''}
    <h2 id="dTitle">${esc(l.title)}</h2>
    <dl>${[...rows, ...dist].map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${l.description?`<p class="desc">${esc(l.description)}</p>`:''}
    <p class="note">Angaben aus dem Inserat, nicht vom Vermieter bestätigt. Vor jeder Zahlung besichtigen und Vertrag prüfen. Entfernungen: Straßen-km und Fahrzeit (Auto-Profil, Roller ähnlich) ab dem Kartenpunkt des Inserats zum nächstgelegenen Ort; Strände nur, wenn ohne Boot erreichbar.</p>
    <div class="actions">
      <a class="primary" href="${esc(l.url)}" target="_blank" rel="noopener">Inserat ↗</a>
      ${nav?`<a class="ghost" href="${nav}" target="_blank" rel="noopener">Route</a>`:''}
      <button class="ghost" data-fav="${esc(l.id)}">${isFav(l.id)?'★ Gemerkt':'☆ Merken'}</button>
    </div>`;
  openSheet('#detail');
}

let lastFocus = null;
function openSheet(sel){ lastFocus = document.activeElement; $('#scrim').hidden=false; $(sel).hidden=false; $(sel).querySelector('button,input,a')?.focus({preventScroll:true}); }
function closeSheets(){ $('#scrim').hidden=true; $('#filters').hidden=true; $('#detail').hidden=true; lastFocus?.focus?.({preventScroll:true}); }

function bindFilters(){
  const f = state.filters;
  const set = () => {
    $('#fOld').checked=f.old; $('#fPool').checked=f.pool; $('#fUnknown').checked=f.unknown; $('#fSoon').checked=f.soon;
    $('#fAge').value=f.maxAge;
    $('#fSize').value=f.size; $('#fPrice').value=f.price; $('#fBeach').value=f.beach; $('#fSort').value=f.sort;
    $('#oSize').textContent = f.size ? `${f.size} m²` : 'alle';
    $('#oPrice').textContent = f.price>=150000 ? 'egal' : `${fmt(+f.price)} ฿${eur(f.price)?` (≈ ${fmt(eur(f.price))} €)`:''}`;
    $('#oBeach').textContent = f.beach>=30 ? 'egal' : `${f.beach} km`;
  };
  const upd = (k, v) => { f[k]=v; save(); set(); render(); };
  $('#fOld').onchange = e => upd('old', e.target.checked);
  $('#fPool').onchange = e => upd('pool', e.target.checked);
  $('#fUnknown').onchange = e => upd('unknown', e.target.checked);
  $('#fSoon').onchange = e => upd('soon', e.target.checked);
  $('#fAge').onchange = e => upd('maxAge', +e.target.value);
  $('#fSize').oninput = e => upd('size', +e.target.value);
  $('#fPrice').oninput = e => upd('price', +e.target.value);
  $('#fBeach').oninput = e => upd('beach', +e.target.value);
  $('#fSort').onchange = e => upd('sort', e.target.value);
  $('#fReset').onclick = () => { Object.assign(f, DEFAULTS); save(); set(); render(); };
  $('#fClose').onclick = closeSheets;
  $('#filterBtn').onclick = () => openSheet('#filters');
  $('#scrim').onclick = closeSheets;
  document.addEventListener('keydown', e => { if(e.key==='Escape') closeSheets(); });
  set();
}

function bindUi(){
  document.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
    view = b.dataset.view;
    document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-selected', x===b));
    $('#viewList').hidden = view==='map' || view==='info'; $('#viewMap').hidden = view!=='map'; $('#viewInfo').hidden = view!=='info';
    render();
  });
  document.addEventListener('click', e => {
    const lb = e.target.closest('[data-layer]');
    if(lb){ const c = lb.dataset.layer; state.layers[c] = !state.layers[c]; save(); syncLayers(); return; }
    const fb = e.target.closest('[data-fav]');
    if(fb){ e.stopPropagation(); const id = fb.dataset.fav;
      state.favs = isFav(id) ? state.favs.filter(x=>x!==id) : [...state.favs, id]; save(); render();
      if(!$('#detail').hidden) openDetail(id); return; }
    if(e.target.closest('#detail .close')) { closeSheets(); return; }
    const c = e.target.closest('.card'); if(c) openDetail(c.dataset.id);
  });
  document.addEventListener('keydown', e => { const c = e.target.closest?.('.card'); if(c && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); openDetail(c.dataset.id); } });
}

async function init(){
  bindUi();
  try{
    const r = await fetch('data/listings.json', {cache:'no-cache'});
    DATA = await r.json();
    fetch('data/klima.json', {cache:'no-cache'}).then(x=>x.json()).then(k=>{ KLIMA=k; if(view==='info') renderInfo(); }).catch(()=>{});
  }catch(err){
    $('#stand').textContent = 'Daten konnten nicht geladen werden (offline?).'; return;
  }
  const g = new Date(DATA.generated);
  $('#stand').textContent = `Stand ${g.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})} ${g.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} · ${DATA.count} Inserate · 1 € = ${(Math.round(DATA.fx.rate*10)/10).toLocaleString('de-DE')} ฿`;
  bindFilters();
  render();
}
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
init();
