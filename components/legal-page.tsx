"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";
import { useInterfaceLocale } from "@/lib/use-interface-locale";

export function LegalPage({
  title,
  titleEs,
  updated,
  children,
  childrenEs,
}: {
  title: string;
  titleEs?: string;
  updated: string;
  children: React.ReactNode;
  childrenEs?: React.ReactNode;
}) {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";

  return (
    <main className="legal-page">
      <header className="account-header">
        <Logo />
        <Link href="/signup"><ArrowLeft size={16} /> {spanish ? "Volver al registro" : "Back to signup"}</Link>
      </header>
      <article>
        <span className="eyebrow">{spanish ? "Legal de First Listen" : "First Listen legal"}</span>
        <h1>{spanish ? titleEs ?? title : title}</h1>
        <small>{spanish ? "Última actualización" : "Last updated"}: {updated}</small>
        {spanish ? childrenEs ?? children : children}
      </article>
    </main>
  );
}
