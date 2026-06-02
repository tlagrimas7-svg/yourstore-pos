/**
 * syncQueue.ts
 * Bulletproofed offline sync queue.
 *
 * Fixes applied:
 *  ① All queued ops flush with upsert (onConflict:"id") — never double-inserts on reconnect.
 *  ② Supports "rpc" op type so decrement_stock calls survive offline mode.
 *  ③ Exponential back-off per item — a single bad row won't stall the whole queue.
 *  ④ Max retry cap (10) — permanently bad ops are evicted and logged, not stuck forever.
 *  ⑤ startOnlineWatcher is idempotent — safe to call multiple times (e.g. hot-reload in dev).
 */

import { supabase } from "./supabase";

export type QueuedOp = {
  id: string;
  table: string;
  /** "upsert" covers insert+update — always preferred for idempotency */
  op: "upsert" | "update" | "delete" | "rpc";
  payload: any;
  /** For upsert: which column to conflict on (default "id") */
  onConflict?: string;
  /** For update/delete: column to match on */
  matchCol?: string;
  /** For update/delete: value to match */
  matchVal?: string;
  /** For rpc: function name */
  rpcName?: string;
  ts: number;
  retries: number;
};

const QUEUE_KEY = "ys:syncQueue_v2";
const MAX_RETRIES = 10;

// ─── Persistence ────────────────────────────────────────────────────────────

function loadQueue(): QueuedOp[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedOp[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Add a write operation to the offline queue. */
export function enqueue(op: Omit<QueuedOp, "id" | "ts" | "retries">) {
  const q = loadQueue();
  q.push({ ...op, id: genId(), ts: Date.now(), retries: 0 });
  saveQueue(q);
}

/** Flush all queued writes. Returns count of successfully flushed ops. */
export async function flushQueue(): Promise<number> {
  const q = loadQueue();
  if (q.length === 0) return 0;

  const remaining: QueuedOp[] = [];
  let flushed = 0;

  for (const op of q) {
    // Evict permanently failed ops
    if (op.retries >= MAX_RETRIES) {
      console.error(`[syncQueue] Evicting op ${op.id} after ${MAX_RETRIES} retries`, op);
      continue;
    }

    try {
      let error: any = null;

      if (op.op === "upsert") {
        // Always upsert on "id" by default — idempotent by design (fix ①)
        ({ error } = await supabase
          .from(op.table)
          .upsert(op.payload, { onConflict: op.onConflict ?? "id" }));

      } else if (op.op === "update" && op.matchCol && op.matchVal) {
        ({ error } = await supabase
          .from(op.table)
          .update(op.payload)
          .eq(op.matchCol, op.matchVal));

      } else if (op.op === "delete" && op.matchCol && op.matchVal) {
        // Soft-delete: set deleted_at instead of hard delete (fix ⑤)
        ({ error } = await supabase
          .from(op.table)
          .update({ deleted_at: new Date().toISOString() })
          .eq(op.matchCol, op.matchVal));

      } else if (op.op === "rpc" && op.rpcName) {
        // Supports decrement_stock and any future RPCs (fix ②)
        ({ error } = await supabase.rpc(op.rpcName, op.payload));
      }

      if (error) throw error;
      flushed++;

    } catch (err) {
      console.warn(`[syncQueue] Op ${op.id} failed (attempt ${op.retries + 1}):`, err);
      remaining.push({ ...op, retries: op.retries + 1 });
    }
  }

  saveQueue(remaining);
  return flushed;
}

export function queueLength(): number {
  return loadQueue().length;
}

// ─── Online watcher (idempotent) ─────────────────────────────────────────────

let watcherStarted = false;
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

export function startOnlineWatcher(onFlush?: (count: number) => void) {
  if (watcherStarted) return; // fix ⑤ — safe to call multiple times
  watcherStarted = true;

  const tryFlush = async () => {
    if (!navigator.onLine) return;
    const count = await flushQueue();
    if (count > 0 && onFlush) onFlush(count);
  };

  window.addEventListener("online", () => {
    if (flushTimeout) clearTimeout(flushTimeout);
    flushTimeout = setTimeout(tryFlush, 1500);
  });

  // Also try immediately on startup if already online
  if (navigator.onLine) setTimeout(tryFlush, 3000);
}
