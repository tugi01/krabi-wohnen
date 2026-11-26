// Beschreibung schon in der Liste lesbar, „Mehr lesen“ klappt den ganzen Text auf, ohne das Inserat zu öffnen.
import { createRequire } from 'module';
const { webkit } = createRequire(process.env.PW_FROM || '/Users/tugrulcinkaya/Projects/fashion-id/package.json')('playwright');
const URL = process.env.URL || 'http://127.0.0.1:8765/';
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if(!c) fails++; };
const b = await webkit.launch(); const p = await (await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true})).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(URL); await p.waitForTimeout(1500);
for (const where of ['pattaya', 'krabi']) {
  await p.evaluate(w => switchCity(w), where); await p.waitForSelector('.card .cdesc', {timeout: 20000});
  for(let i = 0; i < 12; i++){ await p.evaluate(() => window.scrollBy(0, 900)); await p.waitForTimeout(300); }
  await p.waitForTimeout(1500); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(500);
  const n = await p.evaluate(() => { const cs = [...document.querySelectorAll('.card')].slice(0, 10).filter(c => { const l = getListing(c.dataset.id); return l?.hasDesc || l?.desc || l?.description; });
    return [cs.length, cs.filter(c => c.querySelector('.cdesc')).length]; });
  ok(n[0] > 0 && n[1] === n[0], `${where}: ${n[1]} von ${n[0]} Karten mit Beschreibung zeigen sie schon in der Liste (erste 10)`);
  const box = '.card:has(.morebtn) .cdesc';
  const short = await p.$eval(box + ' p', e => e.textContent.length);
  await p.$eval(box + ' .morebtn', e => e.click()); await p.waitForTimeout(2500);
  const box2 = '.card .cdesc.open';
  const long = await p.$eval(box2 + ' p', e => e.textContent.length).catch(() => 0);
  ok(long > short && await p.$eval('#detail', d => d.hidden), `${where}: „Mehr lesen“ zeigt den ganzen Text (${short} → ${long} Zeichen), Inserat bleibt zu`);
  await p.screenshot({path: `${process.env.OUT || '/tmp'}/desc-${where}.png`});
}
await p.evaluate(() => switchCity('thailand')); await p.waitForTimeout(1200);
await p.click('.provs button[data-prov="surat-thani"]'); await p.waitForSelector('.card');
await p.waitForFunction(() => document.querySelector('.card .cdesc'), null, {timeout: 20000}).catch(() => {});
ok(!!(await p.$('.card .cdesc')), 'Thailand: Beschreibung erscheint in der Liste, sobald die Karte sichtbar ist');
ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
await b.close();
console.log(fails ? `${fails} FEHLER` : 'ALLES GRÜN');
