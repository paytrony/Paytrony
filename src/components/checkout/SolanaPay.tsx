import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import QRCode from "qrcode";
import { createSplPaymentIntent, checkSplPaymentIntent } from "@/lib/payments.functions";
import { Button } from "@/components/ui/button";
import { Copy, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

type Intent = {
  id: string;
  address: string;
  mint: string;
  tokenSymbol: string;
  tier: number;
  expectedAmount: number;
  expiresAt: string;
};

export function SolanaPay({ tier, quantity = 1 }: { tier: 10 | 50 | 100; quantity?: number }) {
  const navigate = useNavigate();
  const createIntent = useServerFn(createSplPaymentIntent);
  const checkIntent = useServerFn(checkSplPaymentIntent);

  const [intent, setIntent] = useState<Intent | null>(null);
  const [qr, setQr] = useState<string>("");
  const [status, setStatus] = useState<"loading" | "pending" | "paid" | "expired" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ix = await createIntent({ data: { tier, quantity } });
        if (cancelled) return;
        setIntent(ix);
        setStatus("pending");
        const uri = `solana:${ix.address}?amount=${ix.expectedAmount}&spl-token=${ix.mint}&label=PayTrony&message=NFT%20Tier%20${tier}%20x${quantity}`;
        const url = await QRCode.toDataURL(uri, { width: 320, margin: 1 });
        if (!cancelled) setQr(url);
      } catch (e) {
        if (!cancelled) {
          setStatus("failed");
          setError(e instanceof Error ? e.message : "Could not start Solana payment");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [tier, quantity, createIntent]);


  useEffect(() => {
    if (!intent || status !== "pending") return;
    const tick = async () => {
      try {
        const r = await checkIntent({ data: { id: intent.id } });
        if (r.status === "paid") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("paid");
          toast.success("Payment received! NFT minted.", {
            description: "The mining walkthrough will open on the home page once ownership is confirmed.",
          });

          setTimeout(() => navigate({ to: "/nfts" }), 1600);
        } else if (r.status === "expired") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("expired");
        }
      } catch { /* retry */ }
    };
    tick();
    pollRef.current = setInterval(tick, 6000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [intent, status, checkIntent, navigate]);

  useEffect(() => {
    if (!intent) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [intent]);

  function copy(t: string, l: string) { navigator.clipboard.writeText(t); toast.success(`${l} copied`); }

  if (status === "loading" || !intent) {
    return <div className="flex h-[400px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }
  if (status === "paid") {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-emerald-500" />
        <p className="font-medium">Payment received. Redirecting…</p>
      </div>
    );
  }
  if (status === "expired" || status === "failed") {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <XCircle className="h-12 w-12 text-destructive" />
        <p className="text-sm">{status === "expired" ? "Payment window expired" : (error ?? "Payment failed")}</p>
      </div>
    );
  }

  const remainingMs = Math.max(0, new Date(intent.expiresAt).getTime() - now);
  const mm = String(Math.floor(remainingMs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, "0");

  return (
    <div className="space-y-4">
      <div className="mx-auto flex h-[280px] w-[280px] items-center justify-center rounded-lg bg-white p-2">
        {qr ? <img src={qr} alt="Solana Pay QR" className="h-full w-full" /> : <Loader2 className="animate-spin" />}
      </div>
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-muted-foreground text-xs">Send exactly</div>
            <div className="font-mono text-lg font-bold">{intent.expectedAmount} {intent.tokenSymbol}</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => copy(String(intent.expectedAmount), "Amount")}>
            <Copy className="mr-1 h-3 w-3" /> Copy
          </Button>
        </div>
        <div className="mt-3">
          <div className="text-muted-foreground text-xs">To address (Solana)</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">{intent.address}</code>
            <Button size="sm" variant="outline" onClick={() => copy(intent.address, "Address")}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div className="mt-3 text-xs text-muted-foreground">Network: Solana · Token: USDC (SPL)</div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1 text-muted-foreground"><Clock className="h-4 w-4" /> Expires in {mm}:{ss}</span>
        <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Watching chain…</span>
      </div>
      <p className="text-xs text-muted-foreground">Scan with Phantom, Solflare, Backpack, or any Solana Pay wallet. Send the <b>exact</b> amount for auto-detection.</p>
    </div>
  );
}
