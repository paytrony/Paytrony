## Finish auth email setup

Three focused fixes to the existing auth email pipeline. No new tables, no infra changes.

### 1. Brand the auth email templates (Aurora / PayTrony look)

Update all six templates in `src/lib/email-templates/` (`signup.tsx`, `magic-link.tsx`, `recovery.tsx`, `invite.tsx`, `email-change.tsx`, `reauthentication.tsx`) to match the app's dark-brand aesthetic while keeping `Body` background `#ffffff` (email deliverability rule).

- Add a top brand header inside a rounded dark card: "PayTrony" wordmark with a small diamond glyph, on a dark navy panel (`#0F172A`-ish, matching app `--background`).
- Body copy on white below the card for max compatibility.
- Primary CTA button: green Aurora accent (`#22C55E`-ish, mapped from `--primary` oklch(0.82 0.19 155)), white text, 8px radius, ample padding.
- Inline links use the same green.
- Small muted footer: "PayTrony • paytrony.com" + a plain-text note that this email was sent to the recipient's address.
- Keep the reauthentication code style monospaced but boxed with a subtle border, brand-tinted.
- All colors inline (no `<style>` tags, no external CSS). No images/logos requiring hosting — use inline SVG or plain text wordmark.

### 2. Fix the sender name

In `src/routes/lovable/email/auth/webhook.ts`, change `SITE_NAME` from `"paytronygg"` to `"PayTrony"`. This fixes both the visible From line (`PayTrony <noreply@paytrony.com>`) and the `{siteName}` interpolations inside every template.

### 3. Raise the auth email rate limit

Default GoTrue cap is low and will trip `over_email_send_rate_limit` at real signup volume. Call `supabase--configure_auth` with `rate_limit_email_sent: 1000` (max), keeping other current auth settings unchanged. Requires email sending to be active — the domain is configured, so this should go through; if it rejects because DNS is still verifying, retry after verification.

### Technical notes

- No changes to the webhook handler logic — only the `SITE_NAME` constant.
- Template prop shapes are unchanged; only JSX/styles are edited.
- No package installs, no migrations, no edge-function deploys (modern stack — routes deploy on publish).
- After edits, the dev preview at `/lovable/email/auth/preview` can be spot-checked for each type.