import os
import warnings
import logging
import traceback
from io import BytesIO
from pathlib import Path
from typing import Any

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

# Configure basic logging for debugging /chat failures
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("anlyst.backend")

warnings.filterwarnings(
    "ignore",
    category=FutureWarning,
)

import google.generativeai as genai

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
GEMINI_MODEL_NAME = "gemini-1.5-flash"
GEMINI_FALLBACK_MODEL_NAME = "gemini-pro"

if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)

CURRENT_DATAFRAME: pd.DataFrame | None = None

app = FastAPI(title="AI Data Analyst Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    user_query: str


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

    global CURRENT_DATAFRAME
    CURRENT_DATAFRAME = clean_dataframe_for_chat(dataframe)

    return {
        "filename": filename,
        **analysis,
    }


@app.post("/chat")
async def chat_with_data(payload: ChatRequest) -> dict[str, object]:
    if CURRENT_DATAFRAME is None:
        return JSONResponse(status_code=400, content={"error": "Data not found. Please re-upload your file."})

    if not GOOGLE_API_KEY:
        return JSONResponse(
            status_code=503,
            content={"error": "Gemini API key is missing. Set GOOGLE_API_KEY in the backend .env file or environment."},
        )

    try:
        available_models = discover_available_gemini_models()
        print(f"DEBUG: Available models for this key: {available_models}", flush=True)
        model_name = choose_gemini_model_name(available_models)
        print(f"DEBUG: Selected Gemini model: {model_name}", flush=True)

        dataframe = CURRENT_DATAFRAME
        column_names = list(dataframe.columns)
        system_prompt = (
            "You are a Python Data Analyst. I have a pandas DataFrame named 'df'. "
            f"The columns are: {column_names}. "
            f"Write Python code that answers this question: '{payload.user_query}'. "
            "Return ONLY raw python code. No markdown, no backticks, no comments. "
            "Use 'result' variable to store the final answer. "
            "If the answer is a value, result = value. If it's a table, result = df_subset.to_dict()."
        )

        model = genai.GenerativeModel(model_name)
        response = model.generate_content(system_prompt)

        raw_ai_code = response.text or ""
        print(f"Raw AI Code: {raw_ai_code}", flush=True)
        clean_code = raw_ai_code.replace("```python", "").replace("```", "").strip()
        generated_code = sanitize_gemini_code(clean_code)

        if not generated_code:
            return JSONResponse(status_code=500, content={"error": "Gemini returned empty code."})

        safe_builtins = {
            "abs": abs,
            "all": all,
            "any": any,
            "bool": bool,
            "dict": dict,
            "enumerate": enumerate,
            "float": float,
            "int": int,
            "len": len,
            "list": list,
            "max": max,
            "min": min,
            "range": range,
            "round": round,
            "set": set,
            "sorted": sorted,
            "sum": sum,
            "tuple": tuple,
        }
        execution_globals = {"df": dataframe.copy(), "pd": pd, "__builtins__": safe_builtins}
        execution_locals: dict[str, Any] = {}

        try:
            exec(generated_code, execution_globals, execution_locals)
        except Exception as exec_exc:
            logger.exception("Error executing Gemini-generated code: %s", exec_exc)
            print(f"DEBUG: {str(exec_exc)}", flush=True)
            print(traceback.format_exc(), flush=True)
            return JSONResponse(
                status_code=500,
                content={"error": "I found the data but couldn't process the calculation. Try asking differently."},
            )

        result = execution_locals.get("result", execution_globals.get("result"))
        if result is None:
            return JSONResponse(status_code=500, content={"error": "Gemini code did not produce a result variable."})

        return {
            "result": serialize_chat_result(result),
            "code": generated_code,
        }
    except Exception as exc:
        print(f"DEBUG: {str(exc)}", flush=True)
        print(traceback.format_exc(), flush=True)
        logger.exception("Unhandled error in /chat: %s", exc)
        return JSONResponse(status_code=500, content={"error": str(exc)})


def discover_available_gemini_models() -> list[str]:
    try:
        available_models = [
            model.name
            for model in genai.list_models()
            if "generateContent" in getattr(model, "supported_generation_methods", [])
        ]
        return available_models
    except Exception as exc:
        print(f"DEBUG: model discovery failed: {str(exc)}", flush=True)
        print(traceback.format_exc(), flush=True)
        logger.exception("Model discovery failed")
        return []


def choose_gemini_model_name(available_models: list[str]) -> str:
    if "models/gemini-1.5-flash" in available_models:
        preferred_model = "models/gemini-1.5-flash"
    elif "models/gemini-pro" in available_models:
        preferred_model = "models/gemini-pro"
    elif available_models:
        preferred_model = available_models[0]
    else:
        preferred_model = GEMINI_MODEL_NAME

    return preferred_model.removeprefix("models/")


def analyze_data(dataframe: pd.DataFrame) -> dict[str, object]:
    cleaned_dataframe = clean_dataframe_for_chat(dataframe)
    original_missing_values = int(dataframe.isna().sum().sum())
    duplicates_removed = int(len(dataframe) - len(cleaned_dataframe))

    column_groups = identify_column_groups(cleaned_dataframe)
    fill_missing_values(cleaned_dataframe, column_groups)

    statistics = calculate_statistics(cleaned_dataframe, column_groups)
    chart_data = generate_chart_data(cleaned_dataframe, column_groups)
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
        "chart_data": chart_data,
    }


