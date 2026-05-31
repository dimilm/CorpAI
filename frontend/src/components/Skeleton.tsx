interface SkeletonProps {
  /** CSS width (e.g. "100%", "8rem"). Defaults to 100%. */
  width?: string;
  /** CSS height. Defaults to 1em. */
  height?: string;
  /** Border radius override; defaults to the small token radius. */
  radius?: string;
  className?: string;
}

/** A single shimmering placeholder block. Compose several to mimic the shape of
 *  the content that is loading. Decorative — hidden from assistive tech; the
 *  surrounding region should expose an aria-busy / status text instead. */
export function Skeleton({ width = "100%", height = "1em", radius, className }: SkeletonProps) {
  return (
    <span
      className={`skeleton${className ? ` ${className}` : ""}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  /** Accessible status text announced while the table loads. */
  label?: string;
}

/** Placeholder grid that mimics a data table while it loads. Wrapped in a
 *  role="status" region so screen readers hear the loading label instead of the
 *  decorative blocks. */
export function TableSkeleton({ rows = 8, columns = 6, label = "Lädt…" }: TableSkeletonProps) {
  return (
    <div
      className="skeleton-table"
      role="status"
      aria-live="polite"
      style={{ ["--skeleton-cols" as string]: String(columns) }}
    >
      <span className="sr-only">{label}</span>
      <div className="skeleton-table-row skeleton-table-head" aria-hidden="true">
        {Array.from({ length: columns }).map((_, c) => (
          <Skeleton key={c} height="0.75rem" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-table-row" aria-hidden="true">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} height="1rem" />
          ))}
        </div>
      ))}
    </div>
  );
}
