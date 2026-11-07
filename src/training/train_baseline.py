import json
import logging
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import (
    mean_absolute_error,
    mean_absolute_percentage_error,
    r2_score,
    root_mean_squared_error,
)
from sklearn.model_selection import KFold, cross_val_predict, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, TargetEncoder
from xgboost import XGBRegressor

from src.pipelines.clean_data import clean, engineer_features, load_raw_data

MODELS_DIR = Path(__file__).resolve().parents[2] / "models"

NUMERIC_FEATURES = [
    "area_m2", "bedrooms", "bathrooms", "stratum", "floor", "antiquity", "garages",
    "latitude", "longitude",
]
ONEHOT_FEATURES = ["department_final", "owner_type"]
TARGET_ENCODE_FEATURES = ["city", "neighborhood"]
BOOL_FEATURES = ["is_new_project"]
TARGET = "price_cop"
N_AMENITY_FEATURES = 15

LUXURY_KEYWORDS = [
    "penthouse", "duplex", "chimenea", "vista panoramica", "techos altos",
    "doble altura", "vestier", "walk in closet", "terraza", "club house",
    "zona bbq", "jardin interior", "ventanas termoacusticas", "remodelado",
    "a estrenar", "exclusivo", "lujo", "sky lounge", "piso de madera",
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def top_amenities(df, n: int = N_AMENITY_FEATURES) -> list[str]:
    exploded = df["amenities"].dropna().str.split("; ").explode().str.strip()
    return exploded.value_counts().head(n).index.tolist()


def add_amenity_flags(df, amenities: list[str]):
    amenities_text = df["amenities"].fillna("")
    flags = {}
    for amenity in amenities:
        col = "amenity_" + _slugify(amenity)
        flags[col] = amenities_text.str.contains(amenity, regex=False).astype(int)
    return pd.DataFrame(flags, index=df.index)


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return "".join(c if c.isalnum() else "_" for c in text.lower()).strip("_")


def _normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.lower()


def add_text_keyword_flags(df, keywords: list[str]):
    text = (df["title"].fillna("") + " " + df["description"].fillna("")).apply(_normalize_text)
    flags = {}
    for keyword in keywords:
        col = "txt_" + _slugify(keyword)
        flags[col] = text.str.contains(keyword, regex=False).astype(int)
    return pd.DataFrame(flags, index=df.index)


def build_preprocessor(extra_columns: list[str]) -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
            ("onehot", OneHotEncoder(handle_unknown="ignore"), ONEHOT_FEATURES),
            ("target_enc", TargetEncoder(target_type="continuous"), TARGET_ENCODE_FEATURES),
            ("bool", "passthrough", BOOL_FEATURES + extra_columns),
        ]
    )


def load_dataset():
    df = load_raw_data()
    df = clean(df)
    df = engineer_features(df)
    df = df.dropna(subset=[TARGET]).copy()

    amenities = top_amenities(df)
    amenity_df = add_amenity_flags(df, amenities)
    text_flags_df = add_text_keyword_flags(df, LUXURY_KEYWORDS)

    features = NUMERIC_FEATURES + ONEHOT_FEATURES + TARGET_ENCODE_FEATURES + BOOL_FEATURES
    X = pd.concat([df[features].copy(), amenity_df, text_flags_df], axis=1)
    X["is_new_project"] = X["is_new_project"].astype(int)
    y_log = np.log1p(df[TARGET])
    y_raw = df[TARGET]
    extra_columns = amenity_df.columns.tolist() + text_flags_df.columns.tolist()
    return X, y_log, y_raw, extra_columns, amenities


def evaluate(pipe: Pipeline, X_test, y_test_raw) -> dict:
    pred = np.expm1(pipe.predict(X_test))
    return {
        "RMSE_COP": round(root_mean_squared_error(y_test_raw, pred), 0),
        "MAE_COP": round(mean_absolute_error(y_test_raw, pred), 0),
        "MAPE_%": round(mean_absolute_percentage_error(y_test_raw, pred) * 100, 2),
        "R2": round(r2_score(y_test_raw, pred), 4),
    }


def cross_val_predictions(model, X, y_log, extra_columns, n_splits: int = 5) -> np.ndarray:
    cv = KFold(n_splits=n_splits, shuffle=True, random_state=42)
    pipe = Pipeline([("prep", build_preprocessor(extra_columns)), ("model", model)])
    pred_log = cross_val_predict(pipe, X, y_log, cv=cv, n_jobs=-1)
    return np.expm1(pred_log)


def metrics_from_predictions(y_raw, pred) -> dict:
    return {
        "RMSE_COP": round(root_mean_squared_error(y_raw, pred), 0),
        "MAE_COP": round(mean_absolute_error(y_raw, pred), 0),
        "MAPE_%": round(mean_absolute_percentage_error(y_raw, pred) * 100, 2),
        "R2": round(r2_score(y_raw, pred), 4),
    }


