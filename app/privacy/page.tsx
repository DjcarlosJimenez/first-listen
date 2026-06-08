import { LegalPage } from "@/components/legal-page";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="June 8, 2026">
      <h2>Data collected</h2>
      <p>We store account details, profile preferences, song metadata and links, reviews, reports, credits, and security/audit records.</p>
      <h2>Audio</h2>
      <p>First Listen does not upload, host, or store audio files. Playback occurs on the linked music platform.</p>
      <h2>Use of data</h2>
      <p>Data is used to authenticate users, match reviews, provide analytics, prevent abuse, and operate moderation.</p>
      <h2>Access</h2>
      <p>Private feedback is limited by database access policies. Authorized staff may access records when required for administration, security, or moderation.</p>
      <h2>Contact and deletion</h2>
      <p>Users may request correction or deletion of account data through the platform administrator, subject to legal and security retention requirements.</p>
    </LegalPage>
  );
}
