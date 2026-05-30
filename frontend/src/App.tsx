import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  BarChart3,
  CheckCircle2,
  AlertCircle,
  CalendarClock,
  Columns3,
  Database,
  FileSpreadsheet,
  Hash,
  Loader2,
  TrendingDown,
  TrendingUp,
  Sparkles,
  Table2,
  UploadCloud,
  X,
} from "lucide-react";

type RowValue = string | number | boolean | null;

type Row = Record<string, RowValue>;

type SummaryMetric = {
  total_rows: number;
  total_columns: number;
  missing_values_count: number;
  missing_values_fixed: number;
  duplicates_removed: number;
};

type NumericColumnStat = {
  type: "Numeric";
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  std: number | null;
};

type TextColumnStat = {
  type: "Text";
  top_values: Array<{ value: string; frequency: number }>;
};

type DatetimeColumnStat = {
  type: "Datetime";
  earliest: string | null;
  latest: string | null;
  most_common: string | null;
};

type ColumnStat = NumericColumnStat | TextColumnStat | DatetimeColumnStat;

type UploadResponse = {
  filename: string;
  cleaned_data: Row[];
  metadata: SummaryMetric;
  statistics: Record<string, ColumnStat>;
  column_groups: {
    numeric: string[];
    categorical: string[];
    datetime: string[];
  };
};

type ToastState = {
  title: string;
  message: string;
};

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

function formatCellValue(value: RowValue): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }

  return String(value);
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return numberFormatter.format(value);
}