def clean_dataframe_for_chat(dataframe: pd.DataFrame) -> pd.DataFrame:
    cleaned_dataframe = dataframe.copy()
    cleaned_dataframe = cleaned_dataframe.drop_duplicates().reset_index(drop=True)
    column_groups = identify_column_groups(cleaned_dataframe)
    fill_missing_values(cleaned_dataframe, column_groups)
    return cleaned_dataframe


def generate_chart_data(dataframe: pd.DataFrame, column_groups: dict[str, list[str]]) -> dict[str, object]:
    numeric_columns = column_groups["numeric"]
    categorical_columns = column_groups["categorical"]
    datetime_columns = column_groups["datetime"]

    categorical_distributions = {
        column: build_categorical_distribution(dataframe, column, numeric_columns)
        for column in categorical_columns
    }
    date_trends = {
        column: build_date_trend(dataframe, column, numeric_columns)
        for column in datetime_columns
    }

    return {
        "numeric_columns": numeric_columns,
        "categorical_columns": categorical_columns,
        "datetime_columns": datetime_columns,
        "primary_numeric_column": numeric_columns[0] if numeric_columns else None,
        "primary_categorical_column": categorical_columns[0] if categorical_columns else None,
        "primary_datetime_column": datetime_columns[0] if datetime_columns else None,
        "categorical_distributions": categorical_distributions,
        "date_trends": date_trends,
    }


def build_categorical_distribution(
    dataframe: pd.DataFrame,
    column: str,
    numeric_columns: list[str],
) -> dict[str, object]:
    working_frame = dataframe.copy()
    working_frame["__category__"] = working_frame[column].fillna("N/A").astype(str)

    aggregation_map: dict[str, tuple[str, str]] = {"count": ("__category__", "size")}
    for numeric_column in numeric_columns:
        numeric_series = pd.to_numeric(working_frame[numeric_column], errors="coerce")
        working_frame[f"__numeric__{numeric_column}"] = numeric_series
        aggregation_map[f"{numeric_column}_sum"] = (f"__numeric__{numeric_column}", "sum")
        aggregation_map[f"{numeric_column}_mean"] = (f"__numeric__{numeric_column}", "mean")

    grouped = (
        working_frame.groupby("__category__", dropna=False)
        .agg(**aggregation_map)
        .sort_values("count", ascending=False)
        .head(10)
    )

    items: list[dict[str, object]] = []
    for category, row in grouped.iterrows():
        numeric_metrics = {
            numeric_column: {
                "sum": serialize_number(row.get(f"{numeric_column}_sum")),
                "mean": serialize_number(row.get(f"{numeric_column}_mean")),
            }
            for numeric_column in numeric_columns
        }

        items.append(
            {
                "label": serialize_value(category),
                "count": int(row["count"]),
                "numeric_metrics": numeric_metrics,
            }
        )

    return {
        "column": column,
        "items": items,
    }


def build_date_trend(
    dataframe: pd.DataFrame,
    column: str,
    numeric_columns: list[str],
) -> dict[str, object]:
    working_frame = dataframe.copy()
    working_frame["__date__"] = pd.to_datetime(working_frame[column], errors="coerce", format="mixed").dt.normalize()

    aggregation_map: dict[str, tuple[str, str]] = {"count": ("__date__", "size")}
    for numeric_column in numeric_columns:
        numeric_series = pd.to_numeric(working_frame[numeric_column], errors="coerce")
        working_frame[f"__numeric__{numeric_column}"] = numeric_series
        aggregation_map[f"{numeric_column}_sum"] = (f"__numeric__{numeric_column}", "sum")
        aggregation_map[f"{numeric_column}_mean"] = (f"__numeric__{numeric_column}", "mean")

    grouped = (
        working_frame.dropna(subset=["__date__"])
        .groupby("__date__", dropna=False)
        .agg(**aggregation_map)
        .sort_index()
    )

    items: list[dict[str, object]] = []
    for date_value, row in grouped.iterrows():
        numeric_metrics = {
            numeric_column: {
                "sum": serialize_number(row.get(f"{numeric_column}_sum")),
                "mean": serialize_number(row.get(f"{numeric_column}_mean")),
            }
            for numeric_column in numeric_columns
        }

        items.append(
            {
                "label": serialize_value(date_value),
                "count": int(row["count"]),
                "numeric_metrics": numeric_metrics,
            }
        )

    return {
        "column": column,
        "items": items,
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

        parsed_series = pd.to_datetime(series, errors="coerce", format="mixed")
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
        series = pd.to_datetime(dataframe[column], errors="coerce", format="mixed")
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
        series = pd.to_datetime(dataframe[column], errors="coerce", format="mixed")
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


def serialize_number(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None

    return round(float(value), 4)


def serialize_chat_result(result: Any) -> Any:
    if isinstance(result, pd.DataFrame):
        return serialize_records(result.head(50))

    if isinstance(result, pd.Series):
        return serialize_value(result.to_dict())

    if isinstance(result, dict):
        return {str(key): serialize_value(value) for key, value in result.items()}

    if isinstance(result, (list, tuple, set)):
        return [serialize_value(item) for item in result]

    return serialize_value(result)


def sanitize_gemini_code(code: str) -> str:
    cleaned_code = code.strip()
    cleaned_code = cleaned_code.replace("```python", "").replace("```", "").strip()

    if cleaned_code.lower().startswith("python\n"):
        cleaned_code = cleaned_code[7:].strip()
    elif cleaned_code.lower().startswith("python "):
        cleaned_code = cleaned_code[7:].strip()
    elif cleaned_code.lower() == "python":
        cleaned_code = ""

    return cleaned_code


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
