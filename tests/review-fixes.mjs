// Prüft die Korrekturen aus dem Erst-Nutzer-Bericht (B1–B23) auf iPhone-Größe.
import { createRequire } from 'module';
const { webkit, chromium } = createRequire(process.env.PW_FROM || '/Users/tugrulcinkaya/Projects/fashion-id/package.json')('playwright');
const URL = process.env.URL || 'http://127.0.0.1:8765/';
const OUT = process.env.OUT || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if(!c) fails++; };
for (const [name, bt] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await bt.launch();
  const ctx = await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(2000);
  const hasTh = await p.evaluate(() => !!CITIES.thailand);
  // B13 Kopfzeile + Titel
  const st = await p.evaluate(() => { const fx = document.querySelector('#stand .fx'); const r = fx?.getClientRects(); return {lines: r ? r.length : 0, title: document.title, text: document.querySelector('#stand').textContent}; });
  ok(st.lines === 1 && !/Thailand – Thailand/.test(st.title), `${name}: B13 Wechselkurs in einer Zeile, Titel „${st.title}“`);
  if(hasTh){
    // B1 Thailand ohne Vorfilter + B5 Gegend-Leiste + Rückweg
    await p.evaluate(() => switchCity('thailand')); await p.waitForTimeout(1200);
    const prov = await p.$eval('.provs button', e => e.dataset.prov);
    await p.click(`.provs button[data-prov="${prov}"]`); await p.waitForSelector('.card', {timeout: 20000});
    const sum = await p.$eval('#summary', e => e.textContent);
    ok(!/ohne Baujahr/.test(sum), `${name}: B1 Thailand blendet nichts automatisch aus – „${sum}“`);
    const rb = await p.$eval('.regionbar', e => e.textContent).catch(() => '');
    ok(/📍/.test(rb) && /Alle Gegenden/.test(rb), `${name}: B5 Gegend-Leiste „${rb.replace(/\s+/g,' ').trim().slice(0,110)}“`);
    await p.$eval('[data-overview]', e => e.click()); await p.waitForTimeout(600);
    ok(await p.$$eval('.provs button', x => x.length) > 3, `${name}: B5 „Alle Gegenden“ führt zurück zur Übersicht`);
    await p.click(`.provs button[data-prov="${prov}"]`); await p.waitForSelector('.card');
    await p.evaluate(() => switchCity('thailand')); await p.waitForTimeout(600);
    ok(await p.$$eval('.provs button', x => x.length) > 3, `${name}: B5 erneuter Tipp auf „Thailand“ = Übersicht`);
    // B23 Thailand-Karte: 7-Eleven/Markt standardmäßig aus
    const lay = await p.evaluate(() => [state.layers['7-Eleven'], state.layers.Markt]);
    ok(lay[0] === false && lay[1] === false, `${name}: B23 Thailand-Karte ohne 7-Eleven/Markt-Flut (einschaltbar)`);
  }
  // B1 Krabi: leere Liste hat Ausweg
  await p.evaluate(() => switchCity('krabi')); await p.waitForSelector('.card');
  await p.click('#filterBtn'); await p.waitForTimeout(500);
  await p.$eval('#fSize', e => { e.value = 200; e.dispatchEvent(new Event('input', {bubbles:true})); });
  await p.$eval('#fPrice', e => { e.value = 10000; e.dispatchEvent(new Event('input', {bubbles:true})); });
  await p.$eval('#fClose', e => e.click()); await p.waitForTimeout(500);
  const btns = await p.$$eval('[data-relax]', x => x.map(e => e.textContent.trim()));
  ok(btns.some(t => /Alle Filter aus/.test(t)), `${name}: B1 leere Liste bietet Ausweg: ${btns.join(' | ')}`);
  await p.$eval('[data-relax="all"]', e => e.click()); await p.waitForTimeout(500);
  ok(await p.$$eval('.card', x => x.length) > 10, `${name}: B1 „Alle Filter aus“ zeigt wieder Inserate`);
  await p.$eval('#fReset', e => e.click()); await p.waitForTimeout(300);
  // B6 NEU
  const neu = await p.$$eval('.card', cs => cs.filter(c => /NEU/.test(c.querySelector('.badges')?.textContent||'')).map(c => c.querySelector('.online')?.textContent||''));
  ok(neu.every(t => /\((heute|1 Tag|[1-7] Tage)\)/.test(t)), `${name}: B6 „NEU eingestellt“ nur bei ≤ 7 Tagen (${neu.length} Treffer)`);
  // B2 Formular passt
  await p.click('#tabList'); await p.$eval('#ownAdd', e => e.click()); await p.waitForSelector('#own:not([hidden])'); await p.waitForTimeout(500);
  const w = await p.evaluate(() => { const W = document.documentElement.clientWidth; let max = 0; document.querySelectorAll('#own *').forEach(e => { const r = e.getBoundingClientRect(); if(r.width) max = Math.max(max, r.right); }); return [W, Math.round(max)]; });
  ok(w[1] <= w[0], `${name}: B2 Formular passt (${w[1]} ≤ ${w[0]} px)`);
  await p.screenshot({path: `${OUT}/rv-${name}-own.png`});
  // B11 + B3: 9999 ohne Baujahr wird gespeichert und bleibt sichtbar
  await p.fill('#wUrl', 'https://www.facebook.com/marketplace/item/1/'); await p.fill('#wTitle', 'Prüfhaus ohne Baujahr'); await p.fill('#wPrice', '9999');
  await p.$eval('#ownForm button[type=submit]', e => e.click()); await p.waitForTimeout(800);
  const mb = await p.$eval('#map', m => { const r = m.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; });
  await p.mouse.click(mb[0], mb[1]); await p.waitForTimeout(600);
  await p.click('#tabList'); await p.waitForTimeout(400);
  ok(await p.$$eval('.card', cs => cs.some(c => /Prüfhaus ohne Baujahr/.test(c.textContent) && /9\.999/.test(c.textContent))), `${name}: B3+B11 eigenes Inserat (9.999 ฿, ohne Baujahr) bleibt sichtbar`);
  // B17 Hinweis eigenes Inserat
  await p.evaluate(() => { const c = [...document.querySelectorAll('.card')].find(c => /Prüfhaus/.test(c.textContent)); c.querySelector('.body').click(); });
  await p.waitForSelector('#detail:not([hidden])');
  const note = await p.$eval('#detail .note', e => e.textContent);
  ok(/Schätzungen/.test(note) && !/Straßen-km/.test(note), `${name}: B17 Hinweis ohne Widerspruch`);
  // B8 Zurück schließt Blatt, App bleibt
  await p.goBack(); await p.waitForTimeout(600);
  ok(await p.$eval('#detail', d => d.hidden) && /krabi-wohnen|127\.0\.0\.1/.test(p.url()), `${name}: B8 Zurück schließt das Inserat, App bleibt offen`);
  // B8 Link zum Inserat
  await p.click('.card:not(:has(.badge.own)) .body'); await p.waitForSelector('#detail:not([hidden])');
  const link = p.url(); await p.$eval('#detail .close', e => e.click()); await p.waitForTimeout(300);
  const p2 = await ctx.newPage(); await p2.goto(link); await p2.waitForSelector('#detail:not([hidden])', {timeout: 15000}).catch(()=>{});
  ok(/#i=/.test(link) && !(await p2.$eval('#detail', d => d.hidden)), `${name}: B8 eigener Link öffnet das Inserat direkt`);
  await p2.close();
  // B7 Merkliste über Gegenden
  await p.$eval('.card .fav', e => e.click()); await p.waitForTimeout(300);
  await p.evaluate(() => switchCity('pattaya')); await p.waitForSelector('.card');
  await p.click('#tabFav'); await p.waitForTimeout(500);
  const fs = await p.$eval('#summary', e => e.textContent); const tab = await p.$eval('#tabFav', e => e.textContent);
  ok(/^1 gemerktes Inserat/.test(fs) && /\(1\)/.test(tab) && await p.$$eval('.card', x => x.length) === 1, `${name}: B7 Merkliste in anderer Gegend sichtbar – „${fs}“, Reiter „${tab}“`);
  await p.$eval('.card .fav', e => e.click()); await p.waitForTimeout(300);
  // B10 Datumsformat
  await p.click('#tabList'); await p.evaluate(() => switchCity('krabi')); await p.waitForSelector('.card');
  const dates = await p.evaluate(() => DATA.listings.filter(l => l.updated || l.available).slice(0, 40).map(l => [deDate(l.updated), deDate(l.available)]));
  ok(dates.flat().filter(Boolean).every(d => /^\d\d\.\d\d\.\d{4}$|^sofort$/.test(d) || !/[A-Za-z]{3,} \d/.test(d)), `${name}: B10 Daten deutsch (${dates.flat().filter(Boolean).slice(0,4).join(', ')})`);
  // B9 Grob-Punkte
  const coarse = await p.evaluate(() => DATA.listings.filter(l => l.coarse).length);
  ok(coarse > 0, `${name}: B9 ${coarse} Inserate auf Sammel-Grobpunkten als „Lage ≈“ markiert`);
  // B15 aus Sammel-Liste zurück
  await p.click('#tabMap'); await p.waitForSelector('.pin.grp'); await p.$eval('.pin.grp', e => e.click());
  await p.waitForSelector('.glist'); await p.$eval('.glist button', e => e.click()); await p.waitForSelector('#detail .close.back');
  await p.$eval('#detail .close.back', e => e.click()); await p.waitForTimeout(300);
  ok(!!(await p.$('#detail .glist')), `${name}: B15 „‹ zurück“ führt zur Sammel-Liste`);
  await p.$eval('#detail .close', e => e.click());
  // B20 gleiche Wohnung bei zwei Anbietern
  const dup = await p.evaluate(() => DATA.listings.filter(l => (l.also||[]).some(a => a.price)).length);
  ok(dup >= 1, `${name}: B20 doppelte Wohnung zusammengeführt (${dup}× „auch bei … für … ฿“)`);
  // B12 Blatt nicht durchsichtig
  await p.click('#tabList'); await p.click('.card .body'); await p.waitForSelector('#detail:not([hidden])'); await p.waitForTimeout(500);
  const bg = await p.$eval('#detail', e => getComputedStyle(e).backgroundColor);
  ok(!/rgba\(.*, 0?\.\d+\)/.test(bg), `${name}: B12 Blatt-Hintergrund deckend (${bg})`);
  await p.screenshot({path: `${OUT}/rv-${name}-detail.png`});
  ok(errs.length === 0, `${name}: keine JS-Fehler ${errs.join(' | ')}`);
  await b.close();
}
// B14 320 px
{ const b = await webkit.launch(); const p = await (await b.newContext({viewport:{width:320,height:640},isMobile:true,hasTouch:true})).newPage();
  await p.goto(URL); await p.waitForTimeout(1500);
  const ov = await p.evaluate(() => { const a = document.querySelector('#appTitle').getBoundingClientRect(); const s = document.querySelector('#shareApp').getBoundingClientRect(); return s.width === 0 || s.left >= a.right; });
  ok(ov, 'webkit: B14 bei 320 px überdeckt nichts „Pattaya“'); await b.close(); }
console.log(fails ? `${fails} FEHLER` : 'ALLES GRÜN');
