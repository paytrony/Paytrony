import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { createPaymentIntent, checkPaymentIntent, cancelPaymentIntent, getPublicPaymentConfig } from "@/lib/payments.functions";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Loader2, CheckCircle2, XCircle, Clock, QrCode, Wallet, Smartphone, Zap, CreditCard, ChevronLeft, Lock, Check, Minus, Plus } from "lucide-react";
import { TIER_BENEFITS } from "@/lib/tier-benefits";
import { MetaMaskPay } from "@/components/checkout/MetaMaskPay";
import { SolanaPay } from "@/components/checkout/SolanaPay";
import { WalletConnectPay } from "@/components/checkout/WalletConnectPay";
import { MinerNftArt } from "@/components/MinerNftArt";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/packages")({
  component: Packages,
});

const TIERS = [
  { p: 10 as const, tag: "Starter", desc: "Get started with the basics", cls: "border-border" },
  { p: 50 as const, tag: "Pro", desc: "For serious referrers", cls: "border-primary glow" },
  { p: 100 as const, tag: "Elite", desc: "Maximum earning power", cls: "border-accent glow-accent" },
];

const MAX_QTY = 1000;

type Intent = {
  id: string;
  address: string;
  chain: string;
  tier: number;
  quantity: number;
  expectedAmount: number;
  expiresAt: string;
};

type Method = "chooser" | "tron" | "metamask" | "walletconnect" | "solana" | "card";

type Tile = {
  id: Method;
  label: string;
  subtitle: string;
  fee: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  disabledHint?: string;
};

function buildTiles(cfg: { walletConnectProjectId: string | null; solanaEnabled: boolean; stripeEnabled: boolean } | undefined): Tile[] {
  const wcOn = !!cfg?.walletConnectProjectId;
  const solOn = !!cfg?.solanaEnabled;
  const stripeOn = !!cfg?.stripeEnabled;
  return [
    { id: "tron", label: "Binance / Bybit QR", subtitle: "USDT on Tron (TRC20)", fee: "gas ≈ $1 · ~30s", icon: QrCode },
    { id: "metamask", label: "MetaMask", subtitle: "USDT/USDC on BSC, Polygon, Arbitrum, Optimism, Base, ETH", fee: "gas ≈ $0.01–2", icon: Wallet },
    { id: "solana", label: "Solana Pay", subtitle: "USDC on Solana (Phantom, Solflare, Backpack)", fee: solOn ? "gas < $0.01" : "Setup required", icon: Zap, disabled: !solOn, disabledHint: "Site owner: set SOLANA_USDC_ADDRESS" },
    { id: "walletconnect", label: "WalletConnect", subtitle: "Trust, Rainbow, MetaMask Mobile, any WC wallet", fee: wcOn ? "gas ≈ chain fee" : "Setup required", icon: Smartphone, disabled: !wcOn, disabledHint: wcOn ? undefined : "Site owner: set WALLETCONNECT_PROJECT_ID" },
    { id: "card", label: "Credit / Debit card", subtitle: "Visa, Mastercard, Amex via Stripe", fee: stripeOn ? "2.9% + 30¢" : "Coming soon", icon: CreditCard, disabled: true, disabledHint: stripeOn ? "Card checkout coming shortly" : "Enable Stripe payments to activate" },
  ];
}

/**
 * MintStatusTracker — visualises the full mint pipeline in real time.
 *
 * Steps: (1) Awaiting payment → (2) Payment detected on-chain →
 * (3) Minting N of Q → (4) All Q NFTs minted.
 *
 * We subscribe to the user's `purchases` table via Realtime and count rows
 * created since the modal opened for the current tier, so the "N of Q"
 * progress moves the moment the RPC persists each mint.
 */
