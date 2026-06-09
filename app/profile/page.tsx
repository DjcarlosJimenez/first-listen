import { redirect } from "next/navigation";
import { ProfilePanel } from "@/components/profile-panel";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/profile");

  const [
    { data: profile },
    { data: songs },
    { data: savedSongs },
    { data: impactRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, founder_number, founder_free_submissions_remaining, role, credits, show_explicit_content")
      .eq("id", user.id)
      .single(),
    supabase
      .from("songs")
      .select("id, title, artist_name, music_url, platform, is_active, explicit_content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.rpc("get_saved_songs"),
    supabase.rpc("get_listener_impact_profile"),
  ]);
  if (!profile) redirect("/login?error=profile");

  return (
    <ProfilePanel
      profile={{
        id: user.id,
        displayName: profile.display_name,
        email: user.email ?? "",
        founder: profile.founder_number !== null,
        role: profile.role,
        credits: profile.credits,
        founderSubmissionsRemaining:
          profile.founder_free_submissions_remaining,
        showExplicitContent: profile.show_explicit_content,
      }}
      impact={(
        Array.isArray(impactRows) ? impactRows[0] : impactRows
      ) as never}
      savedSongs={(savedSongs ?? []) as never}
      songs={songs ?? []}
    />
  );
}
