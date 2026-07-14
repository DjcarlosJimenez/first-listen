"use client";

import {
  BarChart3,
  Bookmark,
  ExternalLink,
  Heart,
  MessageSquareText,
  Send,
  Share2,
  UserPlus,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { InterfaceLocale } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";
import type { Platform } from "@/lib/types";

type Engagement = {
  views: number;
  validListens: number;
  likes: number;
  comments: number;
  followers: number;
  communityShares: number;
  originalShares: number;
  liked: boolean;
  saved: boolean;
  following: boolean;
};

type SongComment = {
  id: string;
  author: string;
  guest: boolean;
  body: string;
  createdAt: string;
};

const emptyEngagement: Engagement = {
  views: 0,
  validListens: 0,
  likes: 0,
  comments: 0,
  followers: 0,
  communityShares: 0,
  originalShares: 0,
  liked: false,
  saved: false,
  following: false,
};

function firstRow(data: unknown) {
  return Array.isArray(data) ? data[0] : data;
}

export function SongActionBar({
  songId,
  artistId,
  title,
  artist,
  platform,
  link,
  locale,
  guestToken,
  compact = false,
  onFollowChange,
}: {
  songId: string;
  artistId?: string;
  title: string;
  artist: string;
  platform: Platform;
  link: string;
  locale: InterfaceLocale;
  guestToken?: string;
  compact?: boolean;
  onFollowChange?: (following: boolean) => void;
}) {
  const [engagement, setEngagement] = useState(emptyEngagement);
  const [panel, setPanel] = useState<"comments" | "share" | "stats" | null>(
    null,
  );
  const [comments, setComments] = useState<SongComment[]>([]);
  const [comment, setComment] = useState("");
  const [commentFocused, setCommentFocused] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [storedGuestToken, setStoredGuestToken] = useState<string>();
  const commentBoxRef = useRef<HTMLTextAreaElement | null>(null);
  const spanish = locale === "es";
  const effectiveGuestToken = guestToken ?? storedGuestToken;
  const commentDraftKey = `first-listen-comment-draft:${songId}`;

  useEffect(() => {
    if (guestToken || typeof window === "undefined") return;
    setStoredGuestToken(
      window.localStorage.getItem("first-listen-guest-token") ?? undefined,
    );
  }, [guestToken]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setComment(window.localStorage.getItem(commentDraftKey) ?? "");
  }, [commentDraftKey]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const attribute = "data-song-action-panel-open";

    if (panel) {
      root.setAttribute(attribute, panel);
    } else {
      root.removeAttribute(attribute);
    }

    return () => {
      root.removeAttribute(attribute);
    };
  }, [panel]);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const { data } = await supabase.rpc("get_song_engagement", {
      target_song_id: songId,
      guest_access_token: effectiveGuestToken ?? null,
    });
    const row = firstRow(data) as Record<string, unknown> | null;
    if (!row) return;
    setEngagement({
      views: Number(row.view_count ?? 0),
      validListens: Number(row.valid_listen_count ?? 0),
      likes: Number(row.like_count ?? 0),
      comments: Number(row.comment_count ?? 0),
      followers: Number(row.follower_count ?? 0),
      communityShares: Number(row.community_share_count ?? 0),
      originalShares: Number(row.original_share_count ?? 0),
      liked: Boolean(row.liked),
      saved: Boolean(row.saved),
      following: Boolean(row.following),
    });
  }, [effectiveGuestToken, songId]);

  const loadComments = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) return;
    const { data } = await supabase.rpc("get_song_comments", {
      target_song_id: songId,
      comment_limit: 30,
    });
    setComments(
      ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.comment_id),
        author: String(row.author_name),
        guest: Boolean(row.guest_author),
        body: String(row.comment_body),
        createdAt: String(row.created_at),
      })),
    );
  }, [songId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runToggle = async (
    action: "like" | "save" | "follow",
    rpc: string,
    params: Record<string, string | null>,
  ) => {
    const supabase = createClient();
    if (!supabase || busy) return;
    if (!effectiveGuestToken) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.assign("/guest");
        return;
      }
    }
    setBusy(action);
    const { data, error } = await supabase.rpc(rpc, {
      ...params,
      guest_access_token: effectiveGuestToken ?? null,
    });
    setBusy("");
    if (error) {
      setMessage(error.message);
      return;
    }
    const enabled = Boolean(data);
    setEngagement((current) => {
      if (action === "like") {
        return {
          ...current,
          liked: enabled,
          likes: Math.max(0, current.likes + (enabled ? 1 : -1)),
        };
      }
      if (action === "save") return { ...current, saved: enabled };
      return {
        ...current,
        following: enabled,
        followers: Math.max(0, current.followers + (enabled ? 1 : -1)),
      };
    });
    if (action === "follow") onFollowChange?.(enabled);
  };

  const submitComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (comment.trim().length < 2) return;
    const supabase = createClient();
    if (!supabase || busy) return;
    if (!effectiveGuestToken) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.assign("/guest");
        return;
      }
    }
    setBusy("comment");
    const { error } = await supabase.rpc("add_song_comment", {
      target_song_id: songId,
      comment_body: comment.trim(),
      guest_access_token: effectiveGuestToken ?? null,
    });
    setBusy("");
    if (error) {
      setMessage(error.message);
      return;
    }
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(commentDraftKey);
    }
    setComment("");
    setMessage(
      spanish
        ? "Comentario publicado. Aparece abajo en esta canción."
        : "Comment posted. It appears below on this song.",
    );
    await Promise.all([loadComments(), refresh()]);
  };

  const handleCommentChange = (nextComment: string) => {
    setComment(nextComment);
    if (typeof window === "undefined") return;
    const trimmed = nextComment.trim();
    if (trimmed.length > 0) {
      window.localStorage.setItem(commentDraftKey, nextComment);
    } else {
      window.localStorage.removeItem(commentDraftKey);
    }
  };

  const focusCommentBox = () => {
    window.requestAnimationFrame(() => {
      commentBoxRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    });
  };

  const share = async (kind: "community" | "original_platform") => {
    const supabase = createClient();
    if (!supabase) return;
    const communityUrl = `${window.location.origin}/artists/${artistId ?? ""}`;
    const targetUrl = kind === "community" ? communityUrl : link;
    const shareData = {
      title: `${title} by ${artist}`,
      text:
        kind === "community"
          ? `Listen to ${title} by ${artist} on First Listen.`
          : `Listen to ${title} by ${artist} on ${platform}.`,
      url: targetUrl,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(targetUrl);
        setMessage(spanish ? "Enlace copiado." : "Link copied.");
      }
    } catch {
      return;
    }

    await supabase.rpc("record_song_share", {
      target_song_id: songId,
      share_kind_value: kind,
      share_platform: kind === "original_platform" ? platform : null,
      guest_access_token: effectiveGuestToken ?? null,
    });
    setEngagement((current) => ({
      ...current,
      communityShares:
        current.communityShares + (kind === "community" ? 1 : 0),
      originalShares:
        current.originalShares + (kind === "original_platform" ? 1 : 0),
    }));
  };

  return (
    <div className={`song-action-shell${compact ? " compact" : ""}`}>
      <div className="song-action-bar" aria-label={spanish ? "Acciones de canción" : "Song actions"}>
        <button
          className={engagement.liked ? "active" : ""}
          data-community-action="like"
          data-ui-component="likeButton"
          disabled={busy === "like"}
          onClick={() =>
            void runToggle("like", "toggle_song_like", {
              target_song_id: songId,
            })
          }
          type="button"
        >
          <Heart fill={engagement.liked ? "currentColor" : "none"} size={15} />
          {spanish ? "Me gusta" : "Like"}
        </button>
        <button
          className={panel === "comments" ? "active" : ""}
          data-community-action="comment"
          data-ui-component="commentsButton"
          onClick={() => {
            const next = panel === "comments" ? null : "comments";
            setPanel(next);
            if (next) void loadComments();
          }}
          type="button"
        >
          <MessageSquareText size={15} />
          {spanish ? "Comentarios" : "Comments"}
        </button>
        <button
          className={engagement.following ? "active" : ""}
          data-artist-follow-button
          data-community-action="follow"
          data-ui-component="followButton"
          disabled={!artistId || busy === "follow"}
          onClick={() =>
            artistId &&
            void runToggle("follow", "toggle_follow_artist", {
              target_artist_id: artistId,
            })
          }
          type="button"
        >
          <UserPlus size={15} />
          {engagement.following
            ? spanish
              ? "Siguiendo"
              : "Following"
            : spanish
              ? "Seguir"
              : "Follow"}
        </button>
        <button
          className={engagement.saved ? "active" : ""}
          data-community-action="save"
          data-ui-component="saveButton"
          disabled={busy === "save"}
          onClick={() =>
            void runToggle("save", "toggle_save_song", {
              target_song_id: songId,
            })
          }
          type="button"
        >
          <Bookmark fill={engagement.saved ? "currentColor" : "none"} size={15} />
          {engagement.saved
            ? spanish
              ? "Guardada"
              : "Saved"
            : spanish
              ? "Guardar"
              : "Save"}
        </button>
        <button
          className={panel === "share" ? "active" : ""}
          data-community-action="share"
          data-ui-component="shareButton"
          onClick={() => setPanel(panel === "share" ? null : "share")}
          type="button"
        >
          <Share2 size={15} />
          {spanish ? "Compartir" : "Share"}
        </button>
        <button
          className={panel === "stats" ? "active" : ""}
          data-ui-component="statisticsButton"
          onClick={() => setPanel(panel === "stats" ? null : "stats")}
          type="button"
        >
          <BarChart3 size={15} />
          {spanish ? "Estadísticas" : "Stats"}
        </button>
      </div>

      {panel && (
        <section
          className={`song-action-panel${panel === "comments" ? " song-action-panel-comments" : ""}${commentFocused ? " is-writing" : ""}`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            aria-label={spanish ? "Cerrar" : "Close"}
            className="song-action-close"
            onClick={() => setPanel(null)}
            type="button"
          >
            <X size={15} />
          </button>

          {panel === "comments" && (
            <>
              <h4>{spanish ? "Comentarios de la comunidad" : "Community comments"}</h4>
              <form onSubmit={submitComment}>
                <textarea
                  aria-label={spanish ? "Escribe un comentario" : "Write a comment"}
                  autoCapitalize="sentences"
                  autoComplete="off"
                  inputMode="text"
                  maxLength={1000}
                  onChange={(event) => handleCommentChange(event.target.value)}
                  onBlur={() => {
                    window.setTimeout(() => setCommentFocused(false), 120);
                  }}
                  onFocus={() => {
                    setCommentFocused(true);
                    focusCommentBox();
                  }}
                  placeholder={spanish ? "Escribe un comentario..." : "Write a comment..."}
                  ref={commentBoxRef}
                  rows={2}
                  value={comment}
                />
                <button disabled={busy === "comment" || comment.trim().length < 2} type="submit">
                  <Send size={14} /> {spanish ? "Publicar" : "Post"}
                </button>
              </form>
              <p className="song-comment-helper">
                {spanish
                  ? "Tu comentario queda público en esta canción. Si cierras este panel, guardo tu borrador en este dispositivo."
                  : "Your comment appears publicly on this song. If you close this panel, your draft stays saved on this device."}
              </p>
              {message && (
                <p className="song-action-message song-action-message-inline" role="status">
                  {message}
                </p>
              )}
              <div className="song-comment-list-heading">
                <strong>{spanish ? "Comentarios publicados aquí" : "Published here"}</strong>
                <span>{comments.length}</span>
              </div>
              <div className="song-comment-list">
                {comments.map((item) => (
                  <article key={item.id}>
                    <strong>
                      {item.guest ? (spanish ? "Visitante: " : "Guest: ") : ""}
                      {item.author}
                    </strong>
                    <p>{item.body}</p>
                    <small>{new Date(item.createdAt).toLocaleDateString()}</small>
                  </article>
                ))}
                {!comments.length && (
                  <p>{spanish ? "Sé la primera persona en comentar." : "Be the first to comment."}</p>
                )}
              </div>
              <p className="song-comment-end">
                {comments.length
                  ? spanish
                    ? "Ya viste todos los comentarios."
                    : "You have seen all comments."
                  : spanish
                    ? "Todavía no hay comentarios. Sé la primera persona en apoyar esta canción."
                    : "When someone comments, it will appear here."}
              </p>
            </>
          )}

          {panel === "share" && (
            <>
              <h4>{spanish ? "Compartir esta canción" : "Share This Song"}</h4>
              <div className="song-share-options">
                <button
                  data-ui-component="shareButton"
                  onClick={() => void share("community")}
                  type="button"
                >
                  <Share2 size={16} />
                  <span>
                    <strong>{spanish ? "Compartir First Listen" : "Share First Listen"}</strong>
                    <small>{spanish ? "Ayuda a crecer la comunidad" : "Help grow the community"}</small>
                  </span>
                </button>
                <button
                  data-ui-component="openPlatformButton"
                  onClick={() => void share("original_platform")}
                  type="button"
                >
                  <ExternalLink size={16} />
                  <span>
                    <strong>{spanish ? "Compartir lanzamiento original" : "Share Original Release"}</strong>
                    <small>{platform}</small>
                  </span>
                </button>
              </div>
            </>
          )}

          {panel === "stats" && (
            <>
              <h4>{spanish ? "Estadísticas de la canción" : "Song Statistics"}</h4>
              <div className="song-action-stats">
                <span><strong>{engagement.views}</strong>{spanish ? "Vistas" : "Views"}</span>
                <span><strong>{engagement.validListens}</strong>{spanish ? "Reproducciones que suman" : "Plays that count"}</span>
                <span><strong>{engagement.likes}</strong>{spanish ? "Me gusta" : "Likes"}</span>
                <span><strong>{engagement.comments}</strong>{spanish ? "Comentarios" : "Comments"}</span>
                <span><strong>{engagement.followers}</strong>{spanish ? "Seguidores" : "Followers"}</span>
                <span><strong>{engagement.communityShares + engagement.originalShares}</strong>{spanish ? "Compartidos" : "Shares"}</span>
              </div>
              <small>
                {spanish
                  ? `${engagement.communityShares} compartidos de comunidad / ${engagement.originalShares} a plataformas originales`
                  : `${engagement.communityShares} community shares / ${engagement.originalShares} original-platform shares`}
              </small>
            </>
          )}

          {message && panel !== "comments" && <p className="song-action-message" role="status">{message}</p>}
        </section>
      )}
      {message && !panel && (
        <p className="song-action-message" role="status">{message}</p>
      )}
    </div>
  );
}
