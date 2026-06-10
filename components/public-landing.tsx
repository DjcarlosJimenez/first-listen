"use client";

import {
  ArrowRight,
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Check,
  ChevronDown,
  Crown,
  Flame,
  Headphones,
  Link2,
  LockKeyhole,
  MessageSquareText,
  Music2,
  Play,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { LanguageSelector } from "@/components/language-selector";
import { Logo } from "@/components/logo";
import { growthStages, type InterfaceLocale } from "@/lib/catalog";
import { getCopy } from "@/lib/i18n";

type PublicLandingProps = {
  founderRemaining: number;
  locale: InterfaceLocale;
  onLocaleChange: (locale: InterfaceLocale) => void;
  onGuest: () => void;
  onLogin: () => void;
  onSignUp: () => void;
  onJoinWaitlist: (email: string) => Promise<boolean>;
};

const stepIcons = [Headphones, Link2, BarChart3];
const benefitIcons = [BadgeCheck, Music2, Sparkles, Crown, Star];

export function PublicLanding({
  founderRemaining,
  locale,
  onLocaleChange,
  onGuest,
  onLogin,
  onSignUp,
  onJoinWaitlist,
}: PublicLandingProps) {
  const copy = getCopy(locale);
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);

  const submitWaitlist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await onJoinWaitlist(email);
    if (saved) {
      setJoined(true);
      setEmail("");
    }
  };

  return (
    <div className="landing-page">
      <section
        className="landing-paths-section landing-primary-paths"
        id="top"
        aria-label="Choose how to begin"
      >
        <article className="landing-path-card guest-path-card">
          <span className="eyebrow"><Headphones size={14} /> {locale === "es" ? "Visita para escuchar" : "Guest Listener"}</span>
          <h1>{locale === "es" ? "Escucha música. Descubre artistas. Apoya creadores." : "Listen to music. Discover artists. Support creators."}</h1>
          <p>
            {locale === "es"
              ? "No necesitas registrarte para escuchar. Siempre gratis."
              : "No registration is required to listen. Always free."}
          </p>
          <ul>
            <li><Check size={14} /> {locale === "es" ? "Elige un nickname comunitario" : "Choose a community nickname"}</li>
            <li><Check size={14} /> {locale === "es" ? "Conserva likes, comentarios y canciones guardadas" : "Keep likes, comments, and saved songs"}</li>
            <li><Check size={14} /> {locale === "es" ? "Tu acceso de invitado nunca vence" : "Guest access never expires"}</li>
          </ul>
          <button className="landing-secondary-action" onClick={onGuest}>
            {locale === "es" ? "Entrar ahora" : "Enter Now"}
            <ArrowRight size={15} />
          </button>
        </article>

        <article className="landing-path-card join-path-card">
          <span className="eyebrow"><Music2 size={14} /> {locale === "es" ? "Comparte tu música" : "Creator Account"}</span>
          <h2>{locale === "es" ? "Sube contenido. Gana tokens. Recibe escuchas reales." : "Submit music. Earn tokens. Receive real listens."}</h2>
          <p>
            {locale === "es"
              ? "Haz crecer tu audiencia con una cuenta gratuita."
              : "Grow your audience with a free creator account."}
          </p>
          <ul>
            <li><Check size={14} /> {locale === "es" ? "Envía canciones para recibir feedback" : "Submit songs for honest feedback"}</li>
            <li><Check size={14} /> {locale === "es" ? "Recibe escuchas y apoyo comunitario" : "Receive listens and community support"}</li>
            <li><Check size={14} /> {locale === "es" ? "Descubre y apoya otros artistas" : "Discover and support other artists"}</li>
          </ul>
          <button className="landing-primary" onClick={onSignUp}>
            {locale === "es" ? "Crear cuenta" : "Create Account"}
            <ArrowRight size={15} />
          </button>
        </article>
      </section>

      <div className="founder-sticky-banner">
        <span>
          {founderRemaining > 0 && founderRemaining < 10 ? (
            <AlertTriangle size={15} />
          ) : (
            <Flame size={15} fill="currentColor" />
          )}{" "}
          {founderRemaining > 0 && founderRemaining < 10
            ? locale === "es"
              ? `Solo quedan ${founderRemaining} lugares Founder`
              : `Only ${founderRemaining} Founder Spots Remaining`
            : copy.landing.sticky.label}
        </span>
        <strong>
          {copy.landing.sticky.spots}: {founderRemaining} / 50
        </strong>
        <button disabled={founderRemaining === 0} onClick={onSignUp}>
          {copy.common.claimFounderSpot}
          <ArrowRight size={14} />
        </button>
      </div>

      <header className="landing-nav">
        <a href="#top" aria-label="First Listen home">
          <Logo />
        </a>
        <nav aria-label="Public navigation">
          <a href="#how-it-works">{copy.landing.nav.how}</a>
          <a href="#features">{copy.landing.nav.features}</a>
          <a href="#founders">{copy.landing.nav.founder}</a>
          <a href="#faq">{copy.landing.nav.faq}</a>
        </nav>
        <div className="landing-actions">
          <LanguageSelector compact locale={locale} onChange={onLocaleChange} />
          <span className="beta-pill">{copy.common.publicBeta}</span>
          <button className="landing-login" onClick={onLogin}>{copy.common.login}</button>
          <button className="landing-signup" onClick={onSignUp}>
            {copy.common.signup} <ArrowRight size={15} />
          </button>
        </div>
      </header>

      <main>
        <section className="founder-section founder-top-section" id="founders">
          <div className="founder-copy">
            <span className="founder-label">
              <BadgeCheck size={14} /> {copy.landing.founderTop.eyebrow}
            </span>
            <h1>{copy.landing.founderTop.title}</h1>
            <p>{copy.landing.founderTop.body}</p>
            <div className="founder-benefits">
              {copy.landing.founder.benefits.map((benefit, index) => {
                const Icon = benefitIcons[index];
                return <span key={benefit}><Icon size={17} /> {benefit}</span>;
              })}
            </div>
            <button
              className="landing-primary"
              disabled={founderRemaining === 0}
              onClick={onSignUp}
            >
              {founderRemaining > 0
                ? copy.common.claimFounderSpot
                : copy.common.joinWaitlist}
              <ArrowRight size={17} />
            </button>
            <small className="founder-billing-note">
              <LockKeyhole size={13} /> {copy.landing.founderTop.note}
            </small>
          </div>
          <div className="founder-counter">
            <div className="founder-badge-large"><BadgeCheck size={42} /></div>
            <span>{copy.common.founderSpotsRemaining}</span>
            <strong>{founderRemaining}<small>/50</small></strong>
            <div className="founder-track">
              <i style={{ width: `${(founderRemaining / 50) * 100}%` }} />
            </div>
            <p>
              {founderRemaining > 0
                ? founderRemaining < 10
                  ? locale === "es"
                    ? "Últimos lugares Founder disponibles."
                    : "Final Founder Spots Available."
                  : copy.landing.founder.open
                : copy.landing.founder.closed}
            </p>
          </div>
        </section>

        <section className="landing-hero">
          <div className="landing-hero-copy">
            <div className="launch-label"><i /> {copy.landing.hero.label}</div>
            <h2>{copy.landing.hero.headline}</h2>
            <p>{copy.landing.hero.subheadline}</p>
            <div className="hero-actions">
              <button className="landing-primary" onClick={onSignUp}>
                {copy.landing.hero.primary} <ArrowRight size={17} />
              </button>
              <a href="#how-it-works">
                <span><Play fill="currentColor" size={13} /></span>
                {copy.landing.hero.secondary}
              </a>
            </div>
            <div className="hero-trust">
              <span><Check size={13} /> {copy.common.noAudioUploads}</span>
              <span><Check size={13} /> {copy.common.noSubscription}</span>
              <span><Check size={13} /> {copy.common.privateAnalytics}</span>
            </div>
          </div>

          <div className="hero-product-card" aria-label="First Listen product preview">
            <div className="preview-top">
              <span className="preview-cover"><Music2 size={32} /></span>
              <span>
                <small>{copy.landing.preview.nowReviewing}</small>
                <strong>Neon Weather</strong>
                <em>Indie Electronic</em>
              </span>
              <span className="preview-score">
                <small>{copy.landing.preview.hookScore}</small>
                <strong>86</strong>
              </span>
            </div>
            <div className="preview-wave">
              {Array.from({ length: 42 }, (_, index) => (
                <i
                  key={index}
                  style={{
                    height: `${22 + ((index * 23) % 62)}%`,
                    opacity: index < 25 ? 1 : 0.25,
                  }}
                />
              ))}
            </div>
            <div className="preview-signals">
              {[
                [copy.landing.preview.listenFull, "83%"],
                [copy.landing.preview.playlist, "67%"],
                [copy.landing.preview.attention, "92%"],
                [copy.landing.preview.share, "75%"],
              ].map(([label, value]) => (
                <div key={label}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
            <div className="preview-comment">
              <MessageSquareText size={17} />
              <p>&quot;{copy.landing.preview.comment}&quot;</p>
              <span>9<Star size={10} fill="currentColor" /></span>
            </div>
          </div>
        </section>

        <section className="landing-proof">
          <p>{copy.landing.proof.headline}</p>
          <div>
            <span><ShieldCheck size={18} /> {copy.landing.proof.honest}</span>
            <span><LockKeyhole size={18} /> {copy.landing.proof.private}</span>
            <span><Link2 size={18} /> {copy.landing.proof.platform}</span>
          </div>
        </section>

        <section className="brand-positioning-section">
          <span className="eyebrow">
            {locale === "es" ? "Atención humana verificada" : "Verified human attention"}
          </span>
          <h2>
            {locale === "es"
              ? "First Listen no vende vistas. Construye oportunidades justas."
              : "First Listen does not sell views. It creates fair first chances."}
          </h2>
          <p>
            {locale === "es"
              ? "No somos una red de bots ni una plataforma de interacción falsa. Somos una comunidad de creadores que intercambia atención humana real de forma medible, transparente y justa."
              : "First Listen is not a bot network or a fake-engagement platform. It is a creator community where real human attention is exchanged measurably, transparently, and fairly."}
          </p>
        </section>

        <section className="landing-section how-section" id="how-it-works">
          <div className="section-heading">
            <span className="eyebrow">{copy.landing.how.eyebrow}</span>
            <h2>{copy.landing.how.title}</h2>
            <p>{copy.landing.how.body}</p>
          </div>
          <div className="how-grid">
            {copy.landing.how.steps.map(([title, body], index) => {
              const Icon = stepIcons[index];
              return (
                <article key={title}>
                  <span className="step-number">0{index + 1}</span>
                  <div className="step-icon"><Icon size={22} /></div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="why-section">
          <div className="why-visual">
            <div className="why-score">
              <span>Hook Score</span>
              <strong>78</strong>
              <small>{locale === "es" ? "Primera impresión fuerte" : "Strong first impression"}</small>
            </div>
            <div className="why-bars">
              {[
                [copy.landing.preview.attention, 88],
                [copy.landing.preview.listenFull, 79],
                [copy.landing.preview.playlist, 71],
                [copy.landing.preview.share, 73],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <i><b style={{ width: `${value}%` }} /></i>
                  <strong>{value}%</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="why-copy">
            <span className="eyebrow">{copy.landing.why.eyebrow}</span>
            <h2>{copy.landing.why.title}</h2>
            <p>{copy.landing.why.body}</p>
            <ul>
              {copy.landing.why.bullets.map((bullet) => (
                <li key={bullet}><Check size={15} /> {bullet}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-section features-section" id="features">
          <div className="section-heading">
            <span className="eyebrow">{copy.landing.features.eyebrow}</span>
            <h2>{copy.landing.features.title}</h2>
          </div>
          <div className="feature-grid">
            {copy.landing.features.items.map(([title, body], index) => (
              <article key={title}>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section growth-section">
          <div className="section-heading">
            <span className="eyebrow">{copy.landing.growth.eyebrow}</span>
            <h2>{copy.landing.growth.title}</h2>
          </div>
          <div className="growth-stage-grid">
            {growthStages.map((stage, index) => (
              <article className={stage.active ? "active" : ""} key={stage.id}>
                <span>{locale === "es" ? `Etapa ${index + 1}` : stage.label}</span>
                <div>{stage.active ? <Flame size={18} /> : <Rocket size={18} />}</div>
                <h3>
                  {locale === "es"
                    ? ["Artistas Fundadores", "Primeros Usuarios", "Lanzamiento Público"][index]
                    : stage.name}
                </h3>
                <p>
                  {locale === "es"
                    ? ["50 lugares", "500 lugares", "Acceso abierto"][index]
                    : stage.spots}
                </p>
                {stage.active && <strong>{copy.common.founderActive}</strong>}
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section faq-section" id="faq">
          <div className="section-heading">
            <span className="eyebrow">{copy.landing.faq.eyebrow}</span>
            <h2>{copy.landing.faq.title}</h2>
          </div>
          <div className="faq-list">
            {copy.landing.faq.items.map(([question, answer], index) => (
              <article className={openFaq === index ? "open" : ""} key={question}>
                <button onClick={() => setOpenFaq(openFaq === index ? -1 : index)}>
                  <span>{question}</span>
                  <ChevronDown size={18} />
                </button>
                <p>{answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="waitlist-section" id="waitlist">
          <div>
            <span className="eyebrow">{copy.landing.waitlist.eyebrow}</span>
            <h2>{copy.landing.waitlist.title}</h2>
            <p>{copy.landing.waitlist.body}</p>
          </div>
          {joined ? (
            <div className="waitlist-success">
              <BadgeCheck size={22} />
              <span>
                <strong>{copy.landing.waitlist.successTitle}</strong>{" "}
                {copy.landing.waitlist.successBody}
              </span>
            </div>
          ) : (
            <form onSubmit={submitWaitlist}>
              <label className="sr-only" htmlFor="waitlist-email">
                {copy.landing.waitlist.email}
              </label>
              <input
                id="waitlist-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
              <button type="submit">
                {copy.common.joinWaitlist} <ArrowRight size={15} />
              </button>
            </form>
          )}
        </section>
      </main>

      <footer className="landing-footer">
        <Logo />
        <p>{copy.landing.proof.headline}</p>
        <div>
          <span>{copy.common.publicBeta}</span>
          <button onClick={onLogin}>{copy.common.login}</button>
        </div>
      </footer>
    </div>
  );
}
