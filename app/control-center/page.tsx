import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Brush,
  Flag,
  Gauge,
  Megaphone,
  Music2,
  PanelsTopLeft,
  ShieldCheck,
  TimerReset,
  UsersRound,
} from "lucide-react";
import {
  CreatorActivityControls,
  type CreatorActivitySettings,
} from "@/components/creator-activity-controls";
import { Logo } from "@/components/logo";
import {
  hasAdminAccess,
  hasModeratorAccess,
  hasOwnerAccess,
} from "@/lib/admin-access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ManagementRole = "owner" | "admin" | "moderator";

type ManagementCard = {
  description: string;
  eyebrow: string;
  href: string;
  icon: typeof Gauge;
  roles: ManagementRole[];
  title: string;
};

type AdminStatistics = {
  active_songs?: number | null;
  open_reports?: number | null;
  songs?: number | null;
  users?: number | null;
};

const managementCards: ManagementCard[] = [
  {
    description:
      "Publica cambios, revisa la configuración global y administra las funciones maestras de FirstListen.",
    eyebrow: "Plataforma",
    href: "/owner",
    icon: Gauge,
    roles: ["owner"],
    title: "Control maestro",
  },
  {
    description:
      "Consulta cuentas, estados, permisos y envía correos seguros para recuperar contraseñas.",
    eyebrow: "Cuentas",
    href: "/admin?section=users",
    icon: UsersRound,
    roles: ["owner", "admin"],
    title: "Usuarios y recuperación",
  },
  {
    description:
      "Revisa publicaciones, activa o retira contenido y corrige información de canciones.",
    eyebrow: "Catálogo",
    href: "/admin?section=songs",
    icon: Music2,
    roles: ["owner", "admin"],
    title: "Música y publicaciones",
  },
  {
    description:
      "Activa o desactiva el archivado automático y define los días de inactividad permitidos.",
    eyebrow: "Rotación",
    href: "/control-center#creator-activity",
    icon: TimerReset,
    roles: ["owner", "admin"],
    title: "Actividad de artistas",
  },
  {
    description:
      "Atiende reportes de canciones, perfiles y comentarios con herramientas de moderación.",
    eyebrow: "Seguridad",
    href: "/admin?section=reports",
    icon: Flag,
    roles: ["owner", "admin"],
    title: "Moderación y reportes",
  },
  {
    description:
      "Crea, publica y asigna páginas personalizadas sin modificar otras cuentas de artistas.",
    eyebrow: "Artistas",
    href: "/owner/artist-pages",
    icon: PanelsTopLeft,
    roles: ["owner"],
    title: "Páginas de artistas",
  },
  {
    description:
      "Prepara avisos dentro de la plataforma y controla a quién y cuándo se muestran.",
    eyebrow: "Comunicaciones",
    href: "/admin?section=announcements",
    icon: Megaphone,
    roles: ["owner", "admin"],
    title: "Anuncios y mensajes",
  },
  {
    description:
      "Ajusta la identidad visual, los colores y la presentación pública de FirstListen.",
    eyebrow: "Diseño",
    href: "/admin?section=appearance",
    icon: Brush,
    roles: ["owner", "admin"],
    title: "Apariencia",
  },
  {
    description:
      "Consulta actividad, crecimiento y comportamiento real para tomar mejores decisiones.",
    eyebrow: "Información",
    href: "/owner/analytics",
    icon: BarChart3,
    roles: ["owner"],
    title: "Estadísticas y visitas",
  },
  {
    description:
      "Supervisa el estado de la comunidad, las señales de riesgo y la operación diaria.",
    eyebrow: "Operación",
    href: "/admin?section=health",
    icon: Activity,
    roles: ["owner", "admin"],
    title: "Salud y seguridad",
  },
];

const roleLabels: Record<ManagementRole, string> = {
  admin: "Administrador",
  moderator: "Moderador",
  owner: "Propietario",
};

