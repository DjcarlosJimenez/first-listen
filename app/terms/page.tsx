import { LegalPage } from "@/components/legal-page";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      titleEs="Términos de servicio"
      updated="June 8, 2026"
      childrenEs={
        <>
          <h2>Servicio</h2>
          <p>First Listen ofrece feedback y analítica para enlaces de música. No aloja, sube ni guarda audio.</p>
          <h2>Cuentas</h2>
          <p>Debes proporcionar información correcta, proteger tu contraseña y usar el servicio legalmente.</p>
          <h2>Contenido enviado</h2>
          <p>Confirmas que tienes autorización para enviar cada enlace musical y su metadata. Envíos duplicados, ilegales, engañosos o abusivos pueden ser retirados.</p>
          <h2>Feedback</h2>
          <p>Las reseñas deben ser honestas y constructivas. Spam, comentarios copiados, manipulación y acoso están prohibidos y pueden causar suspensión.</p>
          <h2>Disponibilidad</h2>
          <p>La beta pública se ofrece sin garantía de disponibilidad continua. Podemos limitar cuentas o contenido para proteger usuarios y la plataforma.</p>
        </>
      }
    >
      <h2>Service</h2>
      <p>First Listen provides music-link feedback and analytics. It does not host, upload, or store audio.</p>
      <h2>Accounts</h2>
      <p>You must provide accurate account information, protect your password, and use the service lawfully.</p>
      <h2>Submitted content</h2>
      <p>You confirm that you are authorized to submit each music link and associated metadata. Duplicate, illegal, deceptive, or abusive submissions may be removed.</p>
      <h2>Feedback</h2>
      <p>Reviews must be honest and constructive. Spam, copied comments, manipulation, and harassment are prohibited and may result in suspended access.</p>
      <h2>Availability</h2>
      <p>The public beta is provided without guarantees of uninterrupted availability. Accounts or content may be restricted to protect users and the platform.</p>
    </LegalPage>
  );
}
