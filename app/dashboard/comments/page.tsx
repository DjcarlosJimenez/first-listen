import { redirect } from "next/navigation";
import { CommentsPage } from "@/components/comments-page";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardCommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ song?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/comments");

  const { song } = await searchParams;
  const [{ data: comments }, { data: selectedSong }] = await Promise.all([
    supabase.rpc("get_my_song_comments", {
      target_song_id: song || null,
    }),
    song
      ? supabase
          .from("songs")
          .select("title")
          .eq("id", song)
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <CommentsPage
      comments={(comments ?? []) as never}
      selectedSongTitle={selectedSong?.title}
    />
  );
}
