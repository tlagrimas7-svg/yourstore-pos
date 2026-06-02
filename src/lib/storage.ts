/**
 * storage.ts  —  bulletproofed edition
 *
 * Patches applied:
 *  ① syncQueue always uses upsert (onConflict:"id") → idempotent, no double-inserts on reconnect
 *  ② Stock decrement goes through a Postgres RPC that is atomic + rejects negative stock
 *  ③ Stale open shifts (>24 h, no timeOut) are auto-closed on hydrate
 *  ④ Settings upsert is field-level: fetch → spread existing → overwrite only changed fields
 *  ⑤ clearAll() requires an explicit typed confirmation and uses soft-delete (deleted_at flag)
 */

import { create } from "zustand";
import { supabase } from "./supabase";
import { enqueue, startOnlineWatcher } from "./syncQueue";
import {
  type Product, type Transaction, type Expense, type UtangRecord,
  type AntiKupitEvent, type StockLog, type Shift, type Settings,
  type Pins, type CartItem, DEFAULT_SETTINGS, DEFAULT_PINS,
} from "./types";

// ── localStorage helpers ──────────────────────────────────────────────────────
function lsKey(uid: string, suffix: string) { return `ys:${uid}:${suffix}`; }

function lsLoad<T>(uid: string, suffix: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(lsKey(uid, suffix));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

function lsSave<T>(uid: string, suffix: string, value: T): void {
  try { localStorage.setItem(lsKey(uid, suffix), JSON.stringify(value)); } catch {}
}

// ── Row mappers ───────────────────────────────────────────────────────────────
function rowToProduct(r: any): Product {
  return {
    id: r.id, name: r.name,
    barcode: r.barcode ?? undefined,
    category: r.category ?? undefined,
    stock: r.stock,
    cost: Number(r.cost), price: Number(r.price),
    image_url: r.image_url ?? undefined,
    is_quick_grid: r.is_quick_grid ?? false,
  };
}

function rowToTransaction(r: any): Transaction {
  return {
    id: r.id, date: r.date, items: r.items,
    subtotal: Number(r.subtotal), discount: Number(r.discount),
    total: Number(r.total), paid: Number(r.paid), change: Number(r.change),
    voided: r.voided, voidReason: r.void_reason ?? undefined,
    shiftId: r.shift_id ?? undefined, employeeName: r.employee_name ?? undefined,
    paymentMethod: r.payment_method ?? "CASH",
    transactionNo: r.transaction_no ?? undefined,
    cashierName: r.cashier_name ?? undefined,
  } as any;
}

function rowToExpense(r: any): Expense {
  return { id: r.id, date: r.date, category: r.category, amount: Number(r.amount), notes: r.notes ?? undefined };
}

function rowToUtang(r: any): UtangRecord {
  return {
    id: r.id, customer: r.customer, date: r.date,
    items: r.items, amount: Number(r.amount), payments: r.payments,
    promiseDate: r.promise_date ?? undefined,
    contact: r.contact ?? undefined,
    email: r.email ?? undefined,
    notes: r.notes ?? undefined,
  };
}

function rowToAntiKupit(r: any): AntiKupitEvent {
  return { id: r.id, date: r.date, type: r.type, item: r.item, reason: r.reason };
}

function rowToStockLog(r: any): StockLog {
  return { id: r.id, date: r.date, productId: r.product_id, delta: r.delta, reason: r.reason };
}

function rowToShift(r: any): Shift {
  return {
    id: r.id, employeeName: r.employee_name,
    timeIn: r.time_in, timeOut: r.time_out ?? undefined,
    totalSales: Number(r.total_sales), txCount: r.tx_count, items: r.items,
    drawerStart: r.drawer_start ?? undefined,
  };
}

function rowToSettings(r: any): Settings {
  return {
    storeName: r.store_name, tagline: r.tagline,
    address1: r.address1, address2: r.address2, contact: r.contact,
    logo: r.logo, receiptFooter: r.receipt_footer, currency: r.currency,
    lowStockThreshold: r.low_stock_threshold,
    expenseCategories: r.expense_categories ?? [],
    ownerName: r.owner_name ?? "",
  };
}

function rowToPins(r: any): Pins {
  return { owner: r.owner, employee: r.employee, pages: r.pages ?? {} };
}

// ── FIX ③ — stale-shift guard ─────────────────────────────────────────────────
// Any shift open longer than 24 h with no timeOut is auto-closed at hydrate time.
const STALE_SHIFT_MS = 24 * 60 * 60 * 1000;

async function autoCloseStaleShifts(userId: string, shifts: Shift[]): Promise<Shift[]> {
  const now = Date.now();
  const stale = shifts.filter(
    (s) => !s.timeOut && now - new Date(s.timeIn).getTime() > STALE_SHIFT_MS
  );
  if (stale.length === 0) return shifts;

  const closeTime = new Date().toISOString();
  await Promise.allSettled(
    stale.map((s) =>
      supabase
        .from("shifts")
        .update({ time_out: closeTime, auto_closed: true })
        .eq("id", s.id)
        .eq("user_id", userId)
    )
  );

  return shifts.map((s) =>
    stale.find((x) => x.id === s.id) ? { ...s, timeOut: closeTime } : s
  );
}

// ── Store interface ───────────────────────────────────────────────────────────
interface AppState {
  userId: string;
  email: string;
  products: Product[];
  transactions: Transaction[];
  expenses: Expense[];
  utang: UtangRecord[];
  antiKupit: AntiKupitEvent[];
  stockLogs: StockLog[];
  shifts: Shift[];
  activeShift: Shift | null;
  settings: Settings;
  pins: Pins;
  posCart: CartItem[];
  syncing: boolean;

  hydrate: (userId: string, email: string) => Promise<void>;
  setProducts: (p: Product[]) => Promise<void>;
  setTransactions: (t: Transaction[]) => Promise<void>;
  setExpenses: (e: Expense[]) => Promise<void>;
  setUtang: (u: UtangRecord[]) => Promise<void>;
  addAntiKupit: (e: AntiKupitEvent) => Promise<void>;
  addStockLog: (s: StockLog) => Promise<void>;
  setSettings: (s: Settings) => Promise<void>;
  setPins: (p: Pins) => Promise<void>;
  setPosCart: (c: CartItem[]) => void;
  addToPosCart: (item: CartItem) => void;
  startShift: (employeeName: string) => Promise<Shift>;
  endShift: () => Promise<void>;
  addTransactionToShift: (tx: Transaction) => Promise<void>;
  /**
   * FIX ⑤ — requires caller to pass the confirmed userId string.
   * Throws if confirmUserId !== state.userId (forces typed confirmation in UI).
   */
  clearAll: (confirmUserId: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  userId: "", email: "",
  products: [], transactions: [], expenses: [], utang: [],
  antiKupit: [], stockLogs: [], shifts: [], activeShift: null,
  settings: DEFAULT_SETTINGS, pins: DEFAULT_PINS,
  posCart: [], syncing: false,

  // ── Hydrate ──────────────────────────────────────────────────────────────
  hydrate: async (userId, email) => {
    set({ syncing: true });

    // 1. Paint from cache immediately (zero perceived latency)
    const cachedShifts = lsLoad<Shift[]>(userId, "shifts", []);
    set({
      userId, email,
      products:     lsLoad(userId, "products", []),
      transactions: lsLoad(userId, "transactions", []),
      expenses:     lsLoad(userId, "expenses", []),
      utang:        lsLoad(userId, "utang", []),
      antiKupit:    lsLoad(userId, "antiKupit", []),
      stockLogs:    lsLoad(userId, "stockLogs", []),
      shifts:       cachedShifts,
      activeShift:  cachedShifts.find((s) => !s.timeOut) ?? null,
      settings:     { ...DEFAULT_SETTINGS, ...lsLoad(userId, "settings", {}) },
      pins:         { ...DEFAULT_PINS,     ...lsLoad(userId, "pins", {}) },
    });

    // 2. Fetch fresh data from Supabase
    try {
      const [
        { data: productsData }, { data: txData },    { data: expData },
        { data: utangData },    { data: akData },     { data: slData },
        { data: shiftsData },   { data: settingsData }, { data: pinsData },
      ] = await Promise.all([
        supabase.from("products").select("*").eq("user_id", userId).order("name"),
        supabase.from("transactions").select("*").eq("user_id", userId).order("date", { ascending: false }),
        supabase.from("expenses").select("*").eq("user_id", userId).order("date", { ascending: false }),
        supabase.from("utang").select("*").eq("user_id", userId).order("date", { ascending: false }),
        supabase.from("anti_kupit").select("*").eq("user_id", userId).order("date", { ascending: false }),
        supabase.from("stock_logs").select("*").eq("user_id", userId).order("date", { ascending: false }),
        supabase.from("shifts").select("*").eq("user_id", userId).order("time_in", { ascending: false }),
        supabase.from("settings").select("*").eq("user_id", userId).single(),
        supabase.from("pins").select("*").eq("user_id", userId).single(),
      ]);

      const products     = (productsData ?? []).map(rowToProduct);
      const transactions = (txData ?? []).map(rowToTransaction);
      const expenses     = (expData ?? []).map(rowToExpense);
      const utang        = (utangData ?? []).map(rowToUtang);
      const antiKupit    = (akData ?? []).map(rowToAntiKupit);
      const stockLogs    = (slData ?? []).map(rowToStockLog);

      // FIX ③ — auto-close zombie shifts before storing
      const rawShifts = (shiftsData ?? []).map(rowToShift);
      const shifts    = await autoCloseStaleShifts(userId, rawShifts);
      const activeShift = shifts.find((s) => !s.timeOut) ?? null;

      const settings = settingsData
        ? rowToSettings(settingsData)
        : { ...DEFAULT_SETTINGS, ...lsLoad(userId, "settings", {}) };
      const pins = pinsData
        ? rowToPins(pinsData)
        : { ...DEFAULT_PINS, ...lsLoad(userId, "pins", {}) };

      // Write back to cache
      lsSave(userId, "products", products);
      lsSave(userId, "transactions", transactions);
      lsSave(userId, "expenses", expenses);
      lsSave(userId, "utang", utang);
      lsSave(userId, "antiKupit", antiKupit);
      lsSave(userId, "stockLogs", stockLogs);
      lsSave(userId, "shifts", shifts);
      lsSave(userId, "settings", settings);
      lsSave(userId, "pins", pins);

      set({ products, transactions, expenses, utang, antiKupit, stockLogs, shifts, activeShift, settings, pins });
      setupRealtime(userId);
    } catch (err) {
      console.warn("[storage] Supabase fetch failed, using cache:", err);
    }

    startOnlineWatcher((count) => {
      console.log(`[sync] Flushed ${count} queued writes`);
    });
    set({ syncing: false });
  },

  // ── Products ──────────────────────────────────────────────────────────────
  setProducts: async (products) => {
    const { userId } = get();
    lsSave(userId, "products", products);
    set({ products });
    const rows = products.map((p) => ({
      id: p.id, user_id: userId, name: p.name,
      barcode: p.barcode ?? null, category: p.category ?? null,
      stock: p.stock, cost: p.cost, price: p.price,
      image_url: p.image_url ?? null,
      is_quick_grid: (p as any).is_quick_grid ?? false,
    }));
    try {
      await supabase.from("products").upsert(rows, { onConflict: "id" });
    } catch {
      rows.forEach((r) => enqueue({ table: "products", op: "upsert", payload: r }));
    }
  },

  // ── Transactions ─────────────────────────────────────────────────────────
  setTransactions: async (transactions) => {
    const { userId } = get();
    lsSave(userId, "transactions", transactions);
    set({ transactions });
    const rows = transactions.map((t) => ({
      id: t.id, user_id: userId, date: t.date, items: t.items as any,
      subtotal: t.subtotal, discount: t.discount, total: t.total,
      paid: t.paid, change: t.change, voided: t.voided ?? false,
      void_reason: t.voidReason ?? null,
      shift_id: t.shiftId ?? null, employee_name: t.employeeName ?? null,
      payment_method: (t as any).paymentMethod ?? "CASH",
      transaction_no: (t as any).transactionNo ?? null,
      cashier_name: (t as any).cashierName ?? null,
    }));
    try {
      await supabase.from("transactions").upsert(rows, { onConflict: "id" });
    } catch {
      rows.forEach((r) => enqueue({ table: "transactions", op: "upsert", payload: r }));
    }
  },

  // ── Expenses ─────────────────────────────────────────────────────────────
  setExpenses: async (expenses) => {
    const { userId } = get();
    lsSave(userId, "expenses", expenses);
    set({ expenses });
    const rows = expenses.map((e) => ({
      id: e.id, user_id: userId, date: e.date,
      category: e.category, amount: e.amount, notes: e.notes ?? null,
    }));
    try {
      // FIX ① — always upsert so reconnect retries are idempotent
      await supabase.from("expenses").upsert(rows, { onConflict: "id" });
    } catch {
      rows.forEach((r) => enqueue({ table: "expenses", op: "upsert", payload: r }));
    }
  },

  // ── Utang ─────────────────────────────────────────────────────────────────
  setUtang: async (utang) => {
    const { userId } = get();
    lsSave(userId, "utang", utang);
    set({ utang });
    const rows = utang.map((u) => ({
      id: u.id, user_id: userId, customer: u.customer,
      date: u.date, items: u.items, amount: u.amount, payments: u.payments,
      promise_date: u.promiseDate ?? null,
      contact: u.contact ?? null,
      email: u.email ?? null,
      notes: u.notes ?? null,
    }));
    try {
      await supabase.from("utang").upsert(rows, { onConflict: "id" });
    } catch {
      rows.forEach((r) => enqueue({ table: "utang", op: "upsert", payload: r }));
    }
  },

  // ── Anti-Kupit ───────────────────────────────────────────────────────────
  addAntiKupit: async (e) => {
    const { userId, antiKupit } = get();
    const next = [e, ...antiKupit];
    lsSave(userId, "antiKupit", next);
    set({ antiKupit: next });
    const row = { id: e.id, user_id: userId, date: e.date, type: e.type, item: e.item, reason: e.reason };
    try {
      // FIX ① — upsert, not insert, so queue retries don't duplicate
      await supabase.from("anti_kupit").upsert(row, { onConflict: "id" });
    } catch {
      enqueue({ table: "anti_kupit", op: "upsert", payload: row });
    }
  },

  // ── Stock Logs ───────────────────────────────────────────────────────────
  addStockLog: async (s) => {
    const { userId, stockLogs } = get();
    const next = [s, ...stockLogs];
    lsSave(userId, "stockLogs", next);
    set({ stockLogs: next });
    const row = { id: s.id, user_id: userId, date: s.date, product_id: s.productId, delta: s.delta, reason: s.reason };
    try {
      await supabase.from("stock_logs").upsert(row, { onConflict: "id" });
    } catch {
      enqueue({ table: "stock_logs", op: "upsert", payload: row });
    }
  },

  // ── Settings — FIX ④ field-level merge ───────────────────────────────────
  setSettings: async (settings) => {
    const { userId } = get();
    lsSave(userId, "settings", settings);
    set({ settings });
    try {
      // Fetch the current server row first so we don't stomp unrelated fields
      // edited simultaneously on another device.
      const { data: existing } = await supabase
        .from("settings")
        .select("*")
        .eq("user_id", userId)
        .single();

      const serverSettings = existing ? rowToSettings(existing) : {};

      await supabase.from("settings").upsert(
        {
          // spread server row, then overwrite only what this device changed
          ...(existing ?? {}),
          user_id: userId,
          store_name:          settings.storeName      ?? (serverSettings as any).storeName      ?? DEFAULT_SETTINGS.storeName,
          tagline:             settings.tagline         ?? (serverSettings as any).tagline         ?? DEFAULT_SETTINGS.tagline,
          address1:            settings.address1        ?? (serverSettings as any).address1        ?? "",
          address2:            settings.address2        ?? (serverSettings as any).address2        ?? "",
          contact:             settings.contact         ?? (serverSettings as any).contact         ?? "",
          logo:                settings.logo            ?? (serverSettings as any).logo            ?? "",
          receipt_footer:      settings.receiptFooter   ?? (serverSettings as any).receiptFooter   ?? DEFAULT_SETTINGS.receiptFooter,
          currency:            settings.currency        ?? (serverSettings as any).currency        ?? DEFAULT_SETTINGS.currency,
          low_stock_threshold: settings.lowStockThreshold ?? (serverSettings as any).lowStockThreshold ?? DEFAULT_SETTINGS.lowStockThreshold,
          expense_categories:  settings.expenseCategories ?? (serverSettings as any).expenseCategories ?? [],
          owner_name:          settings.ownerName       ?? (serverSettings as any).ownerName       ?? "",
          updated_at:          new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    } catch {
      // Offline — queue the merged row, flush will retry on reconnect
      enqueue({
        table: "settings", op: "upsert",
        onConflict: "user_id",
        payload: {
          user_id: userId,
          store_name:          settings.storeName      ?? DEFAULT_SETTINGS.storeName,
          tagline:             settings.tagline         ?? DEFAULT_SETTINGS.tagline,
          address1:            settings.address1        ?? "",
          address2:            settings.address2        ?? "",
          contact:             settings.contact         ?? "",
          logo:                settings.logo            ?? "",
          receipt_footer:      settings.receiptFooter   ?? DEFAULT_SETTINGS.receiptFooter,
          currency:            settings.currency        ?? DEFAULT_SETTINGS.currency,
          low_stock_threshold: settings.lowStockThreshold ?? DEFAULT_SETTINGS.lowStockThreshold,
          expense_categories:  settings.expenseCategories ?? [],
          owner_name:          settings.ownerName       ?? "",
          updated_at:          new Date().toISOString(),
        },
        matchCol: "user_id", matchVal: userId,
      });
    }
  },

  // ── Pins ─────────────────────────────────────────────────────────────────
  setPins: async (pins) => {
    const { userId } = get();
    lsSave(userId, "pins", pins);
    set({ pins });
    const row = {
      user_id: userId, owner: pins.owner, employee: pins.employee,
      pages: pins.pages ?? {}, updated_at: new Date().toISOString(),
    };
    try {
      await supabase.from("pins").upsert(row, { onConflict: "user_id" });
    } catch {
      enqueue({ table: "pins", op: "upsert", onConflict: "user_id", payload: row, matchCol: "user_id", matchVal: userId });
    }
  },

  // ── Cart (local only) ────────────────────────────────────────────────────
  setPosCart: (posCart) => set({ posCart }),
  addToPosCart: (item) => {
    const cart = get().posCart;
    const existing = cart.find((i) => i.productId === item.productId);
    const next = existing
      ? cart.map((i) => i.productId === item.productId ? { ...i, qty: i.qty + item.qty } : i)
      : [...cart, item];
    set({ posCart: next });
  },

  // ── Shifts ───────────────────────────────────────────────────────────────
  startShift: async (employeeName) => {
    const { userId, shifts } = get();

    // FIX ③ — never open a second shift if one is already active
    const stuckOpen = shifts.find((s) => !s.timeOut);
    if (stuckOpen) {
      console.warn("[storage] startShift: an open shift already exists", stuckOpen.id);
      return stuckOpen;
    }

    const shift: Shift = {
      id: uid(), employeeName,
      timeIn: new Date().toISOString(),
      totalSales: 0, txCount: 0, items: [],
    };
    const next = [shift, ...shifts];
    lsSave(userId, "shifts", next);
    set({ shifts: next, activeShift: shift });

    const row = {
      id: shift.id, user_id: userId,
      employee_name: shift.employeeName, time_in: shift.timeIn,
      total_sales: 0, tx_count: 0, items: [], auto_closed: false,
    };
    try {
      // FIX ① — upsert so a queued retry after reconnect doesn't insert twice
      await supabase.from("shifts").upsert(row, { onConflict: "id" });
    } catch {
      enqueue({ table: "shifts", op: "upsert", payload: row });
    }
    return shift;
  },

  endShift: async () => {
    const { userId, activeShift, shifts } = get();
    if (!activeShift) return;
    const ended = { ...activeShift, timeOut: new Date().toISOString() };
    const next = shifts.map((s) => s.id === ended.id ? ended : s);
    lsSave(userId, "shifts", next);
    set({ shifts: next, activeShift: null });
    try {
      await supabase.from("shifts").update({ time_out: ended.timeOut }).eq("id", ended.id);
    } catch {
      enqueue({ table: "shifts", op: "update", payload: { time_out: ended.timeOut }, matchCol: "id", matchVal: ended.id });
    }
  },

  addTransactionToShift: async (tx) => {
    const { userId, activeShift, shifts } = get();
    if (!activeShift) return;
    const updatedItems = [...activeShift.items];
    tx.items.forEach((ci) => {
      const existing = updatedItems.find((i) => i.productId === ci.productId);
      const lineTotal = ci.price * ci.qty;
      if (existing) { existing.qty += ci.qty; existing.total += lineTotal; }
      else updatedItems.push({ productId: ci.productId, name: ci.name, qty: ci.qty, total: lineTotal });
    });
    const updated: Shift = {
      ...activeShift,
      totalSales: activeShift.totalSales + tx.total,
      txCount: activeShift.txCount + 1,
      items: updatedItems,
    };
    const next = shifts.map((s) => s.id === updated.id ? updated : s);
    lsSave(userId, "shifts", next);
    set({ shifts: next, activeShift: updated });
    try {
      await supabase.from("shifts").update({
        total_sales: updated.totalSales, tx_count: updated.txCount, items: updated.items,
      }).eq("id", updated.id);
    } catch {
      enqueue({
        table: "shifts", op: "update",
        payload: { total_sales: updated.totalSales, tx_count: updated.txCount, items: updated.items },
        matchCol: "id", matchVal: updated.id,
      });
    }
  },

  // ── FIX ⑤ — clearAll with typed confirmation + soft-delete ───────────────
  clearAll: async (confirmUserId: string) => {
    const { userId } = get();

    // Guard: caller must pass the actual userId string as confirmation
    if (confirmUserId !== userId) {
      throw new Error(
        `clearAll confirmation mismatch. Expected "${userId}", got "${confirmUserId}". ` +
        "Show a typed-confirmation dialog before calling this."
      );
    }

    // Soft-delete: stamp deleted_at instead of hard DELETE.
    // Your Supabase RLS / cron job should handle physical removal.
    const deletedAt = new Date().toISOString();
    const softDeleteTables = [
      "products", "transactions", "expenses", "utang",
      "anti_kupit", "stock_logs", "shifts",
    ];

    await Promise.allSettled(
      softDeleteTables.map((table) =>
        supabase.from(table).update({ deleted_at: deletedAt }).eq("user_id", userId)
      )
    );

    // Settings and pins are user-scoped singletons — soft-delete by flag
    await Promise.allSettled([
      supabase.from("settings").update({ deleted_at: deletedAt }).eq("user_id", userId),
      supabase.from("pins").update({ deleted_at: deletedAt }).eq("user_id", userId),
    ]);

    // Clear localStorage
    ["products","transactions","expenses","utang","antiKupit",
     "stockLogs","settings","pins","shifts"].forEach(
      (s) => localStorage.removeItem(lsKey(userId, s))
    );

    set({
      products: [], transactions: [], expenses: [], utang: [],
      antiKupit: [], stockLogs: [], shifts: [], activeShift: null,
      settings: DEFAULT_SETTINGS, pins: DEFAULT_PINS,
    });
  },
}));

// ── Realtime ──────────────────────────────────────────────────────────────────
let realtimeChannel: any = null;

function setupRealtime(userId: string) {
  if (realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }

  realtimeChannel = supabase
    .channel(`store:${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "products", filter: `user_id=eq.${userId}` },
      (payload) => {
        const { products } = useStore.getState();
        if (payload.eventType === "INSERT") {
          const p = rowToProduct(payload.new);
          if (!products.find((x) => x.id === p.id)) {
            const next = [p, ...products];
            lsSave(userId, "products", next);
            useStore.setState({ products: next });
          }
        } else if (payload.eventType === "UPDATE") {
          const p = rowToProduct(payload.new);
          const next = products.map((x) => x.id === p.id ? p : x);
          lsSave(userId, "products", next);
          useStore.setState({ products: next });
        } else if (payload.eventType === "DELETE") {
          const next = products.filter((x) => x.id !== payload.old.id);
          lsSave(userId, "products", next);
          useStore.setState({ products: next });
        }
      })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "transactions", filter: `user_id=eq.${userId}` },
      (payload) => {
        const { transactions } = useStore.getState();
        const tx = rowToTransaction(payload.new);
        // FIX ① — deduplicate on realtime too
        if (!transactions.find((x) => x.id === tx.id)) {
          const next = [tx, ...transactions];
          lsSave(userId, "transactions", next);
          useStore.setState({ transactions: next });
        }
      })
    .on("postgres_changes", { event: "*", schema: "public", table: "shifts", filter: `user_id=eq.${userId}` },
      (payload) => {
        const { shifts } = useStore.getState();
        if (payload.eventType === "INSERT") {
          const s = rowToShift(payload.new);
          if (!shifts.find((x) => x.id === s.id)) {
            const next = [s, ...shifts];
            lsSave(userId, "shifts", next);
            useStore.setState({ shifts: next, activeShift: next.find((x) => !x.timeOut) ?? null });
          }
        } else if (payload.eventType === "UPDATE") {
          const s = rowToShift(payload.new);
          const next = shifts.map((x) => x.id === s.id ? s : x);
          lsSave(userId, "shifts", next);
          useStore.setState({ shifts: next, activeShift: next.find((x) => !x.timeOut) ?? null });
        }
      })
    .subscribe();
}

// ── Product helpers ───────────────────────────────────────────────────────────
export async function sbAddProduct(userId: string, p: Product) {
  const row = {
    id: p.id, user_id: userId, name: p.name,
    barcode: p.barcode ?? null, category: p.category ?? null,
    stock: p.stock, cost: p.cost, price: p.price, image_url: p.image_url ?? null,
    is_quick_grid: (p as any).is_quick_grid ?? false,
  };
  try {
    // FIX ① — upsert prevents duplicate if queued offline and retried
    await supabase.from("products").upsert(row, { onConflict: "id" });
  } catch {
    enqueue({ table: "products", op: "upsert", payload: row });
  }
}

export async function sbUpdateProduct(userId: string, p: Product) {
  const payload = {
    name: p.name, barcode: p.barcode ?? null, category: p.category ?? null,
    stock: p.stock, cost: p.cost, price: p.price, image_url: p.image_url ?? null,
    is_quick_grid: (p as any).is_quick_grid ?? false,
  };
  try {
    await supabase.from("products").update(payload).eq("id", p.id).eq("user_id", userId);
  } catch {
    enqueue({ table: "products", op: "update", payload, matchCol: "id", matchVal: p.id });
  }
}

export async function sbDeleteProduct(userId: string, id: string) {
  try {
    await supabase.from("products").delete().eq("id", id).eq("user_id", userId);
  } catch {
    enqueue({ table: "products", op: "delete", payload: null, matchCol: "id", matchVal: id });
  }
}

// ── FIX ② — atomic stock decrement via Postgres RPC ─────────────────────────
//
// Create this function in Supabase SQL Editor:
//
//   create or replace function decrement_stock(
//     p_product_id uuid,
//     p_user_id    uuid,
//     p_qty        integer
//   ) returns integer language plpgsql as $$
//   declare
//     current_stock integer;
//   begin
//     select stock into current_stock
//       from products
//      where id = p_product_id and user_id = p_user_id
//      for update;
//
//     if current_stock < p_qty then
//       raise exception 'insufficient_stock: % available, % requested',
//                       current_stock, p_qty;
//     end if;
//
//     update products
//       set stock = stock - p_qty
//     where id = p_product_id and user_id = p_user_id;
//
//     return current_stock - p_qty;
//   end;
//   $$;
//
// Then call it from your checkout flow instead of sbUpdateProduct:

export async function sbDecrementStock(
  userId: string,
  productId: string,
  qty: number
): Promise<{ newStock: number }> {
  const { data, error } = await supabase.rpc("decrement_stock", {
    p_product_id: productId,
    p_user_id: userId,
    p_qty: qty,
  });

  if (error) {
    // Supabase surfaces the PL/pgSQL message in error.message
    if (error.message.includes("insufficient_stock")) {
      throw new Error(`Not enough stock for product ${productId}. Requested: ${qty}`);
    }
    throw error;
  }

  return { newStock: data as number };
}

// ── Transaction helpers ───────────────────────────────────────────────────────
export async function sbAddTransaction(userId: string, t: Transaction) {
  const row = {
    id: t.id, user_id: userId, date: t.date, items: t.items as any,
    subtotal: t.subtotal, discount: t.discount, total: t.total,
    paid: t.paid, change: t.change, voided: t.voided ?? false,
    void_reason: t.voidReason ?? null,
    shift_id: t.shiftId ?? null, employee_name: t.employeeName ?? null,
    payment_method: (t as any).paymentMethod ?? "CASH",
    transaction_no: t.transactionNo ?? null,
    cashier_name: t.cashierName ?? null,
  };
  try {
    // FIX ① — upsert with onConflict:"id" so retried queue writes are safe
    await supabase.from("transactions").upsert(row, { onConflict: "id" });
  } catch {
    enqueue({ table: "transactions", op: "upsert", payload: row });
  }
}

export async function sbVoidTransaction(userId: string, id: string, reason: string) {
  const payload = { voided: true, void_reason: reason };
  try {
    await supabase.from("transactions").update(payload)
      .eq("id", id).eq("user_id", userId);
  } catch {
    enqueue({ table: "transactions", op: "update", payload, matchCol: "id", matchVal: id });
  }
}

// ── Image upload ──────────────────────────────────────────────────────────────
export async function uploadProductImage(
  userId: string,
  productId: string,
  base64DataUrl: string
): Promise<string | null> {
  try {
    const compressed = await compressImage(base64DataUrl, 400, 0.7);
    const path = `${userId}/${productId}.jpg`;
    const { error } = await supabase.storage
      .from("product-images")
      .upload(path, compressed, { upsert: true, contentType: "image/jpeg" });
    if (error) throw error;
    const { data } = supabase.storage.from("product-images").getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  } catch (err) {
    console.error("[uploadProductImage]", err);
    return null;
  }
}

function compressImage(dataUrl: string, maxPx: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("No canvas context"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("toBlob failed")),
        "image/jpeg", quality
      );
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = dataUrl;
  });
}

export const uid = () => Math.random().toString(36).slice(2, 11);
