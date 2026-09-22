"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Plus, Save } from "lucide-react";
import { normalizeArtistSiteSlug } from "@/lib/artist-sites";
import { createClient } from "@/lib/supabase/client";

type ManagedSite = {
  id: string;
  slug: string;
  name: string;
  owner_user_id: string | null;
  owner_email: string | null;
  published: boolean;
  slug_locked: boolean;
  sort_order: number;
  updated_at: string;
};

export function ArtistSiteManager({ initialSites }: { initialSites: ManagedSite[] }) {
  const router = useRouter();
  const [sites, setSites] = useState(initialSites);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const [tagline, setTagline] = useState("");
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const reload = async () => {
    const client = createClient();
    if (!client) return;
    const { data, error } = await client.rpc("admin_list_artist_sites");
    if (error) {
      setMessage(error.message);
      return;
    }
    setSites((data ?? []) as ManagedSite[]);
    router.refresh();
  };

  const createSite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setCredentials(null);
    try {
      const response = await fetch("/api/owner/artist-sites", {
        body: JSON.stringify({ channelUrl, name, ownerEmail, slug, tagline }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        existingAccount?: boolean;
        temporaryPassword?: string | null;
      };
      if (!response.ok) {
        setMessage(result.error ?? "No se pudo crear la pagina.");
      } else {
        setName("");
        setSlug("");
        setOwnerEmail("");
        setChannelUrl("");
        setTagline("");
        if (result.temporaryPassword && ownerEmail.trim()) {
          setCredentials({ email: ownerEmail.trim(), password: result.temporaryPassword });
        }
        setMessage(result.existingAccount
          ? "Pagina creada y asignada a la cuenta existente. Usa su contrasena actual."
          : "Pagina creada como borrador. Ya puedes editarla.");
        await reload();
      }
    } catch {
      setMessage("No hubo conexion con el servidor. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  };

  const updateSite = (id: string, update: Partial<ManagedSite>) => {
    setSites((current) => current.map((site) =>
      site.id === id ? { ...site, ...update } : site,
    ));
  };

  const saveSite = async (site: ManagedSite) => {
    const client = createClient();
    if (!client || busy) return;
    setBusy(true);
    setMessage("");
    const { error } = await client.rpc("admin_update_artist_site", {
      site_id: site.id,
      site_name: site.name.trim(),
      site_slug: site.slug.trim(),
      owner_email: site.owner_email?.trim() || null,
      site_published: site.published,
      site_sort_order: site.sort_order,
    });
    setMessage(error ? error.message : `Guardado: ${site.name}`);
    if (!error) await reload();
    setBusy(false);
  };

  const moveSite = async (site: ManagedSite, direction: -1 | 1) => {
    const ordered = [...sites].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((item) => item.id === site.id);
    const neighbor = ordered[index + direction];
    if (!neighbor || busy) return;
    const client = createClient();
    if (!client) return;
    setBusy(true);
    setMessage("");
    ordered[index] = neighbor;
    ordered[index + direction] = site;
    const { error } = await client.rpc("admin_reorder_artist_sites", {
      site_ids: ordered.map((item) => item.id),
    });
    setMessage(error?.message ?? "Orden actualizado.");
    await reload();
    setBusy(false);
  };

  return (
    <div className="artist-site-manager">
      <div className="artist-site-manager-heading">
        <div>
          <span className="eyebrow">PAGINAS PERSONALIZADAS</span>
          <h1>Paginas de artistas</h1>
        </div>
        <Link href="/paginas-de-artistas"><ExternalLink size={16} /> Ver directorio</Link>
      </div>

      <form className="artist-site-create" onSubmit={(event) => void createSite(event)}>
        <h2>Nueva pagina</h2>
        <label>Nombre del artista
          <input required maxLength={120} onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label>Canal de YouTube
          <input
            onChange={(event) => setChannelUrl(event.target.value)}
            placeholder="https://www.youtube.com/@canal"
            type="url"
            value={channelUrl}
          />
        </label>
        <label>Direccion en First Listen
          <input
            aria-describedby="artist-site-slug-help"
            onChange={(event) => setSlug(event.target.value)}
            placeholder={normalizeArtistSiteSlug(channelUrl, name || "nombre-artista")}
            value={slug}
          />
          <small id="artist-site-slug-help">firstlisten.net/{normalizeArtistSiteSlug(slug || channelUrl, name || "nombre-artista")}</small>
        </label>
        <label>Descripcion breve
          <input maxLength={240} onChange={(event) => setTagline(event.target.value)} value={tagline} />
        </label>
        <label>Correo para administrar (opcional)
          <input
            autoComplete="off"
            onChange={(event) => setOwnerEmail(event.target.value)}
            placeholder="Si no existe, se creara una cuenta"
            type="email"
            value={ownerEmail}
          />
        </label>
        <button disabled={busy} type="submit"><Plus size={16} /> Crear borrador</button>
      </form>

      {message && <p className="artist-site-manager-message" role="status">{message}</p>}
      {credentials && (
        <div className="artist-site-credentials" role="status">
          <div><strong>Acceso temporal creado</strong><span>Comparte estos datos de forma privada. Al entrar debera cambiar la contrasena.</span></div>
          <code>{credentials.email}</code>
          <code>{credentials.password}</code>
          <button onClick={() => void navigator.clipboard.writeText(`Correo: ${credentials.email}\nContrasena temporal: ${credentials.password}`)} type="button"><Copy size={16} /> Copiar acceso</button>
        </div>
      )}

      <div className="artist-site-manager-list">
        {sites.map((site) => (
          <article className="artist-site-manager-row" key={site.id}>
            <div className="artist-site-manager-row-head">
              <strong>{site.name}</strong>
              <span>{site.published ? "Publicada" : "Borrador"}</span>
              <Link href={`/${site.slug}/admin`}>Editar contenido</Link>
              <Link href={`/${site.slug}`} target="_blank" title="Abrir pagina"><ExternalLink size={16} /></Link>
            </div>
            <div className="artist-site-manager-fields">
              <label>Nombre
                <input maxLength={120} onChange={(event) => updateSite(site.id, { name: event.target.value })} value={site.name} />
              </label>
              <label>Enlace
                <input disabled={site.slug_locked || site.published} maxLength={62} onChange={(event) => updateSite(site.id, { slug: event.target.value })} value={site.slug} />
              </label>
              <label>Cuenta asignada
                <input
                  onChange={(event) => updateSite(site.id, { owner_email: event.target.value })}
                  placeholder="Sin asignar"
                  type="email"
                  value={site.owner_email ?? ""}
                />
              </label>
              <label className="artist-site-published">
                <input
                  checked={site.published}
                  onChange={(event) => updateSite(site.id, { published: event.target.checked })}
                  type="checkbox"
                />
                Publicada
              </label>
              <button disabled={busy} onClick={() => void moveSite(site, -1)} title="Subir" type="button"><ArrowUp size={16} /></button>
              <button disabled={busy} onClick={() => void moveSite(site, 1)} title="Bajar" type="button"><ArrowDown size={16} /></button>
              <button disabled={busy} onClick={() => void saveSite(site)} type="button"><Save size={16} /> Guardar</button>
            </div>
          </article>
        ))}
        {!sites.length && <p className="artist-site-empty">Aun no hay paginas adicionales. La pagina de DJ Carlos sigue funcionando por separado.</p>}
      </div>
    </div>
  );
}
