"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";
import { useInterfaceLocale } from "@/lib/use-interface-locale";

export function ResendConfirmationForm() {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    setEmail(window.sessionStorage.getItem("first-listen-pending-email") ?? "");
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError(
        spanish
          ? "Escribe el correo que usaste para crear tu cuenta."
          : "Enter the email address used to create your account.",
      );
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setError(
        spanish
          ? "El servicio de correo no está disponible. Inténtalo más tarde."
          : "Email service is unavailable. Please try again later.",
      );
      return;
    }

    setLoading(true);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    setLoading(false);

    if (resendError) {
      setError(
        resendError.message.toLowerCase().includes("rate")
          ? spanish
            ? "Espera antes de solicitar otro correo de confirmación."
            : "Please wait before requesting another confirmation email."
          : spanish
            ? "No pudimos enviar el correo de confirmación. Inténtalo de nuevo."
            : "The confirmation email could not be sent. Please try again.",
      );
      return;
    }

    window.sessionStorage.setItem("first-listen-pending-email", normalizedEmail);
    setCooldown(60);
    setMessage(
      spanish
        ? "Si este correo tiene una cuenta pendiente en First Listen, enviaremos un correo de confirmación."
        : "If this address has a pending First Listen account, a confirmation email has been sent.",
    );
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Logo />
        <div className="auth-heading">
          <span className="auth-icon"><MailCheck size={22} /></span>
          <h1>{spanish ? "Confirma tu correo" : "Confirm your email"}</h1>
          <p>
            {spanish
              ? "Abre el enlace de confirmación enviado por First Listen. Puedes pedir otro si el mensaje expiró o no llegó."
              : "Open the confirmation link sent by First Listen. You can request a replacement below if the original message expired or never arrived."}
          </p>
        </div>
        <form onSubmit={submit}>
          <label className="auth-field">
            <span>Email</span>
            <input
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          {message && <div className="form-message" role="status">{message}</div>}
          <button
            className="auth-submit"
            disabled={loading || cooldown > 0}
            type="submit"
          >
            {loading
              ? spanish
                ? "Enviando..."
                : "Sending..."
              : cooldown > 0
                ? spanish
                  ? `Reenvío disponible en ${cooldown}s`
                  : `Resend available in ${cooldown}s`
                : spanish
                  ? "Reenviar correo de confirmación"
                  : "Resend confirmation email"}
          </button>
        </form>
        <div className="auth-switch">
          <span>
            {spanish ? "¿Ya confirmaste? " : "Already confirmed? "}
            <Link href="/login">{spanish ? "Inicia sesión" : "Log in"}</Link>
          </span>
        </div>
      </section>
    </main>
  );
}
