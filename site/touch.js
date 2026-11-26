/* Thailand Wohnen – sichtbares und fühlbares Antippen.
   1) Welle: vom Fingerpunkt breitet sich ein weicher Ring aus – wie ein Tropfen auf stillem Wasser (zwei Ringe, leicht versetzt).
   2) Schimmernder Rand: beim Drücken läuft ein heller Glanz einmal um den Knopf (passt zum Milchglas).
   3) Kurze Vibration zur Bestätigung – nur bei Aktionen mit Ergebnis (Merken, Schalter, Ort, Sortierung, Speichern),
      nicht bei jedem Tipp. Android: navigator.vibrate. iPhone (iOS 18+): Safari erlaubt keine Vibration per Skript,
      gibt aber beim Umlegen eines System-Schalters (<input switch>) ein leises Klick-Gefühl – das wird genutzt.
   Alles läuft in einer eigenen Ebene über der Seite (pointer-events:none): kein Eingriff ins Layout, keine Klicks verschluckt.
   „Bewegung reduzieren“ (Systemeinstellung) -> keine Wellen/Glanz; Vibration in den Infos abschaltbar. */
'use strict';
const TAP = (() => {
  const SEL = 'button, a[href], [role=button], .card .body, summary, select, label.toggle, .pl';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const KEY = 'krabiwohnen.haptic';
  let layer = null, sw = null, swLabel = null;
  const on = () => localStorage.getItem(KEY) !== 'off';

  function ensure(){
    if(layer) return;
    layer = document.createElement('div'); layer.id = 'tapfx'; layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    // iOS-Haptik: unsichtbarer System-Schalter; ein Klick auf sein Label löst das Klick-Gefühl aus
    sw = document.createElement('input'); sw.type = 'checkbox'; sw.setAttribute('switch', ''); sw.id = 'tapfxSwitch'; sw.tabIndex = -1;
    swLabel = document.createElement('label'); swLabel.htmlFor = 'tapfxSwitch';
    const box = document.createElement('div'); box.className = 'tapfx-hidden'; box.append(sw, swLabel);
    document.body.appendChild(box);
  }

  function haptic(kind = 'light'){
    if(!on()) return;
    try {
      if(navigator.vibrate){ navigator.vibrate(kind === 'success' ? [10, 40, 14] : 9); return; }
      ensure(); swLabel.click();                        // iPhone
      if(kind === 'success') setTimeout(() => swLabel.click(), 90);
    } catch {}
  }

  function fx(el, x, y){
    if(reduce.matches) return;
    ensure();
    const r = el.getBoundingClientRect();
    if(r.width < 8 || r.height < 8 || r.width > innerWidth * 1.2) return;
    const cs = getComputedStyle(el);
    const box = document.createElement('div');
    box.className = 'tapfx-box' + (el.matches('.card .body') ? ' soft' : '');
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
      borderRadius: el.matches('.card .body') ? getComputedStyle(el.closest('.card')).borderRadius : cs.borderRadius });
    // Welle: Radius bis zur entferntesten Ecke
    const lx = Math.max(0, Math.min(r.width, x - r.left)), ly = Math.max(0, Math.min(r.height, y - r.top));
    const R = Math.hypot(Math.max(lx, r.width - lx), Math.max(ly, r.height - ly));
    for(const d of [0, 110]){
      const w = document.createElement('span'); w.className = 'tapfx-wave';
      Object.assign(w.style, { left: lx - R + 'px', top: ly - R + 'px', width: 2 * R + 'px', height: 2 * R + 'px', animationDelay: d + 'ms' });
      box.appendChild(w);
    }
    const ring = document.createElement('span'); ring.className = 'tapfx-ring'; box.appendChild(ring);
    layer.appendChild(box);
    setTimeout(() => box.remove(), 900);
  }

  document.addEventListener('pointerdown', e => {
    if(e.button > 0) return;
    const el = e.target.closest(SEL);
    if(!el || el.disabled || (el.closest('.leaflet-container') && !el.closest('.leaflet-control'))) return;
    fx(el, e.clientX, e.clientY);
  }, { passive: true, capture: true });

  // Bestätigung bei Aktionen mit Ergebnis
  document.addEventListener('click', e => {
    const t = e.target;
    if(t.closest('[data-fav], [data-pldel], [data-relax], .sortbar button, .seg button, [data-pl="__add"], .sheetActions .primary, .ownform [type=submit]')) haptic();
  }, { capture: true });
  document.addEventListener('change', e => { if(e.target.matches('#filters input[type=checkbox], #filters select')) haptic(); }, true);

  return { haptic, fx, on, set: v => localStorage.setItem(KEY, v ? 'on' : 'off') };
})();
