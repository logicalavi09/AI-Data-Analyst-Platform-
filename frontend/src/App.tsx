import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from "react";
import axios from "axios";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  CalendarClock,
  ChevronDown,
  Columns3,
  Database,
  Download,
  FileSpreadsheet,
  Hash,
  Loader2,
  MessageSquare,
  Send,
  Bot,
  User,
  PieChart as PieChartIcon,
  Sparkles,
  Table2,
  TrendingDown,
  TrendingUp,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts";

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

type NumericMetric = {
  sum: number | null;
  mean: number | null;
};

type AggregatedItem = {
  label: string;
  count: number;
  numeric_metrics: Record<string, NumericMetric>;
};

type AggregatedSeries = {
  column: string;
  items: AggregatedItem[];
};

type ChartData = {
  numeric_columns: string[];
  categorical_columns: string[];
  datetime_columns: string[];
  primary_numeric_column: string | null;
  primary_categorical_column: string | null;
  primary_datetime_column: string | null;
  categorical_distributions: Record<string, AggregatedSeries>;
  date_trends: Record<string, AggregatedSeries>;
};

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
  chart_data: ChartData;
};

type ToastState = {
  title: string;
  message: string;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant" | "error";
  content: string;
};

type ChatResponse = {
  result: unknown;
  code?: string;
};

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const CHART_COLORS = ["#4f46e5", "#6366f1", "#8b5cf6", "#0f766e", "#14b8a6", "#1d4ed8", "#a855f7"];

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

function resolveNumericMetric(item: AggregatedItem, selectedNumeric: string): number {
  if (selectedNumeric) {
    const metric = item.numeric_metrics[selectedNumeric];
    if (metric?.sum !== null && metric?.sum !== undefined) {
      return metric.sum;
    }
  }

  return item.count;
}

