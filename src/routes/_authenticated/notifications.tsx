import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

type Category = "nfts" | "earnings" | "withdrawals";

type Item = {
  id: string;
  category: Category;
  title: string;
  detail: string;
  amount: number | null;
  created_at: string;
  unread: boolean;
  href: string;
};

const CAT_LABEL: Record<Category, string> = {
  nfts: "NFT minted",
  earnings: "Referral earning",
  withdrawals: "Withdrawal",
};

const CAT_TONE: Record<Category, string> = {
  nfts: "text-accent border-accent/40",
  earnings: "text-primary border-primary/40",
  withdrawals: "text-muted-foreground border-border",
};

function NotificationsPage() {
  const { user } = Route.useRouteContext();
  const [items, setItems] = useState<Item[]>([]);
  const [reads, setReads] = useState<Record<Category, string>>({ nfts: "", earnings: "", withdrawals: "" });
  const [filter, setFilter] = useState<"all" | Category | "unread">("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [{ data: r }, { data: purchases }, { data: credits }, { data: withdrawals }] = await Promise.all([
      supabase.from("notification_reads").select("category,last_read_at").eq("user_id", user.id),
      supabase.from("purchases").select("id,nft_tier,amount,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("wallet_transactions").select("id,amount,note,created_at,type").eq("user_id", user.id).eq("type", "referral_credit").order("created_at", { ascending: false }).limit(50),
      supabase.from("withdrawals").select("id,amount,status,created_at,resolved_at,admin_note,payout_note").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    ]);

    const readMap: Record<Category, string> = { nfts: "", earnings: "", withdrawals: "" };
    (r ?? []).forEach((row: any) => { readMap[row.category as Category] = row.last_read_at; });
    setReads(readMap);

    const isUnread = (cat: Category, ts: string) => !readMap[cat] || new Date(ts) > new Date(readMap[cat]);

    const merged: Item[] = [
      ...(purchases ?? []).map((p: any): Item => ({
        id: `p-${p.id}`,
        category: "nfts",
        title: `Minted a $${p.nft_tier} NFT`,
        detail: `Tier ${p.nft_tier} · Purchase ${String(p.id).slice(0, 8)}`,
        amount: Number(p.amount),
        created_at: p.created_at,
        unread: isUnread("nfts", p.created_at),
        href: "/nfts",
      })),
      ...(credits ?? []).map((c: any): Item => ({
        id: `c-${c.id}`,
        category: "earnings",
        title: "Referral bonus credited",
        detail: c.note ?? "Referral credit",
        amount: Number(c.amount),
        created_at: c.created_at,
        unread: isUnread("earnings", c.created_at),
        href: "/ledger",
      })),
      ...(withdrawals ?? []).map((w: any): Item => {
        const isResolved = w.status !== "pending";
        const ts = isResolved && w.resolved_at ? w.resolved_at : w.created_at;
        return {
          id: `w-${w.id}`,
          category: "withdrawals",
          title:
            w.status === "pending" ? "Withdrawal requested" :
            w.status === "approved" ? "Withdrawal approved" : "Withdrawal rejected",
          detail: w.admin_note ?? w.payout_note ?? "—",
          amount: Number(w.amount),
          created_at: ts,
          unread: isUnread("withdrawals", ts),
          href: "/withdraw",
        };
      }),
    ].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

    setItems(merged);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${user.id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "withdrawals", filter: `user_id=eq.${user.id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases", filter: `user_id=eq.${user.id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_reads", filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  async function markRead(category: Category | "all") {
    const { error } = await supabase.rpc("mark_notifications_read", { _category: category });
    if (error) { toast.error(error.message); return; }
    toast.success(category === "all" ? "All notifications marked read" : `${CAT_LABEL[category]}s marked read`);
    load();
  }

  const unreadCounts = useMemo(() => {
    const c = { nfts: 0, earnings: 0, withdrawals: 0, total: 0 };
    items.forEach((i) => { if (i.unread) { c[i.category]++; c.total++; } });
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter((i) => i.unread);
    return items.filter((i) => i.category === filter);
  }, [items, filter]);

  const chip = (v: typeof filter, label: string, badge?: number) => (
    <button
      onClick={() => setFilter(v)}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${filter === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
    >
      {label}
      {badge ? <span className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-mono text-primary-foreground">{badge}</span> : null}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-muted-foreground">
            {unreadCounts.total === 0
              ? "You're all caught up."
              : `${unreadCounts.total} unread · ${unreadCounts.nfts} NFTs, ${unreadCounts.earnings} earnings, ${unreadCounts.withdrawals} withdrawals`}
          </p>
        </div>
        <button
          onClick={() => markRead("all")}
          disabled={unreadCounts.total === 0}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          Mark all as read
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {chip("all", "All", 0)}
        {chip("unread", "Unread", unreadCounts.total)}
        {chip("nfts", "NFTs", unreadCounts.nfts)}
        {chip("earnings", "Earnings", unreadCounts.earnings)}
        {chip("withdrawals", "Withdrawals", unreadCounts.withdrawals)}
        <div className="ml-auto flex gap-2">
          {(["nfts", "earnings", "withdrawals"] as Category[]).map((c) => (
            <button
              key={c}
              onClick={() => markRead(c)}
              disabled={unreadCounts[c] === 0}
              className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              Mark {CAT_LABEL[c]}s read
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No notifications{filter !== "all" ? " in this view" : " yet"}.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((n) => (
              <Link
                key={n.id}
                to={n.href}
                className={`flex items-start gap-4 px-5 py-4 transition ${n.unread ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/40"}`}
              >
                <div className={`mt-1 shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-mono uppercase ${CAT_TONE[n.category]}`}>
                  {CAT_LABEL[n.category]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {n.unread && <span className="inline-block h-2 w-2 rounded-full bg-primary" />}
                    <div className="truncate text-sm font-medium">{n.title}</div>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">{n.detail}</div>
                  <div className="mt-1 text-[11px] font-mono text-muted-foreground">
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
                {n.amount != null && (
                  <div className={`shrink-0 font-mono text-sm font-semibold ${n.category === "earnings" ? "text-primary" : n.category === "withdrawals" ? "text-muted-foreground" : "text-accent"}`}>
                    {n.category === "withdrawals" ? "−" : n.category === "earnings" ? "+" : ""}${n.amount.toFixed(2)}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
