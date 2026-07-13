# Data contract

## Source precedence

1. `D:\typhoon boss radar\台风实时演进分析.md`: half-hour maintained synthesis and 34 representative-city 10 m wind rows.
2. `http://127.0.0.1:3038/api/storms/current`: no-cache active-storm observation, wind radii, and agency forecast tracks.
3. `http://127.0.0.1:3038/api/city-status?province=...`: product impact zone derived from storm-center distance and wind radii.
4. Zhejiang Water Resources public route API: upstream storm observation and forecast source.
5. MET Norway Locationforecast 2.0: representative-city 10 m model wind source.
6. OpenStreetMap Nominatim: coordinate lookup for a specifically named Chinese city or county that is not one of the 34 maintained representative cities.

## Meanings

- `storm.latest`: published storm-center observation, not the viewer's local wind.
- `cityWind`: representative-coordinate 10 m model wind. Always include city, speed, Beaufort level, direction, and model time.
- A province-only wind question uses that province's maintained representative-city row (for example 福建→福州, 安徽→合肥). Do not send the bare province name to a public geocoder.
- `defense`: product classification. Never call it an official meteorological warning.
- `forecast`: agency forecast track. Never say a forecast has already happened.
- `landfall.confirmed=false`: no confirmed landfall record exists in the queried source.
- `document.stale=true`: the half-hour document is older than 75 minutes; warn that city-wind values may be delayed.

## Public attribution

- Typhoon position, intensity, pressure, wind radii, and forecast track: 浙江省水利厅台风路径公开接口.
- Representative-city current wind: MET Norway Locationforecast 2.0 global forecast/model field.
- Other named-city current wind: OpenStreetMap Nominatim resolves the coordinate, then MET Norway supplies the same 10 m model-wind field.
- Official warnings and emergency decisions: defer to the local meteorological observatory and emergency authority.
