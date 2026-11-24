"""Zusätzliche, öffentlich lesbare Quellen (ohne Anmeldung, robots.txt erlaubt).

  * BahtSold   (bahtsold.com)  – Kleinanzeigen, viele private Ausländer/Eigentümer – nur Pattaya
  * Meezub     (meezub.com)    – thailändische Kleinanzeigen, viele Eigentümer      – Pattaya & Krabi

Jede Funktion liefert Datensätze im selben Format wie scrape.py (DotProperty).
Detailseiten werden über denselben Cache wie DotProperty geführt und nur für neue/geänderte
Inserate geladen (Budget gilt gemeinsam).
"""
from __future__ import annotations

import html
import json
import re
import time
import urllib.error
import urllib.parse
from datetime import datetime

# Ortsteil-Mittelpunkte für Inserate ohne Kartenpunkt (Lage dann „ungefähr“)
AREAS = {
    # Pattaya
    "jomtien": (12.8940, 100.8730), "pratamnak": (12.9170, 100.8640), "pratumnak": (12.9170, 100.8640),
    "thappraya": (12.9100, 100.8780), "thepprasit": (12.9150, 100.8900), "naklua": (12.9650, 100.8930),
    "na kluea": (12.9650, 100.8930), "na-kluea": (12.9650, 100.8930), "wongamat": (12.9700, 100.8870),
    "central pattaya": (12.9330, 100.8830), "south pattaya": (12.9230, 100.8780), "north pattaya": (12.9500, 100.8880),
    "east pattaya": (12.9300, 100.9300), "nong prue": (12.9200, 100.9200), "nong-prue": (12.9200, 100.9200),
    "huay yai": (12.8300, 100.9700), "huai yai": (12.8300, 100.9700), "na jomtien": (12.8250, 100.9100),
    "bang saray": (12.7600, 100.9100), "nong pla lai": (12.9400, 100.9600), "nong-pla-lai": (12.9400, 100.9600),
    "bang lamung": (13.0450, 100.9250), "sattahip": (12.6650, 100.9000), "si racha": (13.1650, 100.9300),
    "sriracha": (13.1650, 100.9300), "si-racha": (13.1650, 100.9300), "ban chang": (12.7250, 101.0600),
    "ban-chang": (12.7250, 101.0600), "bang saen": (13.2800, 100.9150), "laem chabang": (13.0800, 100.9000), "bang-lamung": (13.0450, 100.9250), "pattaya": (12.9330, 100.8830),
    # Krabi
    "ao nang": (8.0400, 98.8300), "ao-nang": (8.0400, 98.8300), "nong thale": (8.0850, 98.7950),
    "nong-thale": (8.0850, 98.7950), "sai thai": (8.0880, 98.8650), "sai-thai": (8.0880, 98.8650),
    "krabi noi": (8.0700, 98.8700), "krabi-noi": (8.0700, 98.8700), "pak nam": (8.0600, 98.9150),
    "pak-nam": (8.0600, 98.9150), "krabi yai": (8.0900, 98.9100), "krabi-yai": (8.0900, 98.9100),
    "khlong prasong": (8.0300, 98.9200), "khlong-prasong": (8.0300, 98.9200),
    "ao nam mao": (8.0300, 98.8700), "klong muang": (8.0500, 98.7600), "tub kaek": (8.0900, 98.7470),
}
THAI_AREAS = {"บางละมุง": "bang lamung", "นาเกลือ": "naklua", "หนองปรือ": "nong prue", "หนองปลาไหล": "nong pla lai",
              "ห้วยใหญ่": "huai yai", "จอมเทียน": "jomtien", "พัทยา": "pattaya", "อ่าวนาง": "ao nang",
              "หนองทะเล": "nong thale", "ไสไทย": "sai thai", "กระบี่น้อย": "krabi noi", "ปากน้ำ": "pak nam",
              "กระบี่ใหญ่": "krabi yai", "คลองประสงค์": "khlong prasong",
              "สัตหีบ": "sattahip", "ศรีราชา": "si racha", "บ้านฉาง": "ban chang", "บางเสร่": "bang saray",
              "นาจอมเทียน": "na jomtien", "แหลมฉบัง": "laem chabang"}


def area_point(*texts):
    blob = " ".join(t or "" for t in texts)
    for th, key in THAI_AREAS.items():
        if th in blob:
            blob += " " + key
    low = blob.lower()
    best = None
    for k, ll in AREAS.items():   # längster Treffer gewinnt (z. B. "na jomtien" vor "jomtien")
        if k in low and (best is None or len(k) > len(best[0])):
            best = (k, ll)
    return best[1] if best else None


