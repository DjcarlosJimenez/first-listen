"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  CircleHelp,
  Headphones,
  Link2,
  MessageSquareText,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { FeedbackCenterForm } from "@/components/feedback-center-form";
import { Logo } from "@/components/logo";
import { useInterfaceLocale } from "@/lib/use-interface-locale";

const helpTopics = [
  {
    icon: Headphones,
    title: "Reviewing songs",
    body: "Listen to the opening, answer every required question, and leave a specific comment of at least 30 characters. Low-quality or repeated feedback does not count.",
  },
  {
    icon: Link2,
    title: "Submitting music",
    body: "Submit a direct song link from Spotify, YouTube, YouTube Music, SoundCloud, or Apple Music. First Listen stores metadata and links, never audio.",
  },
  {
    icon: BarChart3,
    title: "Understanding results",
    body: "Hook Score combines Listen Full, Playlist Add, Attention, and Share With Friend percentages. Your analytics keep each song's performance separate.",
  },
  {
    icon: UserPlus,
    title: "Following artists",
    body: "Follow artists from their public profile or after a review. Following records listener interest without exposing private account information.",
  },
  {
    icon: Bookmark,
    title: "Saving songs",
    body: "Use Save For Later after a review or on an artist profile. Saved links remain attached to your account for future listening.",
  },
  {
    icon: ShieldCheck,
    title: "Safety and moderation",
    body: "Report spam, broken links, non-music, illegal content, or offensive content. Moderators can review reports and remove invalid submissions.",
  },
];

const helpTopicsEs = [
  {
    icon: Headphones,
    title: "Escuchar canciones",
    body: "Escucha el inicio, responde las preguntas requeridas y deja un comentario específico de al menos 30 caracteres. El feedback repetido o de baja calidad no cuenta.",
  },
  {
    icon: Link2,
    title: "Enviar música",
    body: "Envía un enlace directo de Spotify, YouTube, YouTube Music, SoundCloud o Apple Music. First Listen guarda metadata y enlaces, nunca audio.",
  },
  {
    icon: BarChart3,
    title: "Entender resultados",
    body: "Hook Score combina escuchar completa, agregar a playlist, atención y compartir con un amigo. Tus analíticas mantienen separados los resultados de cada canción.",
  },
  {
    icon: UserPlus,
    title: "Seguir artistas",
    body: "Sigue artistas desde su perfil público o después de escuchar una canción. Seguir registra interés real sin exponer información privada.",
  },
  {
    icon: Bookmark,
    title: "Guardar canciones",
    body: "Usa Guardar para después tras escuchar o desde el perfil de artista. Los enlaces guardados quedan en tu cuenta para volver a escucharlos.",
  },
  {
    icon: ShieldCheck,
    title: "Seguridad y moderación",
    body: "Reporta spam, enlaces rotos, contenido que no sea música, contenido ilegal u ofensivo. Los moderadores pueden revisar reportes y retirar envíos inválidos.",
  },
];

export default function HelpPage() {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";
  const topics = spanish ? helpTopicsEs : helpTopics;

  return (
    <main className="help-page">
      <header className="account-header">
        <Logo />
        <Link href="/dashboard"><ArrowLeft size={16} /> {spanish ? "Volver a descubrir música" : "Back to discovery"}</Link>
      </header>

      <section className="help-hero">
        <span className="help-icon"><CircleHelp size={24} /></span>
        <span className="eyebrow">{spanish ? "Centro de ayuda" : "Support Center"}</span>
        <h1>
          {spanish
            ? "Recibe feedback útil y descubre tu próximo artista favorito."
            : "Get useful feedback and discover your next favorite artist."}
        </h1>
        <p>
          {spanish
            ? "First Listen conecta primeras impresiones honestas con escucha directa, seguidores y canciones guardadas."
            : "First Listen connects honest first impressions with direct listening, following, and saving actions."}
        </p>
        <div className="support-contact-strip">
          <strong>{spanish ? "¿Necesitas ayuda?" : "Need Help?"}</strong>
          <a href="mailto:support@firstlisten.net">support@firstlisten.net</a>
          <a href="#feedback-center">{spanish ? "Abrir formulario de soporte" : "Open support form"}</a>
        </div>
      </section>

      <section className="help-topic-grid">
        {topics.map(({ icon: Icon, title, body }) => (
          <article key={title}>
            <Icon size={20} />
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="help-steps">
        <div>
          <MessageSquareText size={20} />
          <h2>{spanish ? "¿Todavía necesitas ayuda?" : "Still need help?"}</h2>
          <p>
            {spanish
              ? "Consulta las reglas, privacidad y ajustes de contenido explícito, o vuelve a tu perfil para revisar tu cuenta."
              : "Check the platform rules and privacy details, or return to your profile to review account and explicit-content settings."}
          </p>
        </div>
        <nav aria-label="Help resources">
          <Link href="/profile">{spanish ? "Ajustes de cuenta" : "Account settings"}</Link>
          <Link href="/guidelines">{spanish ? "Guías de la comunidad" : "Community Guidelines"}</Link>
          <Link href="/privacy">{spanish ? "Política de privacidad" : "Privacy Policy"}</Link>
          <Link href="/terms">{spanish ? "Términos de servicio" : "Terms of Service"}</Link>
        </nav>
      </section>

      <FeedbackCenterForm supportEmail="support@firstlisten.net" />
    </main>
  );
}
