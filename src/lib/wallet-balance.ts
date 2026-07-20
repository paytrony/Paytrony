// Client-side helper for the canonical `get_wallet_balance` RPC.
// Every page that shows a balance (dashboard / wallet / withdraw / mining)
// funnels through this — no more per-page ad-hoc reductions over truncated
// wallet_transactions lists.

import { supabase } from "@/integrations/supabase/client";

export type WalletBalance = {
  balance: number;
  available: number;
  pending: number;
  referral_credits: number;
  withdrawals: number;
  mining_earned: number;
  mining_transferred: number;
  mining_available: number;
};

const ZERO: WalletBalance = {
  balance: 0,
  available: 0,
  pending: 0,
  referral_credits: 0,
  withdrawals: 0,
  mining_earned: 0,
  mining_transferred: 0,
  mining_available: 0,
};

export async function fetchWalletBalance(): Promise<WalletBalance> {
  const { data, error } = await supabase.rpc("get_wallet_balance");
  if (error) throw error;
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    balance: Number(d.balance ?? 0),
    available: Number(d.available ?? 0),
    pending: Number(d.pending ?? 0),
    referral_credits: Number(d.referral_credits ?? 0),
    withdrawals: Number(d.withdrawals ?? 0),
    mining_earned: Number(d.mining_earned ?? 0),
    mining_transferred: Number(d.mining_transferred ?? 0),
    mining_available: Number(d.mining_available ?? 0),
  };
}

export const EMPTY_WALLET_BALANCE = ZERO;
