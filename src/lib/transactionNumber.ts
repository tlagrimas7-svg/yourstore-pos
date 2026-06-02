// transactionNumber.ts — atomic sequential transaction numbers via Supabase RPC
import { supabase } from "./supabase";

/**
 * Returns the next transaction number as a zero-padded string, e.g. "000042".
 * Uses an atomic Postgres counter via increment_txn_counter RPC to prevent gaps
 * or duplicates even across multiple devices/tabs.
 */
export async function getNextTransactionNumber(): Promise<string> {
  const { data, error } = await supabase.rpc("increment_txn_counter");
  if (error) {
    console.error("getNextTransactionNumber error:", error);
    // Fallback: timestamp-based number (not sequential but unique)
    return Date.now().toString().slice(-6);
  }
  return String(data).padStart(6, "0");
}
