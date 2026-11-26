// Prüft die Korrekturen aus dem zweiten Erst-Nutzer-Bericht.
import { createRequire } from 'module';
const { webkit } = createRequire(process.env.PW_FROM || '/Users/tugrulcinkaya/Projects/fashion-id/package.json')('playwright');
const URL = process.env.URL || 'http://127.0.0.1:8765/';
const OUT = process.env.OUT || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if(!c) fails++; };
const b = await webkit.launch();
const ctx = await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('about:blank'); await p.goto(URL); await p.waitForTimeout(2000);
// Kopfzeile ohne Stadt-Reiter
ok(!(await p.$('.cityseg')) && await p.$eval('#appTitle', e => e.textContent) === 'Thailand Wohnen', 'Kopfzeile: „Thailand Wohnen“ ohne alte Reiter');
const pls = await p.$$eval('#placebar .pl', x => x.map(e => e.textContent));
ok(pls.join('|') === 'Ganz Thailand|Krabi|Pattaya|＋ Ort', `Meine Orte: ${pls.join(' | ')}`);
await p.click('[data-pl="__add"]'); await p.waitForSelector('#places:not([hidden])');
await p.click('#plSugg [data-pladd*="Koh Samui"]'); await p.waitForTimeout(300);
await p.click('#plMine [data-pldel="0"]'); await p.waitForTimeout(200);
await p.screenshot({path: `${OUT}/r2-places.png`});
await p.$eval('#plClose', e => e.click()); await p.waitForTimeout(400);
const pls2 = await p.$$eval('#placebar .pl', x => x.map(e => e.textContent));
ok(pls2.join('|') === 'Ganz Thailand|Pattaya|Koh Samui|＋ Ort', `Ort hinzugefügt/entfernt: ${pls2.join(' | ')}`);
await p.click('#placebar .pl:has-text("Koh Samui")'); await p.waitForSelector('.card', {timeout:20000}); await p.waitForTimeout(800);
const sam = await p.evaluate(() => ({on: document.querySelector('#placebar .pl.on')?.textContent, rb: document.querySelector('.regionbar')?.textContent.replace(/\s+/g,' ').slice(0,60), n: document.querySelectorAll('.card').length, lat: TH.listingsIn(TH.bounds).slice(0,20).every(l => l.lat > 9.2 && l.lat < 9.9)}));
ok(sam.on === 'Koh Samui' && sam.n > 3 && sam.lat, `Koh Samui: ${sam.n} Karten, Leiste „${sam.rb}“`);
await p.screenshot({path: `${OUT}/r2-samui.png`});
await p.reload(); await p.waitForTimeout(2000);
ok((await p.$$eval('#placebar .pl', x => x.map(e => e.textContent))).includes('Koh Samui'), 'Orte bleiben nach Neuladen');
await p.click('[data-pl="__all"]'); await p.waitForTimeout(1000);
await p.click('[data-pl="__add"]'); await p.waitForSelector('#places:not([hidden])');
for(const want of ['Krabi']) await p.click(`#plSugg [data-pladd*='"${want}"']`);
await p.$eval('#plClose', e => e.click()); await p.waitForTimeout(300);
await p.evaluate(() => { PLACES = [{name:'Krabi', city:'krabi'}, {name:'Pattaya', city:'pattaya'}, ...PLACES.filter(x => !x.city)]; savePlaces(); });
// Start: Schnellwahl Krabi/Pattaya
ok(await p.$$eval('.thpick .quick button', x => x.length) === 2, 'Start: Schnellwahl „Krabi / Ao Nang“ und „Pattaya“');
// B7 Zurück: Provinz -> Übersicht, Gegend -> vorige Gegend, Tab -> voriger Tab
const prov = await p.$eval('.provs button', e => e.dataset.prov);
await p.click(`.provs button[data-prov="${prov}"]`); await p.waitForSelector('.card', {timeout:20000});
await p.goBack(); await p.waitForTimeout(800);
ok(await p.$$eval('.provs button', x => x.length) > 3 && p.url().startsWith(URL), 'B7 Zurück nach Provinz-Wahl → Provinzliste, App bleibt offen');
await p.$eval('.thpick .quick [data-city="krabi"]', e => e.click()); await p.waitForSelector('.card');
await p.click('#tabMap'); await p.waitForTimeout(800); await p.click('#tabInfo'); await p.waitForTimeout(500);
await p.goBack(); await p.waitForTimeout(600);
ok(await p.evaluate(() => view) === 'map', 'B7 Zurück von „Infos“ → „Karte“');
await p.goBack(); await p.waitForTimeout(600);
ok(await p.evaluate(() => view) === 'list' && await p.evaluate(() => CITY) === 'krabi', 'B7 Zurück von „Karte“ → „Liste“');
await p.goBack(); await p.waitForTimeout(1200);
ok(await p.evaluate(() => CITY) === 'thailand' && p.url().startsWith(URL), 'B7 Zurück von „Krabi“ → „Thailand“, App bleibt offen');
await p.click('#placebar .pl:has-text("Pattaya")'); await p.waitForSelector('.card');
ok(await p.$eval('#appTitle', e => e.textContent) === 'Pattaya & Umgebung' && await p.$eval('#placebar .pl.on', e => e.textContent) === 'Pattaya', 'Pattaya: Titel + Knopf markiert');
await p.screenshot({path: `${OUT}/r2-head-pattaya.png`, clip:{x:0,y:0,width:390,height:160}});
await p.click('[data-pl="__all"]'); await p.waitForTimeout(1200);
ok(await p.evaluate(() => CITY) === 'thailand', '„Ganz Thailand“ führt zurück');
await p.screenshot({path: `${OUT}/r2-head-th.png`, clip:{x:0,y:0,width:390,height:140}});
await p.evaluate(() => switchCity('krabi')); await p.waitForSelector('.card');
// B5 Vorauswahl sichtbar
const fc = await p.$eval('#filterCount', e => e.textContent);
const hint = await p.$eval('.hidehint', e => e.textContent.replace(/\s+/g,' ')).catch(() => '');
ok(+fc >= 3 && /Alle \d/.test(hint), `B5 Filter-Knopf zeigt Vorauswahl (${fc}), Leiste: „${hint.slice(0,110)}“`);
// B14 Filter-Knopf nennt Treffer
await p.click('#filterBtn'); await p.waitForTimeout(400);
const fl = await p.$eval('#fClose', e => e.textContent); ok(/\d+ Inserate? zeigen/.test(fl), `B14 Filter-Knopf: „${fl}“`);
await p.$eval('#fClose', e => e.click()); await p.waitForTimeout(300);
// B12 Texte
const t = await p.$$eval('.card', cs => cs.map(c => c.textContent).join(' '));
ok(!/\d SZ\b/.test(t) && /Schlafz\./.test(t), 'B12 „SZ“ ersetzt durch „Schlafz.“');
ok(await p.evaluate(() => deTxt('Negotiable') === 'verhandelbar' && deTxt('House') === 'Haus' && deTxt('Cats Only') === 'nur Katzen'), 'B12 Anbieter-Angaben übersetzt');
// B1 Preis-Prüfung (künstliches Beispiel)
ok(await p.evaluate(() => pCheck({price:6500, size:290}) && !pCheck({price:20000, size:70}) && !pCheck({price:6500, size:290, price_list:6500})), 'B1 unplausibler Preis wird erkannt (6.500 ฿ für 290 m²)');
// B8 Karte: Preisschilder überdecken sich nicht
await p.click('#tabMap'); await p.waitForTimeout(1500);
const ov = await p.evaluate(() => { const r = [...document.querySelectorAll('.leaflet-marker-pane .pin')].map(e => e.getBoundingClientRect()).filter(r => r.width);
  let n = 0; for(let i=0;i<r.length;i++) for(let j=i+1;j<r.length;j++){ const a=r[i], c=r[j]; if(a.left < c.right-4 && c.left < a.right-4 && a.top < c.bottom-4 && c.top < a.bottom-4) n++; } return [r.length, n]; });
