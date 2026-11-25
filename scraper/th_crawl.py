"""Thailand Wohnen – Mietinserate für ganz Thailand (DotProperty-Listenseiten) + Kachel-Ausgabe.

Datenvertrag: docs/thailand-data.md

Ablauf auf GitHub Actions:
  1) crawl  (mehrere Shards parallel): Listenseiten aller Provinzen (+ Tages-Anteil der Größen-/Baujahr-Stufen)
  2) build  : Shards + alter Zustand + Krabi/Pattaya-Detaildaten + Orte -> Kacheln, index.json, state.json.gz

  python3 scraper/th_crawl.py crawl --shard 0 --of 3 --state state.json.gz --out shards/s0.json.gz
  python3 scraper/th_crawl.py build --shards shards --state state.json.gz --out site/data/th

Höflich: 1 Abruf pro Shard und Sekunde, nur Listenseiten (robots.txt erlaubt sie).
"""
from __future__ import annotations

import argparse
import glob
import gzip
import html
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scrape  # noqa: E402  (fetch, ld_blocks, haversine, thb_per_eur, keep_home)

ROOT = scrape.ROOT
BASE = "https://www.dotproperty.co.th/en/properties-for-rent/"
DELAY = float(os.environ.get("TH_DELAY", "1.0"))
CHUNK = 300                         # Listenseiten pro Arbeitspaket
YEAR = datetime.now(timezone.utc).year

PROVINCES = """amnat-charoen ang-thong bangkok bueng-kan buriram chachoengsao chai-nat chaiyaphum chanthaburi
chiang-mai chiang-rai chonburi chumphon kalasin kamphaeng-phet kanchanaburi khon-kaen krabi lampang lamphun loei
lopburi mae-hong-son maha-sarakham mukdahan nakhon-nayok nakhon-pathom nakhon-phanom nakhon-ratchasima nakhon-sawan
nakhon-si-thammarat nan narathiwat nong-bua-lam-phu nong-khai nonthaburi pathum-thani pattani phang-nga phatthalung
phayao phetchabun phetchaburi phichit phitsanulok phra-nakhon-si-ayutthaya phrae phuket prachinburi
prachuap-khiri-khan ranong ratchaburi rayong roi-et sa-kaeo sakon-nakhon samut-prakan samut-sakhon samut-songkhram
saraburi satun sing-buri sisaket songkhla sukhothai suphan-buri surat-thani surin tak trang trat ubon-ratchathani
udon-thani uthai-thani uttaradit yala yasothon""".split()
if os.environ.get("TH_PROVINCES"):                       # zum Testen: nur einige Provinzen
    PROVINCES = os.environ["TH_PROVINCES"].split(",")

# Stufen für Filter ohne Detailseiten (Portal-Filter).  Schlüssel -> Query
SIZE_BINS = [((0, 34), "maxLivingArea=34"), ((35, 49), "minLivingArea=35&maxLivingArea=49"),
             ((50, 64), "minLivingArea=50&maxLivingArea=64"), ((65, 79), "minLivingArea=65&maxLivingArea=79"),
             ((80, 99), "minLivingArea=80&maxLivingArea=99"), ((100, 149), "minLivingArea=100&maxLivingArea=149"),
             ((150, 249), "minLivingArea=150&maxLivingArea=249"), ((250, 9999), "minLivingArea=250")]
YEAR_BINS = [((YEAR - 2, YEAR + 1), f"minYearBuilt={YEAR - 2}"),
             ((YEAR - 5, YEAR - 3), f"minYearBuilt={YEAR - 5}&maxYearBuilt={YEAR - 3}"),
             ((YEAR - 10, YEAR - 6), f"minYearBuilt={YEAR - 10}&maxYearBuilt={YEAR - 6}"),
             ((YEAR - 15, YEAR - 11), f"minYearBuilt={YEAR - 15}&maxYearBuilt={YEAR - 11}"),
             ((YEAR - 25, YEAR - 16), f"minYearBuilt={YEAR - 25}&maxYearBuilt={YEAR - 16}"),
             ((1900, YEAR - 26), f"maxYearBuilt={YEAR - 26}")]
BUCKET_DAYS = 7          # jede Stufe einmal pro Woche
CAP = 9900               # DotProperty liefert je Suche höchstens ~10.000 Treffer (Seite 334+ wiederholt sich)
PRICE_MAX = 10_000_000


