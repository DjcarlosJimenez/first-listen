import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ArtistSiteManager } from "@/components/artist-site-manager";
import { Logo } from "@/components/logo";
import { hasOwnerAccess } from "@/lib/admin-access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OwnerArtistPagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/owner/artist-pages");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, founder_number")
    .eq("id", user.id)
    .maybeSingle();
  if (!hasOwnerAccess(profile, user.email)) redirect("/dashboard");

  const { data, error } = await supabase.rpc("admin_list_artist_sites");

  return (
    <main className="artist-site-manager-page">
      <header className="account-header">
        <Logo />
        <Link href="/owner"><ArrowLeft size={16} /> Propietario</Link>
      </header>
      {error ? (
        <div className="artist-site-manager-error" role="alert">
          No pudimos cargar las paginas de artistas. {error.message}
        </div>
      ) : (
        <ArtistSiteManager initialSites={data ?? []} />
      )}
    </main>
  );
}
