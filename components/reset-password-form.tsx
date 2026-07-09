"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Logo } from "@/components/logo";
import {
  isValidPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
  PASSWORD_REQUIREMENTS,
} from "@/lib/password-policy";
import { createClient } from "@/lib/supabase/client";
import { useInterfaceLocale } from "@/lib/use-interface-locale";

export function ResetPasswordForm() {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";
  const router = useRouter();
  const [error, setError] = useState("");
  const [checkingRecovery, setCheckingRecovery] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const passwordRequirements = spanish
    ? "Minimo 8 caracteres, una mayuscula, una minuscula y un numero."
    : PASSWORD_REQUIREMENTS;

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    const finishChecking = (ready: boolean, nextError = "") => {
      if (!active) return;
      setRecoveryReady(ready);
      setError(nextError);
      setCheckingRecovery(false);
    };

    const cleanRecoveryUrl = () => {
      window.history.replaceState(null, "", "/reset-password");
    };

    const prepareRecoverySession = async () => {
      if (!supabase) {
        finishChecking(
          false,
          spanish
            ? "La recuperacion no esta disponible. Solicita un nuevo enlace."
            : "Password recovery is unavailable. Request a new recovery link.",
        );
        return;
      }

      const currentSession = await supabase.auth.getSession();
      if (currentSession.data.session) {
        finishChecking(true);
        return;
      }

      const url = new URL(window.location.href);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const urlError =
        url.searchParams.get("error_description") ??
        hashParams.get("error_description") ??
        url.searchParams.get("error") ??
        hashParams.get("error");
      if (urlError) {
        cleanRecoveryUrl();
        finishChecking(
          false,
          spanish
            ? "El enlace de recuperacion expiro o ya fue usado. Solicita uno nuevo."
            : "This recovery link expired or was already used. Request a new one.",
        );
        return;
      }

      const tokenHash = url.searchParams.get("token_hash");
      const recoveryType = url.searchParams.get("type");
      if (tokenHash && recoveryType === "recovery") {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (verifyError) {
          cleanRecoveryUrl();
          finishChecking(
            false,
            spanish
              ? "No pudimos verificar este enlace de recuperacion. Solicita uno nuevo."
              : "We could not verify this recovery link. Request a new one.",
          );
          return;
        }
        cleanRecoveryUrl();
        finishChecking(true);
        return;
      }

      const code = url.searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          cleanRecoveryUrl();
          finishChecking(
            false,
            spanish
              ? "No pudimos abrir este enlace de recuperacion. Solicita uno nuevo."
              : "We could not open this recovery link. Request a new one.",
          );
          return;
        }
        cleanRecoveryUrl();
        finishChecking(true);
        return;
      }

      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          cleanRecoveryUrl();
          finishChecking(
            false,
            spanish
              ? "No pudimos activar este enlace de recuperacion. Solicita uno nuevo."
              : "We could not activate this recovery link. Request a new one.",
          );
          return;
        }
        cleanRecoveryUrl();
        finishChecking(true);
        return;
      }

      finishChecking(
        false,
        spanish
          ? "Abre el enlace mas reciente que enviamos a tu correo."
          : "Open the latest recovery link we sent to your email.",
      );
    };

    const {
      data: { subscription },
    } =
      supabase?.auth.onAuthStateChange((event, session) => {
        if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
          cleanRecoveryUrl();
          finishChecking(true);
        }
      }) ?? { data: { subscription: null } };

    void prepareRecoverySession();

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [spanish]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    if (!isValidPassword(password)) {
      setError(passwordRequirements);
      return;
    }
    if (password !== confirm) {
      setError(spanish ? "Las contrasenas deben coincidir." : "Passwords must match.");
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setError(
        spanish
          ? "La recuperacion no esta disponible. Solicita un nuevo enlace."
          : "Password recovery is unavailable. Request a new recovery link.",
      );
      return;
    }

    setLoading(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError(
        spanish
          ? "Tu enlace de recuperacion expiro. Solicita uno nuevo."
          : "Your recovery link expired. Request a new one.",
      );
      setLoading(false);
      setRecoveryReady(false);
      return;
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      setError(spanish ? "No pudimos guardar la contrasena. Intentalo de nuevo." : passwordError.message);
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();
    router.replace("/login?message=password-reset");
    router.refresh();
  };

  if (checkingRecovery) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <Logo />
          <div className="auth-heading">
            <span className="auth-icon"><LockKeyhole size={22} /></span>
            <h1>{spanish ? "Verificando enlace" : "Verifying link"}</h1>
            <p>
              {spanish
                ? "Estamos preparando la pagina para que elijas una nueva contrasena."
                : "We are preparing the page so you can choose a new password."}
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (!recoveryReady) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <Logo />
          <div className="auth-heading">
            <span className="auth-icon"><LockKeyhole size={22} /></span>
            <h1>{spanish ? "Solicita un nuevo enlace" : "Request a new link"}</h1>
            <p>
              {spanish
                ? "Por seguridad, los enlaces de recuperacion solo funcionan una vez y expiran rapido."
                : "For security, recovery links only work once and expire quickly."}
            </p>
          </div>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <Link className="auth-submit" href="/forgot-password">
            {spanish ? "Enviar nuevo enlace" : "Send a new link"}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Logo />
        <div className="auth-heading">
          <span className="auth-icon"><LockKeyhole size={22} /></span>
          <h1>{spanish ? "Elige una nueva contrasena" : "Choose a new password"}</h1>
          <p>{passwordRequirements}</p>
        </div>
        <form onSubmit={submit}>
          <label className="auth-field">
            <span>{spanish ? "Nueva contrasena" : "New password"}</span>
            <input
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              name="password"
              pattern={PASSWORD_PATTERN}
              required
              title={passwordRequirements}
              type="password"
            />
          </label>
          <label className="auth-field">
            <span>{spanish ? "Confirmar contrasena" : "Confirm password"}</span>
            <input
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              name="confirm"
              pattern={PASSWORD_PATTERN}
              required
              title={passwordRequirements}
              type="password"
            />
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" disabled={loading} type="submit">
            {loading
              ? spanish
                ? "Guardando..."
                : "Saving..."
              : spanish
                ? "Guardar nueva contrasena"
                : "Save new password"}
          </button>
        </form>
      </section>
    </main>
  );
}
