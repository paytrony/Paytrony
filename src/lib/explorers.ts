// Chain -> explorer metadata. Shared by checkout components and admin tables.
export type EvmChain = "bsc" | "polygon" | "arbitrum" | "optimism" | "base" | "eth";

export const EVM_EXPLORERS: Record<EvmChain, { label: string; explorerName: string; tx: (h: string) => string }> = {
  bsc: { label: "BNB Smart Chain", explorerName: "BscScan", tx: (h) => `https://bscscan.com/tx/${h}` },
  polygon: { label: "Polygon", explorerName: "PolygonScan", tx: (h) => `https://polygonscan.com/tx/${h}` },
  arbitrum: { label: "Arbitrum One", explorerName: "Arbiscan", tx: (h) => `https://arbiscan.io/tx/${h}` },
  optimism: { label: "Optimism", explorerName: "Optimistic Etherscan", tx: (h) => `https://optimistic.etherscan.io/tx/${h}` },
  base: { label: "Base", explorerName: "BaseScan", tx: (h) => `https://basescan.org/tx/${h}` },
  eth: { label: "Ethereum", explorerName: "Etherscan", tx: (h) => `https://etherscan.io/tx/${h}` },
};

export function explorerTxUrl(method: string, chain: string | null | undefined, evmChain: string | null | undefined, hash: string | null | undefined): string | null {
  if (!hash) return null;
  if (method === "trc20") return `https://tronscan.org/#/transaction/${hash}`;
  if (method === "spl") return `https://solscan.io/tx/${hash}`;
  if (method === "evm") {
    const c = (evmChain ?? "") as EvmChain;
    return EVM_EXPLORERS[c]?.tx(hash) ?? null;
  }
  if (method === "stripe") return null;
  return null;
}

export function chainLabel(method: string, chain: string | null | undefined, evmChain: string | null | undefined): string {
  if (method === "trc20") return "Tron (USDT)";
  if (method === "spl") return "Solana (USDC)";
  if (method === "evm") return EVM_EXPLORERS[(evmChain ?? "") as EvmChain]?.label ?? (evmChain ?? "EVM");
  if (method === "stripe") return "Stripe";
  return chain ?? method;
}
