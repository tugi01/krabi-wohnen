#!/usr/bin/env python3
"""Orte (POIs) für ganz Thailand -> site/data/th/pois/<cellId>.json  (Vertrag: docs/thailand-data.md, "Orte").

Ablauf
  1. Raster 1°x1° über lat 5..21, lng 97..106 (cellId = "<floor(lat)>_<floor(lng)>").
     Pro Zelle EINE Overpass-Abfrage mit allen Kategorien, begrenzt auf das Staatsgebiet
     (area["ISO3166-1"="TH"][admin_level=2]) -> Myanmar/Laos/Kambodscha/Malaysia fallen weg.
     Nur die 82 Zellen, die Thailand berühren (TH_CELLS), werden abgefragt.
  2. Kategorien = dieselben Tag-Regeln wie scrape.py (build_pois / refresh_seven_eleven / refresh_markets):
       Strand      natural=beach
       Moschee     amenity=place_of_worship + religion=muslim, zusätzlich name~มัสยิด|สุเหร่า|masjid|mosque
       Muay Thai   sport~muay_thai|boxing|kickboxing|thai_boxing  oder  name~muay thai|boxing|fairtex|sityodtong|kombat|มวย
                   (nicht place_of_worship; Namen mit hotel|resort|shop|store|restaurant|bar$ raus;
                    landesweit zusätzlich keine Straßen (highway=*))
       Einkauf     shop=supermarket|mall|department_store|wholesale
       Krankenhaus amenity=hospital
       7-Eleven    brand~7-Eleven|7-11, name~7-Eleven|7-11|7 Eleven|เซเว่น, brand:wikidata=Q259340 (Dubletten < 40 m raus)
       Markt       amenity=marketplace|food_court, name~night market|walking street|food market|weekend market|floating market
                   (ohne "minimart"; nicht innerhalb 80 m eines Einkaufs-/Markt-Eintrags)
     Ohne Namen: nur Strand/Moschee/Markt bleiben (mit Platzhalter-Namen) – wie in scrape.py.
     Dubletten gleicher Kategorie < 60 m werden zusammengelegt (wie build_pois).
  3. Strand "boat" (nur per Boot/Fähre): ein Strand bekommt boat:true, wenn er auf einer Fläche
     place=island/islet liegt (Punkt-in-Polygon gegen die OSM-Inselumrisse; bei Strandflächen zählt auch
     ein Stützpunkt der Fläche, weil Strände oft über die Küstenlinie ins Meer ragen; Punkt-Strände: < 100 m).
     AUSNAHME: Phuket (per Brücke mit dem Festland verbunden) -> boat:false.
     Ko Samui, Ko Lanta, Ko Chang, Ko Phangan, Ko Tao, Ko Larn, Phi Phi usw. sind Fähr-/Bootsinseln -> boat:true.
  4. Kuratierte Orte aus scraper/pois-krabi.json und scraper/pois-pattaya.json werden zusammengeführt:
     gleicher Kategorie innerhalb 80 m -> der kuratierte Eintrag ersetzt den OSM-Eintrag (Name/Notiz/boat
     bleiben), sonst wird er ergänzt. So geht nichts Kuratiertes verloren.
  5. Ausgabe kompakt: {"cell":"12_100","pois":[{cat,name,lat,lng,note?,boat?}]}, Koordinaten auf 6 Stellen,
     plus pois/index.json {"generated","cells":{cellId:n},"counts":{cat:n}}.

Fortsetzbar: Rohdaten jeder Zelle liegen in scraper/.pois-th-cache/ (gitignored). Neu laden: --refresh.
Overpass wird per curl angesprochen (auf macOS hat urllib Zertifikatsprobleme; curl gibt es auch auf GitHub Actions).
"""
import json
import math
import os
import random
import re
import subprocess
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scraper", ".pois-th-cache")
OUT = os.path.join(ROOT, "site", "data", "th", "pois")
CURATED = [os.path.join(ROOT, "scraper", f) for f in ("pois-krabi.json", "pois-pattaya.json")]
SERVERS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]
# Zellen des 1°-Rasters (lat 5..21, lng 97..106), die das thailändische Staatsgebiet (OSM-Relation
# ISO3166-1=TH, admin_level=2, inkl. Hoheitsgewässer) berühren – einmalig berechnet (Randpunkte + 4x4-Stichproben
# Punkt-in-Polygon). Alle anderen Rasterzellen (Myanmar, Laos, Kambodscha, Malaysia, offene See) werden übersprungen.
TH_CELLS = [
    "5_100", "5_101", "6_98", "6_99", "6_100", "6_101", "6_102", "7_98", "7_99", "7_100", "7_101", "7_102",
    "8_97", "8_98", "8_99", "8_100", "8_101", "9_97", "9_98", "9_99", "9_100", "10_98", "10_99", "10_100",
    "11_99", "11_100", "11_102", "12_99", "12_100", "12_101", "12_102", "13_99", "13_100", "13_101",
    "13_102", "14_98", "14_99", "14_100", "14_101", "14_102", "14_103", "14_104", "14_105", "15_98", "15_99",
    "15_100", "15_101", "15_102", "15_103", "15_104", "15_105", "16_98", "16_99", "16_100", "16_101",
    "16_102", "16_103", "16_104", "16_105", "17_97", "17_98", "17_99", "17_100", "17_101", "17_102",
    "17_103", "17_104", "18_97", "18_98", "18_99", "18_100", "18_101", "18_102", "18_103", "18_104", "19_97",
    "19_98", "19_99", "19_100", "19_101", "20_99", "20_100",
]
CATS = ["Strand", "Moschee", "Muay Thai", "Einkauf", "Krankenhaus", "7-Eleven", "Markt"]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def haversine(a, b) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


