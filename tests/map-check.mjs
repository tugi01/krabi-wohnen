import { createRequire } from 'module';
const { webkit, chromium } = createRequire('/Users/tugrulcinkaya/Projects/fashion-id/package.json')('playwright');
const OUT = process.env.TMPDIR;
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if(!c) fails++; };
for (const [name, bt] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await bt.launch();
  const p = await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true})).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8765/'); await p.waitForTimeout(1500);
  // --- Pattaya: Sammel-Pins
  await p.evaluate(() => switchCity('pattaya')); await p.waitForFunction(() => CITY === 'pattaya' && document.querySelector('.card'));
  await p.click('#filterBtn'); await p.waitForTimeout(600); await p.$eval('#fReset', e => e.click()); await p.$eval('#fOld', e => e.click()); await p.$eval('#fUnknown', e => e.click());
  await p.$eval('#fSize', e => { e.value = 0; e.dispatchEvent(new Event('input', {bubbles:true})); });
  await p.$eval('#fPrice', e => { e.value = 150000; e.dispatchEvent(new Event('input', {bubbles:true})); });
  await p.$eval('#fClose', e => e.click());
  const total = await p.$eval('#summary', e => +e.textContent.replace(/\./g,'').match(/^(\d+)/)[1]);
  await p.click('#tabMap'); await p.waitForSelector('.pin'); await p.waitForTimeout(1500);
  const m = await p.evaluate(() => { let n = 0; document.querySelectorAll('.leaflet-marker-pane .pin:not(.hipin)').forEach(e => { const g = e.querySelector('b'); n += g ? parseInt(g.textContent) : 1; }); return {pins: document.querySelectorAll('.leaflet-marker-pane .pin').length, covered: n, hint: document.querySelector('#mapHint').textContent}; });
  ok(m.covered + (+(m.hint.match(/(\d+) ohne Kartenpunkt/)||[0,0])[1]) === total, `${name}: Pattaya alle Filter offen – ${total} Inserate, Karte deckt ${m.covered} ab (${m.pins} Pins) · „${m.hint}“`);
  await p.screenshot({path: `${OUT}/grp-${name}.png`});
  // Sammel-Pin antippen
  await p.evaluate(() => { const g = [...document.querySelectorAll('.pin.grp')].sort((a,b)=>parseInt(b.querySelector('b').textContent)-parseInt(a.querySelector('b').textContent))[0]; g.click(); });
  await p.waitForSelector('#detail:not([hidden]) .glist'); const gl = await p.$$eval('.glist li', x => x.length);
  ok(gl > 1, `${name}: Sammel-Pin öffnet Liste mit ${gl} Inseraten`);
  await p.screenshot({path: `${OUT}/grplist-${name}.png`});
  await p.$eval('.glist li button', e => e.click()); await p.waitForSelector('#detail [data-showmap]');
  // Auf Karte zeigen
  const id = await p.$eval('#detail [data-showmap]', e => e.dataset.showmap);
  await p.$eval('#detail [data-showmap]', e => e.click()); await p.waitForTimeout(1200);
  const hi = await p.evaluate(() => ({ring: !!document.querySelector('.hiring'), pin: document.querySelector('.hipin')?.textContent, z: map.getZoom(), vis: !document.querySelector('#viewMap').hidden}));
  ok(hi.ring && hi.pin && hi.vis && hi.z === 16, `${name}: „Auf Karte“ markiert Objekt (Ring ${hi.ring}, Pin ${hi.pin}, Zoom ${hi.z})`);
  await p.screenshot({path: `${OUT}/hi-${name}.png`});
  // --- Thailand-Modus
  await p.click('#tabList'); await p.evaluate(() => switchCity('thailand')); await p.waitForTimeout(1500);
  const picker = await p.$$eval('.provs button', x => x.length);
  ok(picker > 0, `${name}: Thailand ohne Ausschnitt zeigt Gegend-Auswahl (${picker} Provinzen)`);
  await p.click('.provs button[data-prov="rayong"]'); await p.waitForSelector('.card', {timeout: 15000}).catch(()=>{});
  const s1 = await p.$eval('#summary', e => e.textContent);
  ok(await p.$$eval('.card', x => x.length) > 0, `${name}: Rayong gewählt – ${s1}`);
  await p.click('#tabMap'); await p.waitForTimeout(2500);
  const tm = await p.evaluate(() => ({pins: document.querySelectorAll('.leaflet-marker-pane .pin').length, dots: document.querySelectorAll('.leaflet-overlay-pane canvas').length, bub: document.querySelectorAll('.bubble').length, hint: document.querySelector('#mapHint').textContent, z: map.getZoom()}));
  ok(tm.pins > 0 || tm.dots > 0, `${name}: Thailand-Karte Rayong zeigt Inserate (${tm.pins} Pins, Zoom ${tm.z}, Hinweis „${tm.hint}“)`);
  await p.screenshot({path: `${OUT}/th-${name}.png`});
  await p.evaluate(() => map.setZoom(6)); await p.waitForTimeout(1500);
  ok(await p.$$eval('.bubble', x => x.length) > 0, `${name}: herausgezoomt Zahlen-Blasen`);
  ok(errs.length === 0, `${name}: keine JS-Fehler ${errs.join(' | ')}`);
  await b.close();
}
console.log(fails ? `${fails} FEHLER` : 'ALLES GRÜN');
