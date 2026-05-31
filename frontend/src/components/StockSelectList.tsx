import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { EmptyState } from "./EmptyState";
import { SearchField } from "./SearchField";
import { SearchIcon } from "./icons";
import type { Stock } from "../types";

export interface StockSelectColumn {
  key: string;
  header: ReactNode;
  render: (stock: Stock) => ReactNode;
  className?: string;
}

interface StockSelectListProps {
  stocks: Stock[];
  selectedIsins: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Heading shown above the table; pass null to hide the head row. */
  title?: string | null;
  searchPlaceholder?: string;
  /** Override the table's max-height (default comes from `.stock-select-list`). */
  maxListHeight?: number | string;
  emptyDescription?: ReactNode;
  /** Extra read-only columns appended after Sektor (e.g. AI-analysis status). */
  extraColumns?: StockSelectColumn[];
}

/**
 * Reusable multi-select table of watchlist stocks: a search field plus a
 * checkbox table (with a "select all visible" header checkbox and row-click
 * toggling). Controlled via `selectedIsins` / `onChange`. Used by the
 * KI-Stapellauf and the Marktdaten subset refresh.
 */
export function StockSelectList({
  stocks,
  selectedIsins,
  onChange,
  title = "Unternehmen",
  searchPlaceholder = "Nach Name, ISIN oder Sektor filtern …",
  maxListHeight,
  emptyDescription = "Passe den Filter an oder lege zunächst Unternehmen in der Watchlist an.",
  extraColumns = [],
}: StockSelectListProps) {
  const [search, setSearch] = useState("");

  const filteredStocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stocks;
    return stocks.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.isin.toLowerCase().includes(q) ||
        (s.sector ?? "").toLowerCase().includes(q)
    );
  }, [stocks, search]);

  const visibleIsins = useMemo(
    () => filteredStocks.map((s) => s.isin),
    [filteredStocks]
  );
  const allVisibleSelected =
    visibleIsins.length > 0 && visibleIsins.every((isin) => selectedIsins.has(isin));

  function toggleStock(isin: string) {
    const next = new Set(selectedIsins);
    if (next.has(isin)) next.delete(isin);
    else next.add(isin);
    onChange(next);
  }

  function toggleAllVisible() {
    const next = new Set(selectedIsins);
    if (allVisibleSelected) {
      for (const isin of visibleIsins) next.delete(isin);
    } else {
      for (const isin of visibleIsins) next.add(isin);
    }
    onChange(next);
  }

  return (
    <div className="stock-select">
      {title != null && (
        <div className="detail-card-head">
          <h3>{title}</h3>
          <span className="detail-card-hint">{selectedIsins.size} ausgewählt</span>
        </div>
      )}

      <div className="stock-select-toolbar">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={searchPlaceholder}
          ariaLabel="Unternehmen filtern"
        />
      </div>

      {filteredStocks.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={20} />}
          title="Keine Unternehmen"
          description={emptyDescription}
        />
      ) : (
        <div
          className="stock-select-list"
          style={maxListHeight != null ? { maxHeight: maxListHeight } : undefined}
        >
          <table className="stock-select-table">
            <thead>
              <tr>
                <th className="stock-select-col-check">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    disabled={visibleIsins.length === 0}
                    aria-label="Alle sichtbaren auswählen"
                    title="Alle sichtbaren auswählen"
                  />
                </th>
                <th>Unternehmen</th>
                <th>ISIN</th>
                <th>Sektor</th>
                {extraColumns.map((col) => (
                  <th key={col.key} className={col.className}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredStocks.map((s) => {
                const selected = selectedIsins.has(s.isin);
                return (
                  <tr
                    key={s.isin}
                    className={selected ? "is-selected" : undefined}
                    onClick={() => toggleStock(s.isin)}
                  >
                    <td className="stock-select-col-check">
                      <input
                        type="checkbox"
                        checked={selected}
                        aria-label={s.name}
                        onChange={() => toggleStock(s.isin)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>{s.name}</td>
                    <td className="stock-select-isin">{s.isin}</td>
                    <td>{s.sector ?? "–"}</td>
                    {extraColumns.map((col) => (
                      <td key={col.key} className={col.className}>
                        {col.render(s)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
