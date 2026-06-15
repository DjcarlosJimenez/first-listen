import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PublicEntry } from "@/components/public-entry";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  let founderRemaining = 50;
  let authenticated = false;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    authenticated = Boolean(user);

    const { data } = await supabase
      .from("founder_program")
      .select("capacity, claimed_count")
      .eq("id", true)
      .maybeSingle();
    if (data) founderRemaining = Math.max(0, data.capacity - data.claimed_count);
  } catch {
    founderRemaining = 0;
  }

  if (authenticated) redirect("/dashboard");
  const cookieStore = await cookies();
  if (cookieStore.get("first-listen-guest-token")?.value) redirect("/guest");

  return <PublicEntry initialFounderRemaining={founderRemaining} />;
}
