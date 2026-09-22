import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { hasOwnerAccess } from "@/lib/admin-access";
import {
  emptyArtistSiteConfig,
  normalizeArtistSiteConfig,
  normalizeArtistSiteSlug,
} from "@/lib/artist-sites";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type CreateArtistSiteBody = {
  channelUrl?: unknown;
  name?: unknown;
  ownerEmail?: unknown;
  slug?: unknown;
  tagline?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validChannelUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return url.protocol === "https:" && ["youtube.com", "m.youtube.com", "youtu.be"].includes(host);
  } catch {
    return false;
  }
}

async function findUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found || data.users.length < 1000) return found ?? null;
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Inicia sesion nuevamente." }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, founder_number")
    .eq("id", user.id)
    .maybeSingle();
  if (!hasOwnerAccess(profile, user.email)) {
    return NextResponse.json({ error: "No tienes permiso para crear paginas." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as CreateArtistSiteBody;
  const name = cleanText(body.name, 120);
  const channelUrl = cleanText(body.channelUrl, 2048);
  const ownerEmail = cleanText(body.ownerEmail, 320).toLowerCase();
  const slug = normalizeArtistSiteSlug(cleanText(body.slug, 2048), name);
  const tagline = cleanText(body.tagline, 240);

  if (name.length < 2) {
    return NextResponse.json({ error: "Escribe el nombre del artista o creador." }, { status: 400 });
  }
  if (!validChannelUrl(channelUrl)) {
    return NextResponse.json({ error: "El canal debe ser un enlace valido de YouTube." }, { status: 400 });
  }
  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return NextResponse.json({ error: "Revisa el correo de acceso." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: duplicate } = await admin
    .from("artist_sites")
    .select("id")
    .eq("slug_key", slug.toLowerCase())
    .maybeSingle();
  if (duplicate) {
    return NextResponse.json({ error: `La direccion /${slug} ya esta en uso.` }, { status: 409 });
  }

  let account = ownerEmail ? await findUserByEmail(admin, ownerEmail) : null;
  let accountCreated = false;
  let temporaryPassword: string | null = null;

  if (ownerEmail && !account) {
    temporaryPassword = `${randomBytes(18).toString("base64url")}Aa1!`;
    const { data, error } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        explicit_content_acknowledged: true,
        full_name: name,
        legal_accepted: true,
        system_bootstrap: true,
      },
    });
    if (error || !data.user) {
      return NextResponse.json({ error: error?.message ?? "No se pudo crear la cuenta." }, { status: 400 });
    }
    account = data.user;
    accountCreated = true;
    const { error: profileError } = await admin
      .from("profiles")
      .update({ account_status: "active", force_password_change: true })
      .eq("id", account.id);
    if (profileError) {
      await admin.auth.admin.deleteUser(account.id);
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
  }

  const config = normalizeArtistSiteConfig({
    ...emptyArtistSiteConfig(),
    channelUrl,
    tagline,
  });
  const { data: site, error: siteError } = await admin
    .from("artist_sites")
    .insert({ config, name, owner_user_id: account?.id ?? null, slug })
    .select("id, name, slug")
    .single();

  if (siteError) {
    if (accountCreated && account) await admin.auth.admin.deleteUser(account.id);
    return NextResponse.json({ error: siteError.message }, { status: 400 });
  }

  await admin.from("admin_audit_log").insert({
    actor_id: user.id,
    action: "create_artist_site",
    target_type: "artist_site",
    target_id: site.id,
    details: { account_created: accountCreated, channel_url: channelUrl || null },
  });

  return NextResponse.json({
    accountCreated,
    email: ownerEmail || null,
    existingAccount: Boolean(ownerEmail && !accountCreated),
    site,
    temporaryPassword,
  });
}
