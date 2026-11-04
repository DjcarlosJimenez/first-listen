import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccountDeletionPanel } from "@/components/account-deletion-panel";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Delete First Listen Account",
  description: "Delete your First Listen account and associated personal data.",
};

export default function DeleteAccountPage() {
  return (
    <main className="legal-page account-deletion-page">
      <header className="account-header">
        <Logo />
        <Link href="/profile">
          <ArrowLeft size={16} /> Volver / Back
        </Link>
      </header>
      <article>
        <span className="eyebrow">First Listen account</span>
        <h1>Eliminar cuenta / Delete account</h1>
        <p>
          Esta página pública explica el proceso y permite iniciar la eliminación
          desde la aplicación. / This public page explains the process and lets
          you initiate deletion inside the app.
        </p>
        <AccountDeletionPanel />
        <p>
          ¿Necesitas ayuda? / Need help?{" "}
          <a href="mailto:support@firstlisten.net">support@firstlisten.net</a>
        </p>
      </article>
    </main>
  );
}
