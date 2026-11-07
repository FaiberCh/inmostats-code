import logging
import unicodedata
from pathlib import Path
from typing import Optional

import pandas as pd


import os
from datetime import datetime

RAW_DIR = Path(os.environ.get("INMOSTATS_RAW_DIR", Path(__file__).resolve().parents[2] / "data" / "raw"))
PROCESSED_DIR = Path(__file__).resolve().parents[2] / "data" / "processed"

MIN_PRICE_COP = 50_000_000
MAX_PRICE_COP = 10_000_000_000
MIN_AREA_M2 = 15
MAX_AREA_M2 = 1_000
MAX_BEDROOMS = 10
MAX_BATHROOMS = 10
VALID_STRATUM_RANGE = (1, 6)
VALID_FLOOR_RANGE = (-2, 60)
VALID_GARAGES_RANGE = (0, 10)

CANONICAL_DEPARTMENTS = [
    "Amazonas", "Antioquia", "Arauca", "Atlántico", "Bogotá D.C.", "Bolívar",
    "Boyacá", "Caldas", "Caquetá", "Casanare", "Cauca", "Cesar", "Chocó",
    "Córdoba", "Cundinamarca", "Guainía", "Guaviare", "Huila", "La Guajira",
    "Magdalena", "Meta", "Nariño", "Norte de Santander", "Putumayo",
    "Quindío", "Risaralda", "San Andrés y Providencia", "Santander",
    "Sucre", "Tolima", "Valle del Cauca", "Vaupés", "Vichada",
]


def _normalize_key(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().replace(",", " ").replace(".", " ")
    return " ".join(text.split())


DEPARTMENT_NAME_LOOKUP = {_normalize_key(name): name for name in CANONICAL_DEPARTMENTS}
DEPARTMENT_NAME_LOOKUP[_normalize_key("Archipielago de San Andres")] = "San Andrés y Providencia"


def normalize_department(name):
    if not isinstance(name, str) or not name.strip():
        return name
    return DEPARTMENT_NAME_LOOKUP.get(_normalize_key(name), name)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def run_started_at_tag(started_at: str) -> str:
    return "run" + datetime.fromisoformat(started_at).strftime("%Y%m%dT%H%M%S")


def load_raw_data(raw_dir: Path = RAW_DIR, run_started_at: Optional[str] = None) -> pd.DataFrame:
    if run_started_at:
        pattern = f"listings_*_{run_started_at_tag(run_started_at)}_*.csv"
    else:
        pattern = "listings_*.csv"
    csv_files = sorted(raw_dir.rglob(pattern))
    if not csv_files:
        raise FileNotFoundError(f"No se encontraron CSV crudos en {raw_dir} (patron: {pattern})")

    logger.info("Cargando %d archivo(s) crudo(s)", len(csv_files))
    frames = [pd.read_csv(f, encoding="utf-8-sig") for f in csv_files]
    df = pd.concat(frames, ignore_index=True)

    df["captured_at"] = pd.to_datetime(df["captured_at"])
    df = df.sort_values("captured_at").drop_duplicates(subset="listing_id", keep="last")
    logger.info("Registros tras deduplicar por listing_id: %d", len(df))
    return df


def clean(df: pd.DataFrame) -> pd.DataFrame:
    before = len(df)

    df = df.dropna(subset=["price_cop", "area_m2", "bedrooms", "bathrooms"]).copy()

    df = df[df["price_cop"].between(MIN_PRICE_COP, MAX_PRICE_COP)]
    df = df[df["area_m2"].between(MIN_AREA_M2, MAX_AREA_M2)]
    df = df[df["bedrooms"].between(1, MAX_BEDROOMS)]
    df = df[df["bathrooms"].between(1, MAX_BATHROOMS)]

    if "stratum" in df.columns:
        invalid_stratum = ~df["stratum"].between(*VALID_STRATUM_RANGE) & df["stratum"].notna()
        df.loc[invalid_stratum, "stratum"] = None

    if "floor" in df.columns:
        invalid_floor = ~df["floor"].between(*VALID_FLOOR_RANGE) & df["floor"].notna()
        df.loc[invalid_floor, "floor"] = None

    if "garages" in df.columns:
        invalid_garages = ~df["garages"].between(*VALID_GARAGES_RANGE) & df["garages"].notna()
        df.loc[invalid_garages, "garages"] = None

    logger.info("Registros descartados por limpieza: %d (de %d)", before - len(df), before)
    return df


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["price_per_m2"] = (df["price_cop"] / df["area_m2"]).round(0)
    df["admin_fee_cop"] = df["admin_fee_cop"].fillna(0)

    for col in ("department", "department_real", "city", "neighborhood", "locality", "zone", "owner_type"):
        if col in df.columns:
            df[col] = df[col].fillna("sin especificar")
    if "is_new_project" in df.columns:
        df["is_new_project"] = df["is_new_project"].fillna(False)

    if "department_real" in df.columns:
        df["department_final"] = df["department_real"].where(
            df["department_real"] != "sin especificar", df["department"]
        )
    else:
        df["department_final"] = df["department"]
    df["department_final"] = df["department_final"].apply(normalize_department)
    df = infer_department_from_city(df)

    return df


UNKNOWN_DEPARTMENT_LABELS = {"Resto de Colombia", "sin especificar"}


def infer_department_from_city(df: pd.DataFrame) -> pd.DataFrame:
    unknown_mask = df["department_final"].isin(UNKNOWN_DEPARTMENT_LABELS)
    known = df[~unknown_mask]
    if known.empty or not unknown_mask.any():
        return df

    city_to_department = known.groupby("city")["department_final"].agg(
        lambda s: s.mode().iat[0]
    )

    mapped = df["city"].map(city_to_department)
    fillable = unknown_mask & mapped.notna()
    df.loc[fillable, "department_final"] = mapped[fillable]
    logger.info(
        "department_final inferido por ciudad para %d/%d filas sin departamento real",
        fillable.sum(), unknown_mask.sum(),
    )
    return df


def save_processed(df: pd.DataFrame, output_dir: Path = PROCESSED_DIR) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "apartamentos_colombia_processed.csv"
    df.to_csv(output_path, index=False, encoding="utf-8-sig")
    logger.info("Guardado dataset procesado (%d filas) en %s", len(df), output_path)
    return output_path


def main() -> None:
    df = load_raw_data()
    df = clean(df)
    df = engineer_features(df)
    save_processed(df)


if __name__ == "__main__":
    main()