def count(prov, query):
    url = BASE + prov + ("?" + query if query else "")
    for _ in range(3):
        try:
            _, n = parse_page(scrape.fetch(url), prov)
            time.sleep(DELAY)
            return n or 0
        except Exception as e:  # noqa: BLE001
            log("Zählfehler", prov, query, str(e)[:80])
            time.sleep(5)
    return None


def price_q(lo, hi):
    return "&".join(x for x in (f"minPrice={lo}" if lo else "", f"maxPrice={hi}" if hi is not None else "") if x)


def split_bands(prov, query, total):
    """Preisbänder [lo, hi, n] (hi=None offen) mit je <= CAP Treffern. Bisektion über den Preis."""
    out = []

    def rec(lo, hi, n):
        if n is None:
            return
        if n <= CAP or (hi is not None and hi - lo <= 1):
            if n:
                out.append([lo, hi, n])
            return
        top = hi if hi is not None else PRICE_MAX
        mid = int(round((max(lo, 1000) * top) ** 0.5)) if lo else max(1000, top // 8)
        mid = max(lo + 1, min(mid, top - 1))
        n1 = count(prov, "&".join(x for x in (query, price_q(lo, mid)) if x))
        n2 = count(prov, "&".join(x for x in (query, price_q(mid + 1, hi)) if x))
        rec(lo, mid, n1)
        rec(mid + 1, hi, n2)

    rec(0, None, total)
    return out


def cmd_bands(a):
    """Vorbereitung (1 Job): Größen messen und große Suchen in Preisbänder teilen. Schreibt den Zustand zurück."""
    state = load_gz(a.state, {})
    counts = state.setdefault("counts", {})
    bands = state.setdefault("bands", {})
    try:
        seed = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "th_counts_seed.json")))
    except Exception:  # noqa: BLE001
        seed = {}
    keys = []
    for prov in PROVINCES:
        keys.append((prov, ""))
        n = counts.get(prov, seed.get(prov)) or 0
        if n > CAP:   # Stufen-Suchen großer Provinzen können auch über 10.000 liegen
            for kind, bins in (("sz", SIZE_BINS), ("by", YEAR_BINS)):
                for rng, q in bins:
                    keys.append((f"{prov}|{kind}|{rng[0]}-{rng[1]}", q))
    t0 = time.time()
    for key, q in keys:
        prov = key.split("|")[0]
        known = counts.get(key, seed.get(key) if "|" not in key else None)
        if known is not None and known <= CAP and key not in bands:
            continue                                # klein genug, nichts zu tun
        n = count(prov, q)
        if n is None:
            continue
        counts[key] = n
        if n <= CAP:
            bands.pop(key, None)
            continue
        old = bands.get(key)
        if old and abs(sum(b[2] for b in old) - n) / n < 0.03:
            fresh, ok = [], True     # Bänder vom Vortag nur nachzählen
            for lo, hi, _ in old:
                m = count(prov, "&".join(x for x in (q, price_q(lo, hi)) if x))
                if m is None or m > CAP:
                    ok = False
                    break
                fresh.append([lo, hi, m])
            if ok:
                bands[key] = fresh
                continue
        bands[key] = split_bands(prov, q, n)
        log(f"{key}: {n} Treffer -> {len(bands[key])} Preisbänder, Summe {sum(b[2] for b in bands[key])}")
    log(f"Bänder fertig in {time.time() - t0:.0f} s: {sum(len(v) for v in bands.values())} Bänder für {len(bands)} Suchen")
    save_gz(a.out, state)



def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)


def load_gz(path, default):
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def save_gz(path, obj):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def dp_id(url: str) -> str:
    return "dp-" + url.rstrip("/").rsplit("_", 1)[-1][-24:]


SQM = re.compile(r"(\d{2,4}(?:[.,]\d+)?)\s?(?:sq\.?\s?m|sqm|m2|m²|square met)", re.I)


