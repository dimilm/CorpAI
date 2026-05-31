import { ReactNode } from "react";

export type FilterPillAccent =
  | "running"
  | "done"
  | "error"
  | "not_started"
  | "cancelled";

export interface FilterPillOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional count badge; omit for pills without a count (e.g. aktiv/inaktiv). */
  count?: number;
  /** Status accent for the active pill background. */
  accent?: FilterPillAccent;
  /** Skip rendering this option entirely (e.g. "cancelled" when count is 0). */
  hidden?: boolean;
}

interface FilterPillsProps<T extends string> {
  value: T;
  options: FilterPillOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  /** Container class; defaults to the standard `.run-filter-row`. */
  className?: string;
}

/**
 * Single-select segmented pill control. Replaces the per-page `FilterPill`
 * components that RunsPage and JobsPage duplicated inline. Reuses the existing
 * `.run-filter-*` styling.
 */
export function FilterPills<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = "run-filter-row",
}: FilterPillsProps<T>) {
  return (
    <div className={className} role="group" aria-label={ariaLabel}>
      {options
        .filter((option) => !option.hidden)
        .map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className={`run-filter-pill${active ? " is-active" : ""}${
                option.accent ? ` run-filter-${option.accent}` : ""
              }`}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
            >
              <span>{option.label}</span>
              {option.count != null && (
                <span className="run-filter-count">{option.count}</span>
              )}
            </button>
          );
        })}
    </div>
  );
}
