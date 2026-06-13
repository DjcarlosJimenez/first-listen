import { LegalPage } from "@/components/legal-page";

export default function GuidelinesPage() {
  return (
    <LegalPage
      title="Community Guidelines"
      titleEs="Guías de la comunidad"
      updated="June 8, 2026"
      childrenEs={
        <>
          <h2>Sé útil</h2>
          <p>Escucha antes de dejar una reseña, responde honestamente y explica el momento específico que formó tu reacción.</p>
          <h2>Sin abuso</h2>
          <p>No acoses artistas, no suplantes a otros, no manipules ratings, no copies comentarios y no envíes feedback automatizado.</p>
          <h2>Solo música válida</h2>
          <p>Los enlaces deben apuntar a música en una plataforma compatible. Reporta spam, enlaces rotos, contenido que no sea música y contenido ilegal.</p>
          <h2>Aplicación</h2>
          <p>Los moderadores pueden retirar canciones inválidas, resolver reportes y marcar spam. Violaciones repetidas o graves pueden resultar en suspensión.</p>
        </>
      }
    >
      <h2>Be useful</h2>
      <p>Listen before reviewing, answer honestly, and explain the specific moment that shaped your reaction.</p>
      <h2>No abuse</h2>
      <p>Do not harass artists, impersonate others, manipulate ratings, copy comments, or submit automated feedback.</p>
      <h2>Valid music only</h2>
      <p>Links must point to music on a supported platform. Spam, broken links, non-music, and illegal content should be reported.</p>
      <h2>Enforcement</h2>
      <p>Moderators may remove invalid songs, resolve reports, and flag spam. Repeated or serious violations may result in account suspension.</p>
    </LegalPage>
  );
}
