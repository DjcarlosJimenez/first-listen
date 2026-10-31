"use client";

import Link from "next/link";
import { useState } from "react";
import { BadgeCheck, CheckCircle2, Clock3, LoaderCircle, ShieldCheck } from "lucide-react";
import type { FirstPublishVerificationType } from "@/lib/first-publish";

export function FirstPublishVerify({
  token,
  tokenHash,
  type,
}: {
  token: string;
  tokenHash: string;
  type: FirstPublishVerificationType | "";
}) {
  const [publishing, setPublishing] = useState(false);
  const [retaining, setRetaining] = useState(false);
  const [songId, setSongId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [retained, setRetained] = useState(false);
  const [error, setError] = useState("");
  const linkReady = Boolean(token && tokenHash && type);

  async function publish() {
    if (!linkReady || publishing) return;
    setPublishing(true);
    setError("");
    try {
      const response = await fetch("/api/first-publish/verify", {
        body: JSON.stringify({ token, tokenHash, type }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as {
        error?: string;
        expiresAt?: string | null;
        retained?: boolean;
        songId?: string | null;
      };
      if (!response.ok || !data.songId) throw new Error(data.error || "No pudimos publicar la canción.");
      setSongId(data.songId);
      setExpiresAt(data.expiresAt ?? "");
      setRetained(Boolean(data.retained));
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "No pudimos publicar la canción.");
    } finally {
      setPublishing(false);
    }
  }

  async function retain() {
    if (!songId || retaining) return;
    setRetaining(true);
    setError("");
    try {
      const response = await fetch("/api/first-publish/retain", {
        body: JSON.stringify({ songId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "No pudimos conservar la publicación.");
      setRetained(true);
      setExpiresAt("");
    } catch (retainError) {
      setError(retainError instanceof Error ? retainError.message : "No pudimos conservar la publicación.");
    } finally {
      setRetaining(false);
    }
  }

  if (songId) {
    return (
      <main className="first-publish-page first-publish-verify-page">
        <section className="first-publish-success-card published">
          <span className="first-publish-success-icon"><CheckCircle2 size={32} /></span>
          <span className="eyebrow">PUBLICACIÓN COMPLETADA</span>
          <h1>{retained ? "Tu canción se mantendrá activa" : "Tu canción ya está publicada"}</h1>
          <p>
            {retained
              ? "Tu acceso gratuito quedó activo. Ya puedes administrar esta canción y publicar más desde tu cuenta."
              : `Estará visible en First Listen durante 7 días${expiresAt ? `, hasta ${new Date(expiresAt).toLocaleDateString("es-US")}` : ""}.`}
          </p>
          {!retained && (
            <div className="first-publish-retain-box">
              <BadgeCheck size={24} />
              <div>
                <strong>Mantén tu canción activa gratis</strong>
                <span>Sin tarjeta. Conserva la publicación y administra tu música.</span>
              </div>
              <button disabled={retaining} onClick={retain} type="button">
                {retaining ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
                {retaining ? "Activando..." : "Mantenerla activa"}
              </button>
            </div>
          )}
          {error && <div className="first-publish-error" role="alert">{error}</div>}
          <div className="first-publish-success-actions">
            <Link className="primary" href={retained ? "/dashboard" : "/guest"}>
              {retained ? "Administrar mi música" : "Ver First Listen"}
            </Link>
            {!retained && <Link href="/dashboard">Entrar a mi cuenta gratuita</Link>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="first-publish-page first-publish-verify-page">
      <section className="first-publish-success-card verify">
        <span className="first-publish-success-icon"><ShieldCheck size={30} /></span>
        <span className="eyebrow">CONFIRMACIÓN SEGURA</span>
        <h1>Confirma y publica</h1>
        <p>
          Abrir el correo no publicó nada. Presiona el botón para confirmar tu dirección y colocar tu canción en First Listen durante 7 días.
        </p>
        <div className="first-publish-email-help">
          <Clock3 size={18} />
          <span>Este paso manual evita que los escáneres de correo consuman tu enlace.</span>
        </div>
        {error && <div className="first-publish-error" role="alert">{error}</div>}
        <button className="first-publish-submit" disabled={!linkReady || publishing} onClick={publish} type="button">
          {publishing ? <LoaderCircle className="spin" size={19} /> : <CheckCircle2 size={19} />}
          {publishing ? "Publicando..." : "Confirmar correo y publicar"}
        </button>
        {!linkReady && <p className="first-publish-error">El enlace está incompleto. Solicita uno nuevo.</p>}
        <Link href="/first-publish">Solicitar un enlace nuevo</Link>
      </section>
    </main>
  );
}
