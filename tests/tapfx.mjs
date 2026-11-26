// Antipp-Rückmeldung: Welle + schimmernder Rand sichtbar, Klick kommt trotzdem an, Vibration nur bei Bestätigungen.
import { createRequire } from 'module';
const pw = createRequire(process.env.PW_FROM || '/Users/tugrulcinkaya/Projects/fashion-id/package.json')('playwright');
const URL = process.env.URL || 'http://127.0.0.1:8765/', OUT = process.env.OUT || '/tmp';
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if(!c) fails++; };
for (const [name, eng] of [['webkit', pw.webkit], ['chromium', pw.chromium]]) {
  const b = await eng.launch();
  const ctx = await b.newContext({viewport:{width:393,height:852}, deviceScaleFactor:2, isMobile:name !== 'webkit' ? true : true, hasTouch:true});
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { window.__vib = 0; window.__sw = 0;
    if(!/AppleWebKit\/6/.test(navigator.userAgent) || 'vibrate' in navigator) navigator.vibrate = () => { window.__vib++; return true; };
    document.addEventListener('change', e => { if(e.target.id === 'tapfxSwitch') window.__sw++; }, true); });
  await p.goto(URL); await p.waitForTimeout(1200);
  await p.evaluate(() => switchCity('krabi')); await p.waitForSelector('.card'); await p.waitForTimeout(600);
  const fav = await p.$('.card .fav'); const bb = await fav.boundingBox();
  const fid = await fav.getAttribute('data-fav'); const before = await p.evaluate(id => isFav(id), fid);
  await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.waitForTimeout(120);
  const fx = await p.evaluate(() => ({boxes: document.querySelectorAll('#tapfx .tapfx-box').length, waves: document.querySelectorAll('#tapfx .tapfx-wave').length, ring: !!document.querySelector('#tapfx .tapfx-ring'),
    pe: getComputedStyle(document.querySelector('#tapfx')).pointerEvents}));
  ok(fx.boxes === 1 && fx.waves === 2 && fx.ring && fx.pe === 'none', `${name}: Welle (2 Ringe) + schimmernder Rand beim Antippen, Ebene lässt Klicks durch`);
  await p.screenshot({path: `${OUT}/tapfx-${name}.png`, clip: {x: Math.max(0, bb.x - 60), y: Math.max(0, bb.y - 40), width: 160, height: 120}});
  const after = await p.evaluate(id => isFav(id), fid); ok(after !== before, `${name}: Merken funktioniert trotz Effekt (${before} → ${after})`);
  const h = await p.evaluate(() => window.__vib + window.__sw);
  ok(h >= 1, `${name}: Bestätigung beim Merken (Vibration ${await p.evaluate(() => window.__vib)}, iPhone-Schalter ${await p.evaluate(() => window.__sw)})`);
  await p.waitForTimeout(450);
  ok(await p.evaluate(() => document.querySelectorAll('#tapfx .tapfx-box').length) === 0, `${name}: Effekt ist nach 0,5 s weg`);
  // gewöhnlicher Tipp (Karte öffnen) -> Welle ja, Vibration nein
  const h0 = await p.evaluate(() => window.__vib + window.__sw);
  const body = await (await p.$('.card .body')).boundingBox();
  await p.touchscreen.tap(body.x + body.width / 2, body.y + 20); await p.waitForSelector('#detail:not([hidden])'); await p.waitForTimeout(180);
  ok(await p.evaluate(() => document.querySelectorAll('#tapfx .tapfx-box').length) === 0, `${name}: Inserat geöffnet – kein Nachleuchten (nach 0,18 s weg)`);
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => window.__vib + window.__sw) === h0 && !(await p.$eval('#detail', d => d.hidden)), `${name}: Inserat öffnen – keine Vibration, Inserat geht auf`);
  await p.goBack(); await p.waitForTimeout(400);
  // abschaltbar
  await p.evaluate(() => TAP.set(false)); const h1 = await p.evaluate(() => window.__vib + window.__sw);
  await p.click('.card .fav'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.__vib + window.__sw) === h1, `${name}: Vibration in den Infos abschaltbar`);
  await p.evaluate(() => TAP.set(true));
  ok(errs.length === 0, `${name}: keine JS-Fehler ${errs.join(' | ')}`);
  await b.close();
  // Bewegung reduzieren
  const b2 = await eng.launch(); const c2 = await b2.newContext({viewport:{width:393,height:852}, hasTouch:true, reducedMotion:'reduce'});
  const p2 = await c2.newPage(); await p2.goto(URL); await p2.waitForTimeout(1000);
  await p2.evaluate(() => switchCity('krabi')); await p2.waitForSelector('.card');
  const f2 = await (await p2.$('.sortbar button')).boundingBox(); await p2.touchscreen.tap(f2.x + 10, f2.y + 10); await p2.waitForTimeout(100);
  ok(await p2.evaluate(() => document.querySelectorAll('#tapfx .tapfx-box').length) === 0, `${name}: „Bewegung reduzieren“ → keine Wellen`);
  await b2.close();
}
console.log(fails ? `${fails} FEHLER` : 'ALLES GRÜN');
