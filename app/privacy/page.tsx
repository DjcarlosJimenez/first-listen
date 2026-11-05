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
          <h2>Alcance</h2>
          <p>Esta política cubre el sitio web, la aplicación web instalable y cualquier aplicación Android oficial de First Listen que muestre el mismo servicio.</p>
          <h2>Cuenta y perfil</h2>
          <p>Si creas una cuenta, podemos guardar tu correo, nombre de perfil, identificador de cuenta, foto opcional, país musical, idioma y preferencias de géneros. También conservamos datos necesarios para iniciar sesión, recuperar la cuenta y administrar tus publicaciones.</p>
          <h2>Contenido que decides compartir</h2>
          <p>Podemos guardar enlaces y metadata musical, portadas, nombres de artista, reseñas, comentarios, preferencias, canciones guardadas, seguidores, reportes y otros datos que envíes. Las páginas personalizadas de artistas también pueden alojar imágenes de identidad y adelantos de audio cortos que su administrador suba voluntariamente.</p>
          <h2>Actividad, dispositivo y seguridad</h2>
          <p>Registramos páginas visitadas, botones utilizados, decisiones de reproducción, duración, fuente de visita y tipo general de dispositivo para operar el reproductor, ofrecer estadísticas privadas y mantener una rotación justa. Usamos identificadores aleatorios de visitante y sesión que se guardan como resúmenes irreversibles (hashes) en el servidor. En funciones protegidas contra abuso, una dirección IP puede procesarse temporalmente y guardarse solamente como hash irreversible; no guardamos la dirección IP original en esas tablas.</p>
          <h2>Cómo usamos los datos</h2>
          <p>Usamos los datos para autenticar cuentas, mostrar música, completar publicaciones solicitadas, medir actividad real, mantener una rotación justa, ofrecer estadísticas, prevenir fraude, enviar correos transaccionales, atender reportes y proteger a la comunidad. Las reproducciones no generan pagos, tokens ni prioridad.</p>
          <h2>Reproductores externos y proveedores</h2>
          <p>La plataforma principal reproduce música mediante enlaces o reproductores autorizados de YouTube, YouTube Music, Spotify, SoundCloud, Apple Music u otros servicios que el usuario elija. Al abrir o reproducir contenido, esos servicios pueden recibir datos normales de conexión y aplicar sus propias políticas. Para operar First Listen utilizamos proveedores como Supabase, Vercel y Resend como encargados del servicio.</p>
          <h2>Venta, anuncios y seguridad</h2>
          <p>No vendemos datos personales y actualmente First Listen no integra una red de anuncios ni usa datos para publicidad dirigida. Las comunicaciones viajan mediante HTTPS y limitamos el acceso administrativo a los datos. Ningún sistema es infalible, pero usamos controles técnicos y de acceso razonables para proteger la información.</p>
          <h2>Retención y seguridad</h2>
          <p>Conservamos los datos mientras la cuenta esté activa o sean necesarios para operar el servicio. Después de eliminar una cuenta podemos conservar registros mínimos de seguridad, cumplimiento o resolución de disputas cuando sea legalmente necesario. Las estadísticas agregadas o seudónimas pueden permanecer sin estar vinculadas directamente a una cuenta.</p>
          <h2>Tus controles</h2>
          <p>Puedes modificar preferencias, reportar contenido, bloquear usuarios y eliminar tu cuenta desde First Listen. La eliminación se inicia en <Link href="/delete-account">Eliminar cuenta</Link> y también está enlazada dentro de tu perfil.</p>
          <h2>Menores y cambios</h2>
          <p>First Listen no está dirigido a menores de 13 años. La aplicación Android oficial está destinada y será distribuida únicamente para personas de 18 años o más, porque puede mostrar música enviada por usuarios con lenguaje explícito o temas maduros. Podemos actualizar esta política cuando cambien las funciones o requisitos legales; publicaremos la fecha de la revisión.</p>
        </>
      }
    >
      <h2>Who operates First Listen</h2>
      <p>First Listen is operated by DJ Carlos Jimenez. For privacy, security, or data-rights questions, contact <a href="mailto:support@firstlisten.net">support@firstlisten.net</a>.</p>
      <h2>Scope</h2>
      <p>This policy covers the website, installable web app, and any official First Listen Android application that displays the same service.</p>
      <h2>Account and profile</h2>
      <p>If you create an account, we may store your email, profile name, account identifier, optional photo, music country, language, and genre preferences. We also retain data needed to sign in, recover the account, and manage your submissions.</p>
      <h2>Content you choose to share</h2>
      <p>We may store music links and metadata, cover images, artist names, reviews, comments, preferences, saved songs, follows, reports, and other data you submit. Custom artist pages may also host identity images and short audio previews voluntarily uploaded by their administrator.</p>
      <h2>Activity, device, and security data</h2>
      <p>We record pages visited, buttons used, playback choices, duration, visit source, and general device type to operate the player, provide private analytics, and maintain fair rotation. We use random visitor and session identifiers that are stored as one-way hashes on the server. For abuse-protected features, an IP address may be processed temporarily and stored only as a one-way hash; the original IP address is not stored in those tables.</p>
      <h2>How we use data</h2>
      <p>We use data to authenticate accounts, display music, complete requested submissions, measure genuine activity, maintain fair rotation, provide analytics, prevent fraud, send transactional email, process reports, and protect the community. Plays do not award payments, tokens, or priority.</p>
      <h2>External players and service providers</h2>
      <p>The main platform plays music through links or authorized players from YouTube, YouTube Music, Spotify, SoundCloud, Apple Music, or other services selected by the user. When content is opened or played, those services may receive standard connection data and apply their own policies. We use providers such as Supabase, Vercel, and Resend as service processors to operate First Listen.</p>
      <h2>Sale, advertising, and security</h2>
      <p>We do not sell personal data, and First Listen currently does not integrate an advertising network or use data for targeted advertising. Communications are transmitted over HTTPS, and administrative access is restricted. No system is infallible, but we use reasonable technical and access controls to protect information.</p>
      <h2>Retention and security</h2>
      <p>We retain data while an account is active or as needed to operate the service. After account deletion, minimal security, compliance, or dispute-resolution records may be retained where legally required. Aggregated or pseudonymous analytics may remain without being directly linked to an account.</p>
      <h2>Your controls</h2>
      <p>You can change preferences, report content, block users, and delete your account inside First Listen. Start deletion at <Link href="/delete-account">Delete account</Link>, also linked from your profile.</p>
      <h2>Children and updates</h2>
      <p>First Listen is not directed to children under 13. The official Android application is intended and will be distributed only to people aged 18 or older because it may display user-submitted music with explicit language or mature themes. We may update this policy when features or legal requirements change and will post the revision date.</p>
    </LegalPage>
  );
}
