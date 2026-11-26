// Preis in der App = Preis der Original-Inseratseite (sichtbare Karten werden geprüft und korrigiert)
import { createRequire } from 'module';
const { webkit } = createRequire(process.env.PW_FROM || '/Users/tugrulcinkaya/Projects/fashion-id/package.json')('playwright');
const URL = process.env.URL || 'http://127.0.0.1:8765/';
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if(!c) fails++; };
const b = await webkit.launch(); const p = await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(URL); await p.waitForTimeout(1500);
for (const where of ['krabi', 'thailand']) {
  if(where === 'krabi'){ await p.evaluate(() => switchCity('krabi')); await p.waitForSelector('.card'); }
  else { await p.evaluate(() => switchCity('thailand')); await p.waitForTimeout(1200); await p.click('.provs button[data-prov="phuket"]'); await p.waitForSelector('.card'); }
  // ein sichtbares DotProperty-Inserat absichtlich verfälschen, dann neu zeichnen
  const id = await p.evaluate(() => { const c = [...document.querySelectorAll('.card')].find(c => /dotproperty/.test(getListing(c.dataset.id)?.url || ''));
    const l = getListing(c.dataset.id); window.__real = l.price; l.price = 1234; l.detailTried = false; l.detailLoaded = false; l.priceChecked = false; TH.detail.delete(l.url); render(); return l.id; });
  await p.waitForFunction(id => getListing(id)?.priceChecked, id, {timeout: 20000}).catch(() => {});
  await p.waitForTimeout(800);
  const r = await p.evaluate(id => { const l = getListing(id), c = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    return {price: l.price, list: l.price_list, checked: l.priceChecked, card: c?.textContent.replace(/\s+/g,' ').slice(0, 90), badge: !!c?.querySelector('.badge.fixp')}; }, id);
  ok(r.checked && r.price !== 1234 && r.list === 1234 && r.badge && !/1\.234 ฿/.test(r.card), `${where}: falscher Preis 1.234 ฿ → Originalseite ${r.price} ฿, Karte zeigt „${r.card}“`);
}
ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
await b.close();
console.log(fails ? `${fails} FEHLER` : 'ALLES GRÜN');
