import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { mode: "signin" } });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [isAdmin, setIsAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [referralCode, setReferralCode] = useState<string>("");
  const [pendingWithdrawals, setPendingWithdrawals] = useState(0);
  const [recentEarnings, setRecentEarnings] = useState(0);
  const [recentNfts, setRecentNfts] = useState(0);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin")
      .then(({ data }) => setIsAdmin(!!(data && data.length)));
    supabase.from("profiles").select("referral_code").eq("id", user.id).maybeSingle()
      .then(({ data }) => setReferralCode((data as any)?.referral_code ?? ""));
  }, [user.id]);

  async function loadBadges() {
    const { data: reads } = await supabase.from("notification_reads")
      .select("category,last_read_at").eq("user_id", user.id);
    const readMap: Record<string, string> = {};
    (reads ?? []).forEach((r: any) => { readMap[r.category] = r.last_read_at; });
    const EPOCH = "1970-01-01T00:00:00Z";
    const sinceNfts = readMap.nfts ?? EPOCH;
    const sinceEarn = readMap.earnings ?? EPOCH;
    const sinceWd = readMap.withdrawals ?? EPOCH;

    const [{ count: pw }, { count: re }, { count: rn }] = await Promise.all([
      supabase.from("withdrawals").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", sinceWd),
      supabase.from("wallet_transactions").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("type", "referral_credit").gte("created_at", sinceEarn),
      supabase.from("purchases").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", sinceNfts),
    ]);
    setPendingWithdrawals(pw ?? 0);
    setRecentEarnings(re ?? 0);
    setRecentNfts(rn ?? 0);
  }

  useEffect(() => {
    loadBadges();
    const channel = supabase
      .channel(`badges:${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${user.id}` }, (payload) => {
        const row: any = payload.new;
        const amt = Number(row.amount).toFixed(2);
        if (row.type === "referral_credit") {
          toast.success(`+$${amt} referral credit added to your wallet`);
        } else if (row.type === "withdrawal") {
          const isFee = String(row.note ?? "").toLowerCase().includes("fee");
          toast(isFee ? `Withdrawal fee $${amt} debited` : `Withdrawal $${amt} sent to your payout method`);
        }
        loadBadges();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${user.id}` }, () => loadBadges())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "withdrawals", filter: `user_id=eq.${user.id}` }, (payload) => {
        const row: any = payload.new;
        if (row.status === "approved") toast.success(`Withdrawal of $${Number(row.amount).toFixed(2)} approved — payout sent`);
        if (row.status === "rejected") toast.error(`Withdrawal of $${Number(row.amount).toFixed(2)} rejected`);
        loadBadges();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "withdrawals", filter: `user_id=eq.${user.id}` }, () => loadBadges())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "purchases", filter: `user_id=eq.${user.id}` }, (payload) => {
        const row: any = payload.new;
        toast.success(`Purchase confirmed — Tier $${row.nft_tier} NFT minted`);
        loadBadges();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases", filter: `user_id=eq.${user.id}` }, () => loadBadges())
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_reads", filter: `user_id=eq.${user.id}` }, () => loadBadges())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);


  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setMenuOpen(false);
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      navigate({ to: "/auth", search: { mode: "signin" }, replace: true });
    } catch (e) {
      toast.error("Sign out failed. Please try again.");
      setSigningOut(false);
    }
  }

  const referralUrl = useMemo(
    () => referralCode ? `${typeof window !== "undefined" ? window.location.origin : ""}/auth?mode=signup&ref=${referralCode}` : "",
    [referralCode]
  );

  function copyReferral(e: React.MouseEvent) {
    e.stopPropagation();
    if (!referralUrl) return;
    navigator.clipboard.writeText(referralUrl);
    toast.success("Referral link copied");
  }

  const baseLink = "flex items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-muted";
  const idle = "text-muted-foreground hover:text-foreground";
  const active = "bg-muted text-foreground border-l-2 border-primary";

  const Badge = ({ n, tone }: { n: number; tone: "primary" | "accent" | "muted" }) => {
    if (!n) return null;
    const cls = tone === "primary" ? "bg-primary text-primary-foreground"
      : tone === "accent" ? "bg-accent text-accent-foreground"
      : "bg-muted text-foreground";
    return <span className={`ml-auto inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-mono font-semibold ${cls}`}>{n > 99 ? "99+" : n}</span>;
  };

  const menuItem = (to: string, label: string, icon: React.ReactElement, opts?: { badge?: React.ReactNode; onClick?: (e: React.MouseEvent) => void; accent?: boolean }) => {
    const isActive = pathname === to || (to !== "/dashboard" && pathname.startsWith(to));
    return (
      <Link
        to={to}
        onClick={(e) => { if (opts?.onClick) opts.onClick(e); if (!e.defaultPrevented) setMenuOpen(false); }}
        className={`${baseLink} ${isActive ? active : idle} ${opts?.accent ? "text-accent" : ""}`}
      >
        <span className="flex items-center gap-2">{icon}<span>{label}</span></span>
        {opts?.badge}
      </Link>
    );
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/dashboard" className="font-mono text-lg font-semibold">
            <span className="text-primary">◆</span> PayTrony
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => !signingOut && setMenuOpen((v) => !v)}
                aria-label="Menu"
                aria-expanded={menuOpen}
                disabled={signingOut}
                className={`relative flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground hover:bg-muted ${signingOut ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.75"/><circle cx="12" cy="12" r="1.75"/><circle cx="12" cy="19" r="1.75"/></svg>
                {(pendingWithdrawals + recentEarnings + recentNfts) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                  </span>
                )}
              </button>
              {menuOpen && (
                <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-md border border-border bg-background shadow-lg">
                  <div className="px-3 py-2 text-[10px] font-mono uppercase text-muted-foreground">Explore</div>
                  {menuItem("/dashboard", "Dashboard", <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>)}
                  {menuItem("/packages", "Buy packages", <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>)}
                  {menuItem("/marketplace", "Marketplace", <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9h18l-1.5 10a2 2 0 0 1-2 1.7H6.5a2 2 0 0 1-2-1.7L3 9Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></svg>, { badge: <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-mono uppercase text-primary">Soon</span> })}
                  {menuItem("/withdraw", "Withdraw", <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18"/><path d="m17 8-5-5-5 5"/><path d="m17 16-5 5-5-5"/></svg>, {
                    badge: <Badge n={pendingWithdrawals} tone="muted" />,
                    onClick: (e) => { e.preventDefault(); setMenuOpen(false); setConfirmWithdraw(true); },
                  })}
                  {menuItem("/settings", "Account settings", <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.16.68.4.94.71"/></svg>)}
                  <div className="mt-1 border-t border-border px-3 py-2 text-[10px] font-mono uppercase text-muted-foreground">Quick access</div>
                  {menuItem("/notifications", "Notifications", <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>, { badge: <Badge n={recentNfts + recentEarnings + pendingWithdrawals} tone="primary" /> })}
                  {menuItem("/nfts", "My NFTs", <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>, { badge: <Badge n={recentNfts} tone="accent" /> })}
                  {menuItem("/ledger", "Wallet", <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12V7H3v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2"/><path d="M16 12h.01"/></svg>, { badge: <Badge n={recentEarnings} tone="primary" /> })}
                  {menuItem("/referrals", "Referral dashboard", <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, { badge: <Badge n={recentEarnings} tone="primary" /> })}
                  {referralUrl && (
                    <button
                      onClick={copyReferral}
                      className={`${baseLink} ${idle} w-full text-left`}
                    >
                      <span className="flex items-center gap-2">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        <span>Copy referral link</span>
                      </span>
                    </button>
                  )}
                  {isAdmin && <><div className="mt-1 border-t border-border" />{menuItem("/admin", "Admin", <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>, { accent: true })}</>}
                  <div className="mt-1 border-t border-border" />
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setConfirmSignOut(true); }}
                    className={`${baseLink} ${idle} w-full text-left`}
                  >
                    <span className="flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
                      <span>Sign out</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8"><Outlet /></main>

      {confirmWithdraw && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={() => setConfirmWithdraw(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Start a withdrawal?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              You'll be taken to the withdrawal form to enter an amount and payout details. Approved withdrawals are debited from your wallet balance and can't be reversed.
            </p>
            {pendingWithdrawals > 0 && (
              <div className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                You already have <span className="font-mono text-foreground">{pendingWithdrawals}</span> pending withdrawal{pendingWithdrawals === 1 ? "" : "s"}.
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setConfirmWithdraw(false)}
                className="rounded-md border border-border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmWithdraw(false); navigate({ to: "/withdraw" }); }}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmSignOut && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={() => !signingOut && setConfirmSignOut(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Sign out?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This will end your session on this device and clear your cached account data. You'll need to sign in again to access your wallet, NFTs, and referrals.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setConfirmSignOut(false)}
                disabled={signingOut}
                className={`rounded-md border border-border px-4 py-2 text-sm ${signingOut ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                Cancel
              </button>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {signingOut ? (
                  <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    Signing out…
                  </span>
                ) : (
                  "Sign out"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
