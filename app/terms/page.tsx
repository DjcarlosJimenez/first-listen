import { LegalPage } from "@/components/legal-page";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="June 8, 2026">
      <h2>Service</h2>
      <p>First Listen provides music-link feedback and analytics. It does not host, upload, or store audio.</p>
      <h2>Accounts</h2>
      <p>You must provide accurate account information, protect your password, and use the service lawfully.</p>
      <h2>Submitted content</h2>
      <p>You confirm that you are authorized to submit each music link and associated metadata. Duplicate, illegal, deceptive, or abusive submissions may be removed.</p>
      <h2>Feedback</h2>
      <p>Reviews must be honest and constructive. Spam, copied comments, manipulation, and harassment are prohibited and may result in suspended access.</p>
      <h2>Availability</h2>
      <p>The public beta is provided without guarantees of uninterrupted availability. Accounts or content may be restricted to protect users and the platform.</p>
    </LegalPage>
  );
}
