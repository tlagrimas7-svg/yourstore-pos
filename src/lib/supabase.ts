import { createClient } from "@supabase/supabase-js";

// 1. Initialize static production Supabase client using client environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const isSupabaseConfigured = true;

export type Plan = "trial" | "starter" | "pro" | "business";

export interface AllowedUser {
  id: string;
  email: string;
  store_name: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  plan: Plan | null;
  trial_ends_at: string | null;
  notes: string | null;
}

export interface AccessInfo {
  plan: Plan;
  trialDaysLeft: number | null;  // null = not on trial, 0 = expired today, positive = days remaining
  isTrialExpired: boolean;
  isPro: boolean;
  isBusiness: boolean;
}

export type AccessCheck =
  | { ok: true; user: AllowedUser; access: AccessInfo }
  | { ok: false; reason: "denied" | "expired" | "trial_expired" };

function buildAccessInfo(user: AllowedUser): AccessInfo {
  const plan: Plan = user.plan ?? "trial";

  let trialDaysLeft: number | null = null;
  let isTrialExpired = false;

  if (plan === "trial" && user.trial_ends_at) {
    const ends = new Date(user.trial_ends_at);
    const now = new Date();
    const diffMs = ends.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    trialDaysLeft = Math.max(0, diffDays);
    isTrialExpired = diffDays < 0;
  }

  return {
    plan,
    trialDaysLeft,
    isTrialExpired,
    isPro: plan === "pro" || plan === "business",
    isBusiness: plan === "business",
  };
}

/**
 * Validates staff login sessions directly against the production public table
 */
export async function checkAccess(email: string): Promise<AccessCheck> {
  try {
    // Fallback for local dev without connection strings
    if (!isSupabaseConfigured) {
      const mockUser: AllowedUser = {
        id: "local", email, store_name: null, is_active: true,
        expires_at: null, created_at: new Date().toISOString(),
        plan: "pro", trial_ends_at: null, notes: null,
      };
      return { ok: true, user: mockUser, access: buildAccessInfo(mockUser) };
    }

    // Queries the production database directly
    const { data, error } = await supabase
      .from("allowed_users")
      .select("*")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (error || !data) return { ok: false, reason: "denied" };

    const user = data as AllowedUser;

    // Account manually deactivated by owner validation gate
    if (!user.is_active) return { ok: false, reason: "denied" };

    // Hard expiry monitoring tracking layers
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return { ok: false, reason: "expired" };
    }

    // Trial duration limits verification check
    const access = buildAccessInfo(user);
    if (access.isTrialExpired) {
      return { ok: false, reason: "trial_expired" };
    }

    return { ok: true, user, access };
  } catch (err) {
    console.error("[checkAccess error]:", err);
    return { ok: false, reason: "denied" };
  }
}
