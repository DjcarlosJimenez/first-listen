"use client";

import { FormEvent, useState } from "react";
import {
  Bug,
  CircleHelp,
  Heart,
  Lightbulb,
  Send,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const categories = [
  {
    id: "report_problem",
    label: "Report a Problem",
    icon: Bug,
    description: "Something broke, looks wrong, or blocked your flow.",
  },
  {
    id: "suggest_improvement",
    label: "Suggest an Improvement",
    icon: Lightbulb,
    description: "Share an idea that would make First Listen better.",
  },
  {
    id: "ask_question",
    label: "Ask a Question",
    icon: CircleHelp,
    description: "Get help understanding the platform or your account.",
  },
  {
    id: "general_feedback",
    label: "General Feedback",
    icon: Heart,
    description: "Tell us what feels useful, confusing, or promising.",
  },
] as const;

export function FeedbackCenterForm({
  supportEmail = "support@firstlisten.net",
}: {
  supportEmail?: string;
}) {
  const [category, setCategory] =
    useState<(typeof categories)[number]["id"]>("report_problem");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notifyByEmail, setNotifyByEmail] = useState(true);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    if (subject.trim().length < 3 || message.trim().length < 10) {
      setStatus("Please add a clear subject and a useful message.");
      return;
    }
    if (screenshotUrl.trim() && !/^https:\/\//i.test(screenshotUrl.trim())) {
      setStatus("Screenshot links must begin with https://.");
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setStatus(`Support form is unavailable. Email ${supportEmail}.`);
      return;
    }

    setSending(true);
    const { error } = await supabase.rpc("submit_feedback", {
      feedback_category: category,
      feedback_subject: subject.trim(),
      feedback_message: message.trim(),
      screenshot_url: screenshotUrl.trim() || null,
      page_url: window.location.href,
      contact_email: contactEmail.trim() || null,
      notify_by_email: notifyByEmail,
      user_agent: window.navigator.userAgent,
    });
    setSending(false);

    if (error) {
      setStatus(error.message);
      return;
    }

    setSubject("");
    setMessage("");
    setScreenshotUrl("");
    setContactEmail("");
    setNotifyByEmail(true);
    setStatus("Thanks. Your message was sent to the First Listen team.");
  };

  return (
    <section className="feedback-center-card" id="feedback-center">
      <div className="help-section-heading">
        <span className="eyebrow">Feedback Center</span>
        <h2>Need help or want to improve First Listen?</h2>
        <p>
          Send a problem report, question, suggestion, or general note. You can
          also email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      </div>

      <div className="feedback-category-grid" role="radiogroup">
        {categories.map(({ id, label, icon: Icon, description }) => (
          <button
            aria-checked={category === id}
            className={category === id ? "active" : ""}
            key={id}
            onClick={() => setCategory(id)}
            role="radio"
            type="button"
          >
            <Icon size={18} />
            <strong>{label}</strong>
            <small>{description}</small>
          </button>
        ))}
      </div>

      <form className="feedback-form" onSubmit={submit}>
        <label>
          Subject
          <input
            maxLength={160}
            onChange={(event) => setSubject(event.target.value)}
            required
            value={subject}
          />
        </label>
        <label>
          Message
          <textarea
            maxLength={4000}
            minLength={10}
            onChange={(event) => setMessage(event.target.value)}
            required
            rows={6}
            value={message}
          />
        </label>
        <label>
          Optional screenshot URL
          <input
            onChange={(event) => setScreenshotUrl(event.target.value)}
            placeholder="https://"
            type="url"
            value={screenshotUrl}
          />
        </label>
        <label>
          Contact email
          <input
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            value={contactEmail}
          />
        </label>
        <label className="legal-check feedback-check">
          <input
            checked={notifyByEmail}
            onChange={(event) => setNotifyByEmail(event.target.checked)}
            type="checkbox"
          />
          <span>Email me if a reply is available.</span>
        </label>
        {status && <div className="form-message" role="status">{status}</div>}
        <button className="primary-button" disabled={sending} type="submit">
          <Send size={15} />
          {sending ? "Sending..." : "Send Feedback"}
        </button>
      </form>
    </section>
  );
}
