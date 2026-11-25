#!/usr/bin/env python3
"""Sammelt Mietinserate für mehrere Städte (Krabi, Pattaya) und schreibt site/data/<stadt>/listings.json.

Quellen:
  * DotProperty (enthält die FazWaz-Inserate inkl. GPS, Größe, Ausstattung, Baujahr)
  * aonangapartments.com (Vermieter-Direktseite Ao Nang Valley)

Nur Python-Standardbibliothek. Lauf: python3 scraper/scrape.py [stadt ...]
Detailseiten werden zwischengespeichert (scraper/cache-<stadt>.json) und nur neu geladen,
wenn sich Preis/Titel ändern oder der Eintrag älter als REFRESH_DAYS ist.
"""
from __future__ import annotations

import html
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
REFRESH_DAYS = 7
MAX_PAGES = 60
YEAR = datetime.now(timezone.utc).year

# Städte. "params" filtert schon beim Portal (Pattaya hat sonst > 16.000 Inserate).
CITIES = {
    "krabi": {
        "name": "Krabi / Ao Nang",
        "list": {"Krabi": "https://www.dotproperty.co.th/en/properties-for-rent/krabi/mueang-krabi"},
        "params": "",
        "center": (8.0310923, 98.8218831), "radius_km": 25,
        "bbox": (7.94, 98.70, 8.16, 98.98),
        "boat": lambda lat, lon: False,
        "landlords": True,
    },
    "pattaya": {
        "name": "Pattaya & Umgebung",
        # Pattaya mit Jomtien/Naklua/Pratumnak + Umgebung, alles mit dem Roller erreichbar
        "list": {"Pattaya": "https://www.dotproperty.co.th/en/properties-for-rent/chonburi/pattaya",
                 "Sattahip / Na Jomtien / Bang Saray": "https://www.dotproperty.co.th/en/properties-for-rent/chonburi/sattahip",
                 "Si Racha": "https://www.dotproperty.co.th/en/properties-for-rent/chonburi/si-racha",
                 "Ban Chang": "https://www.dotproperty.co.th/en/properties-for-rent/rayong/ban-chang"},
        "params": f"minLivingArea=50&maxPrice=60000&minYearBuilt={YEAR - 10}",
        "center": (12.9327, 100.8800), "radius_km": 45,
        "bbox": (12.60, 100.76, 13.22, 101.20),
        # Koh Larn und Koh Si Chang – nur per Fähre
        "boat": lambda lat, lon: lon < 100.80 or (lat > 13.10 and lon < 100.845),
        "landlords": False,
    },
}
CITY = None      # aktuelle Stadt (Schlüssel)
POIS = []
POIS_FILE = ""


def overpass(q: str):
    import urllib.parse
    last = None
    for url in ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
                "https://maps.mail.ru/osm/tools/overpass/api/interpreter"):
        try:
            body = urllib.parse.urlencode({"data": q}).encode()
            req = urllib.request.Request(url, data=body, headers={"User-Agent": "krabi-wohnen/1.0"})
            with urllib.request.urlopen(req, timeout=150) as r:
                return json.loads(r.read().decode())["elements"]
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3)
    raise RuntimeError(f"Overpass: {last}")


def _ll(e):
    return e.get("lat") or (e.get("center") or {}).get("lat"), e.get("lon") or (e.get("center") or {}).get("lon")


