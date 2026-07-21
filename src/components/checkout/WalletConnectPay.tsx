import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  createEvmPaymentIntent,
  submitEvmTxHash,
  checkEvmPaymentIntent,
  getPublicPaymentConfig,
} from "@/lib/payments.functions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Smartphone, CheckCircle2, XCircle, ExternalLink, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Chain = "bsc" | "polygon" | "arbitrum" | "optimism" | "base" | "eth";
const CHAIN_META: Record<Chain, { label: string; explorerName: string; chainId: number; token: string; explorer: (h: string) => string; rpc: string }> = {
  bsc: { label: "BNB Smart Chain (cheap)", explorerName: "BscScan", chainId: 56, token: "USDT", explorer: (h) => `https://bscscan.com/tx/${h}`, rpc: "https://bsc-dataseed.binance.org" },
  polygon: { label: "Polygon (very cheap)", explorerName: "PolygonScan", chainId: 137, token: "USDT", explorer: (h) => `https://polygonscan.com/tx/${h}`, rpc: "https://polygon-rpc.com" },
  arbitrum: { label: "Arbitrum One (L2)", explorerName: "Arbiscan", chainId: 42161, token: "USDT", explorer: (h) => `https://arbiscan.io/tx/${h}`, rpc: "https://arb1.arbitrum.io/rpc" },
  optimism: { label: "Optimism (L2)", explorerName: "Optimistic Etherscan", chainId: 10, token: "USDT", explorer: (h) => `https://optimistic.etherscan.io/tx/${h}`, rpc: "https://mainnet.optimism.io" },
  base: { label: "Base (USDC)", explorerName: "BaseScan", chainId: 8453, token: "USDC", explorer: (h) => `https://basescan.org/tx/${h}`, rpc: "https://mainnet.base.org" },
  eth: { label: "Ethereum (high fees)", explorerName: "Etherscan", chainId: 1, token: "USDT", explorer: (h) => `https://etherscan.io/tx/${h}`, rpc: "https://ethereum-rpc.publicnode.com" },
};

