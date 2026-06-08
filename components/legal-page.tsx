import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/logo";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="legal-page">
      <header className="account-header">
        <Logo />
        <Link href="/signup"><ArrowLeft size={16} /> Back to signup</Link>
      </header>
      <article>
        <span className="eyebrow">First Listen legal</span>
        <h1>{title}</h1>
        <small>Last updated: {updated}</small>
        {children}
      </article>
    </main>
  );
}
