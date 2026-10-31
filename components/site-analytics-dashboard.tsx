"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowLeft, BarChart3, Disc3, Eye, Globe2, Monitor,
  MousePointerClick, Music2, Smartphone, UserRoundCheck, Users, Video,
} from "lucide-react";
import {
  emptySiteAnalyticsReport,
  normalizeSiteAnalyticsReport,
  type SiteAnalyticsPeriod,
  type SiteAnalyticsReport,
  type SiteAnalyticsScope,
} from "@/lib/site-analytics";

const periodLabels: Record<SiteAnalyticsPeriod, string> = {
  "7": "7 dias", "30": "30 dias", "90": "90 dias", all: "Todo el tiempo",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-MX").format(value);
}

function relativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recientemente";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  return `Hace ${Math.floor(hours / 24)} dias`;
}

export function SiteAnalyticsDashboard({
  allowedScopes = ["artist"], artistSlug = "djcarlosjimenez",
  backHref = "/DJCarlosJimenez/admin", initialScope = "artist",
}: {
  allowedScopes?: SiteAnalyticsScope[];
  artistSlug?: string;
  backHref?: string;
  initialScope?: SiteAnalyticsScope;
}) {
  const [scope, setScope] = useState<SiteAnalyticsScope>(initialScope);
  const [period, setPeriod] = useState<SiteAnalyticsPeriod>("30");
  const [report, setReport] = useState<SiteAnalyticsReport>(emptySiteAnalyticsReport);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ period, scope });
    if (scope === "artist") params.set("artist", artistSlug);
    void fetch(`/api/analytics/report?${params}`, {
      cache: "no-store", credentials: "same-origin", signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se pudo abrir el reporte.");
      setReport(normalizeSiteAnalyticsReport(data.report));
    }).catch((reason) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setReport(emptySiteAnalyticsReport);
      setError(reason instanceof Error ? reason.message : "No se pudo abrir el reporte.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [artistSlug, period, scope]);

  const totalSources = useMemo(
    () => report.sources.reduce((sum, item) => sum + item.value, 0),
    [report.sources],
  );
  const totalDevices = useMemo(
    () => report.devices.reduce((sum, item) => sum + item.value, 0),
    [report.devices],
  );
  const maxSeries = Math.max(1, ...report.series.map((item) => item.value));
  const title = scope === "artist" ? "DJ Carlos Jimenez" : "First Listen";
  const subtitle = scope === "artist"
    ? "Estadisticas privadas de tu pagina de artista"
    : "Resumen privado para Owner y administradores";
  const trackingStart = report.startedAt
    ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(report.startedAt))
    : "Comienza con esta actualizacion";

  return (
    <main className="artist-analytics-page">
      <header className="artist-analytics-header">
        <div>
          <Link href={backHref}><ArrowLeft size={16} /> Volver al panel</Link>
          <span>Reporte privado</span><h1>Actividad y visitas</h1><p>{subtitle}</p>
        </div>
        {allowedScopes.length > 1 && <div className="artist-analytics-scope" aria-label="Seleccionar reporte">
          {allowedScopes.includes("artist") && <button className={scope === "artist" ? "is-active" : ""} onClick={() => setScope("artist")} type="button">DJ Carlos</button>}
          {allowedScopes.includes("platform") && <button className={scope === "platform" ? "is-active" : ""} onClick={() => setScope("platform")} type="button">First Listen</button>}
        </div>}
      </header>

      <section className="artist-analytics-toolbar">
        <div><strong>{title}</strong><small>Contador real · inicio: {trackingStart}</small></div>
        <div>{(Object.keys(periodLabels) as SiteAnalyticsPeriod[]).map((value) => (
          <button className={period === value ? "is-active" : ""} key={value} onClick={() => setPeriod(value)} type="button">{periodLabels[value]}</button>
        ))}</div>
      </section>
      {error && <div className="artist-analytics-error" role="alert">{error}</div>}

      <section className={loading ? "artist-analytics-metrics is-loading" : "artist-analytics-metrics"}>
        <article><Eye size={19} /><strong>{formatNumber(report.metrics.visits)}</strong><span>Visitas totales</span><small>{period === "all" ? "Acumuladas desde el inicio" : `Durante ${periodLabels[period]}`}</small></article>
        <article><Users size={19} /><strong>{formatNumber(report.metrics.visitors)}</strong><span>Visitantes unicos</span><small>Sin repetir el mismo dispositivo</small></article>
        <article><UserRoundCheck size={19} /><strong>{formatNumber(report.metrics.members)}</strong><span>Miembros de First Listen</span><small>Visitantes con sesion iniciada</small></article>
        <article><Activity size={19} /><strong>{formatNumber(report.metrics.returning)}</strong><span>Regresaron a la pagina</span><small>Con mas de una sesion</small></article>
        <article><MousePointerClick size={19} /><strong>{formatNumber(report.metrics.actions)}</strong><span>Acciones realizadas</span><small>Reproducir, compartir o abrir enlaces</small></article>
      </section>

      <section className="artist-analytics-grid">
        <article className="artist-analytics-card artist-analytics-chart-card">
          <div className="artist-analytics-card-head"><div><BarChart3 size={17} /><span>Visitas por periodo</span></div><small>{period === "all" ? "Desde que inicio el contador" : `Ultimos ${periodLabels[period]}`}</small></div>
          {report.series.length ? <div className="artist-analytics-chart" aria-label="Grafica de visitas">{report.series.map((item) => <div key={item.label} title={`${item.label}: ${item.value}`}><span style={{ height: `${Math.max(4, item.value / maxSeries * 100)}%` }} /><small>{item.label}</small></div>)}</div> : <p className="artist-analytics-empty">Las primeras visitas apareceran aqui.</p>}
        </article>

        <article className="artist-analytics-card">
          <div className="artist-analytics-card-head"><div><Globe2 size={17} /><span>De donde llegan</span></div></div>
          {report.sources.length ? <div className="artist-analytics-breakdown">{report.sources.map((item) => {
            const percent = totalSources ? Math.round(item.value / totalSources * 100) : 0;
            return <div key={item.label}><span><b>{item.label}</b><em>{percent}%</em></span><i><b style={{ width: `${percent}%` }} /></i></div>;
          })}</div> : <p className="artist-analytics-empty">Aun no hay fuentes registradas.</p>}
        </article>

        <article className="artist-analytics-card">
          <div className="artist-analytics-card-head"><div><Smartphone size={17} /><span>Dispositivos</span></div></div>
          {report.devices.length ? <div className="artist-analytics-devices">{report.devices.map((item) => {
            const percent = totalDevices ? Math.round(item.value / totalDevices * 100) : 0;
            const Icon = item.label === "Movil" ? Smartphone : item.label === "Computadora" ? Monitor : Globe2;
            return <div key={item.label}><Icon size={24} /><strong>{percent}%</strong><span>{item.label}</span></div>;
          })}</div> : <p className="artist-analytics-empty">Aun no hay dispositivos registrados.</p>}
        </article>

        <article className="artist-analytics-card artist-analytics-content-card">
          <div className="artist-analytics-card-head"><div><Music2 size={17} /><span>Contenido mas visitado</span></div></div>
          {report.content.length ? <div className="artist-analytics-content-list">{report.content.map((item, index) => <div key={`${item.title}-${index}`}><span>{index + 1}</span>{item.kind === "Album" ? <Disc3 size={17} /> : item.kind === "Video" ? <Video size={17} /> : <Music2 size={17} />}<div><strong>{item.title}</strong><small>{item.kind}</small></div><b>{formatNumber(item.views)}</b></div>)}</div> : <p className="artist-analytics-empty">El contenido mas visitado aparecera aqui.</p>}
        </article>

        <article className="artist-analytics-card artist-analytics-activity-card">
          <div className="artist-analytics-card-head"><div><Activity size={17} /><span>Actividad reciente</span></div></div>
          {report.recent.length ? <ul>{report.recent.map((item, index) => <li key={`${item.created_at}-${index}`}><i /><div><strong>{item.event_type === "action" ? "Interaccion" : "Visita"}: {item.content_label || "Pagina"}</strong><small>{relativeTime(item.created_at)} · {item.device_type} · {item.source_label}</small></div></li>)}</ul> : <p className="artist-analytics-empty">La actividad nueva aparecera aqui.</p>}
        </article>
      </section>

      <aside className="artist-analytics-note"><strong>Reporte privado y respetuoso de la privacidad.</strong><span>No se muestran nombres, correos ni direcciones IP. “Todo el tiempo” suma desde que este contador fue activado.</span></aside>
    </main>
  );
}
