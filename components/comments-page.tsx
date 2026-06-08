import Link from "next/link";
import { ArrowLeft, MessageSquareText, ShieldCheck, Star } from "lucide-react";
import { Logo } from "@/components/logo";

type SongComment = {
  review_id: string;
  song_id: string;
  song_title: string;
  rating: number;
  comment: string;
  quality_score: number;
  created_at: string;
};

export function CommentsPage({
  comments,
  selectedSongTitle,
}: {
  comments: SongComment[];
  selectedSongTitle?: string;
}) {
  return (
    <main className="comments-page">
      <header className="account-header">
        <Logo />
        <Link href="/dashboard"><ArrowLeft size={16} /> Dashboard</Link>
      </header>

      <section className="comments-page-card">
        <div className="comments-page-heading">
          <div>
            <span className="eyebrow"><MessageSquareText size={13} /> Listener feedback</span>
            <h1>{selectedSongTitle ? `${selectedSongTitle} comments` : "All song comments"}</h1>
            <p>Every accepted comment from your submitted songs, newest first.</p>
          </div>
          <strong>{comments.length}</strong>
        </div>

        {comments.length === 0 ? (
          <div className="empty-state">
            <p>No comments have been received for this selection yet.</p>
          </div>
        ) : (
          <div className="full-comment-list">
            {comments.map((comment) => (
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
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