# ---------------------------------------------------------------- Overpass
def overpass(q: str, tries: int = 12):
    last = None
    for attempt in range(tries):
        url = SERVERS[attempt % len(SERVERS)]
        r = subprocess.run(["curl", "-s", "-A", "krabi-wohnen/1.0 (thailand-wohnen POIs)", "--max-time", "300",
                            url, "--data-urlencode", "data=" + q], capture_output=True, text=True)
        try:
            d = json.loads(r.stdout)
            rem = d.get("remark") or ""
            if "error" in rem.lower() or "timed out" in rem.lower():
                raise ValueError(rem[:200])
            return d["elements"]
        except Exception as e:  # noqa: BLE001
            last = (url, r.stdout[:200].replace("\n", " "), e)
            wait = min(180, 10 * 2 ** (attempt // len(SERVERS))) + random.uniform(0, 5)
            log(f"  Overpass-Fehler ({url}): {e} – warte {wait:.0f}s")
            time.sleep(wait)
    raise RuntimeError(f"Overpass: {last}")


def polite():
    time.sleep(random.uniform(2, 5))


# Dieselben Namensmuster wie scrape.py, aber ohne ",i": Overpass ist mit Groß/Klein-Varianten im Muster
# rund doppelt so schnell. Die genaue (case-insensitive) Prüfung macht categories().
NAME_RX = ("มัสยิด|สุเหร่า|มวย|เซเว่น|[Mm](asjid|osque|ASJID|OSQUE)|[Mm]uay ?[Tt]hai|MUAY ?THAI|[Bb]oxing|BOXING"
           "|[Ff]airtex|FAIRTEX|[Ss]ityodtong|SITYODTONG|[Kk]ombat|KOMBAT|7-?(Eleven|ELEVEN|eleven|11)|7 Eleven"
           "|[Nn]ight [Mm]arket|NIGHT MARKET|[Ww]alking [Ss]treet|WALKING STREET|[Ff]ood [Mm]arket|FOOD MARKET"
           "|[Ww]eekend [Mm]arket|WEEKEND MARKET|[Ff]loating [Mm]arket|FLOATING MARKET")


def main_query(s, w, n, e):
    """Alle Kategorien in einer Abfrage. Die Namens-Regeln aller Kategorien laufen als EIN Regex-Durchgang
    (Namens-Regex ist der teure Teil); die genaue Zuordnung macht categories() in Python.
    Das Staatsgebiet (area.th) wird nur einmal auf die Vereinigung angewendet."""
    bb = f"({s},{w},{n},{e})"
    return (
        '[out:json][timeout:240];area["ISO3166-1"="TH"][admin_level=2]->.th;('
        f'nwr["natural"="beach"]{bb};'
        f'nwr["amenity"="place_of_worship"]["religion"="muslim"]{bb};'
        f'nwr["sport"~"muay_thai|boxing|kickboxing|thai_boxing"]{bb};'
        f'nwr["shop"~"^(supermarket|mall|department_store|wholesale)$"]{bb};'
        f'nwr["amenity"~"^(hospital|marketplace|food_court)$"]{bb};'
        f'nwr["brand"~"7-Eleven|7-11",i]{bb};'
        f'nwr["brand:wikidata"="Q259340"]{bb};'
        f'nwr["name"~"{NAME_RX}"]{bb};'
        ')->.all;nwr.all(area.th);out center tags;'
    )


def island_query(s, w, n, e):
    bb = f"({s},{w},{n},{e})"
    return (f'[out:json][timeout:240];(way["place"~"^(island|islet)$"]{bb};relation["place"~"^(island|islet)$"]{bb};'
            f'way["natural"="beach"]{bb};relation["natural"="beach"]{bb};);out geom;')


KEEP_TAGS = ("name", "name:en", "natural", "amenity", "religion", "sport", "shop", "brand", "brand:wikidata",
             "opening_hours", "addr:street", "highway")


def fetch_cell(lat, lng, refresh=False):
    """Rohdaten einer Zelle (aus Cache oder Overpass)."""
    cid = f"{lat}_{lng}"
    path = os.path.join(CACHE, cid + ".json")
    if os.path.exists(path) and not refresh:
        return json.load(open(path, encoding="utf-8"))
    s, w, n, e = lat, lng, lat + 1, lng + 1
    try:
        els = overpass(main_query(s, w, n, e), tries=4)
    except RuntimeError:
        # dichte Zellen (Bangkok, Chiang Mai …) laufen in Zeitüberschreitung -> in 4 Viertel teilen
        log(f"  {cid}: in Viertel geteilt")
        els, ids = [], set()
        for a, b in ((s, w), (s, w + .5), (s + .5, w), (s + .5, w + .5)):
            polite()
            for el in overpass(main_query(a, b, a + .5, b + .5)):
                if (el["type"], el["id"]) not in ids:
                    ids.add((el["type"], el["id"]))
                    els.append(el)
    polite()
    if not els:
        # leere Antworten kommen bei überlasteten Servern auch fälschlich vor -> zweimal gegenprüfen
        for _ in range(2):
            els = overpass(main_query(s, w, n, e))
            polite()
            if els:
                break
    raw = []
    for el in els:
        c = el.get("center") or {}
        la, lo = el.get("lat", c.get("lat")), el.get("lon", c.get("lon"))
        if la is None:
            continue
        t = {k: v for k, v in (el.get("tags") or {}).items() if k in KEEP_TAGS}
        raw.append([el["type"][0] + str(el["id"]), la, lo, t])
    islands, beachgeo = [], {}
    if any(r[3].get("natural") == "beach" for r in raw):
        for el in overpass(island_query(s, w, n, e)):
            t = el.get("tags") or {}
            if t.get("natural") == "beach" and not t.get("place"):
                pts = [g for g in (el.get("geometry") or []) if g] or \
                      [g for m in el.get("members", []) for g in (m.get("geometry") or []) if g]
                step = max(1, len(pts) // 30)   # höchstens ~30 Stützpunkte reichen für den Insel-Test
                beachgeo[el["type"][0] + str(el["id"])] = [[round(g["lat"], 6), round(g["lon"], 6)] for g in pts[::step]]
                continue
            name = " ".join(x for x in (t.get("name"), t.get("name:en")) if x)
            rings = []
            if el["type"] == "way" and el.get("geometry"):
                rings.append([[round(g["lat"], 6), round(g["lon"], 6)] for g in el["geometry"]])
            elif el["type"] == "relation":
                for m in el.get("members", []):
                    if m.get("type") == "way" and m.get("role", "outer") in ("outer", "") and m.get("geometry"):
                        rings.append([[round(g["lat"], 6), round(g["lon"], 6)] for g in m["geometry"] if g])
            if rings:
                islands.append({"id": el["type"][0] + str(el["id"]), "name": name, "segs": rings})
        polite()
    data = {"cell": cid, "raw": raw, "islands": islands, "beachgeo": beachgeo}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    return data


# ---------------------------------------------------------------- Klassifizierung
RX_MOSQUE = re.compile(r"มัสยิด|สุเหร่า|masjid|mosque", re.I)
RX_MUAY_SPORT = re.compile(r"muay_thai|boxing|kickboxing|thai_boxing")
RX_MUAY_NAME = re.compile(r"muay ?thai|boxing|fairtex|sityodtong|kombat|มวย", re.I)
RX_MUAY_BAD = re.compile(r"hotel|resort|shop|store|restaurant|bar$", re.I)
RX_SHOP = re.compile(r"^(supermarket|mall|department_store|wholesale)$")
RX_711_BRAND = re.compile(r"7-Eleven|7-11", re.I)
RX_711_NAME = re.compile(r"7-Eleven|7-11|7 Eleven|เซเว่น", re.I)
RX_MARKET = re.compile(r"night market|walking street|food market|weekend market|floating market", re.I)


def categories(t):
    name = t.get("name") or ""
    cats = []
    if t.get("natural") == "beach":
        cats.append("Strand")
    if (t.get("amenity") == "place_of_worship" and t.get("religion") == "muslim") or \
            (RX_MOSQUE.search(name) and "highway" not in t):
        cats.append("Moschee")
    if (RX_MUAY_SPORT.search(t.get("sport", "")) or
            (RX_MUAY_NAME.search(name) and t.get("amenity") != "place_of_worship")) and "highway" not in t:
        cats.append("Muay Thai")
    if RX_SHOP.search(t.get("shop", "")):
        cats.append("Einkauf")
    if t.get("amenity") == "hospital":
        cats.append("Krankenhaus")
    if RX_711_BRAND.search(t.get("brand", "")) or RX_711_NAME.search(name) or t.get("brand:wikidata") == "Q259340":
        cats.append("7-Eleven")
    if t.get("amenity") in ("marketplace", "food_court") or (RX_MARKET.search(name) and "highway" not in t):
        cats.append("Markt")
    return cats


class Grid:
    """Einfacher räumlicher Index für Nachbarsuche (Radius in km)."""
    def __init__(self, size=0.01):
        self.size, self.cells = size, defaultdict(list)

    def key(self, lat, lng):
        return int(math.floor(lat / self.size)), int(math.floor(lng / self.size))

    def add(self, p):
        self.cells[self.key(p["lat"], p["lng"])].append(p)

    def remove(self, p):
        self.cells[self.key(p["lat"], p["lng"])].remove(p)

    def near(self, lat, lng, km):
        a, b = self.key(lat, lng)
        best, bd = None, km
        for i in (a - 1, a, a + 1):
            for j in (b - 1, b, b + 1):
                for p in self.cells.get((i, j), ()):
                    d = haversine((lat, lng), (p["lat"], p["lng"]))
                    if d < bd:
                        best, bd = p, d
        return best


def point_in_segs(lat, lng, segs):
    """Gerade/ungerade-Regel über alle Außenring-Segmente (funktioniert auch mit unverbundenen Multipolygon-Teilen)."""
    inside = False
    for ring in segs:
        for (y1, x1), (y2, x2) in zip(ring, ring[1:]):
            if (y1 > lat) != (y2 > lat):
                x = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
                if x > lng:
                    inside = not inside
    return inside


def is_phuket(name):
    return bool(re.search(r"phuket|ภูเก็ต", name or "", re.I))


def seg_dist_km(lat, lng, segs, limit_km):
    """Kleinster Abstand (km, flache Näherung) vom Punkt zum Umriss; bricht ab, sobald < limit_km."""
    kx = 111.32 * math.cos(math.radians(lat))
    best = 1e9
    for ring in segs:
        for (y1, x1), (y2, x2) in zip(ring, ring[1:]):
            ax, ay, bx, by = (x1 - lng) * kx, (y1 - lat) * 110.57, (x2 - lng) * kx, (y2 - lat) * 110.57
            dx, dy = bx - ax, by - ay
            L = dx * dx + dy * dy
            u = 0 if L == 0 else max(0, min(1, -(ax * dx + ay * dy) / L))
            d = math.hypot(ax + u * dx, ay + u * dy)
            if d < best:
                best = d
                if best < limit_km:
                    return best
    return best


def island_of(pts, islands, tol_km=0.0):
    """Erste (kleinste) Insel, in der einer der Punkte liegt (bzw. bei tol_km: deren Umriss näher als tol_km ist)."""
    pad = tol_km / 100
    for isl in islands:
        s, w, n, e = isl["bb"]
        for lat, lng in pts:
            if not (s - pad <= lat <= n + pad and w - pad <= lng <= e + pad):
                continue
            if point_in_segs(lat, lng, isl["segs"]) or (tol_km and seg_dist_km(lat, lng, isl["segs"], tol_km) < tol_km):
                return isl
    return None


def on_boat_island(lat, lng, islands, geom=None):
    """Strand auf einer Insel (place=island/islet)? Flächen-Strände: Mittelpunkt oder einer der Stützpunkte liegt
    in der Insel (Strandflächen ragen oft über die Küstenlinie ins Meer). Punkt-Strände: innerhalb oder < 100 m vom Umriss.
    Phuket ist per Brücke angebunden -> False."""
    isl = island_of([(lat, lng)] + [tuple(p) for p in (geom or [])], islands) if geom else \
        island_of([(lat, lng)], islands, tol_km=0.1)
    return bool(isl) and not is_phuket(isl["name"])


def build(cells):
    seen = set()
    islands, beachgeo = {}, {}
    for d in cells:
        beachgeo.update(d.get("beachgeo") or {})
        for isl in d["islands"]:
            pts = [pt for ring in isl["segs"] for pt in ring]
            isl["bb"] = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
            islands[isl["id"]] = isl
    islands = sorted(islands.values(), key=lambda i: (i["bb"][2] - i["bb"][0]) * (i["bb"][3] - i["bb"][1]))
    grids = {c: Grid() for c in CATS}
    shop_market = Grid()
    out = []
    # Einkauf vor Markt einordnen, damit die 80-m-Regel (Markt vs. Einkauf) greift
    rows = []
    for d in cells:
        for oid, lat, lng, t in d["raw"]:
            if oid in seen:
                continue
            seen.add(oid)
            rows.append((oid, lat, lng, t))
    order = {c: i for i, c in enumerate(CATS)}
    items = sorted(((c, r) for r in rows for c in categories(r[3])), key=lambda x: (order[x[0]], x[1][0]))
    for cat, (oid, lat, lng, t) in items:
        name = t.get("name:en") or t.get("name") or ""
        if cat in ("Muay Thai", "Einkauf", "Krankenhaus") and not name:
            continue
        if cat == "Muay Thai" and RX_MUAY_BAD.search(name):
            continue
        p = {"cat": cat, "name": name, "lat": lat, "lng": lng}
        if cat == "Strand":
            if not name:
                p["name"] = "Strand (ohne Namen)"
            if on_boat_island(lat, lng, islands, beachgeo.get(oid)):
                p["boat"] = True
                p["note"] = "Nur per Boot/Fähre erreichbar"
        elif cat == "Moschee":
            p["name"] = name or "Moschee (ohne Namen in OSM)"
            p["note"] = "Gebetszeiten vor Ort erfragen"
        elif cat == "Muay Thai":
            p["note"] = "Trainingszeiten und Preise vor Ort erfragen"
        elif cat == "7-Eleven":
            oh, street = t.get("opening_hours") or "", t.get("addr:street") or ""
            p["name"] = "7-Eleven" + (f" – {street}" if street else "")
            p["note"] = ("24 Stunden geöffnet" if ("24/7" in oh or "00:00+" in oh)
                         else "meist 24 Stunden geöffnet (Öffnungszeit nicht in OSM)")
        elif cat == "Markt":
            if "minimart" in name.lower():
                continue
            if shop_market.near(lat, lng, 0.08):
                continue
            kind = "Essensmarkt" if t.get("amenity") == "food_court" else "Markt"
            p["name"] = name or f"{kind} (ohne Namen in OSM)"
            note = ("Öffnungszeiten laut OSM: " + t["opening_hours"]) if t.get("opening_hours") else "Öffnungszeiten vor Ort erfragen"
            if re.search(r"night|walking", name, re.I):
                note = "Nachtmarkt · " + note
            p["note"] = note
        radius = {"7-Eleven": 0.04, "Markt": 0.08}.get(cat, 0.06)
        if grids[cat].near(lat, lng, radius):
            continue
        grids[cat].add(p)
        if cat in ("Einkauf", "Markt"):
            shop_market.add(p)
        out.append(p)
    # kuratierte Orte (Krabi/Pattaya) zusammenführen
    merged = added = 0
    for f in CURATED:
        if not os.path.exists(f):
            continue
        for c in json.load(open(f, encoding="utf-8")):
            if c.get("cat") not in grids:
                continue
            p = {"cat": c["cat"], "name": c["name"], "lat": c["lat"], "lng": c["lng"]}
            if c.get("note"):
                p["note"] = c["note"]
            if c.get("boat"):
                p["boat"] = True
            old = grids[c["cat"]].near(c["lat"], c["lng"], 0.08)
            if old is not None:
                grids[c["cat"]].remove(old)
                out.remove(old)
                merged += 1
            else:
                added += 1
            grids[c["cat"]].add(p)
            out.append(p)
    log(f"Kuratiert: {merged} ersetzt, {added} ergänzt")
    return out


def write(pois):
    os.makedirs(OUT, exist_ok=True)
    by = defaultdict(list)
    for p in pois:
        q = {"cat": p["cat"], "name": p["name"], "lat": round(p["lat"], 6), "lng": round(p["lng"], 6)}
        if p.get("note"):
            q["note"] = p["note"]
        if p.get("boat"):
            q["boat"] = True
        by[f"{math.floor(p['lat'])}_{math.floor(p['lng'])}"].append(q)
    for fn in os.listdir(OUT):   # veraltete Zellen entfernen
        if fn.endswith(".json") and fn != "index.json" and fn[:-5] not in by:
            os.remove(os.path.join(OUT, fn))
    for cid, ps in by.items():
        ps.sort(key=lambda q: (CATS.index(q["cat"]), q["lat"], q["lng"]))
        with open(os.path.join(OUT, cid + ".json"), "w", encoding="utf-8") as f:
            json.dump({"cell": cid, "pois": ps}, f, ensure_ascii=False, separators=(",", ":"))
    idx = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M+00:00"),
           "cells": {k: len(v) for k, v in sorted(by.items())},
           "counts": dict(Counter(p["cat"] for p in pois))}
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, separators=(",", ":"))
    return idx


def main():
    refresh = "--refresh" in sys.argv
    os.makedirs(CACHE, exist_ok=True)
    cells = []
    todo = [tuple(map(int, c.split("_"))) for c in TH_CELLS]
    for rnd in range(3):
        failed = []
        for i, (la, lo) in enumerate(todo, 1):
            t0 = time.time()
            try:
                d = fetch_cell(la, lo, refresh)
            except Exception as e:  # noqa: BLE001
                log(f"[{i}/{len(todo)}] {la}_{lo}: FEHLER {e}")
                failed.append((la, lo))
                continue
            cells.append(d)
            log(f"[{i}/{len(todo)}] {d['cell']}: {len(d['raw'])} Elemente, {len(d['islands'])} Inseln ({time.time() - t0:.0f}s)")
        if not failed:
            break
        todo = failed
        log(f"Runde {rnd + 2}: {len(failed)} Zellen erneut")
        time.sleep(60)
    if failed:
        log(f"Abbruch: {len(failed)} Zellen fehlen ({failed}) – nichts geschrieben, erneuter Lauf setzt fort")
        sys.exit(1)
    pois = build(cells)
    idx = write(pois)
    log(f"{len(pois)} Orte in {len(idx['cells'])} Zellen: {idx['counts']}")


if __name__ == "__main__":
    main()