def _cache_get(S, cache, key, now, price_key):
    c = cache.get(key)
    if c and c.get("price_list") == price_key and (now - datetime.fromisoformat(c["fetched"])).days < S.REFRESH_DAYS:
        return c["detail"], False
    return (c["detail"] if c else None), True


def _share(budget):
    """Jede Zusatzquelle darf höchstens ein Drittel des Rest-Kontingents nutzen,
    damit keine Quelle die anderen verdrängt (Rest kommt im nächsten Lauf)."""
    return [max(0, budget[0] // 3)]


def plausible_rent(d, title=""):
    """Monatsmiete 3.000–300.000 ฿; Verkaufsanzeigen raus. Fehlgelesene Preise aus dem Titel retten."""
    if re.search(r"\bfor sale\b|\bsale\b(?!.*rent)|ขาย(?!.*เช่า)", title or "", re.I):
        return False
    p = d.get("price") or 0
    if p < 3000:
        m = re.search(r"(\d{1,3}(?:[,.]\d{3})+|\d{4,6})\s*(?:baht|thb|฿|bht)", (title or "") + " " + (d.get("description") or ""), re.I)
        if m:
            d["price"] = p = int(re.sub(r"[,.]", "", m.group(1)))
    return 3000 <= p <= 300000


def _cache_put(cache, key, det, now, price_key):
    cache[key] = {"detail": det, "fetched": now.isoformat(), "price_list": price_key, "title_list": ""}


# ------------------------------------------------------------------ BahtSold
def bahtsold(S, cache, now, budget):
    if S.CITY != "pattaya":
        return []
    urls = []
    for cat in ("condo-apartment-for-rent-175", "house-for-rent-177"):
        for p in range(1, 80):
            try:
                page = S.fetch(f"https://www.bahtsold.com/category/{cat}?area_id=11&sort=newest&page={p}")
            except Exception as e:  # noqa: BLE001
                S.log("BahtSold Liste Fehler", e)
                break
            found = [u for u in dict.fromkeys(re.findall(r'href="(/view/[a-z0-9-]+-\d+)"', page)) if u not in urls]
            if not found:
                break
            urls += found
            time.sleep(0.8)
    S.log(f"BahtSold: {len(urls)} Inserate in der Liste")
    mine = _share(budget)
    out = []
    for u in urls:
        url = "https://www.bahtsold.com" + u
        det, stale = _cache_get(S, cache, url, now, "bs")
        if stale and budget[0] > 0 and mine[0] > 0:
            budget[0] -= 1
            mine[0] -= 1
            try:
                det = parse_bahtsold(S.fetch(url))
                _cache_put(cache, url, det, now, "bs")
                time.sleep(0.8)
            except urllib.error.HTTPError:
                cache.pop(url, None)
                continue
            except Exception as e:  # noqa: BLE001
                S.log("BahtSold Detail-Fehler", url, e)
        if not det or not plausible_rent(det, det.get("title")):
            continue
        rec = {k: v for k, v in det.items() if v not in (None, [], "")}
        rec.update({"url": url, "id": "bs-" + u.rsplit("-", 1)[-1], "source": "BahtSold"})
        out.append(rec)
    return out


def parse_bahtsold(page: str) -> dict:
    h = page.replace('\\\\\\"', '"').replace('\\"', '"')
    vis = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    vis = html.unescape(re.sub(r"<[^>]+>", "|", vis))
    vis = re.sub(r"\s*\|[\s|]*", "|", vis)
    d: dict = {}
    m = re.search(r'"offers":\{"@type":"Offer","price":(\d+)', h)
    d["price"] = int(m.group(1)) if m else None
    t = re.search(r'og:title" content="([^"]+)', page)
    parts = html.unescape(t.group(1)).split(" | ") if t else []
    d["title"] = parts[0] if parts else ""
    area = parts[2] if len(parts) > 3 else ""
    desc = re.search(r"\|Property Description\|(.*?)\|(?:[^|]+\|(?:Dealer|Owner|Private))", vis, re.S)
    d["description"] = (desc.group(1).strip() if desc else "")[:1500]
    blob = d["title"] + " " + d["description"]
    m = re.search(r"(\d{2,4}(?:\.\d+)?)\s?(?:sqm|sq\.?\s?m|m2|m²)", blob, re.I)
    d["size"] = float(m.group(1)) if m else None
    m = re.search(r"(\d)\s*(?:bed(?:room)?s?|br\b|schlafzimmer)", blob, re.I)
    d["beds"] = int(m.group(1)) if m else (0 if re.search(r"studio", blob, re.I) else None)
    m = re.search(r"(\d)\s*bath", blob, re.I)
    d["baths"] = int(m.group(1)) if m else None
    feats = re.search(r'"features":\[([^\]]*)\]', h)
    fl = re.findall(r'"([^"]+)"', feats.group(1)) if feats else []
    d["amenities"] = fl
    low = " ".join(fl).lower() + " " + blob.lower()
    d["pool"] = "privat" if "private pool" in low or "pool villa" in low else ("gemeinschaft" if "pool" in low else None)
    d["furniture"] = "Fully Furnished" if re.search(r"fully furnished", vis, re.I) else (
        "Partly Furnished" if re.search(r"partly furnished|semi.furnished", vis, re.I) else None)
    m = re.search(r"maps\?q=(-?\d+\.\d+),(-?\d+\.\d+)", page)
    if m:
        d["lat"], d["lng"] = float(m.group(1)), float(m.group(2))
    else:
        ll = area_point(area, d["title"])
        if ll:
            d["lat"], d["lng"], d["approx"] = ll[0], ll[1], True
    d["seller"] = "Eigentümer" if re.search(r"\|(?:Owner|Private)\|", vis) else ("Makler" if "|Dealer|" in vis else None)
    imgs = re.findall(r'https://images\.bahtsold\.com/[^"\\\s]+?\.(?:jpe?g|png|webp)', h)
    d["images"] = list(dict.fromkeys(imgs))[:6]
    m = re.search(r"built in (20\d\d)|completed in (20\d\d)|new (?:project|building)[^.]{0,20}(20\d\d)", blob, re.I)
    y = next((g for g in (m.groups() if m else []) if g), None)
    d["built"], d["built_src"] = (f"{y}-01", "Inserat-Text") if y else (None, None)
    d["type"] = "Haus" if re.search(r"house|villa", d["title"], re.I) else "Condo/Apartment"
    return d


# ------------------------------------------------------------------ Meezub
MEEZUB_LISTS = {
    "pattaya": ["condos-for-rent/chon-buri/bang-lamung", "houses-for-rent/chon-buri/bang-lamung",
                "apartments-for-rent/chon-buri/bang-lamung",
                "condos-for-rent/chon-buri/sattahip", "houses-for-rent/chon-buri/sattahip",
                "condos-for-rent/chon-buri/si-racha", "houses-for-rent/chon-buri/si-racha",
                "houses-for-rent/rayong/ban-chang"],
    "krabi": ["houses-for-rent/krabi", "condos-for-rent/krabi", "townhouses-for-rent/krabi"],
}
MEEZUB_TYPE = {"condo": "Condo", "house": "Haus", "house-rent": "Haus", "townhouse": "Reihenhaus", "apartment": "Apartment"}


def meezub(S, cache, now, budget):
    items = []
    for path in MEEZUB_LISTS.get(S.CITY, []):
        for p in range(1, 40):
            url = f"https://www.meezub.com/{path}/" + (f"pg-{p}/" if p > 1 else "")
            try:
                page = S.fetch(url)
            except Exception:  # noqa: BLE001
                break
            new = 0
            for j in S.ld_blocks(page):
                if j.get("@type") != "ItemList":
                    continue
                for el in j.get("itemListElement", []):
                    it = el.get("item") or {}
                    if it.get("url") and all(x["url"] != it["url"] for x in items):
                        g = it.get("geo") or {}
                        items.append({"url": it["url"], "name": it.get("name") or "", "lat": g.get("latitude"),
                                      "lng": g.get("longitude"), "image": it.get("image")})
                        new += 1
            if not new:
                break
            time.sleep(0.8)
    S.log(f"Meezub: {len(items)} Inserate in der Liste ({S.CITY})")
    mine = _share(budget)
    out = []
    for it in items:
        url = it["url"]
        det, stale = _cache_get(S, cache, url, now, "mz")
        if stale and budget[0] > 0 and mine[0] > 0:
            budget[0] -= 1
            mine[0] -= 1
            try:
                det = parse_meezub(S.fetch(urllib.parse.quote(url, safe=":/?=&%")))
                _cache_put(cache, url, det, now, "mz")
                time.sleep(0.8)
            except urllib.error.HTTPError:
                cache.pop(url, None)
                continue
            except Exception as e:  # noqa: BLE001
                S.log("Meezub Detail-Fehler", url, e)
        if not det or not plausible_rent(det, it["name"]):
            continue          # reine Verkaufsanzeige, unplausibler Preis oder noch nicht geladen
        rec = {k: v for k, v in det.items() if v not in (None, [], "")}
        if it.get("lat") and it.get("lng"):
            rec["lat"], rec["lng"] = it["lat"], it["lng"]
            rec.pop("approx", None)
        kind = MEEZUB_TYPE.get(url.rstrip("/").split("/")[-2], "Wohnung")
        bits = [kind, f"{rec['beds']} SZ" if rec.get("beds") is not None else None,
                f"{rec['size']:g} m²" if rec.get("size") else None, rec.get("place")]
        rec["title"] = " · ".join(b for b in bits if b) + (" (Eigentümer)" if rec.get("seller") == "Eigentümer" else "")
        rec.update({"url": url, "id": "mz-" + url.rstrip("/").split("/")[-1], "source": "Meezub", "type": kind,
                    "title_th": it["name"]})
        out.append(rec)
    return out


def parse_meezub(page: str) -> dict:
    vis = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    vis = html.unescape(re.sub(r"<[^>]+>", "|", vis))
    vis = re.sub(r"\s*\|[\s|]*", "|", vis)
    d: dict = {}
    m = re.search(r"\|ราคาให้เช่า\|([\d,]+) บาท/เดือน", vis)
    d["price"] = int(m.group(1).replace(",", "")) if m else None
    m = re.search(r"พื้นที่ใช้สอย\s*([\d.,]+)\s*ตร\.ม", vis)
    d["size"] = float(m.group(1).replace(",", "")) if m else None
    m = re.search(r"(\d+)\s*ห้องนอน", vis)
    d["beds"] = int(m.group(1)) if m else None
    m = re.search(r"(\d+)\s*ห้องน้ำ", vis)
    d["baths"] = int(m.group(1)) if m else None
    loc = re.search(r"\|สถานที่ตั้ง\|([^|]+)\|", vis)
    place = loc.group(1).strip() if loc else ""
    ll = area_point(place)
    key = None
    if ll:
        for th, k in THAI_AREAS.items():
            if th in place:
                key = k
        d["lat"], d["lng"], d["approx"] = ll[0], ll[1], True
    d["place"] = (key or "").title() or None
    desc = re.search(r"\|รายละเอียด\|(.*?)\|การติดต่อ\|", vis, re.S)
    d["description"] = (desc.group(1).replace("|", "\n").strip() if desc else "")[:1500]
    feats = re.search(r"\|ลักษณะเด่น\|(.*?)\|รายละเอียด\|", vis, re.S)
    fl = feats.group(1).split("|") if feats else []
    blob = " ".join(fl) + " " + d["description"]
    d["pool"] = "privat" if re.search(r"สระว่ายน้ำส่วนตัว|private pool|pool villa|พูลวิลล่า", blob, re.I) else (
        "gemeinschaft" if re.search(r"สระว่ายน้ำ|pool", blob, re.I) else None)
    d["seller"] = "Eigentümer" if "เจ้าของขายเอง" in blob or "เจ้าของให้เช่าเอง" in blob else None
    d["furniture"] = "Fully Furnished" if re.search(r"เฟอร์นิเจอร์ครบ|fully furnished", blob, re.I) else None
    imgs = re.findall(r"https://f\.meezub\.com/media/property/(?:photos|thbs)/[^\"' )]+\.(?:jpe?g|png|webp)", page)
    d["images"] = list(dict.fromkeys(i.replace("/thbs/", "/photos/") for i in imgs))[:6]
    m = re.search(r"(?:สร้างเสร็จ|ปีที่สร้าง|built in|completed in)\s*(?:ปี\s*)?(20\d\d|25\d\d)", blob, re.I)
    if m:
        y = int(m.group(1))
        y = y - 543 if y > 2400 else y          # buddhistisches Jahr
        d["built"], d["built_src"] = f"{y}-01", "Inserat-Text"
    upd = re.search(r"\|อัพเดทล่าสุด:\|?([^|]+)\|", vis)
    d["updated"] = upd.group(1).strip() if upd and re.search(r"\d", upd.group(1)) else None
    return d


# ------------------------------------------------------------------ Doppelte Inserate
def src_of(l):
    return (l.get("source") or "").split()[0]


def dedupe(listings):
    """Gleiche Wohnung bei VERSCHIEDENEN Quellen: gleicher Preis, Fläche ±3 m², < 400 m entfernt → nur einmal behalten
    (DotProperty zuerst, weil dort Baujahr und genaue Lage stehen)."""
    from scrape import haversine  # noqa: PLC0415
    keep = []
    for l in listings:
        dup = None
        for k in keep:
            if (src_of(k) != src_of(l) and l.get("price") and k.get("price") == l.get("price") and l.get("size") and k.get("size")
                    and abs(float(k["size"]) - float(l["size"])) <= 3 and l.get("lat") and k.get("lat")
                    and haversine((k["lat"], k["lng"]), (l["lat"], l["lng"])) < (2.0 if l.get("approx") or k.get("approx") else 0.4)):
                dup = k
                break
        if dup:
            dup.setdefault("also", []).append({"source": l.get("source"), "url": l.get("url")})
        else:
            keep.append(l)
    return keep