export default async function ControlCenterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/control-center");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, role, founder_number")
    .eq("id", user.id)
    .maybeSingle();

  const ownerAccess = hasOwnerAccess(profile, user.email);
  const adminAccess = hasAdminAccess(profile, user.email);
  const moderatorAccess = hasModeratorAccess(profile);

  if (!ownerAccess && !adminAccess && !moderatorAccess) {
    redirect("/dashboard");
  }

  const managementRole: ManagementRole = ownerAccess
    ? "owner"
    : adminAccess
      ? "admin"
      : "moderator";
  const displayName =
    String(profile?.display_name ?? "").trim() ||
    user.email?.split("@")[0] ||
    "FirstListen";

  const statisticsResult =
    managementRole === "moderator"
      ? { data: null }
      : await supabase.rpc("admin_get_statistics");
  const rawStatistics = statisticsResult.data;
  const statistics = (
    Array.isArray(rawStatistics) ? rawStatistics[0] : rawStatistics
  ) as AdminStatistics | null;
  const creatorActivityResult =
    managementRole === "moderator"
      ? { data: null }
      : await supabase.rpc("admin_get_creator_activity_settings");
  const creatorActivitySettings =
    creatorActivityResult.data &&
    typeof creatorActivityResult.data === "object" &&
    !Array.isArray(creatorActivityResult.data)
      ? (creatorActivityResult.data as CreatorActivitySettings)
      : null;

  const visibleCards = managementCards
    .filter((card) => card.roles.includes(managementRole))
    .map((card) =>
      managementRole === "moderator" && card.title === "Moderación y reportes"
        ? { ...card, href: "/admin/reports" }
        : managementRole === "admin" && card.title === "Estadísticas y visitas"
          ? { ...card, href: "/admin?section=statistics" }
          : card,
    );

  return (
    <main className="management-hub-page">
      <header className="management-hub-header">
        <Logo />
        <nav aria-label="Navegación del centro de control">
          <Link href="/dashboard">
            <ArrowLeft size={16} /> Ver FirstListen
          </Link>
          <Link href="/profile">Mi cuenta</Link>
        </nav>
      </header>

      <section className="management-hub-hero">
        <div>
          <span className="management-hub-kicker">
            <ShieldCheck size={15} /> Acceso protegido
          </span>
          <h1>Centro de Control FirstListen</h1>
          <p>
            Todo lo necesario para administrar la plataforma, organizado por
            función y visible únicamente para las cuentas autorizadas.
          </p>
        </div>
        <aside>
          <span>Sesión actual</span>
          <strong>{displayName}</strong>
          <small>{roleLabels[managementRole]}</small>
        </aside>
      </section>

      <section className="management-hub-summary" aria-label="Resumen de la plataforma">
        <article>
          <span>Tu permiso</span>
          <strong>{roleLabels[managementRole]}</strong>
          <small>Solo ves las herramientas autorizadas</small>
        </article>
        <article>
          <span>Usuarios</span>
          <strong>{statistics?.users ?? "—"}</strong>
          <small>Cuentas registradas</small>
        </article>
        <article>
          <span>Canciones</span>
          <strong>{statistics?.songs ?? "—"}</strong>
          <small>{statistics?.active_songs ?? "—"} activas</small>
        </article>
        <article>
          <span>Por atender</span>
          <strong>{statistics?.open_reports ?? "—"}</strong>
          <small>Reportes abiertos</small>
        </article>
      </section>

      {managementRole !== "moderator" && (
        <CreatorActivityControls initialSettings={creatorActivitySettings} />
      )}

      <section className="management-hub-directory">
        <div className="management-hub-section-heading">
          <div>
            <span>Herramientas disponibles</span>
            <h2>¿Qué quieres administrar?</h2>
          </div>
          <p>
            Los paneles existentes siguen intactos; esta pantalla los reúne en
            un solo lugar para que no vuelvan a quedar escondidos.
          </p>
        </div>

        <div className="management-hub-grid">
          {visibleCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link href={card.href} key={card.title}>
                <span className="management-hub-card-icon">
                  <Icon size={22} />
                </span>
                <span className="management-hub-card-copy">
                  <small>{card.eyebrow}</small>
                  <strong>{card.title}</strong>
                  <p>{card.description}</p>
                </span>
                <ArrowRight className="management-hub-card-arrow" size={20} />
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
