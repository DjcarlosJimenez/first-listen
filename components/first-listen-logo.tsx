import Image from "next/image";
import { firstListenBrandAsset } from "@/lib/first-listen-brand";

export function FirstListenLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div
      aria-label="First Listen"
      className={`first-listen-brand${compact ? " is-compact" : ""}`}
    >
      <Image
        alt=""
        aria-hidden="true"
        className="first-listen-brand-emblem"
        height={1024}
        priority
        src={firstListenBrandAsset("/brand/first-listen-emblem.png")}
        unoptimized
        width={1024}
      />
      {!compact && (
        <span aria-hidden="true" className="first-listen-brand-wordmark">
          <span className="first-listen-brand-wordmark-first">First</span>
          <span className="first-listen-brand-wordmark-listen">Listen</span>
        </span>
      )}
    </div>
  );
}
