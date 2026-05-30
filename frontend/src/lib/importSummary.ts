/** Shape returned by `POST /api/v1/import/csv`. */
export interface ImportResult {
  imported: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** Human-readable summary of a CSV import for the success toast, e.g.
 *  "3 neu · 2 aktualisiert · 1 übersprungen". Fields are read defensively so an
 *  older/partial backend response still renders something sensible. */
export function formatImportSummary(result: Partial<ImportResult> | undefined): string {
  const created = result?.created ?? 0;
  const updated = result?.updated ?? 0;
  const skipped = result?.skipped ?? 0;

  const parts = [`${created} neu`, `${updated} aktualisiert`];
  if (skipped > 0) {
    parts.push(`${skipped} übersprungen`);
  }
  return parts.join(" · ");
}