function padHex(v: string, len = 64): string {
  return v.replace(/^0x/, "").toLowerCase().padStart(len, "0");
}
function encodeTransfer(to: string, amountRaw: bigint): string {
  return "0xa9059cbb" + padHex(to) + padHex(amountRaw.toString(16));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WCProvider = any;

type PersistShape = {
  v: 1;
  tier: 10 | 50 | 100;
  chain: Chain;
  intentId: string | null;
  txHash: string | null;
  account: string | null;
  amountRaw: string | null; // hex-safe string
  to: string | null;         // USDT contract
  savedAt: number;
};

const persistKey = (tier: number) => `wc-pay:v1:${tier}`;

function loadPersisted(tier: 10 | 50 | 100): PersistShape | null {
  try {
    const raw = localStorage.getItem(persistKey(tier));
    if (!raw) return null;
    const p = JSON.parse(raw) as PersistShape;
    // 45 min ceiling to avoid resurrecting truly dead intents
    if (Date.now() - p.savedAt > 45 * 60_000) {
      localStorage.removeItem(persistKey(tier));
      return null;
    }
    return p;
  } catch { return null; }
}
function savePersisted(tier: 10 | 50 | 100, patch: Partial<PersistShape>) {
  try {
    const prev = loadPersisted(tier) ?? { v: 1, tier, chain: "bsc" as Chain, intentId: null, txHash: null, account: null, amountRaw: null, to: null, savedAt: Date.now() };
    const next: PersistShape = { ...prev, ...patch, v: 1, tier, savedAt: Date.now() };
    localStorage.setItem(persistKey(tier), JSON.stringify(next));
  } catch { /* ignore */ }
}
function clearPersisted(tier: 10 | 50 | 100) {
  try { localStorage.removeItem(persistKey(tier)); } catch { /* ignore */ }
}

export function WalletConnectPay({ tier, quantity = 1 }: { tier: 10 | 50 | 100; quantity?: number }) {
  const navigate = useNavigate();
  const cfgFn = useServerFn(getPublicPaymentConfig);
  const { data: cfg } = useQuery({ queryKey: ["payment-config"], queryFn: () => cfgFn(), staleTime: 60_000 });
  const projectId = cfg?.walletConnectProjectId ?? null;

  const createIntent = useServerFn(createEvmPaymentIntent);
  const submitHash = useServerFn(submitEvmTxHash);
  const checkIntent = useServerFn(checkEvmPaymentIntent);

  const [chain, setChain] = useState<Chain>("bsc");
  const [account, setAccount] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [pendingSign, setPendingSign] = useState<{ to: string; amountRaw: string } | null>(null);
  const [resumed, setResumed] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "creating" | "switching" | "signing" | "watching" | "paid" | "failed" | "expired">("idle");
  const [error, setError] = useState<string | null>(null);
  const providerRef = useRef<WCProvider | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (providerRef.current) {
      try { providerRef.current.disconnect?.(); } catch { /* ignore */ }
    }
  }, []);

  // Restore persisted state on mount
  useEffect(() => {
    const p = loadPersisted(tier);
    if (!p || !p.intentId) return;
    setChain(p.chain);
    setIntentId(p.intentId);
    if (p.account) setAccount(p.account);
    if (p.txHash) {
      setTxHash(p.txHash);
      setStatus("watching");
      startPolling(p.intentId);
    } else if (p.to && p.amountRaw) {
      // Signing was interrupted before a hash was returned
      setPendingSign({ to: p.to, amountRaw: p.amountRaw });
    }
    setResumed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier]);

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const r = await checkIntent({ data: { id } });
        if (r.status === "paid") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("paid");
          clearPersisted(tier);
          toast.success("Payment confirmed! NFT minted.");
          setTimeout(() => navigate({ to: "/nfts" }), 1600);
        } else if (r.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("failed");
          setError((r as { error?: string }).error ?? "Transaction failed on-chain.");
        } else if (r.status === "expired") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("expired");
          clearPersisted(tier);
        }
      } catch { /* retry */ }
    };
    tick();
    pollRef.current = setInterval(tick, 5000);
  }

  async function getProvider(): Promise<WCProvider> {
    if (providerRef.current) return providerRef.current;
    if (!projectId) throw new Error("WalletConnect is not configured");
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    const chainIds = (Object.values(CHAIN_META).map((m) => m.chainId));
    const rpcMap: Record<number, string> = {};
    for (const m of Object.values(CHAIN_META)) rpcMap[m.chainId] = m.rpc;
    const provider = await EthereumProvider.init({
      projectId,
      chains: [CHAIN_META[chain].chainId],
      optionalChains: chainIds as [number, ...number[]],
      rpcMap,
      showQrModal: true,
      metadata: {
        name: "PayTrony",
        description: "Mint NFT packages",
        url: typeof window !== "undefined" ? window.location.origin : "https://paytrony.app",
        icons: [],
      },
    });
    provider.on("accountsChanged", (accs: string[]) => {
      setAccount(accs[0] ?? null);
      savePersisted(tier, { account: accs[0] ?? null });
    });
    provider.on("disconnect", () => { setAccount(null); providerRef.current = null; });
    providerRef.current = provider;
    return provider;
  }

  function friendlyError(e: unknown, phase: "connect" | "switch" | "sign" | "submit" | "other"): string {
    const code = (e as { code?: number }).code;
    const raw = (e as { message?: string }).message ?? "";
    if (code === 4001 || /reject/i.test(raw)) {
      return phase === "sign" ? "You rejected the transaction in your wallet." : "You cancelled the wallet request.";
    }
    if (code === -32002) return "Your wallet already has a pending request — open it to approve or dismiss it.";
    if (code === 4100 || /unauthorized/i.test(raw)) return "This wallet doesn't allow this action. Try another wallet.";
    if (code === 4200 || /unsupported/i.test(raw)) return "This wallet doesn't support that chain. Switch chain manually or try another wallet.";
    if (code === 4902) return "That chain isn't added to your wallet. Add it manually and try again.";
    if (/insufficient funds/i.test(raw)) return "Not enough native token for gas. Top up and try again.";
    if (/expired|proposal|timeout/i.test(raw)) return "The QR session expired. Reconnect and try again.";
    if (/no matching key|session/i.test(raw)) return "Wallet session lost. Please reconnect.";
    if (phase === "switch") return "Couldn't switch network in your wallet. Switch to the requested chain manually and retry.";
    return raw || "Something went wrong. Please try again.";
  }

  async function connect() {
    setError(null);
    setStatus("connecting");
    try {
      const provider = await getProvider();
      if (!provider.connected) {
        await provider.connect();
      }
      const accs = (await provider.request({ method: "eth_accounts" })) as string[];
      if (!accs[0]) throw new Error("No account returned from wallet");
      setAccount(accs[0]);
      savePersisted(tier, { account: accs[0], chain });
      setStatus("idle");
    } catch (e) {
      setStatus("idle");
      setError(friendlyError(e, "connect"));
    }
  }

  async function signAndBroadcast(provider: WCProvider, ix: { id: string; chainIdHex: string; to: string; usdt: string; expectedAmount: number; usdtDecimals: number }, fromAccount: string) {
    setStatus("switching");
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ix.chainIdHex }] });
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 4902) {
        throw new Error(`Add ${CHAIN_META[chain].label} to your wallet, then try again.`);
      }
      throw e;
    }

    setStatus("signing");
    const amountRaw = BigInt(Math.round(ix.expectedAmount * 10 ** ix.usdtDecimals));
    const dataHex = encodeTransfer(ix.to, amountRaw);
    savePersisted(tier, { intentId: ix.id, chain, account: fromAccount, to: ix.usdt, amountRaw: amountRaw.toString() });

    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: fromAccount, to: ix.usdt, data: dataHex, value: "0x0" }],
    })) as string;

    setTxHash(hash);
    savePersisted(tier, { txHash: hash });
    try {
      await submitHash({ data: { id: ix.id, txHash: hash, fromAddress: fromAccount } });
    } catch (e) {
      console.warn("submitHash failed, will still poll:", e);
    }
    setStatus("watching");
    startPolling(ix.id);
  }

  async function pay() {
    if (!account) return;
    setError(null);
    setStatus("creating");
    let ix: Awaited<ReturnType<typeof createIntent>> | null = null;
    try {
      const provider = await getProvider();
      ix = await createIntent({ data: { tier, chain, quantity } });
      setIntentId(ix.id);
      savePersisted(tier, { intentId: ix.id, chain, account });
      await signAndBroadcast(provider, ix, account);
    } catch (e) {
      const phase = !ix ? "other" : status === "switching" ? "switch" : status === "signing" ? "sign" : "submit";
      setStatus("failed");
      setError(friendlyError(e, phase));
    }
  }

  async function retrySign() {
    // Re-broadcast for the existing intent (used after page refresh mid-sign)
    if (!intentId || !account) return;
    setError(null);
    try {
      const provider = await getProvider();
      // Re-fetch intent details minimally via a fresh createIntent is wrong (would create new).
      // Instead poll first — if server already saw the tx, polling will finish it.
      // Otherwise, we don't have full ix data client-side except the persisted pendingSign hint.
      if (pendingSign) {
        setStatus("signing");
        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: account, to: pendingSign.to, data: encodeTransfer(pendingSign.to, BigInt(pendingSign.amountRaw)), value: "0x0" }],
        })) as string;
        setTxHash(hash);
        savePersisted(tier, { txHash: hash });
        try { await submitHash({ data: { id: intentId, txHash: hash, fromAddress: account } }); } catch { /* ignore */ }
        setStatus("watching");
        startPolling(intentId);
      } else {
        setStatus("watching");
        startPolling(intentId);
      }
    } catch (e) {
      setStatus("failed");
      setError(friendlyError(e, "sign"));
    }
  }

  async function disconnect() {
    try { await providerRef.current?.disconnect?.(); } catch { /* ignore */ }
    providerRef.current = null;
    setAccount(null);
    setStatus("idle");
    setError(null);
    setTxHash(null);
    setIntentId(null);
    setPendingSign(null);
    clearPersisted(tier);
  }

  if (!projectId) {
    return (
      <div className="space-y-3 text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
        <p className="font-medium">WalletConnect not configured</p>
        <p className="text-sm text-muted-foreground">Site owner: set WALLETCONNECT_PROJECT_ID.</p>
      </div>
    );
  }

  const explorer = CHAIN_META[chain];
  const explorerLink = txHash ? (
    <a href={explorer.explorer(txHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
      View on {explorer.explorerName} <ExternalLink className="h-3 w-3" />
    </a>
  ) : null;

  return (
    <div className="space-y-4">
      {resumed && status !== "paid" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          Resumed a previous payment session for this tier.
        </div>
      )}

      <div>
        <label className="text-xs uppercase text-muted-foreground">Network</label>
        <Select value={chain} onValueChange={(v) => { setChain(v as Chain); savePersisted(tier, { chain: v as Chain }); }} disabled={status !== "idle" && status !== "connecting"}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(CHAIN_META) as Chain[]).map((c) => (
              <SelectItem key={c} value={c}>{CHAIN_META[c].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">Scan the QR with Trust, Rainbow, MetaMask Mobile, or any WalletConnect-compatible wallet.</p>
      </div>

      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Amount{quantity > 1 ? ` (${quantity} × $${tier})` : ""}</span>
          <span className="font-mono font-bold">${(tier * quantity).toFixed(2)} {explorer.token}</span>
        </div>

        <div className="mt-1 flex items-center justify-between">
          <span className="text-muted-foreground">Wallet</span>
          <span className="font-mono text-xs">{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Not connected"}</span>
        </div>
      </div>

      {(txHash || status === "signing" || status === "watching" || status === "paid" || status === "failed") && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="wc-tx-panel">
          <div className="mb-2 font-mono text-[10px] uppercase text-muted-foreground">Transaction · {explorer.explorerName}</div>
          <ol className="space-y-1.5">
            {[
              { key: "signing", label: "Signed in wallet", done: !!txHash || status === "watching" || status === "paid" },
              { key: "watching", label: "Broadcast · pending on-chain", done: status === "watching" || status === "paid", failed: status === "failed" && !!txHash },
              { key: "paid", label: "Confirmed & credited", done: status === "paid", failed: status === "failed" },
            ].map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-xs">
                {s.failed ? <XCircle className="h-3.5 w-3.5 text-destructive" /> :
                 s.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> :
                 <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                <span className={s.done ? "text-foreground" : s.failed ? "text-destructive" : "text-muted-foreground"}>{s.label}</span>
              </li>
            ))}
          </ol>
          {explorerLink && <div className="mt-2">{explorerLink}</div>}
        </div>
      )}

      {pendingSign && status !== "signing" && status !== "watching" && status !== "paid" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="mb-2">A previous signing request was interrupted. You can retry with the same intent.</p>
          <Button size="sm" onClick={retrySign} disabled={!account}>Retry signing</Button>
        </div>
      )}

      {!account ? (
        <Button onClick={connect} className="w-full" disabled={status === "connecting"}>
          {status === "connecting" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Smartphone className="mr-2 h-4 w-4" />}
          Connect wallet
        </Button>
      ) : status === "paid" ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <p className="font-medium">Payment confirmed. Redirecting…</p>
          {explorerLink}
        </div>
      ) : status === "failed" || status === "expired" ? (
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <XCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm">{status === "expired" ? "Payment window expired" : error ?? "Payment failed"}</p>
          {explorerLink}
          <Button variant="outline" onClick={() => { setStatus("idle"); setTxHash(null); setError(null); setIntentId(null); setPendingSign(null); clearPersisted(tier); }}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <Button onClick={pay} className="w-full" disabled={status !== "idle" || !!pendingSign}>
            {status === "idle" && `Pay $${(tier * quantity).toFixed(2)} ${explorer.token}${quantity > 1 ? ` (mint ${quantity})` : ""}`}
            {status === "creating" && (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing…</>)}
            {status === "switching" && (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Switching network…</>)}
            {status === "signing" && (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirm in your wallet…</>)}
            {status === "watching" && (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Waiting for confirmation…</>)}
          </Button>
          <button onClick={disconnect} className="mx-auto block text-xs text-muted-foreground underline">Disconnect</button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
    </div>
  );
}