def parse_page(page: str, prov: str):
    """Listenseite -> (Inserate, Gesamtzahl laut Portal)."""
    items, total = [], None
    for j in scrape.ld_blocks(page):
        if j.get("@type") != "ItemList":
            continue
        total = j.get("numberOfItems")
        for el in j.get("itemListElement", []):
            it = el.get("item") or {}
            url = it.get("url")
            if not url:
                continue
            about = it.get("about") or {}
            geo = about.get("geo") or {}
            offer = it.get("offers") or {}
            try:
                price = int(float(offer.get("price")))
            except (TypeError, ValueError):
                price = None
            title = html.unescape(it.get("name") or "")
            desc = html.unescape(it.get("description") or "")
            r = {"id": dp_id(url), "url": url, "title": title, "price": price, "prov": prov,
                 "lat": geo.get("latitude"), "lng": geo.get("longitude"),
                 "beds": about.get("numberOfBedrooms"), "img": it.get("image"),
                 "posted": (it.get("datePosted") or "")[:10] or None}
            m = SQM.search(title + " " + desc)
            if m:
                try:
                    v = float(m.group(1).replace(",", "."))
                    if 15 <= v <= 3000:
                        r["sizeh"] = round(v)      # Fläche aus Titel/Beschreibung (Hinweis)
                except ValueError:
                    pass
            blob = (title + " " + desc).lower()
            if "private pool" in blob or "pool villa" in blob or "poolvilla" in blob:
                r["pool"] = "privat"
            elif "swimming pool" in blob or "pool view" in blob or "pool access" in blob or "communal pool" in blob:
                r["pool"] = "gemeinschaft"
            items.append({k: v for k, v in r.items() if v not in (None, "")})
    return items, total


def crawl_query(prov, query, p_from, p_to, sink, stats):
    """Seiten p_from..p_to (p_to=None: bis leer). Rückgabe: Gesamtzahl laut Portal oder None bei Fehler."""
    total = None
    p = p_from
    fails = 0
    while p_to is None or p <= p_to:
        url = BASE + prov + "?" + "&".join(x for x in (query, f"page={p}" if p > 1 else "") if x)
        try:
            page = scrape.fetch(url)
            fails = 0
        except Exception as e:  # noqa: BLE001
            if "404" in str(e):
                break                       # hinter der letzten Seite
            fails += 1
            log("Fehler", prov, query, p, str(e)[:120])
            if fails >= 3:
                return None
            time.sleep(10)
            continue
        items, n = parse_page(page, prov)
        stats["pages"] += 1
        if p > 334:
            log("Warnung: über Seite 334 (Portal-Grenze)", prov, query)
            break
        total = n if total is None else total
        if not items:
            break
        sink(items)
        if n is not None and p * 30 >= n:
            break
        p += 1
        time.sleep(DELAY)
    return total if total is not None else 0


def plan_units(state, day_index):
    """Arbeitspakete: Basis (alle Provinzen, alle Seiten) + heutiger Anteil der Stufen-Abfragen."""
    counts = dict(state.get("counts", {}))
    try:   # gemessene Provinz-Größen (24.11.2026) als Startwert, damit Bangkok sofort aufgeteilt wird
        seed = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "th_counts_seed.json")))
        for k, v in seed.items():
            if v is not None:
                counts.setdefault(k, v)
    except Exception:  # noqa: BLE001
        pass
    units = []
    bands = state.get("bands", {})
    for prov in PROVINCES:
        if prov in bands:
            for lo, hi, n in bands[prov]:
                units.append(("base", prov, "|" + price_q(lo, hi), 1, None, math.ceil(n / 30)))
            continue
        n = counts.get(prov)
        pages = math.ceil(n / 30) if n else None
        if pages and pages > CHUNK:
            for a in range(1, pages + 1, CHUNK):
                last = a + CHUNK - 1 >= pages
                units.append(("base", prov, "", a, None if last else a + CHUNK - 1, CHUNK if not last else pages - a + 1))
        else:
            units.append(("base", prov, "", 1, None, pages or 1))
    for kind, bins in (("sz", SIZE_BINS), ("by", YEAR_BINS)):
        for rng, q in bins:
            for prov in PROVINCES:
                key = f"{prov}|{kind}|{rng[0]}-{rng[1]}"
                if prov in counts and not counts[prov]:
                    continue                      # Provinz ohne Inserate
                if (hash_str(key) % BUCKET_DAYS) != day_index % BUCKET_DAYS:
                    continue                      # jede Stufe einmal pro Woche
                if key in bands:
                    for lo, hi, n in bands[key]:
                        units.append((kind, prov, "&".join(x for x in (q, price_q(lo, hi)) if x) + "|" + key, 1, None, math.ceil(n / 30)))
                    continue
                n = counts.get(key)
                pages = math.ceil(n / 30) if n else None
                if pages and pages > CHUNK:
                    for a in range(1, pages + 1, CHUNK):
                        last = a + CHUNK - 1 >= pages
                        units.append((kind, prov, q + "|" + key, a, None if last else a + CHUNK - 1, CHUNK if not last else pages - a + 1))
                else:
                    est = pages or max(1, math.ceil((counts.get(prov) or 30) / 30 / (len(SIZE_BINS) if kind == "sz" else len(YEAR_BINS)) * 1.3))
                    units.append((kind, prov, q + "|" + key, 1, None, est))
    return units


