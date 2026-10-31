export type SiteAnalyticsScope = "artist" | "platform";
export type SiteAnalyticsPeriod = "7" | "30" | "90" | "all";

export type SiteAnalyticsReport = {
  startedAt: string | null;
  metrics: {
    actions: number;
    members: number;
    returning: number;
    visitors: number;
    visits: number;
  };
  series: Array<{ label: string; value: number }>;
  sources: Array<{ label: string; value: number }>;
  devices: Array<{ label: string; value: number }>;
  content: Array<{ kind: string; title: string; views: number }>;
  recent: Array<{
    content_kind: string | null;
    content_label: string | null;
    created_at: string;
    device_type: string;
    event_type: "action" | "page_view";
    source_label: string;
  }>;
};

export const emptySiteAnalyticsReport: SiteAnalyticsReport = {
  startedAt: null,
  metrics: { actions: 0, members: 0, returning: 0, visitors: 0, visits: 0 },
  series: [],
  sources: [],
  devices: [],
  content: [],
  recent: [],
};

export function normalizeSiteAnalyticsReport(value: unknown): SiteAnalyticsReport {
  if (!value || typeof value !== "object") return emptySiteAnalyticsReport;
  const report = value as Record<string, unknown>;
  const metrics = report.metrics && typeof report.metrics === "object"
    ? report.metrics as Record<string, unknown>
    : {};
  const number = (input: unknown) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  };
  const rows = (input: unknown) => Array.isArray(input) ? input : [];

  return {
    startedAt: typeof report.startedAt === "string" ? report.startedAt : null,
    metrics: {
      actions: number(metrics.actions),
      members: number(metrics.members),
      returning: number(metrics.returning),
      visitors: number(metrics.visitors),
      visits: number(metrics.visits),
    },
    series: rows(report.series).map((item) => {
      const row = item as Record<string, unknown>;
      return { label: String(row.label ?? ""), value: number(row.value) };
    }),
    sources: rows(report.sources).map((item) => {
      const row = item as Record<string, unknown>;
      return { label: String(row.label ?? "Directo"), value: number(row.value) };
    }),
    devices: rows(report.devices).map((item) => {
      const row = item as Record<string, unknown>;
      return { label: String(row.label ?? "Otro"), value: number(row.value) };
    }),
    content: rows(report.content).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        kind: String(row.kind ?? "Pagina"),
        title: String(row.title ?? "Pagina"),
        views: number(row.views),
      };
    }),
    recent: rows(report.recent).map((item) => {
      const row = item as Record<string, unknown>;
      return {
        content_kind: typeof row.content_kind === "string" ? row.content_kind : null,
        content_label: typeof row.content_label === "string" ? row.content_label : null,
        created_at: String(row.created_at ?? ""),
        device_type: String(row.device_type ?? "Otro"),
        event_type: row.event_type === "action" ? "action" : "page_view",
        source_label: String(row.source_label ?? "Directo"),
      };
    }),
  };
}
