import { PublicEntry } from "@/components/public-entry";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  let founderRemaining = 50;

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("founder_program")
      .select("capacity, claimed_count")
      .eq("id", true)
      .maybeSingle();
    if (data) founderRemaining = Math.max(0, data.capacity - data.claimed_count);
  } catch {
    founderRemaining = 0;
  }

  return <PublicEntry initialFounderRemaining={founderRemaining} />;
}
