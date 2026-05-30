from io import BytesIO
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AI Data Analyst Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)) -> dict[str, object]:
    filename = file.filename or ""
    suffix = Path(filename).suffix.lower()

    if suffix not in {".csv", ".xls", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Only CSV or Excel files are supported.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    dataframe = read_tabular_file(file_bytes, suffix)
    analysis = analyze_data(dataframe)

    return {
        "filename": filename,
        **analysis,
    }


def analyze_data(dataframe: pd.DataFrame) -> dict[str, object]:
    cleaned_dataframe = dataframe.copy()
    original_missing_values = int(cleaned_dataframe.isna().sum().sum())

    cleaned_dataframe = cleaned_dataframe.drop_duplicates().reset_index(drop=True)
    duplicates_removed = int(len(dataframe) - len(cleaned_dataframe))

    column_groups = identify_column_groups(cleaned_dataframe)
    fill_missing_values(cleaned_dataframe, column_groups)

    statistics = calculate_statistics(cleaned_dataframe, column_groups)
    metadata = {
        "total_rows": int(cleaned_dataframe.shape[0]),
        "total_columns": int(cleaned_dataframe.shape[1]),
        "missing_values_count": original_missing_values,
        "missing_values_fixed": original_missing_values,
        "duplicates_removed": duplicates_removed,
    }

    cleaned_data = serialize_records(cleaned_dataframe.head(15))

    print(
        f"Analysis Complete: {cleaned_dataframe.shape[0]} rows and {cleaned_dataframe.shape[1]} columns processed.",
        flush=True,
    )

    return {
        "cleaned_data": cleaned_data,
        "metadata": metadata,
        "statistics": statistics,
        "column_groups": column_groups,
    }


def identify_column_groups(dataframe: pd.DataFrame) -> dict[str, list[str]]:
    numeric_columns: list[str] = []
    categorical_columns: list[str] = []
    datetime_columns: list[str] = []

    for column in dataframe.columns:
        series = dataframe[column]

        if pd.api.types.is_bool_dtype(series):
            categorical_columns.append(column)
            continue

        if pd.api.types.is_numeric_dtype(series):
            numeric_columns.append(column)
            continue

        if pd.api.types.is_datetime64_any_dtype(series):
            datetime_columns.append(column)
            continue

        parsed_series = pd.to_datetime(series, errors="coerce")
        non_null_values = int(series.notna().sum())
        parse_ratio = (int(parsed_series.notna().sum()) / non_null_values) if non_null_values else 0

        if non_null_values and parse_ratio >= 0.8:
            dataframe[column] = parsed_series
            datetime_columns.append(column)
        else:
            categorical_columns.append(column)

    return {
        "numeric": numeric_columns,
        "categorical": categorical_columns,
        "datetime": datetime_columns,
    }


def fill_missing_values(dataframe: pd.DataFrame, column_groups: dict[str, list[str]]) -> None:
    for column in column_groups["numeric"]:
        series = pd.to_numeric(dataframe[column], errors="coerce")
        fill_value = 0 if series.dropna().empty else float(series.mean())
        dataframe[column] = series.fillna(fill_value)

    for column in column_groups["categorical"]:
        dataframe[column] = dataframe[column].fillna("N/A").astype(object)

    for column in column_groups["datetime"]:
        series = pd.to_datetime(dataframe[column], errors="coerce")
        if series.dropna().empty:
            fill_value = pd.Timestamp("1970-01-01")
        else:
            mode_values = series.mode(dropna=True)
            fill_value = mode_values.iloc[0] if not mode_values.empty else series.dropna().median()
            if pd.isna(fill_value):
                fill_value = pd.Timestamp("1970-01-01")
        dataframe[column] = series.fillna(fill_value)


def calculate_statistics(dataframe: pd.DataFrame, column_groups: dict[str, list[str]]) -> dict[str, dict[str, Any]]:
    statistics: dict[str, dict[str, Any]] = {}

    for column in column_groups["numeric"]:
        series = pd.to_numeric(dataframe[column], errors="coerce")
        statistics[column] = {
            "type": "Numeric",
            "mean": round(float(series.mean()), 4) if not series.dropna().empty else None,
            "median": round(float(series.median()), 4) if not series.dropna().empty else None,
            "min": round(float(series.min()), 4) if not series.dropna().empty else None,
            "max": round(float(series.max()), 4) if not series.dropna().empty else None,
            "std": round(float(series.std()), 4) if not series.dropna().empty else None,
        }

    for column in column_groups["categorical"]:
        series = dataframe[column].fillna("N/A").astype(str)
        top_values = series.value_counts().head(5)
        statistics[column] = {
            "type": "Text",
            "top_values": [
                {"value": value, "frequency": int(frequency)}
                for value, frequency in top_values.items()
            ],
        }

    for column in column_groups["datetime"]:
        series = pd.to_datetime(dataframe[column], errors="coerce")
        most_common = series.mode(dropna=True)
        statistics[column] = {
            "type": "Datetime",
            "earliest": serialize_value(series.min()),
            "latest": serialize_value(series.max()),
            "most_common": serialize_value(most_common.iloc[0]) if not most_common.empty else None,
        }

    return statistics


def serialize_records(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    return [
        {column: serialize_value(value) for column, value in row.items()}
        for row in dataframe.to_dict(orient="records")
    ]


def serialize_value(value: Any) -> Any:
    if value is None:
        return None

    if isinstance(value, pd.Timestamp):
        return value.isoformat()

    if hasattr(value, "isoformat") and not isinstance(value, (str, bytes)):
        try:
            return value.isoformat()
        except TypeError:
            pass

    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")

    if pd.isna(value):
        return None

    if hasattr(value, "item") and type(value).__module__.startswith("numpy"):
        try:
            return value.item()
        except ValueError:
            pass

    return value


def read_tabular_file(file_bytes: bytes, suffix: str) -> pd.DataFrame:
    buffer = BytesIO(file_bytes)

    if suffix == ".csv":
        for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin1"):
            buffer.seek(0)
            try:
                return pd.read_csv(buffer, encoding=encoding)
            except UnicodeDecodeError:
                continue
            except pd.errors.ParserError as exc:
                raise HTTPException(status_code=400, detail=f"Could not parse CSV file: {exc}") from exc

        raise HTTPException(
            status_code=400,
            detail="Could not decode the CSV file. Please save it as UTF-8 and try again.",
        )

    if suffix in {".xls", ".xlsx"}:
        try:
            return pd.read_excel(buffer)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Could not parse Excel file: {exc}") from exc

    raise HTTPException(status_code=400, detail="Only CSV or Excel files are supported.")
