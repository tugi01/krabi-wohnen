#!/usr/bin/env python3
"""Sammelt Mietinserate in Mueang Krabi (Ao Nang & Umgebung) und schreibt site/data/listings.json.

Quellen:
  * DotProperty (enthält die FazWaz-Inserate inkl. GPS, Größe, Ausstattung, Baujahr)
  * aonangapartments.com (Vermieter-Direktseite Ao Nang Valley)

Nur Python-Standardbibliothek. Lauf: python3 scraper/scrape.py
Detailseiten werden zwischengespeichert (scraper/cache.json) und nur neu geladen,
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
OUT = os.path.join(ROOT, "site", "data", "listings.json")
CACHE = os.path.join(ROOT, "scraper", "cache.json")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
LIST_URL = "https://www.dotproperty.co.th/en/properties-for-rent/krabi/mueang-krabi?page={}"
REFRESH_DAYS = 7
MAX_PAGES = 30
# Nur Inserate innerhalb dieses Radius um Ao Nang Beach (Luftlinie, km)
MAX_RADIUS_KM = 25

AO_NANG = (8.0310923, 98.8218831)
POIS = [
    {"id": "beach-aonang", "cat": "Strand", "name": "Ao Nang Beach", "lat": 8.0310923, "lng": 98.8218831},
    {"id": "beach-noppharat", "cat": "Strand", "name": "Noppharat Thara Beach", "lat": 8.0432922, "lng": 98.8087792},
    {"id": "beach-klongmuang", "cat": "Strand", "name": "Klong Muang Beach", "lat": 8.0496559, "lng": 98.7574128},
    {"id": "mosque-aonang", "cat": "Moschee", "name": "Masjid Aonang Al-Munuawarah", "lat": 8.035478, "lng": 98.8310177},
    {"id": "mosque-klonghaeng", "cat": "Moschee", "name": "Masjid Ban Khlong Haeng", "lat": 8.0498438, "lng": 98.8156873},
    {"id": "mosque-chongpli", "cat": "Moschee", "name": "Masjid Nurunyannah (Chong Pli)", "lat": 8.0744795, "lng": 98.8359274},
    {"id": "gym-emerald", "cat": "Muay Thai", "name": "Emerald Muay Thai Gym", "lat": 8.0323259, "lng": 98.8386019},
    {"id": "shop-makro", "cat": "Einkauf", "name": "Makro Ao Nang", "lat": 8.0425204, "lng": 98.8406331},
    {"id": "shop-lotus", "cat": "Einkauf", "name": "Lotus’s go fresh Ao Nang", "lat": 8.0405562, "lng": 98.8351783},
    {"id": "shop-vogue", "cat": "Einkauf", "name": "Vogue Shopping Center (Krabi-Stadt)", "lat": 8.0643716, "lng": 98.9156773},
]
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


def scrape_dotproperty(cache: dict, now: datetime):
    items, seen = [], set()
    total = None
    for p in range(1, MAX_PAGES + 1):
        page = fetch(LIST_URL.format(p))
        if total is None:
            for j in ld_blocks(page):
                if j.get("@type") == "ItemList":
                    total = j.get("numberOfItems")
        rows = [r for r in parse_list(page) if r["url"] not in seen]
        log(f"Liste Seite {p}: {len(rows)} Inserate (gesamt laut Portal: {total})")
        if not rows:
            break
        for r in rows:
            seen.add(r["url"])
            items.append(r)
        if total and len(seen) >= total:
            break
        time.sleep(1.0)
    out = []
    for r in items:
        if r["lat"] and r["lng"] and haversine(AO_NANG, (r["lat"], r["lng"])) > MAX_RADIUS_KM:
            continue
        c = cache.get(r["url"])
        stale = (not c or c.get("price_list") != r["price"] or c.get("title_list") != r["title"]
                 or (now - datetime.fromisoformat(c["fetched"])).days >= REFRESH_DAYS)
        if stale:
            try:
                det = parse_detail(fetch(r["url"]))
            except Exception as e:  # noqa: BLE001
                log("Detail-Fehler", r["url"], e)
                if not c:
                    continue
                det = c["detail"]
            else:
                c = {"detail": det, "fetched": now.isoformat(), "price_list": r["price"], "title_list": r["title"]}
                cache[r["url"]] = c
                time.sleep(0.8)
        det = dict(c["detail"])
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
    """Straßen-km von jedem Inserat zum nächsten Strand/Moschee/Gym/Einkauf (OSRM table)."""
    pts = [l for l in listings if l.get("lat") and l.get("lng")]
    groups = {}
    for i, p in enumerate(POIS):
        groups.setdefault(p["cat"], []).append(i)
    for chunk in range(0, len(pts), 80):
        part = pts[chunk:chunk + 80]
        coords = ";".join(f"{p['lng']},{p['lat']}" for p in POIS) + ";" + ";".join(
            f"{l['lng']},{l['lat']}" for l in part)
        n = len(POIS)
        src = ";".join(str(n + i) for i in range(len(part)))
        dst = ";".join(str(i) for i in range(n))
        url = f"https://router.project-osrm.org/table/v1/driving/{coords}?sources={src}&destinations={dst}&annotations=distance"
        try:
            data = json.loads(fetch(url))
        except Exception as e:  # noqa: BLE001
            log("OSRM nicht erreichbar – nur Luftlinie", e)
            data = None
        for i, l in enumerate(part):
            dist = {}
            for cat, idxs in groups.items():
                best = None
                for k in idxs:
                    km = None
                    if data and data.get("distances"):
                        v = data["distances"][i][k]
                        km = v / 1000 if v is not None else None
                    road = km is not None
                    if km is None:
                        km = haversine((l["lat"], l["lng"]), (POIS[k]["lat"], POIS[k]["lng"])) * 1.3
                    if best is None or km < best[0]:
                        best = (km, POIS[k]["name"], road)
                dist[cat] = {"km": round(best[0], 1), "name": best[1], "road": best[2]}
            l["dist"] = dist
        time.sleep(1)


def thb_per_eur() -> dict:
    try:
        x = fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")
        rate = float(re.search(r"currency='THB' rate='([\d.]+)'", x).group(1))
        day = re.search(r"time='([\d-]+)'", x).group(1)
        return {"rate": rate, "date": day, "source": "EZB-Referenzkurs"}
    except Exception as e:  # noqa: BLE001
        log("EZB-Kurs fehlt", e)
        return {"rate": 37.24, "date": None, "source": "Fallback (EZB 23.11.2026)"}


def main():
    now = datetime.now(timezone.utc)
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    prev = {}
    if os.path.exists(OUT):
        for l in json.load(open(OUT)).get("listings", []):
            prev[l["id"]] = l
    dp, total = scrape_dotproperty(cache, now)
    if len(dp) < 20:
        raise SystemExit(f"Nur {len(dp)} Inserate gefunden – Abbruch, alte Daten bleiben bestehen.")
    listings = dp + scrape_aonangapartments()
    # Duplikate (gleiches Objekt bei mehreren Quellen) – nach Listing-ID
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
    # Cache aufräumen: nur aktuelle URLs behalten
    live = {l["url"] for l in listings}
    cache = {k: v for k, v in cache.items() if k in live}
    data = {
        "generated": now.isoformat(timespec="minutes"),
        "portal_total": total,
        "count": len(listings),
        "removed_since_last": len(removed),
        "fx": thb_per_eur(),
        "pois": POIS,
        "listings": sorted(listings, key=lambda l: (l.get("price") or 10**9)),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)
    log(f"Fertig: {len(listings)} Inserate, {len(removed)} entfernt, {sum(1 for l in listings if l['first_seen']==now.date().isoformat() and prev)} neu")


if __name__ == "__main__":
    main()
