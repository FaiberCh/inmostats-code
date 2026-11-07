import json
from pathlib import Path

from src.pipelines.clean_data import _normalize_key, normalize_department

REFERENCE_DIR = Path(__file__).resolve().parents[2] / "data" / "reference"
DEPARTMENTS_GEOJSON_PATH = REFERENCE_DIR / "colombia_departamentos.geojson"
MUNICIPIOS_GEOJSON_PATH = REFERENCE_DIR / "colombia_municipios.geojson"

GEOBOUNDARIES_DEPARTMENT_OVERRIDES = {
    _normalize_key("Bogota Capital District"): "Bogotá D.C.",
    _normalize_key("Archipielago de San Andres, Providencia y Santa Catalina"): "San Andrés y Providencia",
}

CITY_NAME_OVERRIDES = {
    _normalize_key("Bogotá"): _normalize_key("Bogotá, D.c."),
    _normalize_key("Cartagena"): _normalize_key("Cartagena De Indias"),
    _normalize_key("El Retiro"): _normalize_key("Retiro"),
    _normalize_key("Barranquilla"): _normalize_key("Distrito Especial, Industrial Y Portuario De Barr*"),
}


def load_department_geojson() -> dict:
    with open(DEPARTMENTS_GEOJSON_PATH, encoding="utf-8") as f:
        geojson = json.load(f)
    for feature in geojson["features"]:
        shape_name = feature["properties"]["shapeName"]
        key = _normalize_key(shape_name)
        feature["properties"]["department_final"] = GEOBOUNDARIES_DEPARTMENT_OVERRIDES.get(
            key, normalize_department(shape_name)
        )
    return geojson


def _flatten_coords(geometry):
    coords = []

    def _walk(c):
        if isinstance(c[0], (int, float)):
            coords.append(c)
        else:
            for sub in c:
                _walk(sub)

    _walk(geometry["coordinates"])
    return coords


def _polygon_centroid(geometry):
    pts = _flatten_coords(geometry)
    return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)


def match_city_features(city_stats):
    with open(MUNICIPIOS_GEOJSON_PATH, encoding="utf-8") as f:
        muni_geojson = json.load(f)

    features_by_key = {}
    for feat in muni_geojson["features"]:
        features_by_key.setdefault(_normalize_key(feat["properties"]["shapeName"]), []).append(feat)

    matched_features, unmatched_cities = [], []
    for city, row in city_stats.iterrows():
        key = CITY_NAME_OVERRIDES.get(_normalize_key(city), _normalize_key(city))
        candidates = features_by_key.get(key)
        if not candidates:
            unmatched_cities.append(city)
            continue
        if len(candidates) > 1:
            best = min(
                candidates,
                key=lambda f: (
                    (_polygon_centroid(f["geometry"])[0] - row["lat_mediana"]) ** 2
                    + (_polygon_centroid(f["geometry"])[1] - row["lon_mediana"]) ** 2
                ),
            )
        else:
            best = candidates[0]
        feat_copy = json.loads(json.dumps(best))
        feat_copy["properties"]["city_matched"] = city
        matched_features.append(feat_copy)

    city_geojson = {"type": "FeatureCollection", "features": matched_features}
    matched_city_names = [f["properties"]["city_matched"] for f in matched_features]
    return city_geojson, matched_city_names, unmatched_cities
