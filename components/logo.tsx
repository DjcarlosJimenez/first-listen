export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="First Listen">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      {!compact && (
        <span className="brand-name">
          FIRST <b>LISTEN</b>
        </span>
      )}
    </div>
  );
}