function formatDateValue(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [metadata, setMetadata] = useState<SummaryMetric | null>(null);
  const [statistics, setStatistics] = useState<Record<string, ColumnStat>>({});
  const [toast, setToast] = useState<ToastState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [toast]);

  const columns = useMemo(() => {
    if (rows.length === 0) {
      return [];
    }

    return Object.keys(rows[0]);
  }, [rows]);

  const summaryCards = useMemo(() => {
    if (!metadata) {
      return [];
    }

    return [
      {
        title: "Total Rows",
        value: formatNumber(metadata.total_rows),
        description: "Rows available after cleaning",
        icon: Database,
      },
      {
        title: "Total Columns",
        value: formatNumber(metadata.total_columns),
        description: "Columns detected in the file",
        icon: Columns3,
      },
      {
        title: "Missing Values Fixed",
        value: formatNumber(metadata.missing_values_fixed),
        description: "Missing cells filled automatically",
        icon: Sparkles,
      },
    ];
  }, [metadata]);

  const columnEntries = useMemo(
    () => Object.entries(statistics),
    [statistics],
  );

  const uploadFile = async (selectedFile: File) => {
    setError("");
    setIsUploading(true);
    setFile(selectedFile);
    setFileName(selectedFile.name);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await axios.post<UploadResponse>(
        `${API_BASE_URL}/upload`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );

      setRows(response.data.cleaned_data ?? []);
      setMetadata(response.data.metadata ?? null);
      setStatistics(response.data.statistics ?? {});
      setToast({
        title: "Success",
        message: "Data cleaned and analyzed successfully.",
      });
    } catch (requestError) {
      const message =
        axios.isAxiosError(requestError) && requestError.response?.data?.detail
          ? requestError.response.data.detail
          : "Upload failed. Please try again with a CSV or Excel file.";
      setError(message);
      setRows([]);
      setMetadata(null);
      setStatistics({});
      setToast(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      void uploadFile(selectedFile);
    }

    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) {
      void uploadFile(droppedFile);
    }
  };

  const resetState = () => {
    setFile(null);
    setRows([]);
    setFileName("");
    setError("");
    setMetadata(null);
    setStatistics({});
    setToast(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.18),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-4 py-10 text-slate-900">
      {toast ? (
        <div className="fixed right-4 top-4 z-50 w-full max-w-sm rounded-2xl border border-emerald-200 bg-white/95 p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-emerald-100 p-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">{toast.message}</p>
            </div>
            <button
              type="button"
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <section className="animate-fadeUp rounded-[2rem] border border-white/70 bg-white/85 p-8 shadow-halo backdrop-blur-xl md:p-10">
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-800">
                <Sparkline />
                Phase 2 Data Intelligence Workspace
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                AI Data Analyst Platform
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-600 md:text-lg">
                Upload a CSV or Excel file, let the backend clean and analyze it,
                then review the insights, statistics, and preview table in one place.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 shadow-sm">
              <div className="flex items-center gap-2 font-medium text-slate-900">
                <FileSpreadsheet className="h-4 w-4 text-teal-600" />
                Supported formats
              </div>
              <p className="mt-2">CSV, XLS, XLSX</p>
            </div>
          </div>

          <label
            className="group relative flex min-h-60 cursor-pointer flex-col items-center justify-center rounded-[1.75rem] border-2 border-dashed border-slate-300 bg-slate-50/70 p-8 text-center transition hover:border-teal-400 hover:bg-teal-50/60"
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xls,.xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="mb-5 rounded-full bg-white p-4 shadow-sm ring-1 ring-slate-200 transition group-hover:scale-105">
              <UploadCloud className="h-10 w-10 text-teal-600" />
            </div>
            <h2 className="text-2xl font-semibold text-slate-900">Upload your file</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600 md:text-base">
              Drag and drop a spreadsheet here or click to browse. The backend
              will parse the file and return a preview table.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-500">
              {fileName ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 font-medium text-slate-800 shadow-sm ring-1 ring-slate-200">
                  <FileSpreadsheet className="h-4 w-4 text-teal-600" />
                  {fileName}
                </span>
              ) : null}
              {isUploading ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-4 py-2 font-medium text-white shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing upload
                </span>
              ) : null}
            </div>
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <UploadCloud className="h-4 w-4" />
              Choose file
            </button>
            <button
              type="button"
              onClick={resetState}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          </div>

          {error ? (
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-red-700">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-sm leading-6">{error}</p>
            </div>
          ) : null}
        </section>

        <section className="animate-fadeUp rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-halo backdrop-blur-xl md:p-8">
          <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-950">
                <BarChart3 className="h-5 w-5 text-teal-600" />
                Data Insights
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Cleaned records, missing value fixes, and the most important column-level signals.
              </p>
            </div>
            {metadata ? (
              <div className="rounded-full bg-teal-50 px-4 py-2 text-sm font-medium text-teal-800 ring-1 ring-teal-100">
                {metadata.duplicates_removed} duplicate row{metadata.duplicates_removed === 1 ? "" : "s"} removed
              </div>
            ) : null}
          </div>

          {metadata ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                {summaryCards.map((card) => {
                  const Icon = card.icon;

                  return (
                    <article
                      key={card.title}
                      className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-slate-500">{card.title}</p>
                          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                            {card.value}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-teal-50 p-3 text-teal-700 ring-1 ring-teal-100">
                          <Icon className="h-6 w-6" />
                        </div>
                      </div>
                      <p className="mt-4 text-sm leading-6 text-slate-500">{card.description}</p>
                    </article>
                  );
                })}
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {columnEntries.length > 0 ? (
                  columnEntries.map(([columnName, stat]) => (
                    <article
                      key={columnName}
                      className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-5 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Column Analysis
                          </p>
                          <h4 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                            {columnName}
                          </h4>
                        </div>
                        <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                          {stat.type}
                        </span>
                      </div>

                      {stat.type === "Numeric" ? (
                        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                          <MetricPill label="Average" value={formatNumber(stat.mean)} icon={Hash} />
                          <MetricPill label="Median" value={formatNumber(stat.median)} icon={BarChart3} />
                          <MetricPill label="Min" value={formatNumber(stat.min)} icon={TrendingDown} />
                          <MetricPill label="Max" value={formatNumber(stat.max)} icon={TrendingUp} />
                          <MetricPill label="Std Dev" value={formatNumber(stat.std)} icon={Sparkles} fullWidth />
                        </div>
                      ) : null}

                      {stat.type === "Text" ? (
                        <div className="mt-5">
                          <p className="text-sm font-medium text-slate-600">Top values</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {stat.top_values.length > 0 ? (
                              stat.top_values.map((item) => (
                                <span
                                  key={`${columnName}-${item.value}`}
                                  className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
                                >
                                  {item.value}
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                                    {item.frequency}
                                  </span>
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-slate-500">No values found.</span>
                            )}
                          </div>
                        </div>
                      ) : null}

                      {stat.type === "Datetime" ? (
                        <div className="mt-5 grid gap-3 text-sm">
                          <MetricPill label="Earliest" value={formatDateValue(stat.earliest)} icon={CalendarClock} />
                          <MetricPill label="Latest" value={formatDateValue(stat.latest)} icon={CalendarClock} />
                          <MetricPill label="Most common" value={formatDateValue(stat.most_common)} icon={Hash} fullWidth />
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-white p-6 text-slate-500 lg:col-span-2">
                    Upload a dataset to unlock the column analysis grid.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-500">
              No analysis yet. Upload a file to generate cleaned data, metadata, and statistics.
            </div>
          )}
        </section>

        <section className="animate-fadeUp rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-halo backdrop-blur-xl md:p-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h3 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-950">
                <Table2 className="h-5 w-5 text-teal-600" />
                Data Preview
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Showing the first 10 rows returned by the backend.
              </p>
            </div>
            {rows.length > 0 ? (
              <div className="rounded-full bg-teal-50 px-4 py-2 text-sm font-medium text-teal-800 ring-1 ring-teal-100">
                {rows.length} row{rows.length === 1 ? "" : "s"} loaded
              </div>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 text-center">
              <div className="rounded-full bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <Table2 className="h-9 w-9 text-slate-400" />
              </div>
              <h4 className="mt-5 text-xl font-semibold text-slate-900">No data available</h4>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Upload a file to populate this preview table. The table will update
                automatically once the backend responds.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      {columns.map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {rows.map((row, rowIndex) => (
                      <tr key={`${rowIndex}-${Object.keys(row).join("-")}`} className="transition hover:bg-teal-50/50">
                        {columns.map((column) => (
                          <td key={column} className="whitespace-nowrap px-5 py-4 text-sm text-slate-700">
                            {formatCellValue(row[column] ?? null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MetricPill({
  label,
  value,
  icon: Icon,
  fullWidth = false,
}: {
  label: string;
  value: string;
  icon: typeof Hash;
  fullWidth?: boolean;
}) {
  return (
    <div className={`rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200 ${fullWidth ? "col-span-2" : ""}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        <Icon className="h-4 w-4 text-teal-600" />
        {label}
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function Sparkline() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-emerald-700" aria-hidden="true">
      <path
        d="M4 15.5C5.7 15.5 6.5 13 7.5 13s1.2 6 2.7 6 1.8-11 3.8-11 1.9 5 3.4 5 2-2.5 2.6-2.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

