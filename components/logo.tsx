import { FirstListenLogo } from "@/components/first-listen-logo";

export function Logo({ compact = false }: { compact?: boolean }) {
  return <FirstListenLogo compact={compact} />;
}
