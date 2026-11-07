from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "sample"
SEED = 20260601
N_LISTINGS = 4200

PLACES = [
    ("Bogotá D.C.", "Bogotá", 4.65, -74.07, 7.0, ["Barrio Norte", "Barrio Centro", "Barrio Occidente", "Barrio Sur", "Barrio Colinas"]),
    ("Antioquia", "Medellín", 6.24, -75.58, 7.4, ["Loma Alta", "Parque Sur", "Cerro Verde", "Valle Bajo", "Ladera"]),
    ("Antioquia", "Envigado", 6.17, -75.59, 7.8, ["Alto Claro", "Rio Medio", "Mirador Este"]),
    ("Antioquia", "Sabaneta", 6.15, -75.62, 6.6, ["Plaza Mayor", "Villa Nueva"]),
    ("Valle del Cauca", "Cali", 3.45, -76.53, 4.4, ["Sol Naciente", "Rio Claro", "Jardin Alto", "Cerro Bello"]),
    ("Atlántico", "Barranquilla", 10.96, -74.80, 4.5, ["Bahia Norte", "Costa Brava", "Villa Mar"]),
    ("Bolívar", "Cartagena", 10.39, -75.48, 8.0, ["Playa Blanca", "Muralla Sur", "Isla Verde"]),
    ("Santander", "Bucaramanga", 7.12, -73.12, 4.6, ["Cumbre", "Mesa Alta", "Pinares"]),
    ("Risaralda", "Pereira", 4.81, -75.69, 5.1, ["Cafetal", "Lago Sur", "Bosque Alto"]),
    ("Caldas", "Manizales", 5.07, -75.52, 5.4, ["Nevado", "Colina Verde"]),
]
AMENITIES = [
    "Ascensor", "Balcón", "Gimnasio", "Zona de lavandería", "Piscina", "Portería / Recepción", "Salón Comunal",
    "Parqueadero visitantes", "Zona BBQ", "Conjunto cerrado", "Cocina integral", "Vigilancia",
]
FIRST_NAMES = ["Carlos", "Laura", "Andres", "Marta", "Julian", "Diana", "Mario", "Sandra", "Pablo", "Luisa"]
OWNER_KINDS = [
    ("inmobiliaria", "Inmobiliaria Muestra {n}", 0.45),
    ("desarrollador", "Constructora Muestra {n}", 0.12),
    ("inmobiliaria", "{first} Prueba", 0.25),
    ("sin especificar", "{first} Prueba", 0.18),
]
RUNS = [datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc), datetime(2026, 7, 15, 10, 0, tzinfo=timezone.utc),
        datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)]
STRATUM_FACTOR = {1: 0.55, 2: 0.68, 3: 0.82, 4: 1.0, 5: 1.3, 6: 1.75}


def build_listings(rng: np.random.Generator) -> pd.DataFrame:
    rows = []
    weights = np.array([2.6, 2.2, 0.6, 0.5, 1.6, 1.2, 0.9, 0.8, 0.7, 0.5])
    weights = weights / weights.sum()
    owner_p = np.array([k[2] for k in OWNER_KINDS])
    for i in range(N_LISTINGS):
        dept, city, lat, lon, ppm2, hoods = PLACES[rng.choice(len(PLACES), p=weights)]
        stratum = int(rng.choice([1, 2, 3, 4, 5, 6], p=[0.02, 0.1, 0.3, 0.3, 0.18, 0.1]))
        area = float(np.clip(rng.lognormal(np.log(72), 0.38), 28, 420))
        beds = int(np.clip(round(area / 28 + rng.normal(0, 0.6)), 1, 6))
        baths = int(np.clip(round(beds * 0.8 + rng.normal(0, 0.5)), 1, 6))
        garages = int(rng.choice([0, 1, 2, 3], p=[0.2, 0.5, 0.25, 0.05]))
        n_amen = int(rng.integers(0, 7))
        amenities = "; ".join(rng.choice(AMENITIES, size=n_amen, replace=False)) if n_amen else None
        new_project = bool(rng.random() < 0.12)
        antiquity = 0 if new_project else int(rng.choice([1, 2, 3, 4, 5], p=[0.25, 0.25, 0.2, 0.2, 0.1]))
        price_m2 = ppm2 * 1e6 * STRATUM_FACTOR[stratum] * rng.lognormal(0, 0.18)
        price_m2 *= 1 + 0.04 * garages + (0.06 if new_project else 0) + 0.015 * min(n_amen, 6)
        price = int(round(price_m2 * area, -6))
        kind, template, _ = OWNER_KINDS[rng.choice(len(OWNER_KINDS), p=owner_p / owner_p.sum())]
        owner_name = template.format(n=int(rng.integers(1, 40)), first=FIRST_NAMES[int(rng.integers(0, len(FIRST_NAMES)))])
        rows.append({
            "listing_id": 900_000_000 + i,
            "title": f"Apartamento en venta en {city}",
            "description": "Anuncio sintetico de muestra generado por scripts/make_sample_data.py.",
            "address": None,
            "department_slug": city.lower(),
            "department": dept,
            "department_real": dept,
            "city": city,
            "neighborhood": hoods[int(rng.integers(0, len(hoods)))],
            "locality": None,
            "zone": None,
            "latitude": round(lat + rng.normal(0, 0.03), 5),
            "longitude": round(lon + rng.normal(0, 0.03), 5),
            "price_cop": price,
            "admin_fee_cop": int(round(area * rng.uniform(2500, 6000), -3)),
            "bedrooms": beds,
            "bathrooms": baths,
            "area_m2": round(area, 1),
            "area_built_m2": round(area * rng.uniform(1.0, 1.08), 1),
            "stratum": stratum,
            "floor": int(rng.integers(1, 20)),
            "floors_count": int(rng.integers(5, 25)),
            "antiquity": antiquity,
            "construction_year": None,
            "garages": garages,
            "amenities": amenities,
            "is_new_project": new_project,
            "owner_type": kind,
            "owner_name": owner_name,
            "image_count": int(rng.integers(3, 25)),
            "listing_created_at": (RUNS[0] - timedelta(days=int(rng.integers(1, 200)))).date().isoformat(),
            "listing_updated_at": (RUNS[0] - timedelta(days=int(rng.integers(0, 30)))).date().isoformat(),
            "source_page": int(rng.integers(1, 300)),
        })
    return pd.DataFrame(rows)


def main() -> None:
    rng = np.random.default_rng(SEED)
    base = build_listings(rng)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("listings_*.csv"):
        old.unlink()
    price = base["price_cop"].astype(float).copy()
    for n, started in enumerate(RUNS):
        seen = rng.random(len(base)) < 0.85
        if n > 0:
            changed = rng.random(len(base)) < 0.05
            price = price.where(~changed, (price * rng.uniform(0.92, 1.06, len(base))).round(-6))
        part = base[seen].copy()
        part["price_cop"] = price[seen].astype("int64")
        part["captured_at"] = [(started + timedelta(seconds=int(s))).isoformat() for s in rng.integers(0, 3600, len(part))]
        part["run_started_at"] = started.isoformat()
        tag = started.strftime("run%Y%m%dT%H%M%S")
        path = OUT_DIR / f"listings_colombia_{tag}_{started.strftime('%Y%m%d_%H%M%S')}.csv"
        part.to_csv(path, index=False, encoding="utf-8")
        print(f"{path.name}: {len(part)} anuncios")


if __name__ == "__main__":
    main()
