import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { createEvmPaymentIntent, submitEvmTxHash, checkEvmPaymentIntent } from "@/lib/payments.functions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Wallet, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Chain = "bsc" | "polygon" | "arbitrum" | "optimism" | "base" | "eth";
const CHAIN_META: Record<Chain, { label: string; native: string; explorer: (h: string) => string; token: string }> = {
  bsc: { label: "BNB Smart Chain (cheap fees)", native: "BNB", token: "USDT", explorer: (h) => `https://bscscan.com/tx/${h}` },
  polygon: { label: "Polygon (very cheap)", native: "POL", token: "USDT", explorer: (h) => `https://polygonscan.com/tx/${h}` },
  arbitrum: { label: "Arbitrum One (cheap L2)", native: "ETH", token: "USDT", explorer: (h) => `https://arbiscan.io/tx/${h}` },
  optimism: { label: "Optimism (cheap L2)", native: "ETH", token: "USDT", explorer: (h) => `https://optimistic.etherscan.io/tx/${h}` },
  base: { label: "Base (USDC, very cheap)", native: "ETH", token: "USDC", explorer: (h) => `https://basescan.org/tx/${h}` },
  eth: { label: "Ethereum (highest fees)", native: "ETH", token: "USDT", explorer: (h) => `https://etherscan.io/tx/${h}` },
};

type Intent = {
  id: string;
  to: string;
  chain: Chain;
  chainIdHex: string;
  chainName: string;
  usdt: string;
  usdtDecimals: number;
  tier: number;
  expectedAmount: number;
  expiresAt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { ethereum?: any } }

function padHex(v: string, len = 64): string {
  return v.replace(/^0x/, "").toLowerCase().padStart(len, "0");
}
function encodeTransfer(to: string, amountRaw: bigint): string {
  return "0xa9059cbb" + padHex(to) + padHex(amountRaw.toString(16));
}

export function MetaMaskPay({ tier }: { tier: 10 | 50 | 100 }) {
  const navigate = useNavigate();
  const createIntent = useServerFn(createEvmPaymentIntent);
  const submitHash = useServerFn(submitEvmTxHash);
  const checkIntent = useServerFn(checkEvmPaymentIntent);

  const [chain, setChain] = useState<Chain>("bsc");
  const [account, setAccount] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "creating" | "switching" | "signing" | "watching" | "paid" | "failed" | "expired">("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasWallet = typeof window !== "undefined" && !!window.ethereum;

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function connect() {
    if (!hasWallet) {
      window.open("https://metamask.io/download/", "_blank");
      return;
    }
    setError(null);
    setStatus("connecting");
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      setAccount(accounts[0] ?? null);
      setStatus("idle");
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : "Wallet connection rejected");
    }
  }

  async function ensureChain(chainIdHex: string, chainKey: Chain) {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 4902) {
        const add = {
          bsc: { chainId: "0x38", chainName: "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: ["https://bsc-dataseed.binance.org"], blockExplorerUrls: ["https://bscscan.com"] },
          polygon: { chainId: "0x89", chainName: "Polygon", nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: ["https://polygon-rpc.com"], blockExplorerUrls: ["https://polygonscan.com"] },
          eth: { chainId: "0x1", chainName: "Ethereum", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://ethereum-rpc.publicnode.com"], blockExplorerUrls: ["https://etherscan.io"] },
        }[chainKey];
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [add] });
      } else {
        throw err;
      }
    }
  }

  async function pay() {
    if (!account) return;
    setError(null);
    setStatus("creating");
    try {
      const ix = await createIntent({ data: { tier, chain } });
      setIntent(ix);

      setStatus("switching");
      await ensureChain(ix.chainIdHex, chain);

      setStatus("signing");
      const amountRaw = BigInt(Math.round(ix.expectedAmount * 10 ** ix.usdtDecimals));
      const dataHex = encodeTransfer(ix.to, amountRaw);
      const hash = (await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: ix.usdt, data: dataHex, value: "0x0" }],
      })) as string;

      setTxHash(hash);
      await submitHash({ data: { id: ix.id, txHash: hash, fromAddress: account } });

      setStatus("watching");
      const tick = async () => {
        try {
          const r = await checkIntent({ data: { id: ix.id } });
          if (r.status === "paid") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStatus("paid");
            toast.success("Payment confirmed! NFT minted.");
            setTimeout(() => navigate({ to: "/nfts" }), 1600);
          } else if (r.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStatus("failed");
            setError((r as { error?: string }).error ?? "Transaction failed on-chain");
          } else if (r.status === "expired") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStatus("expired");
          }
        } catch { /* retry next tick */ }
      };
      tick();
      pollRef.current = setInterval(tick, 5000);
    } catch (e) {
      setStatus("failed");
      setError(e instanceof Error ? e.message : "Payment failed");
    }
  }

  if (!hasWallet) {
    return (
      <div className="space-y-4 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
        <div>
          <p className="font-medium">MetaMask not detected</p>
          <p className="text-sm text-muted-foreground">Install MetaMask to pay with USDT on BSC, Polygon or Ethereum.</p>
        </div>
        <Button onClick={() => window.open("https://metamask.io/download/", "_blank")}>Install MetaMask</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs uppercase text-muted-foreground">Network</label>
        <Select value={chain} onValueChange={(v) => setChain(v as Chain)} disabled={status !== "idle" && status !== "connecting"}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(CHAIN_META) as Chain[]).map((c) => (
              <SelectItem key={c} value={c}>{CHAIN_META[c].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          You'll need a small amount of {CHAIN_META[chain].native} for gas.
        </p>
      </div>

      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Amount</span>
          <span className="font-mono font-bold">${tier}.00 USDT</span>
        </div>
        {intent && (
          <div className="mt-1 flex items-center justify-between">
            <span className="text-muted-foreground">Exact amount to send</span>
            <span className="font-mono font-bold">{intent.expectedAmount} USDT</span>
          </div>
        )}
        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground">Wallet</span>
          <span className="font-mono text-xs">{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Not connected"}</span>
        </div>
      </div>

      {!account ? (
        <Button onClick={connect} className="w-full" disabled={status === "connecting"}>
          {status === "connecting" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
          Connect MetaMask
        </Button>
      ) : status === "paid" ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <p className="font-medium">Payment confirmed. Redirecting…</p>
          {txHash && (
            <a href={CHAIN_META[chain].explorer(txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
              View on explorer <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      ) : status === "failed" || status === "expired" ? (
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <XCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm">{status === "expired" ? "Payment window expired" : error ?? "Payment failed"}</p>
          {txHash && (
            <a href={CHAIN_META[chain].explorer(txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
              View on explorer <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <Button variant="outline" onClick={() => { setStatus("idle"); setIntent(null); setTxHash(null); setError(null); }}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <Button onClick={pay} className="w-full" disabled={status !== "idle"}>
            {status === "idle" && `Pay $${tier} USDT with MetaMask`}
            {status === "creating" && (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing…</>)}
            {status === "switching" && (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Switching network…</>)}
            {status === "signing" && (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirm in MetaMask…</>)}
            {status === "watching" && (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Waiting for confirmation…</>)}
          </Button>
          {txHash && status === "watching" && (
            <a href={CHAIN_META[chain].explorer(txHash)} target="_blank" rel="noreferrer" className="mx-auto flex items-center justify-center gap-1 text-xs text-primary underline">
              View transaction <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
