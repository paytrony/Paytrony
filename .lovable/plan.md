
# What's missing in PayTrony

Based on the current state of the app (auth, packages, purchases with idempotency, referrals, wallet, withdrawals, ledger, NFTs, referral analytics, notifications, admin), here's what is still missing or weak. Pick any subset and I'll build it.

## 1. Real payments
Right now `purchase_package` credits wallets without any real money moving. Missing:
- Stripe (or Paddle) checkout for the $10 / $50 / $100 tiers
- Webhook wired to the existing `payment-webhook` route so purchases only mint after `payment_intent.succeeded`
- Currency + fee handling

## 2. Real withdrawals / payouts
Withdrawals are admin-approved rows with no money leaving. Missing:
- Payout method on the user (bank / UPI / crypto address) with validation
- KYC gating above a threshold
- Minimum withdrawal amount, daily cap, cooldown
- Actual payout execution (Stripe Connect / manual CSV export for admin)

## 3. Security & abuse prevention
- Rate limiting on `purchase_package`, `request_withdrawal`, auth
- Fraud checks: same-IP / same-device referral self-dealing, disposable email block
- Email verification required before withdrawal
- 2FA (TOTP) for withdrawals and admin
- Audit log table for admin actions (approve/reject withdrawals, role changes)

## 4. Account & profile
- Password reset flow
- Change email / change password
- Delete account (with data retention rules)
- Display name / avatar
- Session management (list & revoke sessions)

## 5. Referral depth
- Only 1-level referral today. Missing: decision on multi-level (or explicit "single level only" copy)
- Referral link landing page with attribution cookie (currently only `?ref=` on `/auth`)
- Share buttons (WhatsApp / X / Telegram / copy)
- Referrer sees pending vs confirmed earnings

## 6. Admin console
- User search, filter, ban/unban
- Manual wallet adjustment with reason (audited)
- Refund a purchase (reverses referral credit)
- Metrics: GMV, payouts, active users, top referrers, cohort retention

## 7. NFT layer (currently cosmetic)
- Decide: keep as badges, or actually mint on-chain (wallet connect, chain, contract)
- Metadata + image per tier
- Transferability rules

## 8. Legal & trust
- Terms of Service, Privacy Policy, Refund Policy pages
- Cookie consent
- "Not investment advice" / earnings disclaimer (important given the 100% referral model)
- Contact / support page

## 9. Ops & reliability
- Error tracking (Sentry) + server function logs surfaced to admin
- Email notifications: welcome, purchase receipt, referral earned, withdrawal status
- Backups / data export for user (GDPR)
- Health check endpoint

## 10. UX polish
- Mobile nav pass (3-dot menu on small screens)
- Empty states everywhere (no NFTs, no referrals, no txns)
- Loading skeletons instead of spinners
- Global toast on realtime referral credit ("You just earned $50!")
- Dark/light toggle (currently dark only)

## 11. SEO / landing
- Real hero copy, screenshots, FAQ, testimonials section
- Per-route metadata is set, but no sitemap.xml / robots.txt
- OG image generation

---

## Recommended next 3 (highest impact)
1. **Real Stripe payments + webhook-driven crediting** — without this the app is a demo.
2. **Withdrawal payout method + KYC + limits** — required before real money flows out.
3. **Legal pages + earnings disclaimer + email verification gate on withdrawals** — protects you and users.

Tell me which of these (or others) to build next and I'll produce a detailed implementation plan for that slice.