function downloadSvgChart(containerRef: RefObject<HTMLDivElement>, filename: string) {
  const svgElement = containerRef.current?.querySelector("svg");
  if (!svgElement) {
    return;
  }

  const serializer = new XMLSerializer();
  const svgSource = serializer.serializeToString(svgElement);
  const svgBlob = new Blob([svgSource], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  const downloadLink = document.createElement("a");

  downloadLink.href = svgUrl;
  downloadLink.download = filename;
  downloadLink.click();
  URL.revokeObjectURL(svgUrl);
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [metadata, setMetadata] = useState<SummaryMetric | null>(null);
  const [statistics, setStatistics] = useState<Record<string, ColumnStat>>({});
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [selectedCategorical, setSelectedCategorical] = useState("");
  const [selectedNumeric, setSelectedNumeric] = useState("");
  const [selectedDatetime, setSelectedDatetime] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content: "Upload a dataset and ask me about it. I can summarize rows, filter records, and explain patterns.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const barChartRef = useRef<HTMLDivElement | null>(null);
  const pieChartRef = useRef<HTMLDivElement | null>(null);
  const lineChartRef = useRef<HTMLDivElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!chartData) {
      return;
    }

    setSelectedCategorical((current) =>
      chartData.categorical_columns.includes(current)
        ? current
        : chartData.primary_categorical_column ?? chartData.categorical_columns[0] ?? "",
    );
    setSelectedNumeric((current) =>
      chartData.numeric_columns.includes(current)
        ? current
        : chartData.primary_numeric_column ?? chartData.numeric_columns[0] ?? "",
    );
    setSelectedDatetime((current) =>
      chartData.datetime_columns.includes(current)
        ? current
        : chartData.primary_datetime_column ?? chartData.datetime_columns[0] ?? "",
    );
  }, [chartData]);

  useEffect(() => {
    if (chatListRef.current) {
      chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
    }
  }, [chatMessages, isChatting]);

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

  const columnEntries = useMemo(() => Object.entries(statistics), [statistics]);

  const activeCategoricalSeries = useMemo(() => {
    if (!chartData || !selectedCategorical) {
      return null;
    }

    return chartData.categorical_distributions[selectedCategorical] ?? null;
  }, [chartData, selectedCategorical]);

  const activeDateSeries = useMemo(() => {
    if (!chartData || !selectedDatetime) {
      return null;
    }

    return chartData.date_trends[selectedDatetime] ?? null;
  }, [chartData, selectedDatetime]);

  const barChartRows = useMemo(() => {
    if (!activeCategoricalSeries) {
      return [];
    }

    return activeCategoricalSeries.items.map((item) => ({
      label: item.label,
      value: resolveNumericMetric(item, selectedNumeric),
      count: item.count,
    }));
  }, [activeCategoricalSeries, selectedNumeric]);

  const pieChartRows = useMemo(() => {
    if (!activeCategoricalSeries) {
      return [];
    }

    const totalCount = activeCategoricalSeries.items.reduce((sum, item) => sum + item.count, 0) || 1;

    return activeCategoricalSeries.items.map((item) => ({
      label: item.label,
      value: item.count,
      percentage: (item.count / totalCount) * 100,
    }));
  }, [activeCategoricalSeries]);

  const lineChartRows = useMemo(() => {
    if (!activeDateSeries) {
      return [];
    }

    return activeDateSeries.items.map((item) => ({
      label: item.label,
      value: resolveNumericMetric(item, selectedNumeric),
      count: item.count,
    }));
  }, [activeDateSeries, selectedNumeric]);

  const handleUpload = async (selectedFile: File) => {
    setError("");
    setIsUploading(true);
    setFile(selectedFile);
    setFileName(selectedFile.name);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await axios.post<UploadResponse>(`${API_BASE_URL}/upload`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      setRows(response.data.cleaned_data ?? []);
      setMetadata(response.data.metadata ?? null);
      setStatistics(response.data.statistics ?? {});
      setChartData(response.data.chart_data ?? null);
      setToast({
        title: "Success",
        message: "Data cleaned, analyzed, and visualized successfully.",
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
      setChartData(null);
      setToast(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      void handleUpload(selectedFile);
    }

    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) {
      void handleUpload(droppedFile);
    }
  };

  const resetState = () => {
    setFile(null);
    setRows([]);
    setFileName("");
    setError("");
    setMetadata(null);
    setStatistics({});
    setChartData(null);
    setSelectedCategorical("");
    setSelectedNumeric("");
    setSelectedDatetime("");
    setToast(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const sendChatMessage = async () => {
    const trimmedQuery = chatInput.trim();
    if (!trimmedQuery || isChatting) {
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: trimmedQuery,
    };

    setChatMessages((currentMessages) => [...currentMessages, userMessage]);
    setChatInput("");
    setIsChatting(true);

    try {
      const response = await axios.post<ChatResponse>(`${API_BASE_URL}/chat`, {
        user_query: trimmedQuery,
      });

      const answer = renderChatResult(response.data.result);
      setChatMessages((currentMessages) => [
        ...currentMessages,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: answer,
        },
      ]);
    } catch (requestError) {
      const message =
        axios.isAxiosError(requestError) && requestError.response?.data?.detail
          ? requestError.response.data.detail
          : "I could not answer that right now. Please try again.";

      setChatMessages((currentMessages) => [
        ...currentMessages,
        {
          id: Date.now() + 1,
          role: "error",
          content: message,
        },
      ]);
    } finally {
      setIsChatting(false);
    }
  };

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendChatMessage();
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
                Phase 3 Automated Visualizations
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                AI Data Analyst Platform
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-600 md:text-lg">
                Upload a dataset, let the backend clean and aggregate it, then explore
                modern charted insights with a professional dashboard layout.
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
              Drag and drop a spreadsheet here or click to browse. The backend will
              clean, analyze, and aggregate the file for chart rendering.
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
                  const Icon = card.icon as LucideIcon;

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

              <div className="mt-6 rounded-[1.75rem] border border-slate-200 bg-slate-50/70 p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <h4 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-950">
                      <PieChartIcon className="h-5 w-5 text-indigo-600" />
                      Visual Dashboard
                    </h4>
                    <p className="mt-2 text-sm text-slate-500">
                      Auto-selected charts with manual axis controls for category, metric, and date.
                    </p>
                  </div>
                  <div className="rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 ring-1 ring-slate-200">
                    Bento Grid Charts
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <ChartSelect
                    label="Category axis"
                    value={selectedCategorical}
                    onChange={setSelectedCategorical}
                    options={chartData?.categorical_columns ?? []}
                    placeholder="Select categorical"
                  />
                  <ChartSelect
                    label="Metric axis"
                    value={selectedNumeric}
                    onChange={setSelectedNumeric}
                    options={chartData?.numeric_columns ?? []}
                    placeholder="Count"
                    allowCountFallback
                  />
                  <ChartSelect
                    label="Date axis"
                    value={selectedDatetime}
                    onChange={setSelectedDatetime}
                    options={chartData?.datetime_columns ?? []}
                    placeholder="Select date"
                  />
                </div>

                <div className="mt-6 grid gap-4 xl:grid-cols-12">
                  <ChartCard
                    title="Bar Chart"
                    description={`Distribution of ${selectedCategorical || "a categorical column"}`}
                    badge={selectedCategorical ? `${selectedCategorical}` : "No category selected"}
                    containerRef={barChartRef}
                    onDownload={() => downloadSvgChart(barChartRef, `bar-chart-${selectedCategorical || "chart"}.svg`)}
                    className="xl:col-span-7"
                  >
                    {activeCategoricalSeries && barChartRows.length > 0 ? (
                      <ResponsiveContainer width="100%" height={340}>
                        <BarChart data={barChartRows} margin={{ top: 10, right: 16, left: 4, bottom: 8 }}>
                          <defs>
                            <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.95} />
                              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.85} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="label" tick={{ fill: "#475569", fontSize: 12 }} interval={0} angle={-20} dy={10} />
                          <YAxis tick={{ fill: "#475569", fontSize: 12 }} />
                          <Tooltip
                            contentStyle={{
                              borderRadius: "16px",
                              border: "1px solid #e2e8f0",
                              backgroundColor: "rgba(255,255,255,0.98)",
                              boxShadow: "0 16px 40px -24px rgba(15,23,42,0.55)",
                            }}
                            formatter={(value) => [formatNumber(Number(value)), selectedNumeric || "Count"]}
                          />
                          <Legend />
                          <Bar dataKey="value" name={selectedNumeric || "Count"} fill="url(#barGradient)" radius={[10, 10, 0, 0]}>
                            <LabelList dataKey="value" position="top" formatter={(value) => formatNumber(Number(value))} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <EmptyChartState message="Upload data to generate the categorical distribution chart." />
                    )}
                  </ChartCard>

                  <ChartCard
                    title="Pie Chart"
                    description={`Percentage breakdown of ${selectedCategorical || "a category"}`}
                    badge={selectedCategorical ? `${selectedCategorical}` : "No category selected"}
                    containerRef={pieChartRef}
                    onDownload={() => downloadSvgChart(pieChartRef, `pie-chart-${selectedCategorical || "chart"}.svg`)}
                    className="xl:col-span-5"
                  >
                    {activeCategoricalSeries && pieChartRows.length > 0 ? (
                      <ResponsiveContainer width="100%" height={340}>
                        <PieChart>
                          <Tooltip
                            contentStyle={{
                              borderRadius: "16px",
                              border: "1px solid #e2e8f0",
                              backgroundColor: "rgba(255,255,255,0.98)",
                              boxShadow: "0 16px 40px -24px rgba(15,23,42,0.55)",
                            }}
                            formatter={(value, _name, payload) => {
                              const row = payload?.payload as { percentage?: number } | undefined;
                              return [`${formatNumber(Number(value))} (${formatNumber(row?.percentage ?? 0)}%)`, "Count"];
                            }}
                          />
                          <Pie
                            data={pieChartRows}
                            dataKey="value"
                            nameKey="label"
                            cx="50%"
                            cy="50%"
                            innerRadius={72}
                            outerRadius={120}
                            paddingAngle={3}
                            label={({ percent }) => `${Math.round((percent ?? 0) * 100)}%`}
                          >
                            {pieChartRows.map((entry, index) => (
                              <Cell key={`${entry.label}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <EmptyChartState message="Upload data to generate the category percentage breakdown." />
                    )}
                  </ChartCard>

                  <ChartCard
                    title="Line Chart"
                    description={`Trend of ${selectedNumeric || "record count"} over ${selectedDatetime || "time"}`}
                    badge={selectedDatetime ? `${selectedDatetime}` : "No date selected"}
                    containerRef={lineChartRef}
                    onDownload={() => downloadSvgChart(lineChartRef, `line-chart-${selectedDatetime || "chart"}.svg`)}
                    className="xl:col-span-12"
                  >
                    {activeDateSeries && lineChartRows.length > 0 ? (
                      <ResponsiveContainer width="100%" height={340}>
                        <LineChart data={lineChartRows} margin={{ top: 10, right: 16, left: 4, bottom: 8 }}>
                          <defs>
                            <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.95} />
                              <stop offset="100%" stopColor="#a855f7" stopOpacity={0.95} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="label" tick={{ fill: "#475569", fontSize: 12 }} minTickGap={24} />
                          <YAxis tick={{ fill: "#475569", fontSize: 12 }} />
                          <Tooltip
                            contentStyle={{
                              borderRadius: "16px",
                              border: "1px solid #e2e8f0",
                              backgroundColor: "rgba(255,255,255,0.98)",
                              boxShadow: "0 16px 40px -24px rgba(15,23,42,0.55)",
                            }}
                            formatter={(value) => [formatNumber(Number(value)), selectedNumeric || "Count"]}
                          />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="value"
                            name={selectedNumeric || "Count"}
                            stroke="url(#lineGradient)"
                            strokeWidth={3}
                            dot={{ r: 4, strokeWidth: 2, fill: "#ffffff" }}
                            activeDot={{ r: 7 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <EmptyChartState message="Upload data with a date column to reveal the timeline trend." />
                    )}
                  </ChartCard>
                </div>
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
              No analysis yet. Upload a file to generate cleaned data, metadata, and visualizations.
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
                Showing the first 15 cleaned rows returned by the backend.
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
                Upload a file to populate this preview table. The table will update automatically once the backend responds.
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

      <aside className="fixed bottom-4 right-4 z-40 w-[min(92vw,380px)] rounded-[1.75rem] border border-slate-200 bg-white/95 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-indigo-600 p-2 text-white shadow-sm">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-950">Chat with your Data</p>
              <p className="text-xs text-slate-500">Gemini-powered analysis assistant</p>
            </div>
          </div>
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700">
            AI Chat
          </span>
        </div>

        <div ref={chatListRef} className="max-h-[360px] space-y-3 overflow-y-auto px-4 py-4">
          {chatMessages.map((message) => (
            <ChatBubble key={message.id} message={message} />
          ))}
          {isChatting ? (
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-indigo-100 p-2 text-indigo-700">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-3xl rounded-tl-sm bg-slate-100 px-4 py-3 text-sm text-slate-600 shadow-sm">
                Typing...
              </div>
            </div>
          ) : null}
        </div>

        <form onSubmit={handleChatSubmit} className="border-t border-slate-200 p-4">
          <div className="flex items-end gap-2 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-3 py-3 shadow-sm focus-within:border-indigo-400 focus-within:bg-white">
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder={rows.length > 0 ? "Ask about your data..." : "Upload a file first to start chatting..."}
              rows={2}
              disabled={rows.length === 0 || isUploading}
              className="min-h-[48px] flex-1 resize-none bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || rows.length === 0 || isChatting || isUploading}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            Ask natural language questions like “What are the top categories?” or “Show the average sales by day.”
          </p>
        </form>
      </aside>
    </main>
  );
}

function ChartCard({
  title,
  description,
  badge,
  containerRef,
  onDownload,
  className,
  children,
}: {
  title: string;
  description: string;
  badge: string;
  containerRef: RefObject<HTMLDivElement>;
  onDownload: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={`rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Chart</p>
          <h5 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{title}</h5>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="inline-flex items-center rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
            {badge}
          </span>
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Download Chart as Image
          </button>
        </div>
      </div>

      <div ref={containerRef} className="mt-5 h-[340px] w-full">
        {children}
      </div>
    </article>
  );
}

function ChartSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  allowCountFallback = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  allowCountFallback?: boolean;
}) {
  return (
    <label className="block rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <div className="relative mt-3">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-10 text-sm font-medium text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white"
        >
          {allowCountFallback ? <option value="">Count</option> : <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      </div>
    </label>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isError = message.role === "error";

  return (
    <div className={`flex items-start gap-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser ? (
        <div className={`rounded-2xl p-2 ${isError ? "bg-red-100 text-red-700" : "bg-indigo-100 text-indigo-700"}`}>
          {isError ? <AlertCircle className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>
      ) : null}
      <div
        className={`max-w-[80%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-sm ${
          isUser
            ? "rounded-tr-sm bg-indigo-600 text-white"
            : isError
              ? "rounded-tl-sm bg-red-50 text-red-700 ring-1 ring-red-200"
              : "rounded-tl-sm bg-slate-100 text-slate-700"
        }`}
      >
        <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
          {isUser ? (
            <>
              <User className="h-3 w-3" /> You
            </>
          ) : isError ? (
            <>
              <AlertCircle className="h-3 w-3" /> Error
            </>
          ) : (
            <>
              <Bot className="h-3 w-3" /> Gemini
            </>
          )}
        </div>
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
      {isUser ? (
        <div className="rounded-2xl bg-indigo-100 p-2 text-indigo-700">
          <User className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );
}

function renderChatResult(result: unknown): string {
  if (result === null || result === undefined) {
    return "No result returned.";
  }

  if (typeof result === "string") {
    return result;
  }

  return JSON.stringify(result, null, 2);
}

function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[250px] items-center justify-center rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50 px-6 text-center text-sm leading-6 text-slate-500">
      <div className="max-w-sm">
        <div className="mx-auto mb-4 rounded-full bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <Sparkles className="h-6 w-6 text-slate-400" />
        </div>
        {message}
      </div>
    </div>
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
  icon: LucideIcon;
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