def build_pois(city: str):
    """Erstbefüllung der Orte einer Stadt aus OpenStreetMap."""
    c = CITIES[city]
    bb = "(%s,%s,%s,%s)" % c["bbox"]
    queries = {
        "Strand": f'nwr["natural"="beach"]{bb};',
        "Moschee": f'nwr["amenity"="place_of_worship"]["religion"="muslim"]{bb};',
        "Muay Thai": (f'nwr["sport"~"muay_thai|boxing|kickboxing|thai_boxing"]{bb};'
                      f'nwr["name"~"muay ?thai|boxing|fairtex|sityodtong|kombat|มวย",i]["amenity"!="place_of_worship"]{bb};'),
        "Einkauf": f'nwr["shop"~"^(supermarket|mall|department_store|wholesale)$"]{bb};',
        "Krankenhaus": f'nwr["amenity"="hospital"]{bb};',
    }
    part_file = os.path.join(ROOT, "scraper", f"pois-{city}.partial.json")
    out = json.load(open(part_file, encoding="utf-8")) if os.path.exists(part_file) else []
    for cat, q in queries.items():
        if any(p["cat"] == cat for p in out):
            continue   # schon geladen (Fortsetzung nach Fehler)
        els = overpass(f"[out:json][timeout:120];({q});out center tags;")
        for e in els:
            lat, lon = _ll(e)
            t = e.get("tags", {})
            name = t.get("name:en") or t.get("name") or ""
            if lat is None or (cat != "Strand" and not name and cat != "Moschee"):
                continue
            if cat == "Muay Thai" and re.search(r"hotel|resort|shop|store|restaurant|bar$", name, re.I):
                continue
            if any(p["cat"] == cat and haversine((lat, lon), (p["lat"], p["lng"])) < 0.06 for p in out):
                continue
            p = {"cat": cat, "name": name or {"Strand": "Strand (ohne Namen)", "Moschee": "Moschee (ohne Namen in OSM)"}[cat],
                 "lat": round(lat, 7), "lng": round(lon, 7), "id": f"{cat[:3].lower()}-{e['type'][0]}{e['id']}"}
            if cat == "Strand":
                p["boat"] = bool(c["boat"](lat, lon))
                if p["boat"]:
                    p["note"] = "Nur per Boot/Fähre erreichbar"
            if cat == "Moschee":
                p["note"] = "Gebetszeiten vor Ort erfragen"
            if cat == "Muay Thai":
                p["note"] = "Trainingszeiten und Preise vor Ort erfragen"
            out.append(p)
        log(f"{city}: {cat} {sum(1 for p in out if p['cat'] == cat)}")
        with open(part_file, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False)
        time.sleep(2)
    if os.path.exists(part_file):
        os.remove(part_file)
    return out


def set_city(city: str):
    global CITY, POIS, POIS_FILE
    CITY = city
    POIS_FILE = os.path.join(ROOT, "scraper", f"pois-{city}.json")
    if os.path.exists(POIS_FILE):
        POIS = json.load(open(POIS_FILE, encoding="utf-8"))
    else:
        POIS = build_pois(city)
        save_pois()


def save_pois():
    with open(POIS_FILE, "w", encoding="utf-8") as f:
        json.dump(POIS, f, ensure_ascii=False, indent=1)


def refresh_markets():
    """Neue Nacht-/Essensmärkte aus OpenStreetMap ergänzen (bestehende Einträge mit deutschen Notizen bleiben)."""
    global POIS
    bb = "(%s,%s,%s,%s)" % CITIES[CITY]["bbox"]
    q = ('[out:json][timeout:90];(nwr["amenity"="marketplace"]' + bb + ';nwr["amenity"="food_court"]' + bb + ';'
         'nwr["name"~"night market|walking street|food market|weekend market|floating market",i]' + bb + ';);out center tags;')
    try:
        els = overpass(q)
    except Exception as e:  # noqa: BLE001
        log("Markt-Abfrage fehlgeschlagen", e)
        return
    have = [p for p in POIS if p["cat"] in ("Markt", "Einkauf")]
    added = 0
    for e in els:
        t = e.get("tags", {})
        lat, lon = _ll(e)
        name = t.get("name:en") or t.get("name") or ""
        if lat is None or "minimart" in name.lower() or CITIES[CITY]["boat"](lat, lon):
            continue
        if CITY == "krabi" and lat < 8.02 and 98.83 < lon < 98.85:   # Railay – nur per Boot
            continue
        if any(haversine((lat, lon), (p["lat"], p["lng"])) < 0.08 for p in have):
            continue
        kind = "Essensmarkt" if t.get("amenity") == "food_court" else "Markt"
        note = ("Öffnungszeiten laut OSM: " + t["opening_hours"]) if t.get("opening_hours") else "Öffnungszeiten vor Ort erfragen"
        if re.search(r"night|walking", name, re.I):
            note = "Nachtmarkt · " + note
        p = {"cat": "Markt", "name": name or f"{kind} (ohne Namen in OSM)", "lat": round(lat, 7), "lng": round(lon, 7),
             "note": note, "id": f"mkt-{e['type'][0]}{e['id']}"}
        POIS.append(p); have.append(p); added += 1
    if added:
        save_pois()
    log(f"{CITY}: Märkte {added} neu")


