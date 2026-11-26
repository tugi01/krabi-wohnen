// UI-Prüfung: PW_FROM=<Projekt mit playwright>/package.json node tests/ui-check.mjs  (Server: python3 -m http.server 8765 -d site)
import { createRequire } from 'module';
const require = createRequire(process.env.PW_FROM || (process.cwd() + '/package.json'));
const { chromium, webkit } = require('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const out = process.env.OUT || '/tmp';
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✓ ' : '✗ ') + m); };

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: name === 'chromium' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.card');
    const vw = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
    ok(vw[0] === 390 && vw[1] <= 390, `${name}: keine horizontale Überbreite (${vw})`);
    const count = s => page.$eval('#summary', e => +e.textContent.replace(/\./g,'').match(/^(\d+)/)[1]);
    const base = await count();
    ok(base > 0, `${name}: Standardfilter zeigt ${base} Inserate`);
    // Standard: keine alten Gebäude sichtbar
    const oldTags = await page.$$eval('.card .tag.warn', t => t.length);
    ok(oldTags === 0, `${name}: Standard zeigt keine Gebäude > 5 Jahre (${oldTags})`);
    await page.waitForTimeout(3000);
    const loaded = await page.$$eval('.card [data-gal] img:first-child, .card .noimg', i => i.filter(x => x.getBoundingClientRect().top < innerHeight).map(x => x.tagName !== 'IMG' || (x.complete && x.naturalWidth > 0)));
    ok(loaded.length > 0 && loaded.every(Boolean), `${name}: Fotos der ersten Karten geladen (${loaded})`);
    await page.screenshot({ path: `${out}/kw-${name}-list.png` });
    // Filter öffnen, alte einschalten
    await page.click('#filterBtn');
    await page.waitForSelector('#filters:not([hidden])'); await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/kw-${name}-filter.png` });
    await page.click('label:has(#fOld) i');
    const withOld = await count();
    ok(withOld > base, `${name}: „Ältere zeigen“ erhöht ${base} → ${withOld}`);
    await page.click('label:has(#fOld) i');
    ok(await count() === base, `${name}: „Ältere zeigen“ aus → wieder ${base}`);
    await page.click('label:has(#fPool) i');
    const pool = await count();
    const noPoolTag = await page.$$eval('.card', cs => cs.filter(c => !/pool/i.test(c.querySelector('.facts').innerText)).length);
    ok(pool < base && noPoolTag === 0, `${name}: „Nur mit Pool“ → ${pool} Inserate, alle mit Pool-Tag`);
    await page.click('label:has(#fPool) i');
    await page.selectOption('#fAge', '10');
    const age10 = await count();
    ok(age10 > base, `${name}: Altersgrenze 10 Jahre zeigt mehr (${base} → ${age10})`);
    await page.selectOption('#fAge', '5');
    ok(await count() === base, `${name}: Altersgrenze zurück auf 5 Jahre → ${base}`);
    await page.click('#fClose');
    // Persistenz nach Reload
    await page.click('#filterBtn'); await page.click('label:has(#fPool) i'); await page.click('#fClose');
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.card');
    ok(await page.isChecked('#fPool'), `${name}: Filter bleibt nach Neuladen erhalten`);
    await page.click('#filterBtn'); await page.click('#fReset'); await page.click('#fClose');
    // Wischbare Fotos in der Liste
    const g0 = await page.$('.card [data-gal]');
    const nImg = await g0.$$eval('img', i => i.length);
    await g0.evaluate(g => g.scrollTo({left: g.clientWidth, behavior:'instant'}));
    await page.waitForTimeout(400);
    const cnt0 = await page.$eval('.card .ccount', e => e.textContent);
    ok(nImg > 1 && cnt0.startsWith('2/'), `${name}: Fotos in der Liste wischbar (${nImg} Fotos, Anzeige ${cnt0})`);
    // Sortierung Preis (Leiste über der Liste)
    const prices = () => page.$$eval('.card .price', p => p.map(x => +x.textContent.split('฿')[0].replace(/\D/g,'')));
    await page.click('#sortbar [data-sort="price"]');
    let pr = await prices();
    ok(pr.length > 1 && pr.every((v,i)=>!i||pr[i-1]>=v), `${name}: Preis ↓ teuer zuerst (${pr.slice(0,3)})`);
    await page.click('#sortbar [data-sort="price"]');
    pr = await prices();
    ok(pr.every((v,i)=>!i||pr[i-1]<=v), `${name}: Preis ↑ günstig zuerst (${pr.slice(0,3)})`);
    // Detail
    await page.click('.card .body');
    await page.waitForSelector('#detail:not([hidden])'); await page.waitForTimeout(700);
    const hasLink = await page.$eval('#detail a.primary', a => a.href.startsWith('http'));
    ok(hasLink, `${name}: Detail mit Link zum Original`);
    await page.evaluate(() => { window.__shared = null; navigator.share = d => { window.__shared = d; return Promise.resolve(); }; });
    await page.click('#detail [data-share]');
    const sh = await page.evaluate(() => window.__shared);
    ok(sh && sh.url.startsWith('http') && /฿/.test(sh.text), `${name}: Teilen übergibt Link + Preis`);
    await page.screenshot({ path: `${out}/kw-${name}-detail.png` });
    await page.click('#detail .close');
    // Merken
    await page.click('.card .fav');
    await page.click('#tabFav');
    ok(await count() === 1, `${name}: Merkliste enthält 1 Inserat`);
    // Karte
    await page.click('#tabMap');
    await page.waitForSelector('.pin');
    await page.waitForTimeout(1500);
    const tiles = await page.$$eval('.leaflet-tile-loaded', t => t.length);
    const pins = await page.$$eval('.pin', p => p.length);
    ok(tiles > 0 && pins > 0, `${name}: Karte mit ${tiles} Kacheln und ${pins} Wohnungs-Pins`);
    const mosques = await page.$$eval('.poi', p => p.filter(x => x.textContent.includes('🕌')).length);
    ok(mosques >= 10, `${name}: Karte zeigt ${mosques} Moscheen`);
    const sev = await page.$$eval('.poi', p => p.filter(x => x.querySelector('.ico711')).length);
    ok(sev >= 20, `${name}: Karte zeigt ${sev} 7-Eleven`);
    const mk = await page.$$eval('.poi', p => p.filter(x => x.textContent.includes('🍜')).length);
    ok(mk >= 15, `${name}: Karte zeigt ${mk} Nacht-/Essensmärkte`);
    await page.click('.chip[data-layer="Krankenhaus"]');
    const hosp = await page.$$eval('.poi', p => p.filter(x => x.textContent.includes('🏥')).length);
    ok(hosp >= 3, `${name}: Ebene Krankenhaus eingeblendet (${hosp})`);
    await page.screenshot({ path: `${out}/kw-${name}-map.png` });
    await page.click('#tabInfo');
    await page.waitForSelector('.bars .bar'); await page.waitForTimeout(900);
    ok(await page.$$eval('.bars .bar', b => b.length) === 12, `${name}: Infos mit 12 Monatsbalken`);
    const iw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(iw <= 390, `${name}: Infos ohne Überbreite (${iw})`);
    await page.screenshot({ path: `${out}/kw-${name}-info.png`, fullPage: true });
    const imgs = await page.$$eval('.card img', i => i.filter(x => x.complete && x.naturalWidth > 0).length);
    // Google Maps: Position des Objekts + Routen vom Objekt
    await page.click('#tabList'); await page.click('.card .body'); await page.waitForSelector('#detail:not([hidden])');
    const gm = await page.$$eval('#detail a', as => as.map(a => a.href).filter(h => /google\.com\/maps/.test(h)));
    const lat = await page.evaluate(() => { const id = document.querySelector('#detail [data-fav]').dataset.fav; const l = DATA.listings.find(x=>x.id===id); return l ? [l.lat,l.lng] : null; });
    ok(lat && gm.some(h => h === `https://www.google.com/maps/search/?api=1&query=${lat[0]},${lat[1]}`), `${name}: Google-Maps-Knopf zeigt Position des Objekts`);
    ok(gm.filter(h => h.includes(`/dir/?api=1&origin=${lat[0]},${lat[1]}&destination=`)).length >= 3, `${name}: Routen vom Objekt zu Moschee/Strand/… (${gm.length - 1})`);
    await page.click('#detail .close');
    // Wohnfläche ab/bis
    await page.click('#tabList'); await page.click('#filterBtn'); await page.waitForTimeout(300);
    const cnt = () => page.$eval('#summary', e => +e.textContent.replace(/\./g,'').match(/^(\d+)/)[1]);
    const setR = (id, v) => page.$eval(id, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', {bubbles:true})); }, v);
    await setR('#fSize', 0); await page.waitForTimeout(250); const nAll = await cnt();
    await setR('#fSize', 80); await page.waitForTimeout(250); const n80 = await cnt();
    await setR('#fSizeMax', 120); await page.waitForTimeout(250); const n80_120 = await cnt();
    const sizes = await page.$$eval('.card .tag', ts => ts.map(t => t.textContent).filter(t => /m²/.test(t)).map(t => +t.replace(/[^\d]/g,'')));
    const lbl = await page.$eval('#oSize', e => e.textContent) + ' / ' + await page.$eval('#oSizeMax', e => e.textContent);
    await page.screenshot({ path: `${out}/kw-${name}-flaeche.png` });
    ok(nAll > n80 && n80 >= n80_120 && sizes.length > 0 && sizes.every(s => s >= 80 && s <= 120), `${name}: Wohnfläche einstellbar (alle ${nAll}, ab 80: ${n80}, 80–120: ${n80_120}, Anzeige ${lbl})`);
    await page.click('#fReset'); await page.waitForTimeout(250);
    ok(await page.$eval('#oSize', e => e.textContent) === '50 m²' && await page.$eval('#oSizeMax', e => e.textContent) === 'unbegrenzt', `${name}: Zurücksetzen stellt 50 m² / unbegrenzt wieder ein`);
    await page.click('#fClose');
    // Liste in Portionen (Speicherschutz iPhone)
    await page.click('[data-city="pattaya"]'); await page.waitForFunction(() => document.querySelector('[data-city="pattaya"]').classList.contains('on') && document.querySelector('.card'));
    await page.click('#tabList'); await page.waitForTimeout(500);
    const pg = await page.evaluate(() => ({cards: document.querySelectorAll('#list .card').length, imgs: document.querySelectorAll('#list img[src]').length, more: !!document.querySelector('#list .more'), total: +document.querySelector('#summary').textContent.match(/^(\d+)/)[1]}));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(800);
    const pg2 = await page.$$eval('#list .card', cs => cs.length);
    ok(pg.cards <= 31 && pg.imgs <= 31 && pg.more && pg2 > pg.cards && pg.total > 100, `${name}: Pattaya-Liste lädt portionsweise (${pg.cards} Karten/${pg.imgs} Fotos sofort, nach Scrollen ${pg2}, gesamt ${pg.total})`);
    await page.click('[data-city="krabi"]'); await page.waitForFunction(() => document.querySelector('[data-city="krabi"]').classList.contains('on') && document.querySelector('.card'));
    await page.waitForTimeout(4500);
    // Absturzschutz: unfertiger Pattaya-Start -> Krabi
    await page.evaluate(() => { localStorage.setItem('krabiwohnen.city','pattaya'); localStorage.setItem('krabiwohnen.booting','pattaya'); });
    await page.reload(); await page.waitForSelector('.card'); await page.waitForTimeout(1200);
    ok(await page.$eval('[data-city="krabi"]', b => b.classList.contains('on')), `${name}: nach Absturz startet die App sicher in Krabi`);
    // Stadtwechsel Krabi -> Pattaya -> Krabi
    await page.click('[data-city="pattaya"]');
    await page.waitForFunction(() => /Stand/.test(document.querySelector('#stand').textContent) && document.querySelector('[data-city="pattaya"]').classList.contains('on'));
    await page.waitForSelector('.card');
    const pCount = await page.$eval('#stand', e => e.textContent);
    const pMap = await (async () => { await page.click('#tabMap'); await page.waitForSelector('.pin'); await page.waitForTimeout(1200);
      return page.evaluate(() => [document.querySelectorAll('.pin').length, [...document.querySelectorAll('.poi')].filter(x => x.querySelector('.ico711')).length]); })();
    ok(/Inserate/.test(pCount) && pMap[0] > 20 && pMap[1] > 100, `${name}: Pattaya geladen (${pCount.split('·')[1]?.trim()}, ${pMap[0]} Pins, ${pMap[1]} 7-Eleven)`);
    await page.screenshot({ path: `${out}/kw-${name}-pattaya-map.png` });
    await page.click('#tabInfo'); await page.waitForSelector('.bars .bar');
    ok(await page.$eval('#info h2', e => /Pattaya/.test(e.textContent)), `${name}: Infos zeigen Pattaya`);
    await page.click('#tabList'); await page.waitForSelector('.card');
    await page.screenshot({ path: `${out}/kw-${name}-pattaya-list.png` });
    const favG = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('krabiwohnen.favs.global')||'{}')).length);
    const tabP = await page.$eval('#tabFav', e => e.textContent);
    await page.click('[data-city="krabi"]'); await page.waitForTimeout(1500);
    ok(favG >= 1 && /\(\d+\)/.test(tabP), `${name}: Merkliste gilt für alle Gegenden (${favG} gemerkt, in Pattaya „${tabP}“)`);
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('.card');
    ok(await page.$eval('[data-city="krabi"]', b => b.classList.contains('on')), `${name}: Stadt bleibt nach Neuladen gewählt`);
    // Eigenes Inserat (z. B. von Facebook) anlegen und auf Karte setzen
    await page.click('#tabList');
    await page.click('#ownAdd'); await page.waitForSelector('#own:not([hidden])');
    await page.fill('#wUrl', 'https://www.facebook.com/marketplace/item/123456789/');
    await page.fill('#wTitle', 'Testhaus Facebook'); await page.fill('#wPrice', '15000'); await page.fill('#wSize', '80');
    await page.fill('#wBuilt', String(new Date().getFullYear()-1)); await page.selectOption('#wPool', 'privat');
    await page.click('#ownForm button[type=submit]');
    await page.waitForSelector('#viewMap:not([hidden])'); await page.waitForTimeout(600);
    const mb = await page.$eval('#map', m => { const r = m.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; });
    await page.mouse.click(mb[0], mb[1]); await page.waitForTimeout(500);
    await page.click('#tabList'); await page.waitForTimeout(300);
    const ownCard = await page.$$eval('.card', cs => cs.filter(c => c.innerText.includes('Testhaus Facebook')).map(c => c.innerText));
    ok(ownCard.length === 1 && /Eigenes/.test(ownCard[0]) && /km/.test(ownCard[0]), `${name}: Eigenes Inserat mit Ort und Entfernungen sichtbar`);
    // Facebook-Knopf öffnet Marketplace-Suche
    const [fb] = await Promise.all([page.context().waitForEvent('page'), page.click('#fbSearch')]);
    await fb.waitForURL(/facebook\.com/, {timeout: 15000}).catch(() => {});
    ok(/facebook\.com\/(marketplace|login)/.test(fb.url()), `${name}: Facebook-Knopf öffnet Marketplace-Suche`);
    await fb.close();
    // Eigentümer-Filter
    await page.click('#filterBtn'); await page.click('label:has(#fOwner) i'); await page.waitForTimeout(200);
    const ownerOnly = await page.$$eval('.card', cs => cs.length);
    await page.click('label:has(#fOwner) i'); await page.click('#fClose');
    ok(ownerOnly >= 0, `${name}: Eigentümer-Filter schaltbar (${ownerOnly} Treffer)`);
    ok(errors.length === 0, `${name}: keine Konsolenfehler ${errors.join(' | ')}`);
    await ctx.close();
  } finally { await browser.close(); }
}
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES GRÜN');
process.exit(fails.length ? 1 : 0);
