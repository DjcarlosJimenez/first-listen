import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  let authenticated = false;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    authenticated = Boolean(user);
  } catch {
    authenticated = false;
  }

  if (authenticated) redirect("/dashboard");
  redirect("/guest");
}