def refresh_seven_eleven():
    """7-Eleven-Filialen aus OpenStreetMap neu laden (neue Filialen kommen dazu). Bei Fehler bleibt die alte Liste."""
    global POIS
    bb = "(%s,%s,%s,%s)" % CITIES[CITY]["bbox"]
    q = ('[out:json][timeout:90];(nwr["brand"~"7-Eleven|7-11",i]' + bb + ';nwr["name"~"7-Eleven|7-11|7 Eleven|เซเว่น",i]' + bb + ';'
         'nwr["brand:wikidata"="Q259340"]' + bb + ';);out center tags;')
    try:
        els = overpass(q)
    except Exception as e:  # noqa: BLE001
        log("7-Eleven-Abfrage fehlgeschlagen – alte Liste bleibt", e)
        return
    pts = []
    for e in els:
        lat, lon = _ll(e)
        if lat is None or any(haversine((lat, lon), (p["lat"], p["lng"])) < 0.04 for p in pts):
            continue
        t = e.get("tags", {})
        oh = t.get("opening_hours") or ""
        street = t.get("addr:street") or ""
        pts.append({"cat": "7-Eleven", "name": "7-Eleven" + (f" – {street}" if street else ""),
                    "lat": round(lat, 7), "lng": round(lon, 7),
                    "note": "24 Stunden geöffnet" if ("24/7" in oh or "00:00+" in oh) else "meist 24 Stunden geöffnet (Öffnungszeit nicht in OSM)",
                    "id": f"711-{e['type'][0]}{e['id']}"})
    old = [p for p in POIS if p["cat"] == "7-Eleven"]
    if len(pts) < max(20, int(len(old) * 0.8)):
        log(f"7-Eleven: nur {len(pts)} gefunden (vorher {len(old)}) – alte Liste bleibt")
        return
    POIS = [p for p in POIS if p["cat"] != "7-Eleven"] + pts
    save_pois()
    log(f"{CITY}: 7-Eleven {len(pts)} Filialen (vorher {len(old)})")


MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def fetch(url: str, tries: int = 3) -> str:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                raise
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2 + 3 * i)
    raise RuntimeError(f"fetch failed {url}: {last}")


def ld_blocks(page: str):
    for m in re.finditer(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', page, re.S):
        try:
            yield json.loads(m.group(1))
        except json.JSONDecodeError:
            continue


def visible_text(page: str) -> str:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "|", t))
    return re.sub(r"\s*\|[\s|]*", "|", t)


def field(vis: str, label: str) -> str | None:
    m = re.search(r"\|" + re.escape(label) + r"\|([^|]+)\|", vis)
    if not m:
        return None
    v = m.group(1).strip()
    return None if v in ("N/A", "-", "") else v


def haversine(a, b) -> float:
    r = 6371.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def parse_list(page: str):
    out = []
    for j in ld_blocks(page):
        if j.get("@type") != "ItemList":
            continue
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
            out.append({
                "url": url,
                "title": html.unescape(it.get("name") or ""),
                "lat": geo.get("latitude"), "lng": geo.get("longitude"),
                "price": price,
                "beds": about.get("numberOfBedrooms"),
            })
    return out


def parse_month_year(s: str | None):
    """'Aug 2022' / 'May 2021' / '2022' -> 'YYYY-MM' (Monat 01 wenn unbekannt)."""
    if not s:
        return None
    m = re.search(r"([A-Za-z]{3})[a-z]*\.?\s+(\d{4})", s)
    if m and m.group(1).lower() in MONTHS:
        return f"{m.group(2)}-{MONTHS[m.group(1).lower()]:02d}"
    m = re.search(r"\b(19[5-9]\d|20[0-4]\d)\b", s)
    return f"{m.group(1)}-01" if m else None


