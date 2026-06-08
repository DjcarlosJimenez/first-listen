import { LegalPage } from "@/components/legal-page";

export default function ExplicitContentPage() {
  return (
    <LegalPage title="Explicit Content Disclaimer" updated="June 8, 2026">
      <p><strong>Users may encounter music containing explicit language, mature themes, or adult subject matter.</strong></p>
      <p>By creating an account and using First Listen, you acknowledge and accept this possibility.</p>
      <p>You can disable <strong>Show Explicit Content</strong> in your profile to exclude songs marked explicit from your review queue.</p>
      <p>Artists are responsible for accurately marking explicit submissions. Mislabeling may be reported and moderated.</p>
    </LegalPage>
  );
}
