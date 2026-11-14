import Image from "next/image";
import { firstListenBrandAsset } from "@/lib/first-listen-brand";

export function FirstListenLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div
      aria-label="First Listen"
      className={`brand first-listen-brand${compact ? " is-compact" : ""}`}
    >
      <Image
        alt=""
        aria-hidden="true"
        className="first-listen-brand-lockup"
        height={724}
        priority
        src={firstListenBrandAsset("/brand/first-listen-link-logo.png")}
        unoptimized
        width={2172}
      />
    </div>
  );
}