function MintStatusTracker({
  tier,
  quantity,
  paymentStage,
  startedAt,
}: {
  tier: 10 | 50 | 100;
  quantity: number;
  paymentStage: "awaiting" | "detected" | "paid";
  startedAt: number;
}) {
  const [minted, setMinted] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let uid: string | null = null;

    (async () => {
      const { data: user } = await supabase.auth.getUser();
      uid = user.user?.id ?? null;
      if (!uid || cancelled) return;

      // Initial count of purchases matching tier since we started.
      const initial = await supabase
        .from("purchases")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("nft_tier", tier)
        .gte("created_at", new Date(startedAt - 5_000).toISOString());
      if (!cancelled) setMinted(initial.count ?? 0);
    })();

    const channel = supabase
      .channel(`mint-progress-${tier}-${startedAt}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "purchases" },
        (payload) => {
          const row = payload.new as { user_id?: string; nft_tier?: number; created_at?: string };
          if (!uid || row.user_id !== uid) return;
          if (row.nft_tier !== tier) return;
          setMinted((n) => Math.min(quantity, n + 1));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [tier, quantity, startedAt]);

  const pct = paymentStage === "paid"
    ? Math.round((minted / quantity) * 100)
    : paymentStage === "detected" ? 66 : paymentStage === "awaiting" ? 33 : 0;

  const steps = [
    { key: "pay", label: "Awaiting payment", done: paymentStage !== "awaiting", active: paymentStage === "awaiting" },
    { key: "detect", label: "Payment detected on-chain", done: paymentStage === "paid", active: paymentStage === "detected" },
    { key: "mint", label: quantity > 1 ? `Minting ${minted} of ${quantity} NFTs` : "Minting NFT", done: paymentStage === "paid" && minted >= quantity, active: paymentStage === "paid" && minted < quantity },
    { key: "done", label: quantity > 1 ? `${quantity} NFTs credited to your wallet` : "NFT credited to your wallet", done: paymentStage === "paid" && minted >= quantity, active: false },
  ];

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">Mint status</span>
        <span className="font-mono text-muted-foreground">{paymentStage === "paid" ? `${minted}/${quantity}` : "—"}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          role="progressbar"
        />
      </div>
      <ol className="space-y-1.5 text-xs">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            {s.done ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : s.active ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />
            )}
            <span className={s.done ? "text-foreground" : s.active ? "text-primary" : "text-muted-foreground"}>
              {s.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Packages() {
  const createIntent = useServerFn(createPaymentIntent);
  const checkIntent = useServerFn(checkPaymentIntent);
  const cancelIntent = useServerFn(cancelPaymentIntent);
  const navigate = useNavigate();

  const [openTier, setOpenTier] = useState<10 | 50 | 100 | null>(null);
  const [method, setMethod] = useState<Method>("chooser");
  const [expandedBenefits, setExpandedBenefits] = useState<Set<number>>(new Set());
  const [qtyByTier, setQtyByTier] = useState<Record<10 | 50 | 100, number>>({ 10: 1, 50: 1, 100: 1 });
  const [openQty, setOpenQty] = useState<number>(1);
  const [flowStartedAt, setFlowStartedAt] = useState<number>(() => Date.now());
  const cfgFn = useServerFn(getPublicPaymentConfig);
  const { data: publicCfg } = useQuery({ queryKey: ["payment-config"], queryFn: () => cfgFn(), staleTime: 60_000 });
  const tiles = buildTiles(publicCfg);
  const [tronBusy, setTronBusy] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [status, setStatus] = useState<"pending" | "paid" | "expired" | "cancelled" | "failed">("pending");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toggleBenefits = (p: number) => {
    setExpandedBenefits((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const bumpQty = (p: 10 | 50 | 100, delta: number) => {
    setQtyByTier((prev) => {
      const next = Math.max(1, Math.min(MAX_QTY, (prev[p] ?? 1) + delta));
      return { ...prev, [p]: next };
    });
  };

  function startCheckout(p: 10 | 50 | 100) {
    setOpenQty(qtyByTier[p] ?? 1);
    setOpenTier(p);
    setMethod("chooser");
    setFlowStartedAt(Date.now());
  }

  // Auto-create Tron intent when Tron method active and none exists.
  useEffect(() => {
    if (openTier === null || method !== "tron" || intent || tronBusy) return;
    let cancelled = false;
    setTronBusy(true);
    (async () => {
      try {
        const res = await createIntent({ data: { tier: openTier, quantity: openQty } });
        if (cancelled) return;
        setIntent(res);
        setStatus("pending");
        const payUri = `tron:${res.address}?amount=${res.expectedAmount}&token=USDT`;
        const url = await QRCode.toDataURL(payUri, { width: 320, margin: 1 });
        if (!cancelled) setQrDataUrl(url);
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not start payment");
      } finally {
        if (!cancelled) setTronBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [openTier, openQty, method, intent, tronBusy, createIntent]);

  useEffect(() => {
    if (!intent || status !== "pending" || method !== "tron") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await checkIntent({ data: { id: intent.id } });
        if (cancelled) return;
        if (r.status === "paid") {
          setStatus("paid");
          toast.success(openQty > 1 ? `Payment received! Minting ${openQty} NFTs…` : "Payment received! NFT minted.");
          setTimeout(() => navigate({ to: "/nfts" }), 2400);
        } else if (r.status === "expired") {
          setStatus("expired");
        } else if (r.status === "cancelled" || r.status === "failed") {
          setStatus(r.status);
        }
      } catch { /* retry */ }
    };
    tick();
    pollRef.current = setInterval(tick, 6000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [intent, status, method, checkIntent, navigate, openQty]);

  useEffect(() => {
    if (!intent) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [intent]);

  async function closeModal() {
    if (intent && status === "pending") {
      try { await cancelIntent({ data: { id: intent.id } }); } catch { /* ignore */ }
    }
    setOpenTier(null);
    setIntent(null);
    setQrDataUrl("");
    setStatus("pending");
    setMethod("chooser");
  }

  async function backToChooser() {
    if (intent && status === "pending") {
      try { await cancelIntent({ data: { id: intent.id } }); } catch { /* ignore */ }
    }
    setIntent(null);
    setQrDataUrl("");
    setStatus("pending");
    setMethod("chooser");
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  }

  const remainingMs = intent ? Math.max(0, new Date(intent.expiresAt).getTime() - now) : 0;
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0");

  const paymentStage: "awaiting" | "detected" | "paid" =
    status === "paid" ? "paid" : intent ? "detected" : "awaiting";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Buy NFT</h1>
        <p className="text-muted-foreground">Pick any payment method — USDT on Tron, MetaMask (6 EVM chains), WalletConnect, Solana Pay, or card. Mint 1–{MAX_QTY} NFTs per payment. Your referrer earns 100% instantly.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((t) => {
          const info = TIER_BENEFITS[t.p];
          const qty = qtyByTier[t.p] ?? 1;
          return (
            <div key={t.p} className={`relative flex flex-col rounded-2xl border-2 ${t.cls} bg-card p-8 text-center`}>
              {info.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground">
                  Most popular
                </div>
              )}


              <div className="nft-art mt-4 mx-auto overflow-hidden rounded-xl cursor-pointer">
                <MinerNftArt tier={t.p} size={140} />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {t.p === 10 ? "Pickaxe Miner" : t.p === 50 ? "Rig Miner" : "ASIC Miner"} · Tier {t.p}
              </div>
              {expandedBenefits.has(t.p) && (
                <ul className="mt-5 space-y-2 text-left text-sm">
                  {info.benefits.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />
                      <span className="text-foreground/85">{b}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => toggleBenefits(t.p)}
                className="mt-3 text-xs font-medium text-primary hover:underline"
                aria-expanded={expandedBenefits.has(t.p)}
              >
                {expandedBenefits.has(t.p) ? "Hide benefits" : "See benefits"}
              </button>

              <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Quantity</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => bumpQty(t.p, -1)}
                    disabled={qty <= 1 || openTier !== null}
                    aria-label={`Decrease ${t.tag} quantity`}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card hover:border-primary disabled:opacity-40 disabled:hover:border-border"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-6 text-center font-mono text-sm font-semibold" aria-live="polite">{qty}</span>
                  <button
                    type="button"
                    onClick={() => bumpQty(t.p, +1)}
                    disabled={qty >= MAX_QTY || openTier !== null}
                    aria-label={`Increase ${t.tag} quantity`}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card hover:border-primary disabled:opacity-40 disabled:hover:border-border"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <button
                onClick={() => startCheckout(t.p)}
                disabled={openTier !== null}
                className="mt-4 w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50"
              >
                Mint {qty > 1 ? `${qty} × ` : ""}${t.p * qty}
              </button>
              {qty > 1 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Mints {qty} {t.p === 10 ? "Pickaxe" : t.p === 50 ? "Rig" : "ASIC"} miners in one payment.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={openTier !== null} onOpenChange={(o) => { if (!o) closeModal(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {method !== "chooser" && status === "pending" && (
                <button onClick={backToChooser} className="rounded p-1 hover:bg-muted" aria-label="Back">
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              {status === "paid" ? "Payment received" :
               status === "expired" ? "Payment window expired" :
               status === "cancelled" ? "Payment cancelled" :
               status === "failed" ? "Payment failed" :
               method === "chooser" && openTier ? `Choose how to pay $${(openTier * openQty).toFixed(2)}` :
               openTier ? `Pay $${(openTier * openQty).toFixed(2)}` : ""}
            </DialogTitle>
            <DialogDescription>
              {status === "pending" && method === "chooser" && `All methods mint the same ${openQty > 1 ? `${openQty} NFTs` : "NFT"} — pick whichever is easiest for you.`}
              {status === "pending" && method !== "chooser" && "Detection is automatic. Don't close this window."}
              {status === "paid" && (openQty > 1 ? `Your ${openQty} NFTs are being minted. Redirecting when ready…` : "Your NFT has been minted. Redirecting…")}
              {status === "expired" && "No matching transaction found in time. If you already sent, contact support with your tx hash."}
            </DialogDescription>
          </DialogHeader>

          {method !== "chooser" && openTier !== null && (status === "pending" || status === "paid") && (
            <MintStatusTracker
              tier={openTier}
              quantity={openQty}
              paymentStage={paymentStage}
              startedAt={flowStartedAt}
            />
          )}

          {status === "pending" && method === "chooser" && openTier !== null && (
            <div className="space-y-3">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-primary">
                  <span>{TIER_BENEFITS[openTier].tag} · what you get</span>
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px]">×{openQty} NFT{openQty > 1 ? "s" : ""}</span>
                </div>
                <ul className="space-y-1 text-xs">
                  {TIER_BENEFITS[openTier].benefits.slice(0, 3).map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" strokeWidth={2.5} />
                      <span className="text-foreground/85">{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2">
              {tiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <button
                    key={tile.id}
                    disabled={tile.disabled}
                    onClick={() => setMethod(tile.id)}
                    className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition hover:border-primary hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-card"
                    title={tile.disabled ? tile.disabledHint : undefined}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      {tile.disabled ? <Lock className="h-4 w-4" /> : <Icon className="h-5 w-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{tile.label}</div>
                      <div className="truncate text-xs text-muted-foreground">{tile.subtitle}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{tile.fee}</div>
                  </button>
                );
              })}
              </div>
            </div>
          )}

          {status === "pending" && method === "tron" && openTier !== null && (
            !intent || tronBusy ? (
              <div className="flex h-[400px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-4">
                <div className="mx-auto flex h-[280px] w-[280px] items-center justify-center rounded-lg bg-white p-2">
                  {qrDataUrl ? <img src={qrDataUrl} alt="Payment QR" className="h-full w-full" /> : <Loader2 className="animate-spin" />}
                </div>
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-muted-foreground text-xs">Send exactly{openQty > 1 ? ` (${openQty} × $${openTier})` : ""}</div>
                      <div className="font-mono text-lg font-bold">{intent.expectedAmount} USDT</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => copy(String(intent.expectedAmount), "Amount")}>
                      <Copy className="mr-1 h-3 w-3" /> Copy
                    </Button>
                  </div>
                  <div className="mt-3">
                    <div className="text-muted-foreground text-xs">To address (TRC20)</div>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">{intent.address}</code>
                      <Button size="sm" variant="outline" onClick={() => copy(intent.address, "Address")}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">Network: Tron (TRC20) · Token: USDT</div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1 text-muted-foreground"><Clock className="h-4 w-4" /> Expires in {mm}:{ss}</span>
                  <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Watching chain…</span>
                </div>
                <p className="text-xs text-muted-foreground">Send the <b>exact</b> amount from Binance, Bybit or your wallet. Any other amount won't auto-detect.</p>
              </div>
            )
          )}

          {status === "pending" && method === "metamask" && openTier !== null && (
            <MetaMaskPay tier={openTier} quantity={openQty} />
          )}

          {status === "pending" && method === "solana" && openTier !== null && (
            <SolanaPay tier={openTier} quantity={openQty} />
          )}

          {status === "pending" && method === "walletconnect" && openTier !== null && (
            <WalletConnectPay tier={openTier} quantity={openQty} />
          )}

          {status === "paid" && (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="font-medium">
                {openQty > 1 ? `${openQty} NFTs minted successfully.` : "NFT minted successfully."}
              </p>
            </div>
          )}
          {(status === "expired" || status === "cancelled" || status === "failed") && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <XCircle className="h-12 w-12 text-destructive" />
              <Button onClick={closeModal}>Close</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
