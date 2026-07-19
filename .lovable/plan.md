Reorder the 3-dot dropdown in `src/routes/_authenticated/route.tsx` so **Explore** renders above **Quick access**.

Final order:

**Explore**
1. Dashboard
2. Buy packages
3. Withdraw
4. Account settings

**Quick access**
5. Notifications
6. My NFTs
7. Wallet
8. Referral dashboard
9. Copy referral link

## Technical notes
- Move the Explore section block (label + `menuItem` calls for `/dashboard`, `/packages`, `/withdraw`, `/settings`) above the Quick access block.
- Drop the `mt-1 border-t` classes from the now-first section header and add them to the Quick access header so the divider sits between the two groups.
- No logic, data, badge, or realtime subscription changes — presentation only.