def parse_detail(page: str) -> dict:
    d: dict = {}
    for j in ld_blocks(page):
        if j.get("@type") != "RealEstateListing":
            continue
        me = j.get("mainEntity") or {}
        fs = me.get("floorSize") or {}
        d["size"] = fs.get("value")
        d["baths"] = me.get("numberOfBathroomsTotal")
        d["beds"] = me.get("numberOfBedrooms")
        geo = me.get("geo") or {}
        d["lat"], d["lng"] = geo.get("latitude"), geo.get("longitude")
        d["amenities"] = [a.get("name") for a in me.get("amenityFeature", []) if a.get("value")]
        imgs = me.get("image") or []
        # Original-URLs behalten (signiert); die App lädt sie verkleinert über den Bild-Proxy des Portals
        d["images"] = list(imgs[:6])
        d["description"] = html.unescape(me.get("description") or "")[:1500]
        try:
            d["price"] = int(float((me.get("offers") or {}).get("price")))
        except (TypeError, ValueError):
            pass
    vis = visible_text(page)
    m = re.search(r"Listing ID\|:\|(U?\d+)R?\|", vis)
    d["listing_id"] = m.group(1) if m else None
    d["type"] = field(vis, "Property Type")
    d["furniture"] = field(vis, "Furniture Status")
    d["updated"] = field(vis, "Updated At")
    d["listed"] = field(vis, "Date Listed")
    d["pets"] = field(vis, "Pets")
    # Baujahr: Satz "completed in Aug 2022" > "Year Built" > Projekt-Fertigstellung
    m = re.search(r"was completed in ([A-Za-z]{3,9}\.? \d{4})", vis)
    built = parse_month_year(m.group(1)) if m else None
    built_src = "Inserat" if built else None
    if not built:
        built = parse_month_year(field(vis, "Year Built"))
        built_src = "Baujahr-Feld" if built else None
    if not built:
        c = field(vis, "Construction")
        built = parse_month_year(c) if c and "Completed" in c else None
        built_src = "Projekt" if built else None
    d["built"], d["built_src"] = built, built_src
    # Kernsanierung: "Fully Renovated (2024)" oder Text "renovated ... 2024"
    renov = None
    for a in d.get("amenities", []) + re.findall(r"\|(Fully Renovated[^|]*)\|", vis):
        mm = re.search(r"Fully Renovated\s*\((\d{4})\)", a or "")
        if mm:
            renov = max(renov or 0, int(mm.group(1)))
    if not renov:
        mm = re.search(r"(?:fully|completely|newly|totally)\s+renovated[^.|]{0,40}?\(?(\d{2}/)?(20\d\d)", d.get("description", ""), re.I)
        if mm:
            renov = int(mm.group(2))
    d["renovated"] = renov
    av = field(vis, "Available From") or field(vis, "Availability")
    d["available"] = av
    am = " ".join(d.get("amenities", [])).lower() + " " + d.get("description", "").lower()
    if "private pool" in am or "privater pool" in am:
        d["pool"] = "privat"
    elif "communal pool" in am or "pool access" in am or "swimming pool" in am or "infinity pool" in am:
        d["pool"] = "gemeinschaft"
    else:
        d["pool"] = None
    return d


# Nur echte Gewerbeobjekte: Hotel, Hostel, Gästehaus, „Resort mit 10 Zimmern“, Hotel-/Resort-Betrieb.
# Wohnanlagen mit „Resort“ im Namen (z. B. Espana Condo Resort) und „for sale and rent“ bleiben drin.
HOTEL = re.compile(r"\bhotel\b(?! zone)|\bhostel\b|guest ?house|\b\d{2,}\s*(?:rooms|keys)\b|"
                   r"resort (?:business|for (?:rent|lease|sale))|(?:rent|lease|sale)\w* resort\b(?! ?(?:condo|style|-style))|"
                   r"business for (?:sale|lease|rent)|(?<!bed)\brooms for rent", re.I)


def keep_home(l):
    """Nur Wohnungen/Häuser zum Wohnen: Miete 3.000–300.000 ฿, höchstens 10 Schlafzimmer, keine Hotels/Betriebe."""
    p = l.get("price")
    if p and not (3000 <= p <= 300000):
        return False
    if (l.get("beds") or 0) > 10 and (not l.get("size") or l["size"] >= 300):
        return False   # ganzes Wohnhaus/Betrieb (bei kleiner Fläche ist die SZ-Zahl nur falsch gelesen)
    return not HOTEL.search(l.get("title") or "")


