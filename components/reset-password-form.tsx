"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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

type VerifiedRecovery = { tokenHash: string; userId: string };
const verifiedRecoveryKey = "first-listen-recovery-verified";

function readVerifiedRecovery(): VerifiedRecovery | null {
  try {
    const value = window.sessionStorage.getItem(verifiedRecoveryKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as VerifiedRecovery;
    return typeof parsed.tokenHash === "string" && typeof parsed.userId === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function saveVerifiedRecovery(value: VerifiedRecovery) {
  try {
    window.sessionStorage.setItem(verifiedRecoveryKey, JSON.stringify(value));
  } catch {
    // The current page can still retry using the in-memory recovery session.
  }
}

function clearVerifiedRecovery() {
  try {
    window.sessionStorage.removeItem(verifiedRecoveryKey);
  } catch {
    // The Supabase session is still signed out below.
  }
}

export function ResetPasswordForm({ initialTokenHash = "" }: { initialTokenHash?: string }) {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";
  const router = useRouter();
  const [error, setError] = useState("");
  const [checkingRecovery, setCheckingRecovery] = useState(!initialTokenHash);
  const [recoveryReady, setRecoveryReady] = useState(Boolean(initialTokenHash));
  const [tokenHash, setTokenHash] = useState(initialTokenHash);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const verifiedRecovery = useRef<VerifiedRecovery | null>(null);
  const passwordRequirements = spanish
    ? "Mínimo 8 caracteres, una mayúscula, una minúscula y un número."
    : PASSWORD_REQUIREMENTS;

  useEffect(() => {
    let active = true;

    const finishChecking = (ready: boolean, nextError = "") => {
      if (!active) return;
      setRecoveryReady(ready);
      setError(nextError);
      setCheckingRecovery(false);
    };

    const prepareRecoverySession = async () => {
      const url = new URL(window.location.href);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = url.searchParams.get("token_hash") ?? hashParams.get("token_hash");
      const type = url.searchParams.get("type") ?? hashParams.get("type");
      if (token && type === "recovery") {
        setTokenHash(token);
        finishChecking(true);
        return;
      }

      const urlError =
        url.searchParams.get("error_description") ??
        hashParams.get("error_description") ??
        url.searchParams.get("error") ??
        hashParams.get("error");
      if (urlError) {
        finishChecking(
          false,
          spanish
            ? "Este enlace ya no es válido. Usa únicamente el enlace del correo más reciente."
            : "This link is no longer valid. Use only the link in the most recent email.",
        );
        return;
      }

      const code = url.searchParams.get("code");
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (!code && !(accessToken && refreshToken)) {
        finishChecking(
          false,
          spanish
            ? "Usa únicamente el enlace del correo más reciente."
            : "Use only the link in the most recent email.",
        );
        return;
      }

      const supabase = createClient();
      if (!supabase) {
        finishChecking(
          false,
          spanish
            ? "La recuperación no está disponible. Inténtalo de nuevo más tarde."
            : "Password recovery is unavailable. Try again later.",
        );
        return;
      }

      if (code) {
        const { data: existing } = await supabase.auth.getSession();
        if (!new URL(window.location.href).searchParams.has("code") && existing.session) {
          finishChecking(true);
          return;
        }
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          finishChecking(
            false,
            spanish
              ? "No pudimos abrir este enlace. Usa únicamente el enlace del correo más reciente."
              : "We could not open this link. Use only the link in the most recent email.",
          );
          return;
        }
        window.history.replaceState(null, "", "/reset-password");
        finishChecking(true);
        return;
      }

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          finishChecking(
            false,
            spanish
              ? "No pudimos activar este enlace. Usa únicamente el enlace del correo más reciente."
              : "We could not activate this link. Use only the link in the most recent email.",
          );
          return;
        }
        window.history.replaceState(null, "", "/reset-password");
        finishChecking(true);
      }
    };

    void prepareRecoverySession();

    return () => {
      active = false;
    };
  }, [spanish]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
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

    submitting.current = true;
    setLoading(true);
    try {
      const verified = verifiedRecovery.current ?? readVerifiedRecovery();
      let session = null;
      if (tokenHash && verified?.tokenHash !== tokenHash) {
        const result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (result.error || !result.data.session) {
          setError(
            spanish
              ? "El enlace venció o fue reemplazado. Usa únicamente el enlace del correo más reciente."
              : "The link expired or was replaced. Use only the link in the most recent email.",
          );
          setRecoveryReady(false);
          return;
        }
        verifiedRecovery.current = {
          tokenHash,
          userId: result.data.session.user.id,
        };
        saveVerifiedRecovery(verifiedRecovery.current);
        session = result.data.session;
      } else {
        const result = await supabase.auth.getSession();
        session = result.data.session;
      }
      if (!session || (tokenHash && verified?.tokenHash === tokenHash && session.user.id !== verified.userId)) {
        verifiedRecovery.current = null;
        clearVerifiedRecovery();
        setError(
          spanish
            ? "La sesión de recuperación venció. Usa únicamente el enlace del correo más reciente."
            : "The recovery session expired. Use only the link in the most recent email.",
        );
        setRecoveryReady(false);
        return;
      }

      const { error: passwordError } = await supabase.auth.updateUser({ password });
      if (passwordError) {
        setError(spanish ? "No pudimos guardar la contraseña. Inténtalo de nuevo." : passwordError.message);
        return;
      }

      verifiedRecovery.current = null;
      clearVerifiedRecovery();
      window.history.replaceState(null, "", "/reset-password");
      await supabase.auth.signOut({ scope: "local" });
      setSaved(true);
      window.setTimeout(() => router.replace("/login?message=password-reset"), 1800);
    } catch {
      setError(
        spanish
          ? "Hubo un problema de conexión. Inténtalo de nuevo."
          : "There was a connection problem. Try again.",
      );
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  if (saved) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <Logo />
          <div className="auth-heading">
            <span className="auth-icon"><LockKeyhole size={22} /></span>
            <h1>{spanish ? "Contraseña actualizada" : "Password updated"}</h1>
            <p>{spanish ? "Ya puedes iniciar sesión con tu nueva contraseña." : "You can now log in with your new password."}</p>
          </div>
          <Link className="auth-submit" href="/login?message=password-reset">
            {spanish ? "Ir a iniciar sesión" : "Go to login"}
          </Link>
        </section>
      </main>
    );
  }

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
                ? "Para continuar, abre el correo de recuperación."
                : "To continue, open the recovery email."}
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
          <h1>{spanish ? "Nueva contraseña" : "New password"}</h1>
          <p>{passwordRequirements}</p>
        </div>
        <form onSubmit={submit}>
          <label className="auth-field">
            <span>{spanish ? "Nueva contraseña" : "New password"}</span>
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
            <span>{spanish ? "Confirmar contraseña" : "Confirm password"}</span>
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
                ? "Guardar nueva contraseña"
                : "Save new password"}
          </button>
        </form>
      </section>
    </main>
  );
}
