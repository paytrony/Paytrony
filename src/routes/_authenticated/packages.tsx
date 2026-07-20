import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { createPaymentIntent, checkPaymentIntent, cancelPaymentIntent, getPublicPaymentConfig } from "@/lib/payments.functions";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Loader2, CheckCircle2, XCircle, Clock, QrCode, Wallet, Smartphone, Zap, CreditCard, ChevronLeft, Lock } from "lucide-react";
import { MetaMaskPay } from "@/components/checkout/MetaMaskPay";
import { SolanaPay } from "@/components/checkout/SolanaPay";

export const Route = createFileRoute("/_authenticated/packages")({
  component: Packages,
});

const TIERS = [
  { p: 10 as const, tag: "Starter", desc: "Get started with the basics", cls: "border-border" },
  { p: 50 as const, tag: "Pro", desc: "For serious referrers", cls: "border-primary glow" },
  { p: 100 as const, tag: "Elite", desc: "Maximum earning power", cls: "border-accent glow-accent" },
];

type Intent = {
  id: string;
  address: string;
  chain: string;
  tier: number;
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

const METHOD_TILES: Tile[] = [
  { id: "tron", label: "Binance / Bybit QR", subtitle: "USDT on Tron (TRC20)", fee: "≈ $1 fee · ~30s", icon: QrCode },
  { id: "metamask", label: "MetaMask", subtitle: "USDT/USDC on BSC, Polygon, Arbitrum, Optimism, Base, ETH", fee: "gas ≈ $0.01–2", icon: Wallet },
  { id: "walletconnect", label: "WalletConnect", subtitle: "Trust, Rainbow, any mobile wallet", fee: "Setup required", icon: Smartphone, disabled: true, disabledHint: "Add VITE_WALLETCONNECT_PROJECT_ID to enable" },
  { id: "solana", label: "Solana Pay", subtitle: "USDC on Solana (Phantom, Solflare)", fee: "Setup required", icon: Zap, disabled: true, disabledHint: "Add SOLANA_USDC_ADDRESS to enable" },
  { id: "card", label: "Credit / Debit card", subtitle: "Visa, Mastercard, Amex via Stripe", fee: "Setup required", icon: CreditCard, disabled: true, disabledHint: "Enable Stripe payments to activate" },
];

function Packages() {
  const createIntent = useServerFn(createPaymentIntent);
  const checkIntent = useServerFn(checkPaymentIntent);
  const cancelIntent = useServerFn(cancelPaymentIntent);
  const navigate = useNavigate();

  const [openTier, setOpenTier] = useState<10 | 50 | 100 | null>(null);
  const [method, setMethod] = useState<Method>("chooser");
  const [tronBusy, setTronBusy] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [status, setStatus] = useState<"pending" | "paid" | "expired" | "cancelled" | "failed">("pending");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-create Tron intent when Tron method active and none exists.
  useEffect(() => {
    if (openTier === null || method !== "tron" || intent || tronBusy) return;
    let cancelled = false;
    setTronBusy(true);
    (async () => {
      try {
        const res = await createIntent({ data: { tier: openTier } });
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
  }, [openTier, method, intent, tronBusy, createIntent]);

  useEffect(() => {
    if (!intent || status !== "pending" || method !== "tron") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await checkIntent({ data: { id: intent.id } });
        if (cancelled) return;
        if (r.status === "paid") {
          setStatus("paid");
          toast.success("Payment received! NFT minted.");
          setTimeout(() => navigate({ to: "/nfts" }), 1600);
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
  }, [intent, status, method, checkIntent, navigate]);

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Buy a package</h1>
        <p className="text-muted-foreground">Pick any payment method — USDT on Tron, MetaMask (6 EVM chains), WalletConnect, Solana Pay, or card. Your referrer earns 100% instantly.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((t) => (
          <div key={t.p} className={`rounded-2xl border-2 ${t.cls} bg-card p-8 text-center`}>
            <div className="font-mono text-xs uppercase text-muted-foreground">{t.tag}</div>
            <div className="mt-2 text-5xl font-bold">${t.p}</div>
            <div className="mt-2 text-sm text-muted-foreground">{t.desc}</div>
            <div className="mt-4 mx-auto flex h-24 w-24 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-3xl font-bold text-primary-foreground">◆</div>
            <div className="mt-2 text-xs text-muted-foreground">NFT Tier {t.p}</div>
            <button
              onClick={() => { setOpenTier(t.p); setMethod("chooser"); }}
              disabled={openTier !== null}
              className="mt-6 w-full rounded-md bg-primary py-2.5 font-medium text-primary-foreground disabled:opacity-50"
            >
              Mint ${t.p}
            </button>
          </div>
        ))}
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
               method === "chooser" && openTier ? `Choose how to pay $${openTier}` :
               openTier ? `Pay $${openTier}` : ""}
            </DialogTitle>
            <DialogDescription>
              {status === "pending" && method === "chooser" && "All methods mint the same NFT — pick whichever is easiest for you."}
              {status === "pending" && method !== "chooser" && "Detection is automatic. Don't close this window."}
              {status === "paid" && "Your NFT has been minted. Redirecting…"}
              {status === "expired" && "No matching transaction found in time. If you already sent, contact support with your tx hash."}
            </DialogDescription>
          </DialogHeader>

          {status === "pending" && method === "chooser" && openTier !== null && (
            <div className="space-y-2">
              {METHOD_TILES.map((tile) => {
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
                      <div className="text-muted-foreground text-xs">Send exactly</div>
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
            <MetaMaskPay tier={openTier} />
          )}

          {status === "paid" && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
              <p className="font-medium">NFT minted successfully.</p>
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
