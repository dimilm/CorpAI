import { ReactNode } from "react";

/** ARIA props the control inside a Field must spread onto itself so the label,
 *  error and helper text are correctly associated for assistive technology. */
export interface FieldControlAria {
  id: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

interface FieldProps {
  /** Stable id for the control; the <label> points at it via htmlFor. */
  id: string;
  label: ReactNode;
  required?: boolean;
  error?: string | null;
  helper?: ReactNode;
  /** Render-prop receiving the ARIA props to spread on the actual control.
   *  A render-prop (rather than cloning children) keeps arbitrary controls —
   *  <input>, <select>, SectorAutocomplete, TagInput — wired without guessing
   *  their prop shape. */
  children: (aria: FieldControlAria) => ReactNode;
}

/** Labelled form field: renders the label (+ required marker), the control, an
 *  optional helper line and an error message — wiring `aria-describedby` /
 *  `aria-invalid` so the relationship is exposed to screen readers. Mirrors the
 *  existing `.field` markup so it is a drop-in for the hand-rolled fields. */
export function Field({ id, label, required, error, helper, children }: FieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  const helperId = helper ? `${id}-helper` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`field${error ? " has-error" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="required">*</span>}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {helper && (
        <p id={helperId} className="helper">
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
