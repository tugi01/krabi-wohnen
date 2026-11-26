// iPhone-Prüfung: Tippflächen ≥ 44×44 pt (Apple HIG), Eingabefelder ≥ 16 px (sonst zoomt Safari),
// Text ≥ 11 px, nichts breiter als der Bildschirm, Milchglas (backdrop-filter) auf Leisten/Blättern,
// Abstand zur Notch/Home-Leiste (safe-area). Gemessen im gerenderten DOM, WebKit, iPhone 15 (393×852).
import { createRequire } from 'module';
const { webkit } = createRequire(process.env.PW_FROM || '/Users/tugrulcinkaya/Projects/fashion-id/package.json')('playwright');
const URL = process.env.URL || 'http://127.0.0.1:8765/', OUT = process.env.OUT || '/tmp';
const STRICT = !!process.env.STRICT;
let fails = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if(!c) fails++; };
const b = await webkit.launch();
const ctx = await b.newContext({viewport:{width:393,height:852}, deviceScaleFactor:3, isMobile:true, hasTouch:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'});
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(URL); await p.waitForTimeout(1500);
await p.evaluate(() => switchCity('krabi')); await p.waitForSelector('.card'); await p.waitForTimeout(800);

const audit = async (view) => p.evaluate((view) => {
  const vis = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && !e.closest('[hidden]'); };
  const label = e => (e.getAttribute('aria-label') || e.textContent || e.title || e.className || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 28);
  const small = [], inputs = [], tiny = [];
  for(const e of document.querySelectorAll('button, a[href], [role=button], input, select, summary, label[for], [data-fav], [data-relax]')){
    if(!vis(e) || e.closest('.leaflet-control-attribution')) continue;
    if(e.matches('input[type=range]')) continue;
    if(e.matches('input[type=checkbox],input[type=radio]') && e.closest('label')) continue;   // Tippfläche ist das ganze Label
    if(e.matches('label[for]') && document.getElementById(e.htmlFor)?.matches('input[type=range],select,input[type=text],input[type=number]')) continue;
    const r = e.getBoundingClientRect();
    // Inline-Textlinks im Fließtext sind nach HIG ausgenommen
    if(e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.closest('p,li,dd')) continue;
    if(r.width < 44 - 0.5 || r.height < 44 - 0.5) small.push(`${label(e)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    if(e.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea') && parseFloat(getComputedStyle(e).fontSize) < 16)
      inputs.push(`${label(e)} ${getComputedStyle(e).fontSize}`);
  }
  for(const e of document.querySelectorAll('body *')){
    if(!vis(e) || !e.childNodes.length || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize); if(fs < 11) tiny.push(`${label(e)} ${fs}px`);
  }
  const wide = document.documentElement.scrollWidth > innerWidth + 1;
  return {small: [...new Set(small)], inputs, tiny: [...new Set(tiny)].slice(0, 12), wide, sw: document.documentElement.scrollWidth};
}, view);

const report = async (view) => {
  const a = await audit(view);
  ok(a.small.length === 0, `${view}: Tippflächen ≥ 44 pt – zu klein: ${a.small.length ? a.small.join(' | ') : 'keine'}`);
  ok(a.inputs.length === 0, `${view}: Eingabefelder ≥ 16 px (kein Auto-Zoom) – ${a.inputs.join(' | ') || 'ok'}`);
  ok(a.tiny.length === 0, `${view}: Schrift ≥ 11 px – ${a.tiny.join(' | ') || 'ok'}`);
  ok(!a.wide, `${view}: nichts breiter als der Bildschirm (${a.sw} px)`);
  await p.screenshot({path: `${OUT}/iphone-${view}.png`});
};

await report('Liste');
// Milchglas + Safe Area
const g = await p.evaluate(() => {
  const sel = ['header', '#placebar', '.tabs', 'nav', '#filters', '.sheet', '#detail'];
  const out = {};
  for(const s of sel){ const e = document.querySelector(s); if(!e) continue; const cs = getComputedStyle(e);
    out[s] = (cs.backdropFilter || cs.webkitBackdropFilter || 'none'); }
  const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText); } catch { return []; } }).join('\n');
  return {glass: out, safe: (css.match(/safe-area-inset-(top|bottom|left|right)|var\(--safe-[tblr]\)/g) || []).length};
});
console.log('  Milchglas:', JSON.stringify(g.glass));
ok(Object.values(g.glass).filter(v => v && v !== 'none').length >= 2, 'Milchglas (backdrop-filter) auf Kopfzeile/Leisten');
ok(g.safe >= 3, `Notch/Home-Leiste berücksichtigt (safe-area in ${g.safe} Regeln)`);

await p.click('#filterBtn'); await p.waitForSelector('#filters:not([hidden])'); await p.waitForTimeout(600);
// nur das Blatt prüfen (dahinter liegt die abgedunkelte Liste)
await p.evaluate(() => document.querySelectorAll('header,#placebar,nav,main,.sortbar').forEach(e => e.setAttribute('data-audit-hide','')));
await p.addStyleTag({content:'[data-audit-hide]{visibility:hidden!important}'});
await report('Filter');
await p.goto('about:blank'); await p.goto(URL); await p.waitForTimeout(1200);
await p.evaluate(() => switchCity('krabi')); await p.waitForSelector('.card'); await p.waitForTimeout(500);
await p.click('.card .body'); await p.waitForSelector('#detail:not([hidden])'); await p.waitForTimeout(800);
await p.evaluate(() => document.querySelectorAll('header,#placebar,nav,main,.sortbar').forEach(e => e.setAttribute('data-audit-hide','')));
await p.addStyleTag({content:'[data-audit-hide]{visibility:hidden!important}'});
await report('Inserat');
await p.goto('about:blank'); await p.goto(URL); await p.waitForTimeout(1200);
await p.evaluate(() => switchCity('krabi')); await p.waitForSelector('.card'); await p.waitForTimeout(500);
await p.click('#placebar [data-pl="__add"]'); await p.waitForSelector('#places:not([hidden])'); await p.waitForTimeout(600);
await p.evaluate(() => document.querySelectorAll('header,#placebar,nav,main,.sortbar').forEach(e => e.setAttribute('data-audit-hide','')));
await p.addStyleTag({content:'[data-audit-hide]{visibility:hidden!important}'});
await report('Orte');
ok(errs.length === 0, 'keine JS-Fehler ' + errs.join(' | '));
await b.close();
console.log(fails ? `${fails} FEHLER` : 'ALLES GRÜN');