def c_ok(c):
    return bool(c and c.get("detail"))


def scrape_dotproperty(cache: dict, now: datetime, budget):
    items, seen = [], set()
    total = 0
    c = CITIES[CITY]
    for area, base in c["list"].items():
        n_area = None
        for p in range(1, MAX_PAGES + 1):
            q = "&".join(x for x in (c["params"], f"page={p}" if p > 1 else "") if x)
            try:
                page = fetch(base + ("?" + q if q else ""))
            except Exception as e:  # noqa: BLE001
                log(f"Liste {area} Fehler", e)
                break
            if n_area is None:
                for j in ld_blocks(page):
                    if j.get("@type") == "ItemList":
                        n_area = j.get("numberOfItems")
            rows = [r for r in parse_list(page) if r["url"] not in seen]
            log(f"Liste {area} Seite {p}: {len(rows)} Inserate (laut Portal: {n_area})")
            if not rows:
                break
            for r in rows:
                seen.add(r["url"])
                r["area"] = area
                items.append(r)
            if n_area and sum(1 for x in items if x.get("area") == area) >= n_area:
                break
            time.sleep(1.0)
        total += n_area or 0
    out = []
    for r in items:
        if r["lat"] and r["lng"] and not (c["bbox"][0] <= r["lat"] <= c["bbox"][2] and c["bbox"][1] <= r["lng"] <= c["bbox"][3]):
            continue
        cached = cache.get(r["url"])
        stale = (not cached or cached.get("price_list") != r["price"] or cached.get("title_list") != r["title"]
                 or (now - datetime.fromisoformat(cached["fetched"])).days >= REFRESH_DAYS)
        if stale and budget[0] <= 0:
            if not c_ok(cc := cache.get(r["url"])):
                continue   # Rest kommt beim nächsten Lauf (Zeitlimit)
            stale = False
        if stale:
            budget[0] -= 1
            try:
                det = parse_detail(fetch(r["url"]))
            except urllib.error.HTTPError as e:
                log("Inserat entfernt (HTTP", e.code, ")", r["url"])
                cache.pop(r["url"], None)
                continue
            except Exception as e:  # noqa: BLE001
                log("Detail-Fehler", r["url"], e)
                if not cached:
                    continue
            else:
                cached = {"detail": det, "fetched": now.isoformat(), "price_list": r["price"], "title_list": r["title"]}
                cache[r["url"]] = cached
                time.sleep(0.6)
        det = dict(cached["detail"])
        rec = {**r, **{k: v for k, v in det.items() if v not in (None, [], "")}}
        rec["price"] = r["price"] or det.get("price")
        rec["source"] = "DotProperty / FazWaz"
        rec["id"] = "dp-" + (det.get("listing_id") or re.sub(r"\W+", "", r["url"][-24:]))
        out.append(rec)
    return out, total


def scrape_aonangapartments():
    base = "https://aonangapartments.com"
    try:
        idx = fetch(base + "/apartments")
    except Exception as e:  # noqa: BLE001
        log("aonangapartments nicht erreichbar", e)
        return []
    out = []
    for path in sorted(set(re.findall(r'href="(/apartments/[^"#?]+)"', idx))):
        try:
            vis = visible_text(fetch(base + path))
        except Exception as e:  # noqa: BLE001
            log("Fehler", path, e)
            continue
        name = re.search(r"\|(Apartment [\d/]+ \w+)\|", vis)
        price = re.search(r"THB ([\d']+) / month", vis)
        size = re.search(r"Indoor [Aa]rea:?\|(\d+)", vis)
        comp = re.search(r"Completed:\|([^|]+)\|", vis)
        avail = re.search(r"\|(Available from [^|]+)\|", vis)
        beds = re.search(r"Bedroo+ms:\|(\d+)", vis)
        baths = re.search(r"Bathrooms:\|([\d.]+)", vis)
        desc = re.search(r"Ao Nang Valley\|(This [^|]+)\|", vis)
        if not (name and price):
            continue
        out.append({
            "id": "anv-" + path.rsplit("/", 1)[-1],
            "url": base + path,
            "title": f"Ao Nang Valley – {name.group(1)} (direkt vom Vermieter)",
            "price": int(price.group(1).replace("'", "")),
            "size": int(size.group(1)) if size else None,
            "beds": int(beds.group(1)) if beds else None,
            "baths": float(baths.group(1)) if baths else None,
            "built": parse_month_year(comp.group(1)) if comp else None,
            "built_src": "Vermieter" if comp else None,
            "available": avail.group(1).replace("Available from", "ab").strip() if avail else None,
            "description": desc.group(1) if desc else "",
            "type": "Haus", "furniture": "Fully Furnished", "pool": None,
            "lat": None, "lng": None, "approx": True,
            "source": "aonangapartments.com (Vermieter)",
        })
    log(f"aonangapartments: {len(out)} Einheiten")
    return out


