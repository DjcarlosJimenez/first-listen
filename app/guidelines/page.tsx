import { LegalPage } from "@/components/legal-page";

export default function GuidelinesPage() {
  return (
    <LegalPage
      title="Community Guidelines"
      titleEs="Guías de la comunidad"
      updated="November 4, 2026"
      childrenEs={
        <>
          <h2>Personas reales, decisiones reales</h2>
          <p>Escucha porque quieres descubrir música. Puedes pausar, saltar o marcar “No es para mí”. No uses bots, granjas, múltiples cuentas ni acuerdos de reproducción por reproducción.</p>
          <h2>Respeto y seguridad</h2>
          <p>No acoses, amenaces, discrimines, expongas información privada ni suplantes a otra persona. No publiques contenido ilegal, sexualmente explotador, violento o que promueva daño.</p>
          <h2>Derechos y contenido válido</h2>
          <p>Comparte enlaces musicales legítimos que estés autorizado a publicar. No envíes spam, malware, enlaces engañosos, contenido que no sea música ni material que infrinja derechos de autor.</p>
          <h2>Reportar y bloquear</h2>
          <p>Usa Reportar para enviar canciones, comentarios o perfiles a moderación. Usa Bloquear para dejar de seguir y ocultar de tu experiencia el contenido de otro usuario. Los reportes falsos o abusivos también pueden ser moderados.</p>
          <h2>Aplicación de reglas</h2>
          <p>Podemos ocultar contenido, emitir advertencias, suspender cuentas o cerrar acceso. Evaluamos contexto, gravedad, repetición y riesgo para la comunidad.</p>
        </>
      }
    >
      <h2>Real people, real choices</h2>
      <p>Listen because you want to discover music. You can pause, skip, or choose “Not for me.” Do not use bots, farms, multiple accounts, or play-for-play agreements.</p>
      <h2>Respect and safety</h2>
      <p>Do not harass, threaten, discriminate, expose private information, or impersonate others. Do not post illegal, sexually exploitative, violent, or harmful content.</p>
      <h2>Rights and valid content</h2>
      <p>Share legitimate music links you are authorized to publish. Do not submit spam, malware, deceptive links, non-music content, or copyright-infringing material.</p>
      <h2>Report and block</h2>
      <p>Use Report to send songs, comments, or profiles to moderation. Use Block to unfollow and remove another user’s content from your experience. False or abusive reports may also be moderated.</p>
      <h2>Enforcement</h2>
      <p>We may hide content, issue warnings, suspend accounts, or terminate access. We consider context, severity, repetition, and community risk.</p>
    </LegalPage>
  );
}
