import { LegalPage } from "@/components/legal-page";

export default function ExplicitContentPage() {
  return (
    <LegalPage
      title="Explicit Content Disclaimer"
      titleEs="Aviso de contenido explícito"
      updated="June 8, 2026"
      childrenEs={
        <>
          <p><strong>Los usuarios pueden encontrar música con lenguaje explícito, temas maduros o contenido para adultos.</strong></p>
          <p>Al crear una cuenta y usar First Listen, reconoces y aceptas esta posibilidad.</p>
          <p>Puedes desactivar <strong>Mostrar contenido explícito</strong> en tu perfil para excluir canciones marcadas como explícitas de tu lista de canciones por escuchar.</p>
          <p>Los artistas son responsables de marcar correctamente los envíos explícitos. Etiquetar incorrectamente puede ser reportado y moderado.</p>
        </>
      }
    >
      <p><strong>Users may encounter music containing explicit language, mature themes, or adult subject matter.</strong></p>
      <p>By creating an account and using First Listen, you acknowledge and accept this possibility.</p>
      <p>You can disable <strong>Show Explicit Content</strong> in your profile to exclude songs marked explicit from your review queue.</p>
      <p>Artists are responsible for accurately marking explicit submissions. Mislabeling may be reported and moderated.</p>
    </LegalPage>
  );
}
