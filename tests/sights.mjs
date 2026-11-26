// Entfernungen + Sehenswürdigkeiten in der Liste und im Inserat
import { createRequire } from 'module';
const { webkit } = createRequire(process.env.PW_FROM || '/Users/tugrulcinkaya/Projects/fashion-id/package.json')('playwright');
const URL = process.env.URL || 'http://127.0.0.1:8765/', OUT = process.env.OUT || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if(!c) fails++; };
const b = await webkit.launch(); const p = await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true})).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(URL); await p.waitForTimeout(1500);
for (const w of ['krabi', 'pattaya']) {
  await p.evaluate(x => switchCity(x), w); await p.waitForSelector('.card .dchip'); await p.waitForSelector('.card .csights', {timeout: 15000}).catch(() => {});
  const r = await p.evaluate(() => { const c = [...document.querySelectorAll('.card')].slice(0, 10);
    return {chips: Math.max(...c.map(x => x.querySelectorAll('.dchip').length)), withSights: c.filter(x => x.querySelector('.csights')).length, ex: c.find(x => x.querySelector('.csights'))?.querySelector('.csights').textContent.replace(/\s+/g,' ')}; });
  ok(r.chips >= 6, `${w}: Karte zeigt bis zu ${r.chips} Entfernungen`);
  ok(r.withSights >= (w === 'krabi' ? 5 : 2), `${w}: ${r.withSights} von 10 Karten mit Sehenswürdigkeit – z. B. „${r.ex}“`);
  await p.screenshot({path: `${OUT}/sights-${w}.png`});
}
await p.click('.card .body'); await p.waitForSelector('#detail:not([hidden])'); await p.waitForTimeout(800);
const d = await p.$$eval('#detail dt', x => x.filter(e => /⭐/.test(e.textContent)).map(e => e.textContent + ': ' + e.nextElementSibling.textContent.slice(0, 60)));
ok(d.length >= 2 && await p.$$eval('#detail dt', x => x.filter(e => /⭐/.test(e.textContent) && e.nextElementSibling.querySelector('.rlink')).length) >= 2, `Inserat: ${d.length} Sehenswürdigkeiten mit Route – ${d.slice(0, 2).join(' | ')}`);
await p.goBack(); await p.waitForTimeout(400);
await p.evaluate(() => switchCity('thailand')); await p.waitForTimeout(1200);
await p.click('.provs button[data-prov="surat-thani"]'); await p.waitForSelector('.card .dchip');
await p.waitForSelector('.card .csights', {timeout: 15000}).catch(() => {});
ok(!!(await p.$('.card .csights')), 'Thailand (Samui): Sehenswürdigkeiten in der Liste: ' + (await p.$eval('.card .csights', e => e.textContent.replace(/\s+/g,' ')).catch(() => '–')));
ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
await b.close();
console.log(fails ? `${fails} FEHLER` : 'ALLES GRÜN');