def residual_breakdown(segment: pd.Series, y_raw: pd.Series, pred: np.ndarray, min_count: int = 100) -> pd.DataFrame:
    df = pd.DataFrame({
        "segment": segment.values,
        "y_raw": y_raw.values,
        "pred": pred,
    })
    df["pct_error"] = (df["pred"] - df["y_raw"]) / df["y_raw"] * 100
    grouped = df.groupby("segment").agg(
        n=("y_raw", "size"),
        mape=("pct_error", lambda s: s.abs().mean()),
        bias_pct=("pct_error", "mean"),
    )
    grouped = grouped[grouped["n"] >= min_count].sort_values("mape", ascending=False)
    return grouped.round(2)


def top_feature_importances(pipe: Pipeline, top_n: int = 15) -> list[tuple[str, float]]:
    names = pipe.named_steps["prep"].get_feature_names_out()
    importances = pipe.named_steps["model"].feature_importances_
    ranked = sorted(zip(names, importances), key=lambda pair: pair[1], reverse=True)
    return ranked[:top_n]


KEY_HYPERPARAMETERS = (
    "n_estimators", "max_depth", "learning_rate", "subsample",
    "colsample_bytree", "min_child_weight", "min_samples_leaf",
)


def key_hyperparameters(pipe: Pipeline) -> dict:
    params = pipe.named_steps["model"].get_params()
    return {k: params[k] for k in KEY_HYPERPARAMETERS if params.get(k) is not None}


def build_models() -> dict:
    return {
        "LinearRegression": LinearRegression(),
        "RandomForest": RandomForestRegressor(
            n_estimators=300, max_depth=16, min_samples_leaf=3, n_jobs=-1, random_state=42
        ),
        "XGBoost": XGBRegressor(
            n_estimators=684, max_depth=9, learning_rate=0.0599,
            subsample=0.768, colsample_bytree=0.649, min_child_weight=1,
            n_jobs=-1, random_state=42,
        ),
    }


def train_and_compare(X, y_log, y_raw, extra_columns, test_size: float = 0.2, random_state: int = 42):
    X_train, X_test, y_train_log, y_test_log, y_train_raw, y_test_raw = train_test_split(
        X, y_log, y_raw, test_size=test_size, random_state=random_state
    )

    results, fitted = {}, {}
    for name, model in build_models().items():
        pipe = Pipeline([("prep", build_preprocessor(extra_columns)), ("model", model)])
        pipe.fit(X_train, y_train_log)
        metrics = evaluate(pipe, X_test, y_test_raw)
        results[name] = metrics
        fitted[name] = pipe
        logger.info("%s -> %s", name, metrics)

    return results, fitted, (X_test, y_test_raw)


def main() -> None:
    X, y_log, y_raw, extra_columns, amenities = load_dataset()
    logger.info("Dataset de entrenamiento: %d filas, %d features", len(X), X.shape[1])

    results, fitted, _ = train_and_compare(X, y_log, y_raw, extra_columns)

    best_by_rmse = min(results, key=lambda n: results[n]["RMSE_COP"])
    if "XGBoost" in results and results["XGBoost"]["RMSE_COP"] <= results[best_by_rmse]["RMSE_COP"] * 1.10:
        best_name = "XGBoost"
    else:
        best_name = best_by_rmse
    logger.info("Modelo elegido: %s (%s)", best_name, results[best_name])

    cv_pred = cross_val_predictions(build_models()[best_name], X, y_log, extra_columns)
    cv_metrics = metrics_from_predictions(y_raw, cv_pred)
    logger.info("%s -> %s (5-fold CV, todas las filas como test una vez)", best_name, cv_metrics)

    price_quartile = pd.qcut(y_raw, q=4, labels=["Q1 (mas barato)", "Q2", "Q3", "Q4 (mas caro)"])
    logger.info("Error por cuartil de precio:\n%s", residual_breakdown(price_quartile, y_raw, cv_pred))
    logger.info("Error por departamento (min. 100 anuncios):\n%s", residual_breakdown(X["department_final"], y_raw, cv_pred))

    importances = top_feature_importances(fitted[best_name])
    logger.info("Top features por importancia (%s):", best_name)
    for name, importance in importances:
        logger.info("  %s: %.4f", name, importance)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    output_path = MODELS_DIR / "price_model.joblib"
    joblib.dump(fitted[best_name], output_path)
    logger.info("Guardado modelo en %s (%.1f MB)", output_path, output_path.stat().st_size / 1e6)

    feature_config = {
        "model_name": best_name,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_rows": len(X),
        "metrics_holdout": results[best_name],
        "metrics_cv": cv_metrics,
        "hyperparameters": key_hyperparameters(fitted[best_name]),
        "top_features": [[name, round(float(value), 4)] for name, value in importances[:8]],
        "amenities": amenities,
        "luxury_keywords": LUXURY_KEYWORDS,
        "numeric_features": NUMERIC_FEATURES,
        "onehot_features": ONEHOT_FEATURES,
        "target_encode_features": TARGET_ENCODE_FEATURES,
        "bool_features": BOOL_FEATURES,
    }
    config_path = MODELS_DIR / "feature_config.json"
    config_path.write_text(json.dumps(feature_config, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("Guardada configuracion de features en %s", config_path)


if __name__ == "__main__":
    main()
