import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      titleEs="Términos de servicio"
      updated="November 4, 2026"
      childrenEs={
        <>
          <h2>Servicio</h2>
          <p>First Listen permite descubrir y compartir enlaces musicales, seguir artistas y consultar actividad orgánica. No vendemos, garantizamos ni intercambiamos reproducciones, suscriptores o posiciones.</p>
          <h2>Cuentas</h2>
          <p>Debes proporcionar información correcta, proteger tu contraseña y usar una sola identidad legítima. Puedes eliminar tu cuenta en <Link href="/delete-account">Eliminar cuenta</Link>.</p>
          <h2>Edad para la aplicación Android</h2>
          <p>La aplicación Android oficial de First Listen está destinada únicamente a personas de 18 años o más. Al usar esa aplicación confirmas que tienes al menos 18 años.</p>
          <h2>Contenido y derechos</h2>
          <p>Solo puedes enviar contenido o enlaces que tengas derecho a compartir. Conservas tus derechos; autorizas a First Listen a mostrar la metadata y el enlace mientras permanezcan publicados. Reportes de copyright pueden enviarse a <a href="mailto:support@firstlisten.net">support@firstlisten.net</a>.</p>
          <h2>Conducta prohibida</h2>
          <p>Está prohibido el spam, acoso, suplantación, automatización engañosa, compra o intercambio de actividad, manipulación de contadores, contenido ilegal y evasión de moderación.</p>
          <h2>Moderación</h2>
          <p>Podemos revisar reportes, retirar contenido, limitar funciones o suspender cuentas para proteger usuarios, derechos y funcionamiento. Puedes bloquear perfiles y reportar contenido desde la aplicación.</p>
          <h2>Disponibilidad y responsabilidad</h2>
          <p>La plataforma se ofrece según disponibilidad y puede cambiar. No controlamos la disponibilidad de enlaces externos ni prometemos resultados de audiencia.</p>
        </>
      }
    >
      <h2>Service</h2>
      <p>First Listen lets people discover and share music links, follow artists, and view organic activity. We do not sell, guarantee, or exchange plays, subscribers, or placement.</p>
      <h2>Accounts</h2>
      <p>You must provide accurate information, protect your password, and use one legitimate identity. You may delete your account at <Link href="/delete-account">Delete account</Link>.</p>
      <h2>Age requirement for the Android application</h2>
      <p>The official First Listen Android application is intended only for people aged 18 or older. By using that application, you confirm that you are at least 18 years old.</p>
      <h2>Content and rights</h2>
      <p>You may submit only content or links you have the right to share. You keep your rights and authorize First Listen to display metadata and the link while published. Send copyright reports to <a href="mailto:support@firstlisten.net">support@firstlisten.net</a>.</p>
      <h2>Prohibited conduct</h2>
      <p>Spam, harassment, impersonation, deceptive automation, buying or exchanging activity, metric manipulation, illegal content, and moderation evasion are prohibited.</p>
      <h2>Moderation</h2>
      <p>We may review reports, remove content, limit features, or suspend accounts to protect users, rights, and service integrity. You can block profiles and report content in the app.</p>
      <h2>Availability and responsibility</h2>
      <p>The platform is provided as available and may change. We do not control external-link availability or promise audience results.</p>
    </LegalPage>
  );
}
