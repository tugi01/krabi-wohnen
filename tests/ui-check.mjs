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
    const count = s => page.$$eval('.card', c => c.length);
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
    const sev = await page.$$eval('.poi', p => p.filter(x => x.textContent.includes('7‑11')).length);
    ok(sev >= 20, `${name}: Karte zeigt ${sev} 7-Eleven`);
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
    ok(errors.length === 0, `${name}: keine Konsolenfehler ${errors.join(' | ')}`);
    await ctx.close();
  } finally { await browser.close(); }
}
console.log(fails.length ? `\n${fails.length} FEHLER` : '\nALLES GRÜN');
process.exit(fails.length ? 1 : 0);
