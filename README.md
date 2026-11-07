# InmoStats

**Demo en vivo:** <https://inmostats.vercel.app>

Proyecto de analítica y predicción de precios de apartamentos en venta en Colombia: limpieza y feature
engineering, un modelo XGBoost que estima el precio de un apartamento, una API (FastAPI) que lo sirve y un
tablero web (Next.js) para explorar el mercado.

Este repositorio es una **vitrina del código**. No incluye los datos reales, ni el código que los recolectó, ni
enlaces a anuncios. Para que todo se pueda ejecutar de punta a punta hay un generador de **datos de muestra
sintéticos** (`scripts/make_sample_data.py`): son anuncios inventados con una semilla fija, y el tablero
lo avisa en el pie de página.

## Resultados del modelo real

El modelo publicado en la API se entrenó con unos 82.000 anuncios reales de apartamentos en venta
(datos que no se publican):

| Métrica (validación cruzada, 5 particiones) | Valor |
|---|---|
| Modelo | XGBoost sobre `log(precio)` |
| Error porcentual medio (MAPE) | 13,4 % |
| R² | 0,879 |

Limitación conocida: el modelo se equivoca más en inmuebles de lujo, donde hay pocos anuncios comparables, y subestima el
cuartil de precios más alto. Se probó recalibrar, ponderar y separar un modelo para lujo, sin mejorar el resultado general.

## Qué hay

```text
src/
├── pipelines/   limpieza, features, utilidades geográficas, dinámica del mercado, clasificación aproximada del
│                anunciante y exportador del tablero (JSON y GeoJSON pequeños)
├── training/    entrenamiento, búsqueda de hiperparámetros y evaluación del modelo
└── api/         servicio FastAPI (/health, /model-info, /amenities, /predict)
web/             tablero web (Next.js): mapa, comparación de precios por grupo con filtrado cruzado,
                 oportunidades según el precio esperado del modelo, estimador y dinámica del mercado
scripts/         generador de datos de muestra sintéticos
data/reference/  límites de departamentos y municipios (geoBoundaries)
```

## Probarlo con datos de muestra

Requiere Python 3.12 o superior y Node 20 o superior.

```bash
pip install -r requirements.txt

# 1. Datos sintéticos en data/sample/
python scripts/make_sample_data.py

# 2. Entrenar el modelo y exportar los datos del tablero
export INMOSTATS_RAW_DIR=data/sample          # en Windows PowerShell: $env:INMOSTATS_RAW_DIR = "data/sample"
python -m src.training.train_baseline
python -m src.pipelines.export_dashboard_data --sample

# 3. Tablero
cd web && npm ci && npm run dev
```

El estimador del tablero llama a la API local en el puerto 7860. Para levantarla, con el modelo ya entrenado:
`uvicorn src.api.main:app --port 7860`. La dirección se puede cambiar con la variable `NEXT_PUBLIC_API_URL`.

## Detalles de diseño que vale la pena mirar

- **Validación del precio esperado fuera de muestra.** El tablero compara cada anuncio con lo que el modelo esperaba,
  calculado con validación cruzada para que el modelo no "recuerde" los anuncios con los que entrenó.
- **Filtros y agregados en el navegador.** Los anuncios viajan en un archivo binario por columnas (`points.bin.gz`) y
  todos los resúmenes se recalculan en el cliente con los mismos cuantiles que el exportador en Python.
- **Comparación de precios con filtrado cruzado.** Un gráfico de barras y una tabla de calor permiten comparar el precio
  por metro cuadrado entre estratos, departamentos, ciudades, barrios, habitaciones y tipos de anunciante; al tocar un
  grupo se filtra todo el tablero.
- **Mediana y no promedio.** Unos pocos inmuebles muy caros inflan el promedio; la mediana describe el apartamento típico.
- **Cobertura y cambios en el tiempo.** El análisis separa lo que es cambio de precio de lo que es cambio de cobertura entre
  capturas, usando índices con los mismos anuncios.

## Licencia

MIT. Ver [LICENSE](LICENSE).
