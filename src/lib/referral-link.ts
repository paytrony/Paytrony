// Build a clean, professional invite URL like https://paytrony.com/i/CODE
// Falls back to the current origin when the app isn't on the production domain
// (e.g. local dev or preview) so links still work end-to-end.
const PROD_HOSTS = new Set(["paytrony.com", "www.paytrony.com"]);
const PROD_BASE = "https://paytrony.com";

export function buildInviteUrl(code: string | null | undefined): string {
  if (!code) return "";
  if (typeof window === "undefined") return `${PROD_BASE}/i/${code}`;
  const host = window.location.hostname;
  const base = PROD_HOSTS.has(host) ? PROD_BASE : window.location.origin;
  return `${base}/i/${code}`;
}
