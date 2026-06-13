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
import { useInterfaceLocale } from "@/lib/use-interface-locale";

const categories = [
  {
    id: "report_problem",
    label: "Report a Problem",
    labelEs: "Reportar un problema",
    icon: Bug,
    description: "Something broke, looks wrong, or blocked your flow.",
    descriptionEs: "Algo falló, se ve mal o bloqueó tu experiencia.",
  },
  {
    id: "suggest_improvement",
    label: "Suggest an Improvement",
    labelEs: "Sugerir una mejora",
    icon: Lightbulb,
    description: "Share an idea that would make First Listen better.",
    descriptionEs: "Comparte una idea para mejorar First Listen.",
  },
  {
    id: "ask_question",
    label: "Ask a Question",
    labelEs: "Hacer una pregunta",
    icon: CircleHelp,
    description: "Get help understanding the platform or your account.",
    descriptionEs: "Recibe ayuda para entender la plataforma o tu cuenta.",
  },
  {
    id: "general_feedback",
    label: "General Feedback",
    labelEs: "Feedback general",
    icon: Heart,
    description: "Tell us what feels useful, confusing, or promising.",
    descriptionEs: "Cuéntanos qué se siente útil, confuso o prometedor.",
  },
] as const;

export function FeedbackCenterForm({
  supportEmail = "support@firstlisten.net",
}: {
  supportEmail?: string;
}) {
  const locale = useInterfaceLocale();
  const spanish = locale === "es";
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
      setStatus(
        spanish
          ? "Agrega un asunto claro y un mensaje útil."
          : "Please add a clear subject and a useful message.",
      );
      return;
    }
    if (screenshotUrl.trim() && !/^https:\/\//i.test(screenshotUrl.trim())) {
      setStatus(
        spanish
          ? "El enlace de captura debe comenzar con https://."
          : "Screenshot links must begin with https://.",
      );
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setStatus(
        spanish
          ? `El formulario no está disponible. Escribe a ${supportEmail}.`
          : `Support form is unavailable. Email ${supportEmail}.`,
      );
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
    setStatus(
      spanish
        ? "Gracias. Tu mensaje fue enviado al equipo de First Listen."
        : "Thanks. Your message was sent to the First Listen team.",
    );
  };

  return (
    <section className="feedback-center-card" id="feedback-center">
      <div className="help-section-heading">
        <span className="eyebrow">{spanish ? "Centro de feedback" : "Feedback Center"}</span>
        <h2>{spanish ? "¿Necesitas ayuda o quieres mejorar First Listen?" : "Need help or want to improve First Listen?"}</h2>
        <p>
          {spanish
            ? "Envía un problema, pregunta, sugerencia o nota general. También puedes escribir a "
            : "Send a problem report, question, suggestion, or general note. You can also email "}
          <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
        </p>
      </div>

      <div className="feedback-category-grid" role="radiogroup">
        {categories.map(({ id, label, labelEs, icon: Icon, description, descriptionEs }) => (
          <button
            aria-checked={category === id}
            className={category === id ? "active" : ""}
            key={id}
            onClick={() => setCategory(id)}
            role="radio"
            type="button"
          >
            <Icon size={18} />
            <strong>{spanish ? labelEs : label}</strong>
            <small>{spanish ? descriptionEs : description}</small>
          </button>
        ))}
      </div>

      <form className="feedback-form" onSubmit={submit}>
        <label>
          {spanish ? "Asunto" : "Subject"}
          <input
            maxLength={160}
            onChange={(event) => setSubject(event.target.value)}
            required
            value={subject}
          />
        </label>
        <label>
          {spanish ? "Mensaje" : "Message"}
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
          {spanish ? "URL de captura opcional" : "Optional screenshot URL"}
          <input
            onChange={(event) => setScreenshotUrl(event.target.value)}
            placeholder="https://"
            type="url"
            value={screenshotUrl}
          />
        </label>
        <label>
          {spanish ? "Correo de contacto" : "Contact email"}
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
          <span>{spanish ? "Envíame un correo si hay respuesta." : "Email me if a reply is available."}</span>
        </label>
        {status && <div className="form-message" role="status">{status}</div>}
        <button className="primary-button" disabled={sending} type="submit">
          <Send size={15} />
          {sending
            ? spanish
              ? "Enviando..."
              : "Sending..."
            : spanish
              ? "Enviar feedback"
              : "Send Feedback"}
        </button>
      </form>
    </section>
  );
}
