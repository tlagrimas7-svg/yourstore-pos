// migrate.ts — one-time migration from localStorage → Supabase
import { supabase } from "./supabase";

interface LegacyStore {
  products?: unknown[];
  transactions?: unknown[];
  shifts?: unknown[];
  utangRecords?: unknown[];
  settings?: Record<string, unknown>;
}

const MIGRATION_KEY = "pos-migration-v1-done";

export async function runMigrationIfNeeded(userId: string): Promise<void> {
  if (localStorage.getItem(MIGRATION_KEY)) return;

  const raw = localStorage.getItem("pos-store");
  if (!raw) {
    localStorage.setItem(MIGRATION_KEY, "1");
    return;
  }

  let legacy: LegacyStore = {};
  try {
    const parsed = JSON.parse(raw);
    legacy = parsed?.state ?? parsed ?? {};
  } catch {
    localStorage.setItem(MIGRATION_KEY, "1");
    return;
  }

  const errors: string[] = [];

  // Products
  if (Array.isArray(legacy.products) && legacy.products.length > 0) {
    const { error } = await supabase
      .from("products")
      .upsert(legacy.products, { onConflict: "id" });
    if (error) errors.push(`products: ${error.message}`);
  }

  // Transactions
  if (Array.isArray(legacy.transactions) && legacy.transactions.length > 0) {
    const { error } = await supabase
      .from("transactions")
      .upsert(legacy.transactions, { onConflict: "id" });
    if (error) errors.push(`transactions: ${error.message}`);
  }

  // Shifts
  if (Array.isArray(legacy.shifts) && legacy.shifts.length > 0) {
    const { error } = await supabase
      .from("shifts")
      .upsert(legacy.shifts, { onConflict: "id" });
    if (error) errors.push(`shifts: ${error.message}`);
  }

  // Utang records
  if (Array.isArray(legacy.utangRecords) && legacy.utangRecords.length > 0) {
    const { error } = await supabase
      .from("utang_records")
      .upsert(legacy.utangRecords, { onConflict: "id" });
    if (error) errors.push(`utang_records: ${error.message}`);
  }

  // Settings
  if (legacy.settings && typeof legacy.settings === "object") {
    const { error } = await supabase
      .from("settings")
      .upsert({ ...legacy.settings, user_id: userId }, { onConflict: "user_id" });
    if (error) errors.push(`settings: ${error.message}`);
  }

  if (errors.length > 0) {
    console.error("Migration errors:", errors);
    // Don't mark done — retry next session
    return;
  }

  localStorage.setItem(MIGRATION_KEY, "1");
  console.log("✅ localStorage migration to Supabase complete");
}

// Alias for App.tsx import
export const migrateIfNeeded = runMigrationIfNeeded;
