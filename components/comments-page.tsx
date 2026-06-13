"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  Flag,
  MessageSquareText,
  ShieldCheck,
  Star,
  ThumbsUp,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { createClient } from "@/lib/supabase/client";
import { useInterfaceLocale } from "@/lib/use-interface-locale";

type SongComment = {
  review_id: string;
  reviewer_id: string;
  song_id: string;
  song_title: string;
  rating: number;
  comment: string;
  quality_score: number;
  helpful: boolean;
  created_at: string;
};

export function CommentsPage({
  comments,
  selectedSongTitle,
}: {
  comments: SongComment[];
  selectedSongTitle?: string;
}) {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";
  const [commentRows, setCommentRows] = useState(comments);
  const [reportReasons, setReportReasons] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");

  const markHelpful = async (reviewId: string) => {
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("mark_review_helpful", {
      target_review_id: reviewId,
    });
    setNotice(error ? error.message : "Helpful review marked. The listener earned 10 Community Points.");
    if (!error) {
      setCommentRows((current) =>
        current.map((comment) =>
          comment.review_id === reviewId
            ? { ...comment, helpful: true }
            : comment,
        ),
      );
    }
  };

  const reportComment = async (reviewId: string) => {
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("report_review_comment", {
      target_review_id: reviewId,
      report_reason: reportReasons[reviewId] ?? "personal_attack",
      report_details: null,
    });
    setNotice(
      error
        ? error.message
        : "Comment reported. A moderator will review it.",
    );
  };

  return (
    <main className="comments-page">
      <header className="account-header">
        <Logo />
        <Link href="/dashboard">
          <ArrowLeft size={16} /> {spanish ? "Descubrir música" : "Discover Music"}
        </Link>
      </header>

      <section className="comments-page-card">
        <div className="comments-page-heading">
          <div>
            <span className="eyebrow"><MessageSquareText size={13} /> Listener feedback</span>
            <h1>{selectedSongTitle ? `${selectedSongTitle} comments` : "All song comments"}</h1>
            <p>Every accepted comment from your submitted songs, newest first.</p>
            <p className="comment-guideline">
              Please be respectful. Focus feedback on the content. Harassment,
              discrimination, spam, threats, or personal attacks may result in
              moderation action.
            </p>
          </div>
          <strong>{commentRows.length}</strong>
        </div>

        {notice && <div className="admin-notice" role="status">{notice}</div>}

        {commentRows.length === 0 ? (
          <div className="empty-state">
            <p>No comments have been received for this selection yet.</p>
          </div>
        ) : (
          <div className="full-comment-list">
            {commentRows.map((comment) => (
              <article key={comment.review_id}>
                <div className="full-comment-meta">
                  <div>
                    <strong>{comment.song_title}</strong>
                    <small>{new Date(comment.created_at).toLocaleDateString("en-US", { timeZone: "UTC" })}</small>
                  </div>
                  <span><Star fill="currentColor" size={12} /> {comment.rating}/10</span>
                  <span><ShieldCheck size={12} /> Quality {comment.quality_score}</span>
                </div>
                <p>&quot;{comment.comment}&quot;</p>
                <div className="comment-moderation-actions">
                  <button
                    disabled={comment.helpful}
                    onClick={() => void markHelpful(comment.review_id)}
                    type="button"
                  >
                    <ThumbsUp size={13} />{" "}
                    {comment.helpful ? "Marked Helpful" : "Mark Helpful"}
                  </button>
                  <select
                    aria-label={`Report reason for ${comment.song_title}`}
                    onChange={(event) =>
                      setReportReasons((current) => ({
                        ...current,
                        [comment.review_id]: event.target.value,
                      }))
                    }
                    value={reportReasons[comment.review_id] ?? "personal_attack"}
                  >
                    <option value="harassment">Harassment</option>
                    <option value="discrimination">Discrimination</option>
                    <option value="spam">Spam</option>
                    <option value="threats">Threats</option>
                    <option value="personal_attack">Personal Attack</option>
                    <option value="other">Other</option>
                  </select>
                  <button
                    onClick={() => void reportComment(comment.review_id)}
                    type="button"
                  >
                    <Flag size={13} /> Report Comment
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