def hash_str(s):
    h = 0
    for ch in s:
        h = (h * 131 + ord(ch)) % 1000003
    return h


def cmd_crawl(a):
    state = load_gz(a.state, {})
    day = int(datetime.now(timezone.utc).strftime("%j"))
    units = plan_units(state, day)
    # gleichmäßig verteilen: nach geschätzter Seitenzahl absteigend, gierig auf den leichtesten Shard
    loads = [0] * a.of
    mine = []
    for u in sorted(units, key=lambda u: -u[5]):
        s = loads.index(min(loads))
        loads[s] += u[5]
        if s == a.shard:
            mine.append(u)
    log(f"Shard {a.shard}/{a.of}: {len(mine)} Pakete, ca. {loads[a.shard]} Seiten (alle Shards: {loads})")
    out = {"base": {}, "attr": {}, "counts": {}, "failed": [], "done": []}
    stats = {"pages": 0}
    t0 = time.time()
    budget_s = float(os.environ.get("TH_MAX_SECONDS", "18000"))
    for kind, prov, q, p_from, p_to, _ in mine:
        if time.time() - t0 > budget_s:
            out["failed"].append([kind, prov, q, p_from])
            continue
        if kind == "base":
            def sink(items, prov=prov):
                for it in items:
                    out["base"][it["id"]] = it
            n = crawl_query(prov, q[1:] if q.startswith("|") else "", p_from, p_to, sink, stats)
            key = prov if not q else None
        else:
            query, key = q.split("|", 1)
            rng = [int(x) for x in key.rsplit("|", 1)[1].split("-")]

            def sink(items, kind=kind, rng=rng):
                for it in items:
                    out["attr"].setdefault(it["id"], {})[kind] = rng
            n = crawl_query(prov, query, p_from, p_to, sink, stats)
        if n is None:
            out["failed"].append([kind, prov, q, p_from])
        else:
            if p_from == 1 and key and "minPrice" not in q and "maxPrice" not in q:
                out["counts"][key] = n
            out["done"].append([kind, prov, q, p_from])
        if stats["pages"] % 200 == 0:
            log(f"  {stats['pages']} Seiten, {len(out['base'])} Inserate")
    log(f"Shard {a.shard} fertig: {stats['pages']} Seiten, {len(out['base'])} Inserate, "
        f"{len(out['attr'])} Stufen-Zuordnungen, {len(out['failed'])} Pakete fehlgeschlagen, {time.time() - t0:.0f} s")
    save_gz(a.out, out)


# ---------------------------------------------------------------- build
TH_BBOX = (5.5, 97.3, 20.5, 105.7)
MAX_TILE = 1500


def quadtree(items, b, tid, out):
    if len(items) <= MAX_TILE or len(tid) > 14:
        out.append((tid, b, items))
        return
    s, w, n, e = b
    mlat, mlng = (s + n) / 2, (w + e) / 2
    parts = {"0": [], "1": [], "2": [], "3": []}
    for it in items:
        k = ("2" if it["lat"] >= mlat else "0")
        k = str(int(k) + (1 if it["lng"] >= mlng else 0))
        parts[k].append(it)
    boxes = {"0": (s, w, mlat, mlng), "1": (s, mlng, mlat, e), "2": (mlat, w, n, mlng), "3": (mlat, mlng, n, e)}
    for k, sub in parts.items():
        if sub:
            quadtree(sub, boxes[k], tid + k, out)


def load_pois(pois_dir):
    pois = []
    for f in glob.glob(os.path.join(pois_dir, "*_*.json")):
        try:
            pois += json.load(open(f, encoding="utf-8"))["pois"]
        except Exception:  # noqa: BLE001
            pass
    return pois


