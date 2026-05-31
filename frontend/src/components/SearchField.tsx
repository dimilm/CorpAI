import { SearchIcon, XIcon } from "./icons";

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  type?: "text" | "search";
}

/**
 * Shared search input — icon on the left, clear button on the right once a
 * value is present. Extracted from the watchlist filter bar so every page uses
 * the same `.search-field` styling (see styles/dropdown.css). Defaults to
 * `type="text"` so the browser's native search-clear doesn't duplicate ours.
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel = "Suche",
  type = "text",
}: SearchFieldProps) {
  return (
    <div className="search-field">
      <SearchIcon className="search-field-icon" />
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      {value && (
        <button
          type="button"
          className="search-field-clear"
          aria-label="Suche löschen"
          onClick={() => onChange("")}
        >
          <XIcon />
        </button>
      )}
    </div>
  );
}
