"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Heart,
  Headphones,
  MessageSquareText,
  Share2,
  UserPlus,
} from "lucide-react";
import type { InterfaceLocale } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";

type CommunityPulseItem = {
  event_id: string;
  event_type:
    | "valid_listen"
    | "complete_listen"
    | "review"
    | "follow"
    | "like"
    | "comment"
    | "share";
  actor_name: string;
  artist_id: string;
  artist_name: string;
  song_id: string | null;
  song_title: string | null;
  created_at: string;
};

const activityIcons = {
  valid_listen: Headphones,
  complete_listen: Headphones,
  review: MessageSquareText,
  follow: UserPlus,
  like: Heart,
  comment: MessageSquareText,
  share: Share2,
};

function activityText(
  item: CommunityPulseItem,
  locale: InterfaceLocale,
) {
  const target = item.song_title ?? item.artist_name;
  if (locale === "es") {
    const verbs = {
      valid_listen: "apoyó",
      complete_listen: "terminó de escuchar",
      review: "dejó una review en",
      follow: "siguió a",
      like: "marcó Me gusta en",
      comment: "comentó en",
      share: "compartió",
    };
    return `${item.actor_name} ${verbs[item.event_type]} ${target}`;
  }
  const verbs = {
    valid_listen: "supported",
    complete_listen: "finished listening to",
    review: "reviewed",
    follow: "followed",
    like: "liked",
    comment: "commented on",
    share: "shared",
  };
  return `${item.actor_name} ${verbs[item.event_type]} ${target}`;
}

export function CommunityPulse({
  locale,
  compact = false,
}: {
  locale: InterfaceLocale;
  compact?: boolean;
}) {
  const [items, setItems] = useState<CommunityPulseItem[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const supabase = createClient();
      if (!supabase) return;
      const { data, error } = await supabase.rpc(
        "get_public_community_activity",
        { activity_limit: compact ? 6 : 12 },
      );
      if (active && !error) setItems((data ?? []) as CommunityPulseItem[]);
    };
    void load();
    const interval = window.setInterval(() => void load(), 45_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [compact]);

  return (
    <section className={compact ? "community-pulse compact" : "community-pulse"}>
      <div className="community-pulse-heading">
        <div>
          <span className="eyebrow">
            <UsersIcon />
            {locale === "es" ? "Actividad de la comunidad" : "Community Activity"}
          </span>
          <h2>
            {locale === "es"
              ? "La comunidad está escuchando"
              : "The community is listening"}
          </h2>
        </div>
        <span className="community-live-indicator">
          <i /> {locale === "es" ? "En vivo" : "Live"}
        </span>
      </div>
      <div className="community-pulse-list">
        {items.map((item) => {
          const Icon = activityIcons[item.event_type] ?? Headphones;
          return (
            <article key={item.event_id}>
              <span><Icon size={14} /></span>
              <div>
                <strong>{activityText(item, locale)}</strong>
                <small>{new Date(item.created_at).toLocaleString()}</small>
              </div>
              <Link href={`/artists/${item.artist_id}`}>
                {locale === "es" ? "Perfil" : "Profile"}
              </Link>
            </article>
          );
        })}
        {!items.length && (
          <p className="community-pulse-empty">
            {locale === "es"
              ? "La próxima escucha, review o comentario aparecerá aquí."
              : "The next listen, review, or comment will appear here."}
          </p>
        )}
      </div>
    </section>
  );
}

function UsersIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="13"
      viewBox="0 0 24 24"
      width="13"
    >
      <path
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
