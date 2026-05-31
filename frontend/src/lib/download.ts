import { api } from "../api/client";

/**
 * Fetch a URL as a blob through the shared API client (so auth cookies / CSRF
 * are applied) and trigger a browser download. Reused by Settings exports and
 * the KI-Analysen export.
 */
export async function downloadBlob(url: string, filename: string, mediaType: string): Promise<void> {
  const res = await api.get(url, { responseType: "blob" });
  const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: mediaType });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}