ok(ov[1] <= Math.ceil(ov[0] * 0.05), `B8 Preisschilder: ${ov[0]} sichtbar, ${ov[1]} Überlappungen`);
const zi = await p.evaluate(() => { const pin = document.querySelector('.leaflet-marker-pane .pin')?.parentElement, poi = document.querySelector('.leaflet-marker-pane .poi')?.parentElement; return pin && poi ? [+pin.style.zIndex, +poi.style.zIndex] : null; });
ok(!zi || zi[0] > zi[1], `B8 Orts-Symbole liegen unter den Preisschildern ${zi}`);
await p.screenshot({path: `${OUT}/r2-map-krabi.png`});
// Thailand-Übersicht: Blasen überlappen nicht, Chiang Mai sichtbar
await p.evaluate(() => switchCity('thailand')); await p.waitForTimeout(1500); await p.evaluate(() => thOverview()); await p.waitForTimeout(2000);
const bub = await p.evaluate(() => { const r = [...document.querySelectorAll('.bubble')].map(e => e.getBoundingClientRect()); const m = document.querySelector('#map').getBoundingClientRect();
  let n = 0; for(let i=0;i<r.length;i++) for(let j=i+1;j<r.length;j++){ const a=r[i], c=r[j]; const d = Math.hypot((a.left+a.right-c.left-c.right)/2, (a.top+a.bottom-c.top-c.bottom)/2); if(d < (a.width + c.width)/2 - 2) n++; }
  return {n: r.length, over: n, clipped: r.filter(x => x.top < m.top - 2 || x.bottom > m.bottom + 2).length}; });
