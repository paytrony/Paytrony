// Always use the production brand domain for shareable invite links,
// regardless of whether the app is running on preview, custom, or local origin.
const PROD_BASE = "https://paytrony.com";

export function buildInviteUrl(code: string | null | undefined): string {
  if (!code) return "";
  return `${PROD_BASE}/i/${code}`;
}
