// Simuliert ein Handy mit alter, gespeicherter App-Version und prüft, ob die neue Version ankommt.
import { createRequire } from 'module';
import { spawn } from 'child_process';
const pw = createRequire('/Users/tugrulcinkaya/Projects/fashion-id/package.json')('playwright');
const T = process.env.TMPDIR;
const serve = dir => spawn('python3', ['-m', 'http.server', '8799', '-d', dir], { stdio: 'ignore' });
const wait = ms => new Promise(r => setTimeout(r, ms));
for (const [name, eng] of [['chromium', pw.chromium], ['webkit', pw.webkit]]) {
  let srv = serve(`${T}/old/site`); await wait(800);
  const ctx = await eng.launchPersistentContext(`${T}/pw-${name}-${Date.now()}`, { viewport: { width: 390, height: 844 } });
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto('http://localhost:8799/'); await p.waitForSelector('.card');
  await p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await p.reload(); await p.waitForSelector('.card');
  const oldOk = await p.evaluate(() => !!navigator.serviceWorker.controller && !document.querySelector('#tabInfo'));
  srv.kill(); await wait(500); srv = serve(`${T}/new`); await wait(2500);
  // „App neu öffnen“
  const reqs=[]; p.on('response', r => { if(/app\.js|index|8799\/$/.test(r.url())) reqs.push(`${r.url().replace('http://localhost:8799','')} ${r.status()} sw=${r.fromServiceWorker()}`); });
  await p.goto('http://localhost:8799/'); await p.waitForSelector('.card'); await wait(2500);
  await p.waitForSelector('.card');
  await p.click('#tabMap').catch(() => {});
  await wait(1500);
  let has = await p.evaluate(() => !!document.querySelector('.chip[data-layer="7-Eleven"]'));
  let opens = 1;
  while(!has && opens < 3){ opens++; await p.goto('http://localhost:8799/'); await p.waitForSelector('.card'); await wait(2000); await p.click('#tabMap').catch(()=>{}); await wait(1200);
    has = await p.evaluate(() => !!document.querySelector('.chip[data-layer="7-Eleven"]')); }
  console.log('Öffnungen nötig:', opens);
  console.log(reqs.join(' | '));
  console.log('html has v=', await p.evaluate(()=>document.querySelector('script[src*=app]').getAttribute('src')));
  console.log(`${name}: alte Version mit Speicher installiert=${oldOk} → nach 1× Öffnen 7-Eleven-Knopf=${has}`);
  await ctx.close(); srv.kill();
}