ok(bub.n > 3 && bub.over === 0 && bub.clipped === 0, `B8 Thailand-Blasen: ${bub.n}, Überlappungen ${bub.over}, abgeschnitten ${bub.clipped}`);
await p.screenshot({path: `${OUT}/r2-map-th.png`});
// B14 Merken-Tab bleibt nach Neuladen
await p.click('#tabFav'); await p.waitForTimeout(300); await p.reload(); await p.waitForTimeout(2500);
ok(await p.evaluate(() => view) === 'fav', 'B14 Reiter „Merken“ bleibt nach Neuladen');
await p.click('#tabList'); await p.waitForTimeout(300);
// B10/B11 Eigenes Inserat
await p.evaluate(() => switchCity('krabi')); await p.waitForSelector('.card');
await p.$eval('#ownAdd', e => e.click()); await p.waitForSelector('#own:not([hidden])');
await p.$eval('#ownForm button[type=submit]', e => e.click()); await p.waitForTimeout(400);
const tt = await p.$eval('#toast', e => e.textContent).catch(() => '');
ok(/Monatsmiete/.test(tt) && await p.$eval('label:has(#wPrice) .req', e => !!e), `B11 leeres Speichern: Hinweis „${tt}“, Pflichtfeld mit *`);
await p.fill('#wTitle', 'Ohne Link'); await p.fill('#wPrice', '12000');
await p.$eval('#ownForm button[type=submit]', e => e.click()); await p.waitForTimeout(600);
const mb = await p.$eval('#map', m => { const r = m.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; });
await p.mouse.click(mb[0], mb[1]); await p.waitForTimeout(600); await p.click('#tabList'); await p.waitForTimeout(300);
await p.evaluate(() => [...document.querySelectorAll('.card')].find(c => /Ohne Link/.test(c.textContent)).querySelector('.body').click());
await p.waitForSelector('#detail:not([hidden])');
const hasLink = await p.$$eval('#detail .actions a', as => as.some(a => /Inserat/.test(a.textContent)));
const badge = await p.evaluate(() => [...document.querySelectorAll('.card')].find(c => /Ohne Link/.test(c.textContent)).querySelector('.badge.own').textContent);
ok(!hasLink && badge === 'Eigenes', `B10 ohne Link kein „Inserat ↗“, Marke „${badge}“`);
await p.goBack(); await p.waitForTimeout(400);
// B14 Wetter-Zahlen
await p.click('#tabInfo'); await p.waitForSelector('.bars .bar');
ok(await p.$$eval('.bars .bv', x => x.length) === 12, 'B14 Wetterdiagramm mit Zahlen');
await p.click('#tabList');
ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
await b.close();
// B9 320 px: Detailleiste passt
{ const b2 = await webkit.launch(); const q = await (await b2.newContext({viewport:{width:320,height:640},isMobile:true,hasTouch:true})).newPage();
  await q.goto(URL); await q.waitForTimeout(1500); await q.evaluate(() => switchCity('krabi')); await q.waitForSelector('.card');
  await q.click('.card .body'); await q.waitForSelector('#detail:not([hidden])'); await q.waitForTimeout(500);
  const r = await q.$$eval('#detail .actions > *', x => Math.max(...x.map(e => e.getBoundingClientRect().right)));
  const sh = await q.$eval('#shareApp', e => e.getBoundingClientRect().width);
  ok(r <= 320 && sh > 0, `B9 320 px: Leiste endet bei ${Math.round(r)} px, App-teilen sichtbar (${Math.round(sh)} px)`);
  await q.screenshot({path: `${OUT}/r2-320.png`}); await b2.close(); }
console.log(fails ? `${fails} FEHLER` : 'ALLES GRÜN');
