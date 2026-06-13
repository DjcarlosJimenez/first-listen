import { LegalPage } from "@/components/legal-page";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      titleEs="Política de privacidad"
      updated="June 8, 2026"
      childrenEs={
        <>
          <h2>Datos recopilados</h2>
          <p>Guardamos datos de cuenta, preferencias de perfil, metadata y enlaces de canciones, reseñas, reportes, créditos y registros de seguridad/auditoría.</p>
          <h2>Audio</h2>
          <p>First Listen no sube, aloja ni guarda archivos de audio. La reproducción ocurre en la plataforma musical enlazada.</p>
          <h2>Uso de datos</h2>
          <p>Los datos se usan para autenticar usuarios, conectar canciones con oyentes, ofrecer analítica, prevenir abuso y operar moderación.</p>
          <h2>Acceso</h2>
          <p>El feedback privado está limitado por políticas de acceso de base de datos. Personal autorizado puede acceder a registros cuando sea necesario por administración, seguridad o moderación.</p>
          <h2>Contacto y eliminación</h2>
          <p>Los usuarios pueden solicitar corrección o eliminación de datos de cuenta mediante el administrador, sujeto a requisitos legales y de seguridad.</p>
        </>
      }
    >
      <h2>Data collected</h2>
      <p>We store account details, profile preferences, song metadata and links, reviews, reports, credits, and security/audit records.</p>
      <h2>Audio</h2>
      <p>First Listen does not upload, host, or store audio files. Playback occurs on the linked music platform.</p>
      <h2>Use of data</h2>
      <p>Data is used to authenticate users, match reviews, provide analytics, prevent abuse, and operate moderation.</p>
      <h2>Access</h2>
      <p>Private feedback is limited by database access policies. Authorized staff may access records when required for administration, security, or moderation.</p>
      <h2>Contact and deletion</h2>
      <p>Users may request correction or deletion of account data through the platform administrator, subject to legal and security retention requirements.</p>
    </LegalPage>
  );
}
