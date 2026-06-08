import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  CircleHelp,
  Headphones,
  Link2,
  MessageSquareText,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { Logo } from "@/components/logo";

const helpTopics = [
  {
    icon: Headphones,
    title: "Reviewing songs",
    body: "Listen to the opening, answer every required question, and leave a specific comment of at least 30 characters. Low-quality or repeated feedback does not count.",
  },
  {
    icon: Link2,
    title: "Submitting music",
    body: "Submit a direct song link from Spotify, YouTube, YouTube Music, SoundCloud, or Apple Music. First Listen stores metadata and links, never audio.",
  },
  {
    icon: BarChart3,
    title: "Understanding results",
    body: "Hook Score combines Listen Full, Playlist Add, Attention, and Share With Friend percentages. Your dashboard keeps each song's performance separate.",
  },
  {
    icon: UserPlus,
    title: "Following artists",
    body: "Follow artists from their public profile or after a review. Following records listener interest without exposing private account information.",
  },
  {
    icon: Bookmark,
    title: "Saving songs",
    body: "Use Save For Later after a review or on an artist profile. Saved links remain attached to your account for future listening.",
  },
  {
    icon: ShieldCheck,
    title: "Safety and moderation",
    body: "Report spam, broken links, non-music, illegal content, or offensive content. Moderators can review reports and remove invalid submissions.",
  },
];

export default function HelpPage() {
  return (
    <main className="help-page">
      <header className="account-header">
        <Logo />
        <Link href="/dashboard"><ArrowLeft size={16} /> Back to dashboard</Link>
      </header>

      <section className="help-hero">
        <span className="help-icon"><CircleHelp size={24} /></span>
        <span className="eyebrow">Help Center</span>
        <h1>Get useful feedback and discover your next favorite artist.</h1>
        <p>
          First Listen connects honest first impressions with direct listening,
          following, and saving actions.
        </p>
      </section>

      <section className="help-topic-grid">
        {helpTopics.map(({ icon: Icon, title, body }) => (
          <article key={title}>
            <Icon size={20} />
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="help-steps">
        <div>
          <MessageSquareText size={20} />
          <h2>Still need help?</h2>
          <p>
            Check the platform rules and privacy details, or return to your
            profile to review account and explicit-content settings.
          </p>
        </div>
        <nav aria-label="Help resources">
          <Link href="/profile">Account settings</Link>
          <Link href="/guidelines">Community Guidelines</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </nav>
      </section>
    </main>
  );
}
