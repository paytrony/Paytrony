import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { requestWithdrawal } from "@/lib/wallet.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Landmark,
  Wallet,
  CreditCard,
  ArrowRightLeft,
  CircleDollarSign,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/withdraw")({
  component: Withdraw,
});

const FEE = 1;

type W = { id: string; amount: number; status: string; payout_note: string | null; admin_note: string | null; created_at: string; resolved_at: string | null; tx_hash: string | null };
type Limits = { min_amount: number; daily_cap: number; cooldown_minutes: number };
type KindKey = "binance" | "bybit" | "wallet_address" | "upi" | "paypal" | "bank";

type MethodDef = {
  k: KindKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const METHODS: MethodDef[] = [
  { k: "binance", label: "Binance", icon: ArrowRightLeft },
  { k: "bybit", label: "Bybit", icon: ArrowRightLeft },
  { k: "wallet_address", label: "Wallet Address", icon: Wallet },
  { k: "upi", label: "UPI", icon: CreditCard },
  { k: "paypal", label: "PayPal", icon: CircleDollarSign },
  { k: "bank", label: "Bank", icon: Landmark },
];
const COMING_SOON: KindKey[] = ["upi", "paypal", "bank"];

const CHAINS = [
  { value: "BSC", label: "BNB Smart Chain (BEP-20)" },
  { value: "POLYGON", label: "Polygon" },
  { value: "ARBITRUM", label: "Arbitrum" },
  { value: "OPTIMISM", label: "Optimism" },
  { value: "TRON", label: "Tron (TRC-20)" },
  { value: "SOLANA", label: "Solana" },
];

function Withdraw() {
  const { user } = Route.useRouteContext();
  const req = useServerFn(requestWithdrawal);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [available, setAvailable] = useState(0);
  const [history, setHistory] = useState<W[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; amount: number; fee: number; net: number; method: string; createdAt: string } | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const [kind, setKind] = useState<KindKey>("binance");
  const [exUid, setExUid] = useState("");
  const [exEmail, setExEmail] = useState("");
  const [exPhone, setExPhone] = useState("");
  const [idType, setIdType] = useState<"uid" | "email" | "phone">("uid");
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
  const formKey = `paytrony:withdraw-form:${user.id}`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(amountKey);
      if (saved !== null) setAmount(saved);
      const savedForm = window.localStorage.getItem(formKey);
      if (savedForm) {
        const parsed = JSON.parse(savedForm);
        if (parsed.kind && METHODS.some((m) => m.k === parsed.kind)) setKind(parsed.kind);
        if (parsed.idType) setIdType(parsed.idType);
        if (parsed.exUid !== undefined) setExUid(parsed.exUid);
        if (parsed.exEmail !== undefined) setExEmail(parsed.exEmail);
        if (parsed.exPhone !== undefined) setExPhone(parsed.exPhone);
        if (parsed.walletChain) setWalletChain(parsed.walletChain);
        if (parsed.walletAddress !== undefined) setWalletAddress(parsed.walletAddress);
      }
    } catch {}
  }, [amountKey, formKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (amount === "") window.localStorage.removeItem(amountKey);
      else window.localStorage.setItem(amountKey, amount);
    } catch {}
  }, [amount, amountKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload = {
        kind,
        idType,
        exUid,
        exEmail,
        exPhone,
        walletChain,
        walletAddress,
      };
      window.localStorage.setItem(formKey, JSON.stringify(payload));
    } catch {}
  }, [kind, idType, exUid, exEmail, exPhone, walletChain, walletAddress, formKey]);


  async function load() {
    const [{ data: t }, { data: w }, { data: lim }, { data: u }] = await Promise.all([
      supabase.from("wallet_transactions").select("amount,type").eq("user_id", user.id),
      supabase.from("withdrawals").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("withdrawal_limits").select("*").eq("id", true).maybeSingle(),
      supabase.auth.getUser(),
    ]);
    const bal = (t ?? []).reduce((s, r: any) => s + ((r.type === "referral_credit" || r.type === "mining_reward") ? Number(r.amount) : -Number(r.amount)), 0);
    const pen = (w ?? []).filter((r: any) => r.status === "pending").reduce((s, r: any) => s + Number(r.amount), 0);
    setAvailable(bal - pen);
    setHistory((w ?? []) as W[]);
    setLimits(lim as Limits | null);
    setEmailVerified(!!u.user?.email_confirmed_at);
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

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validateForm(): boolean {
    const next: typeof errors = {};
    const amt = Number(amount);
    const min = limits?.min_amount ?? 0.01;

    if (!amount || Number.isNaN(amt)) {
      next.amount = "Enter an amount";
    } else if (amt <= 0) {
      next.amount = "Amount must be greater than $0";
    } else if (amt < min) {
      next.amount = `Minimum withdrawal is $${min.toFixed(2)}`;
    } else if (amt <= FEE) {
      next.amount = `Amount must be more than the $${FEE} fee`;
    } else if (amt > available) {
      next.amount = `Insufficient balance (available $${available.toFixed(2)})`;
    }

    if (COMING_SOON.includes(kind)) {
      next.method = "This payout method is coming soon";
    } else if (kind === "binance" || kind === "bybit") {
      if (idType === "uid") {
        if (!exUid.trim()) next.uid = "Enter your UID";
      } else if (idType === "email") {
        if (!exEmail.trim()) next.email = "Enter your registered email";
        else if (!emailRegex.test(exEmail.trim())) next.email = "Enter a valid email address";
      } else if (idType === "phone") {
        if (!exPhone.trim()) next.phone = "Enter your registered phone number";
        else if (!/^\+?[\d\s\-()]{7,20}$/.test(exPhone.trim())) next.phone = "Enter a valid phone number";
      }
    
    } else if (kind === "wallet_address") {
      if (!walletChain) next.chain = "Select a chain";
      if (!walletAddress.trim()) {
        next.address = "Enter a destination wallet address";
      } else if (walletAddress.trim().length < 10) {
        next.address = "Address looks too short";
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(key: keyof typeof errors) {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }

  function buildDetails(): { details: Record<string, string>; label: string } | null {
    if (!validateForm()) return null;
    if (kind === "binance" || kind === "bybit") {
      const val = idType === "uid" ? exUid.trim() : idType === "email" ? exEmail.trim() : exPhone.trim();
      return { details: { type: idType, value: val }, label: val };
    }
    if (kind === "wallet_address") {
      return { details: { chain: walletChain, address: walletAddress.trim() }, label: `${walletChain} ${walletAddress.trim().slice(0, 6)}…${walletAddress.trim().slice(-4)}` };
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateForm()) return;
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
      const { data: pm, error: pmErr } = await supabase.from("payout_methods").insert({
        user_id: user.id, kind, label: built.label, details: built.details, is_default: false,
      }).select("id").single();
      if (pmErr || !pm) throw pmErr ?? new Error("Failed to save method");

      // Deterministic idempotency key: same (user, amount, method, note) can never
      // create two rows even on refresh/double-click. Server returns the existing row.
      const keyPayload = JSON.stringify({ u: user.id, a: amt.toFixed(2), pm: pm.id, k: kind, d: built.details, n: note });
      let hash = 0;
      for (let i = 0; i < keyPayload.length; i++) hash = ((hash << 5) - hash + keyPayload.charCodeAt(i)) | 0;
      const idempotencyKey = `wd-${user.id.slice(0, 8)}-${Math.abs(hash).toString(36)}-${amt.toFixed(2)}`;
      const res = await req({ data: { amount: amt, note, idempotencyKey, payoutMethodId: pm.id } });
      toast.success(`Withdrawal request submitted — pending admin approval (up to 24 hours). You'll receive $${net.toFixed(2)} once approved.`);
      setReceipt({ id: res.id, amount: amt, fee: FEE, net, method: methodLabel, createdAt: new Date().toISOString() });
      setAmount(""); setNote(""); setExUid(""); setExEmail(""); setExPhone(""); setWalletAddress("");
      setErrors({});
      setConfirmOpen(false);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(amountKey);
          window.localStorage.removeItem(formKey);
        } catch {}
      }

      await load();
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "Failed");
    } finally { setSigning(false); }
  }

  const gated = !emailVerified;
  const methodReady = (kind === "binance" || kind === "bybit") ? !!(idType === "uid" ? exUid.trim() : idType === "email" ? exEmail.trim() : exPhone.trim()) : kind === "wallet_address" ? !!walletAddress.trim() : false;
  const amt = Number(amount) || 0;
  const totalDebit = amt; // amount entered is what leaves the wallet
  const net = Math.max(0, amt - FEE); // fee is taken out of the amount

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Request Withdrawal</h1>
        <p className="text-muted-foreground">
          Withdrawals are reviewed and approved by an admin, typically within <span className="font-medium text-foreground">24 hours</span>. A flat <span className="font-medium text-foreground">${FEE} fee</span> applies to every withdrawal.
        </p>
      </div>

      {gated && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
          <span className="flex-1">Verify your email before withdrawing.</span>
          <Link to="/settings" className="text-sm font-medium text-primary hover:underline">Go to settings</Link>
        </div>
      )}

      {limits && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Minimum" v={`$${limits.min_amount}`} />
          <Stat label="Daily cap" v={`$${limits.daily_cap}`} />
          <Stat label="Cooldown" v={`${limits.cooldown_minutes}m`} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-6">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Available balance</div>
              <div className="mt-1 text-4xl font-bold text-primary">${available.toFixed(2)}</div>
            </div>

            <form onSubmit={onSubmit} className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="amount">Amount to withdraw</Label>
                  <button
                    type="button"
                    onClick={() => {
                      const maxAmt = Math.max(0, available);
                      setAmount(maxAmt > 0 ? maxAmt.toFixed(2) : "");
                      clearError("amount");
                    }}
                    disabled={available <= 0}
                    className="text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    Max (${Math.max(0, available).toFixed(2)})
                  </button>
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min={limits?.min_amount ?? 0.01}
                    max={Math.max(0, available)}
                    required
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); clearError("amount"); }}
                    className={`pl-7 text-base ${errors.amount ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    placeholder="0.00"
                  />
                </div>
                {errors.amount && <p className="text-xs text-destructive">{errors.amount}</p>}
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Payout summary</div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-medium">${amt.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Withdrawal fee</span>
                    <span className="font-medium text-destructive">- ${FEE.toFixed(2)}</span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total debited</span>
                    <span className="font-semibold">${totalDebit.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground">You receive</span>
                    <span className="font-semibold text-primary">${net.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="payout-method">Payout method</Label>
                <Select
                  value={kind}
                  onValueChange={(v) => {
                    if (COMING_SOON.includes(v as KindKey)) return;
                    setKind(v as typeof kind);
                    clearError("method");
                    clearError("uid");
                    clearError("email");
                    clearError("phone");
                    clearError("chain");
                    clearError("address");
                  }}
                >
                  <SelectTrigger id="payout-method" className="h-11">
                    <SelectValue placeholder="Select a payout method" />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map(({ k, label, icon: Icon }) => {
                      const soon = COMING_SOON.includes(k);
                      return (
                        <SelectItem key={k} value={k} disabled={soon}>
                          <span className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span>{label}</span>
                            {soon && (
                              <Badge variant="secondary" className="h-4 px-1 text-[9px] font-medium uppercase">soon</Badge>
                            )}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {errors.method && <p className="text-xs text-destructive">{errors.method}</p>}
              </div>


              {(kind === "binance" || kind === "bybit") && (
                <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="text-sm font-medium">{kind === "binance" ? "Binance" : "Bybit"} account details</div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="idType" className="text-xs text-muted-foreground">Identifier type</Label>
                      <Select
                        value={idType}
                        onValueChange={(v) => {
                          setIdType(v as "uid" | "email" | "phone");
                          clearError("uid"); clearError("email"); clearError("phone");
                        }}
                      >
                        <SelectTrigger id="idType" className="h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="uid">UID</SelectItem>
                          <SelectItem value="email">Registered email</SelectItem>
                          <SelectItem value="phone">Registered phone number</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {idType === "uid" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="exUid" className="text-xs text-muted-foreground">{kind === "binance" ? "Binance" : "Bybit"} UID</Label>
                        <Input
                          id="exUid"
                          value={exUid}
                          onChange={(e) => { setExUid(e.target.value); clearError("uid"); }}
                          placeholder={`${kind === "binance" ? "Binance" : "Bybit"} UID`}
                          className={errors.uid ? "border-destructive focus-visible:ring-destructive" : ""}
                        />
                        {errors.uid && <p className="text-xs text-destructive">{errors.uid}</p>}
                      </div>
                    )}
                    {idType === "email" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="exEmail" className="text-xs text-muted-foreground">Registered email</Label>
                        <Input
                          id="exEmail"
                          type="email"
                          value={exEmail}
                          onChange={(e) => { setExEmail(e.target.value); clearError("email"); }}
                          placeholder="Registered email"
                          className={errors.email ? "border-destructive focus-visible:ring-destructive" : ""}
                        />
                        {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                      </div>
                    )}
                    {idType === "phone" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="exPhone" className="text-xs text-muted-foreground">Registered phone number</Label>
                        <Input
                          id="exPhone"
                          value={exPhone}
                          onChange={(e) => { setExPhone(e.target.value); clearError("phone"); }}
                          placeholder="Registered phone number"
                          className={errors.phone ? "border-destructive focus-visible:ring-destructive" : ""}
                        />
                        {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Payout is sent to your exchange account using the selected identifier.</p>
                </div>
              )}


              {kind === "wallet_address" && (
                <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="text-sm font-medium">Wallet destination</div>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="chain" className="text-xs text-muted-foreground">Destination chain</Label>
                      <select
                        id="chain"
                        value={walletChain}
                        onChange={(e) => { setWalletChain(e.target.value); clearError("chain"); }}
                        className={`w-full rounded-md border bg-input px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${errors.chain ? "border-destructive" : "border-input"}`}
                      >
                        {CHAINS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      {errors.chain && <p className="text-xs text-destructive">{errors.chain}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="walletAddress" className="text-xs text-muted-foreground">Wallet address</Label>
                      <Input
                        id="walletAddress"
                        value={walletAddress}
                        onChange={(e) => { setWalletAddress(e.target.value); clearError("address"); }}
                        placeholder="Destination wallet address"
                        className={`font-mono text-xs ${errors.address ? "border-destructive focus-visible:ring-destructive" : ""}`}
                      />
                      {errors.address && <p className="text-xs text-destructive">{errors.address}</p>}
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Double-check the chain matches your address. Wrong-chain transfers cannot be recovered.</p>
                </div>
              )}

              {COMING_SOON.includes(kind) && (
                <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-accent">
                  <Clock className="h-4 w-4 shrink-0" />
                  {kind === "upi" ? "UPI" : kind === "paypal" ? "PayPal" : "Bank"} withdrawals are coming soon.
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="note" className="text-xs text-muted-foreground">Note <span className="text-muted-foreground/70">(optional)</span></Label>
                <textarea
                  id="note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <Button
                type="submit"
                disabled={signing || available <= FEE || gated || !methodReady || COMING_SOON.includes(kind)}
                className="w-full py-5 text-base font-medium"
              >
                {signing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {signing ? "Processing…" : "Review & withdraw"}
              </Button>
            </form>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">
          {receipt && (
            <div className="rounded-2xl border border-primary/40 bg-primary/10 p-5" role="status" aria-live="polite">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold text-primary">Withdrawal confirmed</h2>
                </div>
                <Badge variant="outline" className="font-mono text-[10px] uppercase">{receipt.id.slice(0, 8)}</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Requested</span><span className="font-medium">${receipt.amount.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Fee</span><span className="font-medium text-destructive">- ${receipt.fee.toFixed(2)}</span></div>
                <Separator />
                <div className="flex justify-between"><span className="text-muted-foreground">Net payout</span><span className="font-semibold text-primary">${receipt.net.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Destination</span><span className="truncate max-w-[160px]" title={receipt.method}>{receipt.method}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Time</span><span>{new Date(receipt.createdAt).toLocaleString()}</span></div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button asChild variant="default" className="flex-1">
                  <Link to="/withdrawals">Track status</Link>
                </Button>
                <Button onClick={() => setReceipt(null)} variant="outline" className="flex-1">Dismiss</Button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Withdrawal history</h2>
              <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> live
              </span>
            </div>
            {history.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No withdrawals yet. Submit your first request above.
              </div>
            ) : (
              <div className="space-y-4">
                {history.map((w) => (
                  <div key={w.id} className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">${Number(w.amount).toFixed(2)}</div>
                        <div className="text-[11px] text-muted-foreground">Requested {new Date(w.created_at).toLocaleString()}</div>
                      </div>
                      <StatusBadge s={w.status} />
                    </div>
                    <WithdrawalTimeline w={w} />
                    {w.admin_note && <div className="mt-2 text-xs text-muted-foreground">Admin note: {w.admin_note}</div>}
                    {w.tx_hash && (
                      <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs">
                        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">Receipt / Tx hash</div>
                        <div className="break-all font-mono text-foreground">{w.tx_hash}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!signing) setConfirmOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Review & confirm withdrawal</DialogTitle>
            <DialogDescription>
              Please double-check every detail before submitting. Withdrawals are reviewed by an admin and typically approved within 24 hours.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Payout summary</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-medium">${amt.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Withdrawal fee</span>
                  <span className="font-medium text-destructive">- ${FEE.toFixed(2)}</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total debited from wallet</span>
                  <span className="font-semibold">${totalDebit.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-foreground">You receive</span>
                  <span className="font-semibold text-primary">${net.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Available after</span>
                  <span className="font-medium">${(available - totalDebit).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border p-4 text-sm">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Payout destination</div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] uppercase">{kind}</Badge>
                {kind === "wallet_address" ? (
                  <span className="font-mono text-foreground">
                    {walletChain} · {walletAddress}
                  </span>
                ) : (
                  <span className="text-foreground">{kind === "binance" ? "Binance" : "Bybit"} account</span>
                )}
              </div>
              {(kind === "binance" || kind === "bybit") && (
                <div className="mt-3 space-y-1.5 pl-1">
                  {idType === "uid" && exUid && <div className="flex justify-between"><span className="text-muted-foreground">UID</span><span className="font-mono">{exUid}</span></div>}
                  {idType === "email" && exEmail && <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{exEmail}</span></div>}
                  {idType === "phone" && exPhone && <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span>{exPhone}</span></div>}
                </div>
              )}
              {note && (
                <div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                  Note: {note}
                </div>
              )}
            </div>

            {signError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3" role="alert" aria-live="assertive">
                <div className="text-xs text-destructive">{signError}</div>
                <button
                  type="button"
                  onClick={confirmWithdraw}
                  disabled={signing}
                  className="mt-2 text-xs font-medium text-destructive underline hover:text-destructive/80 disabled:opacity-50"
                >
                  Retry withdrawal
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmOpen(false)} disabled={signing}>Go back & edit</Button>
              <Button ref={confirmBtnRef} className="flex-1" onClick={confirmWithdraw} disabled={signing}>
                {signing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {signing ? "Processing…" : "Submit withdrawal"}
              </Button>
            </div>
            <p className="text-center text-[11px] text-muted-foreground">
              By submitting, you confirm the destination details are correct. Incorrect crypto addresses or exchange IDs cannot be recovered.
            </p>
            <p className="text-center text-[11px]">
              <Link to="/withdrawals" className="text-primary underline-offset-2 hover:underline">
                View withdrawal status page →
              </Link>
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{v}</div>
    </div>
  );
}

function StatusBadge({ s }: { s: string }) {
  const variants: Record<string, { className: string; icon: React.ReactNode }> = {
    approved: { className: "bg-primary/20 text-primary border-primary/30", icon: <CheckCircle2 className="h-3 w-3" /> },
    rejected: { className: "bg-destructive/20 text-destructive border-destructive/30", icon: <AlertCircle className="h-3 w-3" /> },
    pending: { className: "bg-accent/20 text-accent border-accent/30 animate-pulse", icon: <Clock className="h-3 w-3" /> },
  };
  const v = variants[s] ?? variants.pending;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] font-medium uppercase ${v.className}`}>
      {v.icon}
      {s}
    </Badge>
  );
}

function WithdrawalTimeline({ w }: { w: { status: string; created_at: string; resolved_at: string | null; admin_note?: string | null; tx_hash?: string | null } }) {
  const requestedAt = w.created_at;
  const resolvedAt = w.resolved_at;
  const rejected = w.status === "rejected";
  const approved = w.status === "approved";
  const pending = w.status === "pending";

  const steps = [
    { key: "requested", label: "Requested", at: requestedAt, done: true, active: false, bad: false },
    { key: "review", label: pending ? "Under admin review" : rejected ? "Reviewed by admin" : "Approved by admin", at: (approved || rejected) ? resolvedAt : null, done: approved || rejected, active: pending, bad: false },
    { key: "outcome", label: rejected ? "Rejected — funds restored to wallet" : "Payout sent", at: resolvedAt, done: approved || rejected, active: false, bad: rejected },
    { key: "completed", label: rejected ? "Closed" : "Completed", at: resolvedAt, done: approved || rejected, active: false, bad: false },
  ];

  return (
    <ol className="mt-3 space-y-2">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-start gap-3">
          <div className="relative flex flex-col items-center">
            <span className={
              "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-medium " +
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
