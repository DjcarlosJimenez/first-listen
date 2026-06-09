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

export function ResetPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    if (!isValidPassword(password)) {
      setError(PASSWORD_REQUIREMENTS);
      return;
    }
    if (password !== confirm) {
      setError("Passwords must match.");
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setError("Password recovery is unavailable. Request a new recovery link.");
      return;
    }

    setLoading(true);
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      setError(passwordError.message);
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
          <h1>Choose a new password</h1>
          <p>{PASSWORD_REQUIREMENTS}</p>
        </div>
        <form onSubmit={submit}>
          <label className="auth-field">
            <span>New password</span>
            <input
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              name="password"
              pattern={PASSWORD_PATTERN}
              required
              title={PASSWORD_REQUIREMENTS}
              type="password"
            />
          </label>
          <label className="auth-field">
            <span>Confirm password</span>
            <input
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              name="confirm"
              pattern={PASSWORD_PATTERN}
              required
              title={PASSWORD_REQUIREMENTS}
              type="password"
            />
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" disabled={loading} type="submit">
            {loading ? "Saving..." : "Save new password"}
          </button>
        </form>
      </section>
    </main>
  );
}
