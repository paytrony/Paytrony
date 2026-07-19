import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { requestWithdrawal } from "@/lib/wallet.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/withdraw")({
  component: Withdraw,
});

const FEE = 1;

type W = { id: string; amount: number; status: string; payout_note: string | null; admin_note: string | null; created_at: string; resolved_at: string | null };
type Limits = { min_amount: number; daily_cap: number; kyc_threshold: number; cooldown_minutes: number };
type KindKey = "binance" | "bybit" | "wallet_address" | "upi" | "paypal" | "bank";

const METHODS: { k: KindKey; label: string }[] = [
  { k: "binance", label: "Binance" },
  { k: "bybit", label: "Bybit" },
  { k: "wallet_address", label: "Wallet Address" },
  { k: "upi", label: "UPI" },
  { k: "paypal", label: "PayPal" },
  { k: "bank", label: "Bank" },
];
const COMING_SOON: KindKey[] = ["upi", "paypal", "bank"];

function Withdraw() {
  const { user } = Route.useRouteContext();
  const req = useServerFn(requestWithdrawal);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [available, setAvailable] = useState(0);
  const [history, setHistory] = useState<W[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [kycStatus, setKycStatus] = useState<string>("none");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; amount: number; fee: number; net: number; method: string; createdAt: string } | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const [kind, setKind] = useState<KindKey>("binance");
  const [exUid, setExUid] = useState("");
  const [exEmail, setExEmail] = useState("");
  const [exPhone, setExPhone] = useState("");
  const [walletChain, setWalletChain] = useState("BSC");
  const [walletAddress, setWalletAddress] = useState("");
  const [errors, setErrors] = useState<{
    amount?: string;
    method?: string;
    uid?: string;
    email?: string;
    phone?: string;
    chain?: string;
    address?: string;
  }>({});

  const amountKey = `paytrony:withdraw-amount:${user.id}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(amountKey);
      if (saved !== null) setAmount(saved);
    } catch {}
  }, [amountKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (amount === "") window.localStorage.removeItem(amountKey);
      else window.localStorage.setItem(amountKey, amount);
    } catch {}
  }, [amount, amountKey]);

  async function load() {
    const [{ data: t }, { data: w }, { data: lim }, { data: u }, { data: prof }] = await Promise.all([
      supabase.from("wallet_transactions").select("amount,type").eq("user_id", user.id),
      supabase.from("withdrawals").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("withdrawal_limits").select("*").eq("id", true).maybeSingle(),
      supabase.auth.getUser(),
      supabase.from("profiles").select("kyc_status").eq("id", user.id).maybeSingle(),
    ]);
    const bal = (t ?? []).reduce((s, r: any) => s + (r.type === "referral_credit" ? Number(r.amount) : -Number(r.amount)), 0);
    const pen = (w ?? []).filter((r: any) => r.status === "pending").reduce((s, r: any) => s + Number(r.amount), 0);
    setAvailable(bal - pen);
    setHistory((w ?? []) as W[]);
    setLimits(lim as Limits | null);
    setEmailVerified(!!u.user?.email_confirmed_at);
    setKycStatus((prof as any)?.kyc_status ?? "none");
  }
  useEffect(() => { load(); }, [user.id]);

  useEffect(() => {
    if (confirmOpen && confirmBtnRef.current && !signing) {
      setTimeout(() => confirmBtnRef.current?.focus(), 50);
    }
  }, [confirmOpen, signing]);

  useEffect(() => {
    const ch = supabase
      .channel(`withdraw-page:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "withdrawals", filter: `user_id=eq.${user.id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_transactions", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  function buildDetails(): { details: Record<string, string>; label: string } | null {
    if (kind === "binance" || kind === "bybit") {
      if (!exUid && !exEmail && !exPhone) {
        toast.error("Enter UID, email or phone");
        return null;
      }
      const label = exUid || exEmail || exPhone;
      return { details: { uid: exUid, email: exEmail, phone: exPhone }, label };
    }
    if (kind === "wallet_address") {
      if (!walletAddress) { toast.error("Enter a wallet address"); return null; }
      return { details: { chain: walletChain, address: walletAddress }, label: `${walletChain} ${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` };
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a positive amount");
    if (COMING_SOON.includes(kind)) return toast.error("This method is coming soon");
    if (!buildDetails()) return;
    if (amt + FEE > available) return toast.error(`Insufficient balance (need $${(amt + FEE).toFixed(2)} incl. $${FEE} fee)`);
    setConfirmOpen(true);
  }

  async function confirmWithdraw() {
    if (signing) return;
    setSigning(true);
    setSignError(null);
    const amt = Number(amount);
    const built = buildDetails();
    if (!built) { setSigning(false); return; }
    const methodLabel = `[${kind.toUpperCase()}] ${built.label}`;
    try {
      // Create an ephemeral payout method for this withdrawal
      const { data: pm, error: pmErr } = await supabase.from("payout_methods").insert({
        user_id: user.id, kind, label: built.label, details: built.details, is_default: false,
      }).select("id").single();
      if (pmErr || !pm) throw pmErr ?? new Error("Failed to save method");

      const idempotencyKey = (crypto as any).randomUUID?.() ?? `wd-${Date.now()}-${Math.random()}`;
      const res = await req({ data: { amount: amt, note, idempotencyKey, payoutMethodId: pm.id } });
      toast.success(`Instant payout sent — $${amt.toFixed(2)} (fee $${FEE})`);
      setReceipt({ id: res.id, amount: amt, fee: FEE, net: amt, method: methodLabel, createdAt: new Date().toISOString() });
      setAmount(""); setNote(""); setExUid(""); setExEmail(""); setExPhone(""); setWalletAddress("");
      setConfirmOpen(false);
      if (typeof window !== "undefined") {
        try { window.localStorage.removeItem(amountKey); } catch {}
      }
      await load();
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "Failed");
    } finally { setSigning(false); }
  }

  const gated = !emailVerified;
  const kycNeeded = limits && Number(amount) > limits.kyc_threshold && kycStatus !== "approved";
  const methodReady = (kind === "binance" || kind === "bybit") ? !!(exUid || exEmail || exPhone) : kind === "wallet_address" ? !!walletAddress : false;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Instant Withdraw</h1>
        <p className="text-muted-foreground">Payouts settle instantly to your chosen method. A flat <span className="text-foreground font-semibold">${FEE} fee</span> applies to every withdrawal.</p>
      </div>

      {gated && (
        <div className="rounded-md border border-accent/40 bg-accent/10 p-4 text-sm">
          Verify your email before withdrawing. <Link to="/settings" className="text-primary underline">Go to settings</Link>
        </div>
      )}

      {limits && (
        <div className="grid gap-3 md:grid-cols-4 text-xs font-mono">
          <Stat label="Min" v={`$${limits.min_amount}`} />
          <Stat label="Daily cap" v={`$${limits.daily_cap}`} />
          <Stat label="KYC over" v={`$${limits.kyc_threshold}`} />
          <Stat label="Cooldown" v={`${limits.cooldown_minutes}m`} />
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="font-mono text-xs uppercase text-muted-foreground">Available to withdraw</div>
          <div className="mt-2 text-4xl font-bold text-primary">${available.toFixed(2)}</div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="text-sm font-medium">Amount ($)</label>
              <input type="number" step="0.01" min={limits?.min_amount ?? 0.01} max={Math.max(0, available - FEE)} required value={amount} onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-input px-3 py-2 text-sm" />
              {kycNeeded && (
                <p className="mt-1 text-xs text-accent">KYC approval required above ${limits!.kyc_threshold}. <Link to="/settings" className="underline">Submit KYC</Link></p>
              )}
            </div>

            <FeeBreakdown amount={Number(amount) || 0} fee={FEE} />

            <div>
              <label className="mb-1 block text-sm font-medium">Payout method</label>
              <div className="grid grid-cols-3 gap-2">
                {METHODS.map(({ k, label }) => {
                  const soon = COMING_SOON.includes(k);
                  const active = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={soon}
                      onClick={() => setKind(k)}
                      className={`relative rounded-md border px-2 py-2 text-xs font-medium transition ${
                        active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:border-primary/50"
                      } ${soon ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      {label}
                      {soon && <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[8px] uppercase text-muted-foreground">soon</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {(kind === "binance" || kind === "bybit") && (
              <div className="space-y-2">
                <input value={exUid} onChange={(e) => setExUid(e.target.value)} placeholder={`${kind === "binance" ? "Binance" : "Bybit"} UID`}
                  className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm" />
                <input value={exEmail} onChange={(e) => setExEmail(e.target.value)} type="email" placeholder="Registered email"
                  className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm" />
                <input value={exPhone} onChange={(e) => setExPhone(e.target.value)} placeholder="Registered phone number"
                  className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm" />
                <p className="text-[10px] text-muted-foreground">Provide at least one identifier. Payout is sent to your exchange account.</p>
              </div>
            )}

            {kind === "wallet_address" && (
              <div className="space-y-2">
                <select value={walletChain} onChange={(e) => setWalletChain(e.target.value)}
                  className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm">
                  <option value="BSC">BNB Smart Chain (BEP-20)</option>
                  <option value="POLYGON">Polygon</option>
                  <option value="ARBITRUM">Arbitrum</option>
                  <option value="OPTIMISM">Optimism</option>
                  <option value="TRON">Tron (TRC-20)</option>
                  <option value="SOLANA">Solana</option>
                </select>
                <input value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} placeholder="Destination wallet address"
                  className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm font-mono" />
                <p className="text-[10px] text-muted-foreground">Double-check the chain matches your address. Wrong-chain transfers can't be recovered.</p>
              </div>
            )}

            {COMING_SOON.includes(kind) && (
              <div className="rounded-md border border-accent/40 bg-accent/10 p-3 text-xs text-accent">
                This payout method is coming soon.
              </div>
            )}

            <div>
              <label className="text-sm font-medium">Note <span className="text-muted-foreground">(optional)</span></label>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-input px-3 py-2 text-sm" />
            </div>

            <button type="submit" disabled={signing || available <= FEE || gated || !methodReady || COMING_SOON.includes(kind)}
              aria-live="polite"
              className="w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50">
              {signing ? "Processing…" : "Review & withdraw"}
            </button>
          </form>
        </div>

        <div className="space-y-4">
          {receipt && (
            <div className="rounded-2xl border border-primary/40 bg-primary/10 p-5" role="status" aria-live="polite">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-primary">Withdrawal confirmed</h2>
                <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-mono uppercase text-primary">{receipt.id.slice(0, 8)}</span>
              </div>
              <div className="space-y-2 text-sm font-mono">
                <div className="flex justify-between"><span className="text-muted-foreground">Requested</span><span>${receipt.amount.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Fee</span><span className="text-destructive">- ${receipt.fee.toFixed(2)}</span></div>
                <div className="my-1 border-t border-border" />
                <div className="flex justify-between"><span className="text-muted-foreground">Net payout</span><span className="font-semibold text-primary">${receipt.net.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Destination</span><span className="text-foreground">{receipt.method}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Time</span><span className="text-foreground">{new Date(receipt.createdAt).toLocaleString()}</span></div>
              </div>
              <button onClick={() => setReceipt(null)} className="mt-4 w-full rounded-md border border-border bg-card py-2 text-sm font-medium hover:bg-muted">Dismiss receipt</button>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">History</h2>
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> live
              </span>
            </div>
            {history.length === 0 ? (
              <div className="text-sm text-muted-foreground">No withdrawals yet.</div>
            ) : (
              <div className="space-y-5">
                {history.map((w) => (
                  <div key={w.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-mono text-lg font-semibold">${Number(w.amount).toFixed(2)}</div>
                        <div className="text-[11px] text-muted-foreground">{new Date(w.created_at).toLocaleString()}</div>
                      </div>
                      <StatusBadge s={w.status} />
                    </div>
                    <WithdrawalTimeline w={w} />
                    {w.admin_note && <div className="mt-2 text-xs text-muted-foreground">Note: {w.admin_note}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => {
        if (!signing) setConfirmOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm instant withdrawal</DialogTitle>
            <DialogDescription>
              Review the exact amount that will be deducted from your wallet and sent to your payout method.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm">
              <div className="mb-3 text-[10px] font-mono uppercase text-muted-foreground">Final payout summary</div>
              <div className="space-y-2 font-mono">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Requested amount</span>
                  <span className="text-foreground">${Number(amount || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Withdrawal fee</span>
                  <span className="text-destructive">- ${FEE.toFixed(2)}</span>
                </div>
                <div className="my-1 border-t border-border" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Total debited from wallet</span>
                  <span className="font-semibold text-foreground">${((Number(amount || 0)) + FEE).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-foreground">Net payout to you</span>
                  <span className="font-semibold text-primary">${Number(amount || 0).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 text-sm">
              <div className="text-[10px] font-mono uppercase text-muted-foreground mb-1">Payout destination</div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase">{kind}</span>
                <span className="text-foreground truncate">
                  {kind === "wallet_address"
                    ? `${walletChain} · ${walletAddress}`
                    : (exUid || exEmail || exPhone)}
                </span>
              </div>
            </div>

            {note && (
              <div className="text-xs text-muted-foreground">
                Note: {note}
              </div>
            )}

            {signError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3" role="alert" aria-live="assertive">
                <div className="text-xs text-destructive">{signError}</div>
                <button
                  type="button"
                  onClick={confirmWithdraw}
                  disabled={signing}
                  className="mt-2 text-xs font-medium underline text-destructive hover:text-destructive/80 disabled:opacity-50"
                >
                  Retry withdrawal
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmOpen(false)}
              disabled={signing}
            >
              Cancel
            </Button>
            <Button
              ref={confirmBtnRef}
              className="flex-1"
              onClick={confirmWithdraw}
              disabled={signing}
            >
              {signing ? "Processing…" : "Confirm withdrawal"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{v}</div>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  const c = s === "approved" ? "bg-primary/20 text-primary" : s === "rejected" ? "bg-destructive/20 text-destructive" : "bg-accent/20 text-accent animate-pulse";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-mono uppercase ${c}`}>{s}</span>;
}

function FeeBreakdown({ amount, fee }: { amount: number; fee: number }) {
  const debited = amount > 0 ? amount + fee : 0;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-2 text-[10px] font-mono uppercase text-muted-foreground">Payout summary</div>
      <div className="space-y-1.5 font-mono">
        <Row label="Requested amount" value={`$${amount.toFixed(2)}`} />
        <Row label="Withdrawal fee" value={`- $${fee.toFixed(2)}`} />
        <div className="my-1 border-t border-border" />
        <Row label="Total debited from wallet" value={`$${debited.toFixed(2)}`} strong />
        <Row label="Net payout to you" value={`$${amount.toFixed(2)}`} accent />
      </div>
    </div>
  );
}

function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={accent ? "text-primary font-semibold" : strong ? "text-foreground font-semibold" : "text-foreground"}>{value}</span>
    </div>
  );
}

function WithdrawalTimeline({ w }: { w: { status: string; created_at: string; resolved_at: string | null } }) {
  const requestedAt = w.created_at;
  const resolvedAt = w.resolved_at;
  const rejected = w.status === "rejected";
  const approved = w.status === "approved";
  const pending = w.status === "pending";

  const steps = [
    { key: "requested", label: "Requested", at: requestedAt, done: true, active: pending && !approved && !rejected },
    { key: "approved", label: rejected ? "Rejected" : "Auto-approved", at: resolvedAt, done: approved || rejected, active: pending, bad: rejected },
    { key: "sent", label: "Payout sent", at: resolvedAt, done: approved, active: false },
    { key: "completed", label: "Completed", at: resolvedAt, done: approved, active: false },
  ];

  return (
    <ol className="mt-3 space-y-2">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-start gap-3">
          <div className="relative flex flex-col items-center">
            <span className={
              "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-mono " +
              (s.bad
                ? "border-destructive bg-destructive/20 text-destructive"
                : s.done
                ? "border-primary bg-primary/20 text-primary"
                : s.active
                ? "border-accent bg-accent/20 text-accent animate-pulse"
                : "border-border bg-muted text-muted-foreground")
            }>{s.bad ? "!" : s.done ? "✓" : i + 1}</span>
            {i < steps.length - 1 && (
              <span className={"mt-0.5 h-6 w-px " + (steps[i + 1].done ? "bg-primary/50" : "bg-border")} />
            )}
          </div>
          <div className="pb-2">
            <div className={"text-xs font-medium " + (s.bad ? "text-destructive" : s.done ? "text-foreground" : s.active ? "text-accent" : "text-muted-foreground")}>
              {s.label}
            </div>
            {s.done && s.at && (
              <div className="text-[10px] text-muted-foreground">{new Date(s.at).toLocaleString()}</div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
