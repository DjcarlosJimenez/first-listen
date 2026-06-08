"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";

export function ChangePasswordForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (password.length < 8 || password !== confirm) {
      setError("Passwords must match and contain at least 8 characters.");
      return;
    }

    const supabase = createClient();
    if (!supabase) return;
    setLoading(true);
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (!passwordError) {
      const { error: profileError } = await supabase.rpc("complete_forced_password_change");
      if (!profileError) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      setError(profileError.message);
    } else {
      setError(passwordError.message);
    }
    setLoading(false);
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Logo />
        <div className="auth-heading">
          <span className="auth-icon"><LockKeyhole size={22} /></span>
          <h1>Set a permanent password</h1>
          <p>Your temporary password cannot be used beyond this first session.</p>
        </div>
        <form onSubmit={submit}>
          <label className="auth-field">
            <span>New password</span>
            <input autoComplete="new-password" minLength={8} name="password" required type="password" />
          </label>
          <label className="auth-field">
            <span>Confirm password</span>
            <input autoComplete="new-password" minLength={8} name="confirm" required type="password" />
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="auth-submit" disabled={loading} type="submit">
            {loading ? "Saving..." : "Save password"}
          </button>
        </form>
      </section>
    </main>
  );
}
