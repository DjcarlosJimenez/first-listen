"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, LogIn, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useInterfaceLocale } from "@/lib/use-interface-locale";

export function AccountDeletionPanel() {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";
  const [signedInEmail, setSignedInEmail] = useState("");
  const [email, setEmail] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadAccount = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = supabase
        ? await supabase.auth.getUser()
        : { data: { user: null } };
      if (!active) return;
      const nextEmail = user?.email ?? "";
      setSignedInEmail(nextEmail);
      setEmail(nextEmail);
      setLoading(false);
    };
    void loadAccount();
    return () => {
      active = false;
    };
  }, []);

  const deleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (deleting) return;
    setError("");
    if (
      !window.confirm(
        spanish
          ? "Esta acción es permanente. ¿Confirmas que deseas eliminar tu cuenta y tus datos?"
          : "This is permanent. Do you confirm that you want to delete your account and data?",
      )
    ) {
      return;
    }

    setDeleting(true);
    const response = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, confirmation }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      setDeleting(false);
      setError(
        result.error ??
          (spanish
            ? "No pudimos eliminar la cuenta."
            : "We could not delete the account."),
      );
      return;
    }

    const supabase = createClient();
    await supabase?.auth.signOut({ scope: "local" }).catch(() => undefined);
    window.localStorage.removeItem("first-listen-guest-token");
    window.localStorage.removeItem("first-listen-guest-recovery-code");
    window.location.replace("/login?message=account-deleted");
  };

  if (loading) {
    return <p>{spanish ? "Comprobando tu cuenta…" : "Checking your account…"}</p>;
  }

  if (!signedInEmail) {
    return (
      <section className="account-deletion-card">
        <AlertTriangle size={28} />
        <h2>{spanish ? "Inicia sesión para continuar" : "Log in to continue"}</h2>
        <p>
          {spanish
            ? "Por seguridad, solo el propietario autenticado puede eliminar su cuenta."
            : "For security, only the authenticated account owner can delete the account."}
        </p>
        <Link className="auth-submit" href="/login?next=/delete-account">
          <LogIn size={16} /> {spanish ? "Iniciar sesión" : "Log in"}
        </Link>
      </section>
    );
  }

  return (
    <section className="account-deletion-card">
      <AlertTriangle size={28} />
      <h2>{spanish ? "Eliminación permanente" : "Permanent deletion"}</h2>
      <p>
        {spanish
          ? "Se eliminarán tu perfil, canciones publicadas, reseñas, seguidores y preferencias. Los registros mínimos de seguridad o cumplimiento pueden conservarse cuando la ley lo permita."
          : "Your profile, submitted songs, reviews, follows, and preferences will be deleted. Minimal security or compliance records may be retained where legally permitted."}
      </p>
      <p>
        {spanish
          ? "Si administras una página personalizada de artista, dejará de estar asignada a tu cuenta hasta que el propietario de First Listen la reasigne."
          : "If you manage a personalized artist page, it will become unassigned until the First Listen owner assigns it again."}
      </p>
      <form onSubmit={deleteAccount}>
        <label className="auth-field">
          <span>{spanish ? "Confirma tu correo" : "Confirm your email"}</span>
          <input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label className="auth-field">
          <span>
            {spanish
              ? "Escribe ELIMINAR para confirmar"
              : "Type DELETE to confirm"}
          </span>
          <input
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
            required
            value={confirmation}
          />
        </label>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button
          className="account-delete-button"
          disabled={
            deleting ||
            email.trim().toLowerCase() !== signedInEmail.trim().toLowerCase() ||
            !["ELIMINAR", "DELETE"].includes(confirmation.trim().toUpperCase())
          }
          type="submit"
        >
          <Trash2 size={16} />
          {deleting
            ? spanish
              ? "Eliminando…"
              : "Deleting…"
            : spanish
              ? "Eliminar mi cuenta permanentemente"
              : "Permanently delete my account"}
        </button>
      </form>
    </section>
  );
}
