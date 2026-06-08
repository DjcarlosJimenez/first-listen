"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const isSignup = mode === "signup";
  const nextPath = useMemo(() => searchParams.get("next") || "/dashboard", [searchParams]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    const supabase = createClient();
    if (!supabase) {
      setError("Supabase is not configured. Add Vercel environment variables before launch.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim();

    if (!email || !password || (isSignup && !name)) {
      setError("Please complete all required fields.");
      return;
    }
    if (isSignup && !accepted) {
      setError("You must accept the legal terms and explicit-content disclaimer.");
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
            },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        })
      : await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    if (isSignup && !result.data.session) {
      setMessage("Account created. Check your email to confirm your address, then log in.");
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
          <h1>{isSignup ? "Create your First Listen account" : "Log in to First Listen"}</h1>
          <p>
            {isSignup
              ? "Use your real email and a secure password. Private areas are account-only."
              : "Dashboard, reviews, submissions, profile, and admin tools require authentication."}
          </p>
        </div>

        <form onSubmit={submit}>
          {isSignup && (
            <label className="auth-field">
              <span>Name</span>
              <input autoComplete="name" name="name" required type="text" />
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input autoComplete="email" name="email" required type="email" />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              autoComplete={isSignup ? "new-password" : "current-password"}
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>

          {isSignup && (
            <label className="legal-check">
              <input
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                required
                type="checkbox"
              />
              <span>
                I accept the <Link href="/terms">Terms of Service</Link>,{" "}
                <Link href="/privacy">Privacy Policy</Link>,{" "}
                <Link href="/guidelines">Community Guidelines</Link>, and{" "}
                <Link href="/explicit-content">Explicit Content Disclaimer</Link>.
                Users may encounter music containing explicit language, mature
                themes, or adult subject matter.
              </span>
            </label>
          )}

          {error && <div className="auth-error" role="alert">{error}</div>}
          {message && <div className="form-message" role="status">{message}</div>}

          <button className="auth-submit" disabled={loading} type="submit">
            {loading ? "Please wait..." : isSignup ? "Create account" : "Log in"}
            <ArrowRight size={16} />
          </button>
        </form>

        <div className="auth-switch">
          <ShieldCheck size={16} />
          {isSignup ? (
            <span>Already have an account? <Link href="/login">Log in</Link></span>
          ) : (
            <span>New to First Listen? <Link href="/signup">Create account</Link></span>
          )}
        </div>
      </section>
    </main>
  );
}