def osrm_distances(listings):
    """Straßen-km/-Minuten von jedem Inserat zum nächsten Ort je Kategorie.

    Pro Inserat werden nur die 4 nächsten Orte (Luftlinie) per OSRM-Tabelle verglichen, damit
    Abfragen auch bei vielen Orten (z. B. 300 x 7-Eleven) klein bleiben. Ersatz: Luftlinie x 1,3.
    Strände nur, wenn ohne Boot erreichbar."""
    pts = [l for l in listings if l.get("lat") and l.get("lng")]
    cats = {}
    for p in POIS:
        if p["cat"] == "Strand" and p.get("boat"):
            continue
        cats.setdefault(p["cat"], []).append(p)
    for l in pts:
        l["dist"] = {}
    fails = 0
    for cat, dests in cats.items():
        for chunk in range(0, len(pts), 15):
            part = pts[chunk:chunk + 15]
            cand = []
            for l in part:
                near = sorted(dests, key=lambda p: haversine((l["lat"], l["lng"]), (p["lat"], p["lng"])))[:4]
                for p in near:
                    if p not in cand:
                        cand.append(p)
            data = None
            if fails < 5:
                coords = ";".join(f"{p['lng']},{p['lat']}" for p in cand) + ";" + ";".join(f"{l['lng']},{l['lat']}" for l in part)
                n = len(cand)
                src = ";".join(str(n + i) for i in range(len(part)))
                dst = ";".join(str(i) for i in range(n))
                url = f"https://router.project-osrm.org/table/v1/driving/{coords}?sources={src}&destinations={dst}&annotations=distance,duration"
                try:
                    data = json.loads(fetch(url, tries=2))
                    if data.get("code") != "Ok":
                        raise RuntimeError(data.get("code"))
                except Exception as e:  # noqa: BLE001
                    log("OSRM nicht erreichbar – Luftlinie", cat, str(e)[:120])
                    data = None
                    fails += 1     # nach 5 Fehlern nur noch Luftlinie statt langer Wartezeiten
                time.sleep(0.5)
            for i, l in enumerate(part):
                best = None
                for k, p in enumerate(cand):
                    km = mins = None
                    if data:
                        v = data["distances"][i][k]
                        tt = data["durations"][i][k]
                        km = v / 1000 if v is not None else None
                        mins = round(tt / 60) if tt is not None else None
                    road = km is not None
                    if km is None:
                        km = haversine((l["lat"], l["lng"]), (p["lat"], p["lng"])) * 1.3
                    if best is None or km < best["km"]:
                        best = {"km": km, "min": mins, "name": p["name"], "road": road}
                best["km"] = round(best["km"], 1)
                l["dist"][cat] = best


def thb_per_eur() -> dict:
    try:
        x = fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")
        rate = float(re.search(r"currency='THB' rate='([\d.]+)'", x).group(1))
        day = re.search(r"time='([\d-]+)'", x).group(1)
        return {"rate": rate, "date": day, "source": "EZB-Referenzkurs"}
    except Exception as e:  # noqa: BLE001
        log("EZB-Kurs fehlt", e)
        return {"rate": 37.24, "date": None, "source": "Fallback (EZB 23.11.2026)"}