def nearest(items, pois):
    """Nächster Ort je Kategorie (Luftlinie × 1,3 als Straßen-Schätzung). Raster 0,1° für Tempo."""
    grid = {}
    for p in pois:
        if p.get("cat") == "Strand" and p.get("boat"):
            continue
        grid.setdefault((p["cat"], int(p["lat"] * 10), int(p["lng"] * 10)), []).append(p)
    cats = sorted({p["cat"] for p in pois})
    for it in items:
        if it.get("lat") is None:
            continue
        gy, gx = int(it["lat"] * 10), int(it["lng"] * 10)
        d = {}
        for cat in cats:
            best = None
            for r in range(0, 6):              # bis ca. 60 km suchen
                cand = []
                for dy in range(-r, r + 1):
                    for dx in range(-r, r + 1):
                        if max(abs(dy), abs(dx)) != r:
                            continue
                        cand += grid.get((cat, gy + dy, gx + dx), [])
                for p in cand:
                    km = scrape.haversine((it["lat"], it["lng"]), (p["lat"], p["lng"])) * 1.3
                    if best is None or km < best[0]:
                        best = (km, p)
                if best and best[0] < r * 11 * 1.3:   # sicher der nächste
                    break
            if best:
                d[cat] = [round(best[0], 1), best[1]["name"], round(best[1]["lat"], 5), round(best[1]["lng"], 5)]
        if d:
            it["d"] = d


def from_city(l, prov):
    """Krabi/Pattaya-Inserat (volle Daten) -> Vertragsformat."""
    r = {"id": l["id"], "url": l["url"], "title": l.get("title"), "price": l.get("price"), "lat": l.get("lat"),
         "lng": l.get("lng"), "beds": l.get("beds"), "size": l.get("size"), "built": l.get("built"),
         "img": (l.get("images") or [None])[0], "src": (l.get("source") or "DotProperty").split(" ")[0],
         "prov": prov, "pool": l.get("pool"), "full": 1, "first": l.get("first_seen")}
    if l.get("approx"):
        r["approx"] = 1
    return {k: v for k, v in r.items() if v not in (None, "", [])}


