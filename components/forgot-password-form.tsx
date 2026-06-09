"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    const supabase = createClient();
    if (!supabase) {
      setMessage("Password recovery is temporarily unavailable.");
      return;
    }

    setLoading(true);
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    setMessage(
      "If an account exists for this address, a password reset email has been sent.",
    );
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Logo />
        <div className="auth-heading">
          <span className="auth-icon"><KeyRound size={22} /></span>
          <h1>Reset your password</h1>
          <p>Enter your account email and we will send a secure recovery link.</p>
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
          {message && <div className="form-message" role="status">{message}</div>}
          <button className="auth-submit" disabled={loading} type="submit">
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>
        <div className="auth-switch">
          <span>Remembered it? <Link href="/login">Return to login</Link></span>
        </div>
      </section>
    </main>
  );
}
