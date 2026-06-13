"use client";

import { FormEvent, useState } from "react";
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
  const [loading, setLoading] = useState(false);
  const passwordRequirements = spanish
    ? "Mínimo 8 caracteres, una mayúscula, una minúscula y un número."
    : PASSWORD_REQUIREMENTS;

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
      setError(spanish ? "Las contraseñas deben coincidir." : "Passwords must match.");
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setError(
        spanish
          ? "La recuperación no está disponible. Solicita un nuevo enlace."
          : "Password recovery is unavailable. Request a new recovery link.",
      );
      return;
    }

    setLoading(true);
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      setError(spanish ? "No pudimos guardar la contraseña. Inténtalo de nuevo." : passwordError.message);
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();
    router.replace("/login?message=password-reset");
    router.refresh();
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Logo />
        <div className="auth-heading">
          <span className="auth-icon"><LockKeyhole size={22} /></span>
          <h1>{spanish ? "Elige una nueva contraseña" : "Choose a new password"}</h1>
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