def run_city(city: str, now: datetime, fx: dict, budget):
    set_city(city)
    out_dir = os.path.join(ROOT, "site", "data", city)
    out = os.path.join(out_dir, "listings.json")
    cache_file = os.path.join(ROOT, "scraper", f"cache-{city}.json")
    cache = json.load(open(cache_file)) if os.path.exists(cache_file) else {}
    prev = {}
    if os.path.exists(out):
        for l in json.load(open(out)).get("listings", []):
            prev[l["id"]] = l
    refresh_seven_eleven()
    refresh_markets()
    dp, total = scrape_dotproperty(cache, now, budget)
    if len(dp) < 20:
        log(f"{city}: nur {len(dp)} Inserate gefunden – alte Daten bleiben bestehen.")
        return
    import sources  # noqa: PLC0415
    me = sys.modules[__name__]
    extra = []
    for fn in (sources.bahtsold, sources.meezub):
        try:
            extra += fn(me, cache, now, budget)
        except Exception as e:  # noqa: BLE001
            log(f"{city}: Quelle {fn.__name__} fehlgeschlagen", e)
    listings = sources.dedupe(dp + (scrape_aonangapartments() if CITIES[city]["landlords"] else []) + extra)
    listings = [l for l in listings if keep_home(l)]   # Tagespreise, Hotels, ganze Wohnhäuser raus
    s_, w_, n_, e_ = CITIES[city]["bbox"]
    for l in listings:   # Kartenpunkt außerhalb des Gebiets = Fehler beim Anbieter -> nur Ortsteil (ungefähr)
        if l.get("lat") is not None and not (s_ <= l["lat"] <= n_ and w_ <= l["lng"] <= e_):
            import sources as _src  # noqa: PLC0415
            ll = _src.area_point(l.get("title"), l.get("description"), l.get("place"))
            if ll:
                l["lat"], l["lng"], l["approx"] = ll[0], ll[1], True
            else:
                l["lat"] = l["lng"] = None
    log(f"{city}: DotProperty {len(dp)}, weitere Quellen {len(extra)}, nach Zusammenfassen {len(listings)}")
    uniq = {}
    for l in listings:
        uniq.setdefault(l["id"], l)
    listings = list(uniq.values())
    for l in listings:
        old = prev.get(l["id"])
        l["first_seen"] = old.get("first_seen") if old else now.date().isoformat()
        if old and old.get("price") and l.get("price") and old["price"] != l["price"]:
            l["price_before"] = old["price"]
        elif old and old.get("price_before"):
            l["price_before"] = old["price_before"]
    osrm_distances(listings)
    removed = sorted(set(prev) - {l["id"] for l in listings})
    live = {l["url"] for l in listings} | {a["url"] for l in listings for a in l.get("also", [])}
    cache = {k: v for k, v in cache.items()
             if k in live or (now - datetime.fromisoformat(v["fetched"])).days < 14}
    c = CITIES[city]
    data = {
        "city": city, "city_name": c["name"],
        "generated": now.isoformat(timespec="minutes"),
        "portal_total": total, "portal_filter": c["params"],
        "sources": {src: sum(1 for l in listings if l.get("source", "").startswith(src)) for src in ("DotProperty", "BahtSold", "Meezub", "aonangapartments")},
        "count": len(listings),
        "removed_since_last": len(removed),
        "new_since_last": sum(1 for l in listings if l["id"] not in prev) if prev else 0,
        "fx": fx,
        "pois": POIS,
        "listings": sorted(listings, key=lambda l: (l.get("price") or 10**9)),
    }
    os.makedirs(out_dir, exist_ok=True)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out)
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    log(f"{city}: {len(listings)} Inserate, {len(removed)} entfernt, {data['new_since_last']} neu")


def main():
    now = datetime.now(timezone.utc)
    fx = thb_per_eur()
    cities = sys.argv[1:] or list(CITIES)
    # höchstens so viele Detailseiten pro Lauf (Zeitlimit der Action); Rest folgt im nächsten Lauf
    budget = [int(os.environ.get("DETAIL_BUDGET", "1500"))]
    for city in cities:
        try:
            run_city(city, now, fx, budget)
        except Exception as e:  # noqa: BLE001
            log(f"{city}: Fehler – alte Daten bleiben", e)


if __name__ == "__main__":
    main()
