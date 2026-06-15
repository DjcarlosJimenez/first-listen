"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import {
  isValidPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_REQUIREMENTS,
} from "@/lib/password-policy";
import { createClient } from "@/lib/supabase/client";
import { useInterfaceLocale } from "@/lib/use-interface-locale";

function authErrorMessage(message: string, spanish: boolean) {
  if (!spanish) return message;
  const normalized = message.toLowerCase();
  if (normalized.includes("email not confirmed")) {
    return "Confirma tu correo antes de iniciar sesión.";
  }
  if (normalized.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (normalized.includes("already registered")) {
    return "Ya existe una cuenta con este correo.";
  }
  if (normalized.includes("password")) {
    return "Revisa la contraseña e inténtalo de nuevo.";
  }
  return "No pudimos completar la solicitud. Inténtalo de nuevo.";
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState("");
  const isSignup = mode === "signup";
  const nextPath = useMemo(() => searchParams.get("next") || "/dashboard", [searchParams]);
  const resetMessage =
    searchParams.get("message") === "password-reset"
      ? spanish
        ? "Contraseña actualizada. Inicia sesión con tu nueva contraseña."
        : "Password updated. Log in with your new password."
      : "";
  const passwordRequirements = spanish
    ? "Mínimo 8 caracteres, una mayúscula, una minúscula y un número."
    : PASSWORD_REQUIREMENTS;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    const supabase = createClient();
    if (!supabase) {
      setError(
        spanish
          ? "El inicio de sesión no está disponible. Inténtalo más tarde."
          : "Supabase is not configured. Add Vercel environment variables before launch.",
      );
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim();

    if (!email || !password || (isSignup && !name)) {
      setError(spanish ? "Completa todos los campos requeridos." : "Please complete all required fields.");
      return;
    }
    if (isSignup && !isValidPassword(password)) {
      setError(passwordRequirements);
      return;
    }
    if (isSignup && !accepted) {
      setError(
        spanish
          ? "Debes aceptar los términos legales y el aviso de contenido explícito."
          : "You must accept the legal terms and explicit-content disclaimer.",
      );
      return;
    }

    setLoading(true);
    const result = isSignup
      ? await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: name,
              legal_accepted: true,
              explicit_content_acknowledged: true,
              guest_access_token:
                window.localStorage.getItem("first-listen-guest-token"),
            },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
          },
        })
      : await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (result.error) {
      if (!isSignup && result.error.message.toLowerCase().includes("email not confirmed")) {
        window.sessionStorage.setItem("first-listen-pending-email", email);
        setUnconfirmedEmail(email);
      }
      setError(authErrorMessage(result.error.message, spanish));
      return;
    }

    if (isSignup && !result.data.session) {
      window.sessionStorage.setItem("first-listen-pending-email", email);
      router.replace("/verify-email");
      return;
    }

    router.replace(isSignup ? "/dashboard" : nextPath);
    router.refresh();
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Logo />
        <div className="auth-heading">
          <span className="auth-icon"><LockKeyhole size={22} /></span>
          <h1>
            {isSignup
              ? spanish
                ? "Crea tu cuenta de First Listen"
                : "Create your First Listen account"
              : spanish
                ? "Inicia sesión en First Listen"
                : "Log in to First Listen"}
          </h1>
          <p>
            {isSignup
              ? spanish
                ? "Usa tu correo real y una contraseña segura. Las áreas privadas requieren cuenta."
                : "Use your real email and a secure password. Private areas are account-only."
              : spanish
                ? "Descubrir música, canciones por escuchar, envíos, perfil y herramientas privadas requieren iniciar sesión."
                : "Music discovery, reviews, submissions, profile, and admin tools require authentication."}
          </p>
        </div>

        <form onSubmit={submit}>
          {isSignup && (
            <label className="auth-field">
              <span>{spanish ? "Nombre" : "Name"}</span>
              <input autoComplete="name" name="name" required type="text" />
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label className="auth-field">
            <span>{spanish ? "Contraseña" : "Password"}</span>
            <input
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={PASSWORD_MIN_LENGTH}
              name="password"
              pattern={isSignup ? PASSWORD_PATTERN : undefined}
              required
              title={isSignup ? passwordRequirements : undefined}
              type="password"
            />
          </label>
          {!isSignup && (
            <div className="auth-inline-link">
              <Link href="/forgot-password">{spanish ? "¿Olvidaste tu contraseña?" : "Forgot password?"}</Link>
            </div>
          )}

          {isSignup && (
            <label className="legal-check">
              <input
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                required
                type="checkbox"
              />
              <span>
                {spanish ? "Acepto los " : "I accept the "}
                <Link href="/terms">{spanish ? "Términos de servicio" : "Terms of Service"}</Link>,{" "}
                <Link href="/privacy">{spanish ? "Política de privacidad" : "Privacy Policy"}</Link>,{" "}
                <Link href="/guidelines">{spanish ? "Guías de la comunidad" : "Community Guidelines"}</Link>
                {spanish ? " y el " : ", and "}
                <Link href="/explicit-content">{spanish ? "Aviso de contenido explícito" : "Explicit Content Disclaimer"}</Link>.
                {spanish
                  ? " Puedes encontrar música con lenguaje explícito, temas maduros o contenido para adultos."
                  : " Users may encounter music containing explicit language, mature themes, or adult subject matter."}
              </span>
            </label>
          )}

          {error && <div className="auth-error" role="alert">{error}</div>}
          {unconfirmedEmail && (
            <div className="form-message" role="status">
              {spanish ? "¿Necesitas otro correo de confirmación? " : "Need another confirmation email? "}
              <Link href="/verify-email">{spanish ? "Reenviarlo" : "Resend it"}</Link>.
            </div>
          )}
          {(message || resetMessage) && (
            <div className="form-message" role="status">{message || resetMessage}</div>
          )}

          <button className="auth-submit" disabled={loading} type="submit">
            {loading
              ? spanish
                ? "Espera..."
                : "Please wait..."
              : isSignup
                ? spanish
                  ? "Crear cuenta"
                  : "Create account"
                : spanish
                  ? "Iniciar sesión"
                  : "Log in"}
            <ArrowRight size={16} />
          </button>
        </form>

        <div className="auth-switch">
          <ShieldCheck size={16} />
          {isSignup ? (
            <span>{spanish ? "¿Ya tienes cuenta? " : "Already have an account? "}<Link href="/login">{spanish ? "Inicia sesión" : "Log in"}</Link></span>
          ) : (
            <span>{spanish ? "¿Nuevo en First Listen? " : "New to First Listen? "}<Link href="/signup">{spanish ? "Crear cuenta" : "Create account"}</Link></span>
          )}
        </div>
      </section>
    </main>
  );
}
