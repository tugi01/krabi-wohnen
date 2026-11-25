# Thailand Wohnen – Datenvertrag (ganz Thailand)

Stand 24.11.2026. Gilt für Crawler (`scraper/th_crawl.py`), Orte (`scraper/th_pois.py`),
Detail-Dienst (Cloudflare Worker) und App (`site/app.js`).

## Quellen
* DotProperty Listenseiten `https://www.dotproperty.co.th/en/properties-for-rent/<provinz>?page=N`
  (JSON-LD ItemList, 30 pro Seite; robots.txt erlaubt). 74 Provinzen, ~206.100 Inserate.
* Fläche/Baujahr per Portal-Filter in Stufen (`minLivingArea`/`maxLivingArea`, `minYearBuilt`/`maxYearBuilt`).
* Krabi und Pattaya: bestehende Detaildaten (`site/data/<stadt>/listings.json`, BahtSold, Meezub) werden übernommen.

## Veröffentlichte Dateien (GitHub Pages, NICHT im git-Repo)
```
site/data/th/index.json        Übersicht
site/data/th/t/<tileId>.json   Kachel mit Inseraten (+ Orte der Kachel)
site/data/th/pois/<cellId>.json  Orte (siehe unten)
site/data/th/state.json.gz     Crawler-Zustand (Größen-/Baujahr-Stufen, first_seen) für den nächsten Lauf
```

### index.json
```json
{"generated":"2026-11-24T23:10+00:00","fx":{"rate":37.2,"date":"2026-11-24","source":"EZB-Referenzkurs"},
 "count":206102,
 "sources":{"DotProperty":206000,"BahtSold":920,"Meezub":388},
 "provinces":[{"key":"chonburi","name":"Chonburi","n":19971,"lat":13.2,"lng":101.1}],
 "tiles":[{"id":"q0123","b":[s,w,n,e],"n":1432}]}
```
Kacheln: Quadtree über Thailand-Bounding-Box (5.5,97.3)–(20.5,105.7). Eine Kachel wird geteilt,
solange sie mehr als 1500 Inserate enthält. id = "q" + Ziffern 0–3 (0=SW,1=SE,2=NW,3=NE).
Inserate ohne Koordinaten bekommen den Provinz-Mittelpunkt und `approx:1`.

### t/<tileId>.json
```json
{"id":"q0123","listings":[ L, ... ]}
```
L (kompakt, fehlende Felder weglassen):
| Feld | Bedeutung |
|---|---|
| id | "dp-<hash>" / "bs-<id>" / "mz-<id>" |
| url | Inserat |
| title | Titel |
| price | Monatsmiete THB |
| lat,lng | Lage |
| approx | 1 = nur ungefähr |
| beds | Schlafzimmer |
| size | genaue m² (wenn bekannt) |
| sz | [min,max] m²-Stufe, z. B. [50,64]; max 9999 = offen |
| built | "YYYY-MM" genau (wenn bekannt) |
| by | [min,max] Baujahr-Stufe, z. B. [2021,2026] |
| img | Titelfoto-URL |
| posted | "YYYY-MM-DD" |
| src | "DotProperty" / "BahtSold" / "Meezub" / "aonangapartments" |
| prov | Provinz-Schlüssel |
| pool | "privat" / "gemeinschaft" (aus Details oder Titel) |
| full | 1 = vollständige Detaildaten vorhanden (Krabi/Pattaya) |
| d | nächste Orte: {"Moschee":[km, "Name", lat, lng], ...} Luftlinie×1,3 |
| first | erstmals gesehen "YYYY-MM-DD" |

### Orte: pois/<cellId>.json
Raster 1°×1° (cellId = "<floor(lat)>_<floor(lng)>", z. B. "12_100").
```json
{"cell":"12_100","pois":[{"cat":"Moschee","name":"…","lat":12.9,"lng":100.9,"note":"…"}]}
```
Kategorien wie bisher: Strand, Moschee, Muay Thai, Einkauf, Krankenhaus, 7-Eleven, Markt.
Strand mit `boat:true` = nur per Boot/Fähre (Inselstrände ohne Straßenverbindung).

## Detail-Dienst (Cloudflare Worker)
`GET https://krabi-wohnen-img.tugrulc.workers.dev/detail?u=<DotProperty-Inserat-URL>` →
```json
{"ok":true,"size":65,"built":"2021-08","built_src":"Projekt","pool":"privat","furniture":"Fully Furnished",
 "images":["…"],"description":"…","available":"…","pets":"…","updated":"…","amenities":["…"]}
```
Nur URLs `https://www.dotproperty.co.th/en/ads/…`; 7 Tage Cache; CORS `*`; 404 beim Portal → `{"ok":false,"gone":true}`.
