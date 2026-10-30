"use client";

import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import {
  CircleUserRound,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

export function DjCarlosAdminLogin({
  logoUrl,
  ownerAccessDenied = false,
}: {
  logoUrl: string;
  ownerAccessDenied?: boolean;
}) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const submitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setStatus("");

    try {
      const response = await fetch("/DJCarlosJimenez/admin/session", {
        body: JSON.stringify({ password, remember }),
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(
          typeof data.error === "string"
            ? data.error
            : "No se pudo abrir el panel.",
        );
        return;
      }
      window.location.reload();
    } catch {
      setStatus("No se pudo conectar con el panel. Intenta otra vez.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="djcx-admin-page djcx-login-page">
      <section className="djcx-login-card">
        <Image
          alt="DJ Carlos Jimenez logo"
          height={94}
          priority
          src={logoUrl}
          width={94}
        />
        <span>
          <ShieldCheck size={15} /> Panel protegido
        </span>
        <h1>DJ Carlos Jimenez</h1>
        <p>
          Entra con la contrasena de artista para editar album, Top Ten y videos.
          Puedes recordarla en este navegador.
        </p>
        <form onSubmit={submitPassword}>
          <label>
            Contrasena
            <input
              autoComplete="current-password"
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <label className="djcx-login-remember">
            <input
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              type="checkbox"
            />
            Recordarme en este navegador
          </label>
          <button disabled={loading || !password.trim()} type="submit">
            <LockKeyhole size={16} />
            {loading ? "Revisando..." : "Entrar al panel"}
          </button>
        </form>
        {(status || ownerAccessDenied) && (
          <div className="djcx-login-error" role="alert">
            {status || "La cuenta abierta no tiene acceso de propietario."}
          </div>
        )}
        <div className="djcx-login-owner-access">
          <span>Acceso del propietario</span>
          <Link href="/DJCarlosJimenez/admin/owner-session">
            <CircleUserRound size={17} /> Entrar con cuenta Owner
          </Link>
          <a href="https://www.firstlisten.net/forgot-password">
            <KeyRound size={17} /> Olvide mi contrasena
          </a>
        </div>
        <Link href="/DJCarlosJimenez">
          Ver pagina publica <ExternalLink size={14} />
        </Link>
      </section>
    </main>
  );
}