def cmd_build(a):
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    state = load_gz(a.state, {})
    old_base = state.get("base", {})
    attrs = state.get("attr", {})
    counts = state.get("counts", {})
    seen = state.get("first", {})
    shards = [load_gz(f, None) for f in sorted(glob.glob(os.path.join(a.shards, "*.json.gz")))]
    shards = [s for s in shards if s]
    base = {}
    failed_provs = set()
    for s in shards:
        base.update(s["base"])
        for k, v in s["attr"].items():
            attrs.setdefault(k, {}).update(v)
        counts.update(s["counts"])
        failed_provs |= {f[1] for f in s["failed"] if f[0] == "base"}
    # Provinzen, deren Abruf (teilweise) scheiterte: alte Inserate behalten statt löschen
    kept = 0
    for k, v in old_base.items():
        if k not in base and v.get("prov") in failed_provs:
            base[k] = v
            kept += 1
    removed = sum(1 for k in old_base if k not in base)
    new = 0
    for k in base:
        if k not in seen:
            seen[k] = today
            new += 1
    log(f"Basis: {len(base)} Inserate, {new} neu, {removed} entfernt, {kept} aus altem Stand (Fehler in {sorted(failed_provs)})")
    # Stufen eintragen
    items = []
    for k, v in base.items():
        it = dict(v)
        at = attrs.get(k, {})
        if "sz" in at:
            it["sz"] = at["sz"]
        if "by" in at:
            it["by"] = at["by"]
        it["src"] = "DotProperty"
        it["first"] = seen.get(k)
        items.append(it)
    # Krabi/Pattaya: volle Detaildaten + BahtSold/Meezub ersetzen bzw. ergänzen
    city_prov = {"krabi": "krabi", "pattaya": "chonburi"}
    by_url = {it["url"]: i for i, it in enumerate(items)}
    extra = 0
    for city, prov in city_prov.items():
        p = os.path.join(ROOT, "site", "data", city, "listings.json")
        if not os.path.exists(p):
            continue
        for l in json.load(open(p, encoding="utf-8"))["listings"]:
            r = from_city(l, prov)
            if l["url"] in by_url:
                old = items[by_url[l["url"]]]
                r.update({k: old[k] for k in ("sz", "by") if k in old})
                r["first"] = old.get("first") or r.get("first")
                items[by_url[l["url"]]] = r
            else:
                items.append(r)
                extra += 1
    # Plausibilität (Tagespreise, Hotels, ganze Wohnhäuser)
    n0 = len(items)
    items = [it for it in items if scrape.keep_home({"price": it.get("price"), "beds": it.get("beds"),
                                                      "size": it.get("size") or it.get("sizeh"), "title": it.get("title")})]
    log(f"+{extra} aus Krabi/Pattaya-Quellen, {n0 - len(items)} aussortiert (Hotel/Tagespreis/Wohnhaus) -> {len(items)}")
    # Provinzmittelpunkte; Inserate ohne Lage -> Mittelpunkt (ungefähr)
    pc = {}
    for it in items:
        if it.get("lat") is not None and it.get("lng") is not None:
            pc.setdefault(it["prov"], []).append((it["lat"], it["lng"]))
    centers = {k: (sorted(x[0] for x in v)[len(v) // 2], sorted(x[1] for x in v)[len(v) // 2]) for k, v in pc.items()}
    for it in items:
        if it.get("lat") is None or it.get("lng") is None:
            c = centers.get(it["prov"])
            if not c:
                continue
            it["lat"], it["lng"], it["approx"] = c[0], c[1], 1
        it["lat"], it["lng"] = round(float(it["lat"]), 6), round(float(it["lng"]), 6)
    items = [it for it in items if it.get("lat") is not None and TH_BBOX[0] <= it["lat"] <= TH_BBOX[2]
             and TH_BBOX[1] <= it["lng"] <= TH_BBOX[3]]
    pois = load_pois(os.path.join(a.out, "pois"))
    log(f"Orte: {len(pois)}")
    if pois:
        nearest(items, pois)
    # Kacheln
    tiles = []
    quadtree(items, TH_BBOX, "q", tiles)
    tdir = os.path.join(a.out, "t")
    os.makedirs(tdir, exist_ok=True)
    for f in glob.glob(os.path.join(tdir, "*.json")):
        os.remove(f)
    for tid, b, its in tiles:
        with open(os.path.join(tdir, tid + ".json"), "w", encoding="utf-8") as f:
            json.dump({"id": tid, "listings": its}, f, ensure_ascii=False, separators=(",", ":"))
    fx = scrape.thb_per_eur()
    provs = {}
    for it in items:
        provs.setdefault(it["prov"], []).append(it)
    idx = {
        "generated": now.strftime("%Y-%m-%dT%H:%M+00:00"), "fx": fx, "count": len(items),
        "new_since_last": new, "removed_since_last": removed,
        "sources": {s: sum(1 for it in items if it.get("src") == s) for s in ("DotProperty", "BahtSold", "Meezub", "aonangapartments")},
        "coverage": {"sz": sum(1 for it in items if it.get("sz") or it.get("size")),
                     "by": sum(1 for it in items if it.get("by") or it.get("built"))},
        "portal_total": sum(v for k, v in counts.items() if "|" not in k and k in PROVINCES),
        "provinces": sorted([{"key": k, "name": k.replace("-", " ").title(), "n": len(v),
                              "lat": round(centers.get(k, (0, 0))[0], 4), "lng": round(centers.get(k, (0, 0))[1], 4)}
                             for k, v in provs.items()], key=lambda x: -x["n"]),
        "tiles": [{"id": tid, "b": [round(x, 5) for x in b], "n": len(its)} for tid, b, its in tiles],
    }
    with open(os.path.join(a.out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
    # Zustand für den nächsten Lauf (nur DotProperty-Basis)
    keep_ids = set(base)
    state = {"base": base, "attr": {k: v for k, v in attrs.items() if k in keep_ids},
             "counts": counts, "first": {k: v for k, v in seen.items() if k in keep_ids}, "generated": idx["generated"],
             "bands": state.get("bands", {})}
    save_gz(os.path.join(a.out, "state.json.gz"), state)
    log(f"Fertig: {len(items)} Inserate in {len(tiles)} Kacheln (größte {max(len(t[2]) for t in tiles)}), "
        f"Fläche bekannt {idx['coverage']['sz']}, Baujahr bekannt {idx['coverage']['by']}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crawl")
    c.add_argument("--shard", type=int, required=True)
    c.add_argument("--of", type=int, required=True)
    c.add_argument("--state", default="state.json.gz")
    c.add_argument("--out", required=True)
    bd = sub.add_parser("bands")
    bd.add_argument("--state", default="state.json.gz")
    bd.add_argument("--out", required=True)
    b = sub.add_parser("build")
    b.add_argument("--shards", required=True)
    b.add_argument("--state", default="state.json.gz")
    b.add_argument("--out", default=os.path.join(ROOT, "site", "data", "th"))
    a = ap.parse_args()
    {"crawl": cmd_crawl, "build": cmd_build, "bands": cmd_bands}[a.cmd](a)


if __name__ == "__main__":
    main()
