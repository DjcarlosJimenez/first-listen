import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      titleEs="Política de privacidad"
      updated="November 4, 2026"
      childrenEs={
        <>
          <h2>Quién opera First Listen</h2>
          <p>First Listen es operado por DJ Carlos Jimenez. Para privacidad, seguridad o derechos de datos, escribe a <a href="mailto:support@firstlisten.net">support@firstlisten.net</a>.</p>
          <h2>Datos que recopilamos</h2>
          <p>Podemos guardar correo, nombre de perfil, preferencias, enlaces y metadata musical, actividad de reproducción, reseñas, seguidores, reportes, información técnica básica y registros de seguridad o auditoría.</p>
          <h2>Cómo usamos los datos</h2>
          <p>Usamos estos datos para autenticar cuentas, mostrar música, medir actividad real, mantener una rotación justa, ofrecer estadísticas, prevenir fraude, atender reportes y proteger a la comunidad. Las reproducciones no generan pagos, tokens ni prioridad.</p>
          <h2>Audio y proveedores</h2>
          <p>First Listen no aloja archivos de audio enviados por usuarios en la plataforma principal. La reproducción ocurre mediante enlaces o reproductores autorizados de servicios externos. Para operar el servicio utilizamos proveedores como Supabase, Vercel y Resend, sujetos a sus propias medidas de seguridad.</p>
          <h2>Retención y seguridad</h2>
          <p>Conservamos los datos mientras la cuenta esté activa o sean necesarios para operar el servicio. Después de eliminar una cuenta podemos conservar registros mínimos de seguridad, cumplimiento o resolución de disputas cuando sea legalmente necesario.</p>
          <h2>Tus controles</h2>
          <p>Puedes modificar preferencias, reportar contenido, bloquear usuarios y eliminar tu cuenta desde First Listen. La eliminación se inicia en <Link href="/delete-account">Eliminar cuenta</Link> y también está enlazada dentro de tu perfil.</p>
          <h2>Menores y cambios</h2>
          <p>First Listen no está dirigido a menores de 13 años. Podemos actualizar esta política cuando cambien las funciones o requisitos legales; publicaremos la fecha de la revisión.</p>
        </>
      }
    >
      <h2>Who operates First Listen</h2>
      <p>First Listen is operated by DJ Carlos Jimenez. For privacy, security, or data-rights questions, contact <a href="mailto:support@firstlisten.net">support@firstlisten.net</a>.</p>
      <h2>Data we collect</h2>
      <p>We may store email, profile name, preferences, music links and metadata, playback activity, reviews, follows, reports, basic technical information, and security or audit records.</p>
      <h2>How we use data</h2>
      <p>We use this data to authenticate accounts, display music, measure genuine activity, maintain fair rotation, provide analytics, prevent fraud, process reports, and protect the community. Plays do not award payments, tokens, or priority.</p>
      <h2>Audio and service providers</h2>
      <p>First Listen does not host user-submitted audio files in the main platform. Playback occurs through links or authorized players from external services. We use providers such as Supabase, Vercel, and Resend to operate the service, subject to their security practices.</p>
      <h2>Retention and security</h2>
      <p>We retain data while an account is active or as needed to operate the service. After account deletion, minimal security, compliance, or dispute-resolution records may be retained where legally required.</p>
      <h2>Your controls</h2>
      <p>You can change preferences, report content, block users, and delete your account inside First Listen. Start deletion at <Link href="/delete-account">Delete account</Link>, also linked from your profile.</p>
      <h2>Children and updates</h2>
      <p>First Listen is not directed to children under 13. We may update this policy when features or legal requirements change and will post the revision date.</p>
    </LegalPage>
  );
}
