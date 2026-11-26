// Fotos: in der Liste wischen, antippen -> Vollbild mit allen Fotos, Zurück schließt nur das Vollbild.
import { createRequire } from 'module';
const { webkit, chromium } = createRequire(process.env.PW_FROM || '/Users/tugrulcinkaya/Projects/fashion-id/package.json')('playwright');
const URL = process.env.URL || 'http://127.0.0.1:8765/', OUT = process.env.OUT || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if(!c) fails++; };
async function swipe(p, sel){
  const r = await p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
  const x = r[0] + r[2]*0.8, y = r[1] + r[3]/2;
  if(p.context().browser().browserType().name() === 'chromium'){
    const c = await p.context().newCDPSession(p);
    await c.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x, y}]});
    for(let i=1;i<=10;i++){ await c.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x: x - i*25, y}]}); await p.waitForTimeout(16); }
    await c.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  } else await p.$eval(sel, e => e.scrollBy({left: e.clientWidth}));
  await p.waitForTimeout(700);
}
for (const [name, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await bt.launch(); const ctx = await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(1500);
  await p.evaluate(() => switchCity('krabi')); await p.waitForSelector('.card'); await p.waitForTimeout(600);
  const gsel = '.card:has([data-gal] img + img) [data-gal]';
  await swipe(p, gsel);
  ok(await p.$eval(gsel, g => g.scrollLeft > 0) && await p.$eval('#detail', d => d.hidden), `${name}: Fotos in der Liste wischen (ohne Inserat zu öffnen)`);
  await p.$eval(gsel + ' img', i => i.click()); await p.waitForTimeout(600);
  const lb = await p.evaluate(() => { const l = document.querySelector('#lightbox'); return l && !l.hidden ? {n: l.querySelectorAll('.lbslide').length, cnt: l.querySelector('.lbcnt').textContent, detail: !document.querySelector('#detail').hidden} : null; });
  ok(lb && lb.n > 1 && !lb.detail, `${name}: Foto antippen → Vollbild mit ${lb?.n} Fotos („${lb?.cnt}“), Inserat bleibt zu`);
  await p.screenshot({path: `${OUT}/lb-${name}.png`});
  await swipe(p, '#lightbox .lbtrack');
  ok(/^2 \//.test(await p.$eval('#lightbox .lbcnt', e => e.textContent)), `${name}: im Vollbild wischen → Foto 2`);
  await p.goBack(); await p.waitForTimeout(500);
  ok(await p.$eval('#lightbox', l => l.hidden) && await p.evaluate(() => CITY) === 'krabi' && p.url().startsWith(URL), `${name}: Zurück schließt nur das Vollbild`);
  // aus dem Inserat heraus
  await p.click('.card .body'); await p.waitForSelector('#detail:not([hidden])'); await p.waitForTimeout(400);
  await p.$eval('#detail .gallery img', i => i.click()); await p.waitForTimeout(500);
  ok(!(await p.$eval('#lightbox', l => l.hidden)), `${name}: Foto im Inserat antippen → Vollbild`);
  await p.click('#lightbox .lbclose'); await p.waitForTimeout(500);
  ok(await p.$eval('#lightbox', l => l.hidden) && !(await p.$eval('#detail', d => d.hidden)), `${name}: ✕ schließt Vollbild, Inserat bleibt offen`);
  await p.goBack(); await p.waitForTimeout(400);
  // Thailand: 1 Foto in der Liste -> Vollbild lädt alle nach
  await p.evaluate(() => switchCity('thailand')); await p.waitForTimeout(1200);
  await p.click('.provs button[data-prov="surat-thani"]'); await p.waitForSelector('.card'); await p.waitForTimeout(300);
  await p.$eval('.card [data-gal] img', i => i.click());
  await p.waitForFunction(() => document.querySelectorAll('#lightbox .lbslide').length > 1, null, {timeout: 15000}).catch(() => {});
  ok(await p.$$eval('#lightbox .lbslide', x => x.length) > 1, `${name}: Thailand – Vollbild lädt alle Fotos (${await p.$$eval('#lightbox .lbslide', x => x.length)})`);
  await p.click('#lightbox .lbopen'); await p.waitForTimeout(800);
  ok(!(await p.$eval('#detail', d => d.hidden)) && await p.$eval('#lightbox', l => l.hidden), `${name}: „Zum Inserat ›“ öffnet das Inserat`);
  ok(errs.length === 0, `${name}: keine JS-Fehler ${errs.join(' | ')}`);
  await b.close();
}
console.log(fails ? `${fails} FEHLER` : 'ALLES GRÜN');
