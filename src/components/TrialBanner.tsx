import { useSession } from "@/App";
import type { AccessInfo } from "@/lib/supabase";

// Drop this component into Layout.tsx just below the header
// It reads the access info passed from App.tsx via context

interface TrialBannerProps {
  access: AccessInfo | null;
}

export function TrialBanner({ access }: TrialBannerProps) {
  if (!access) return null;
  if (access.plan !== "trial") return null;
  if (access.trialDaysLeft === null) return null;

  const days = access.trialDaysLeft;

  const urgent = days <= 3;
  const warning = days <= 7;

  return (
    <div
      className={`w-full px-4 py-1.5 text-center text-xs font-medium flex items-center justify-center gap-2
        ${urgent
          ? "bg-red-500/90 text-white"
          : warning
          ? "bg-amber-400/90 text-black"
          : "bg-blue-500/90 text-white"
        }`}
    >
      <span>
        {days === 0
          ? "⚠️ Your trial expires today — contact us to continue"
          : days === 1
          ? "⚠️ 1 day left in your trial"
          : `🕐 Trial: ${days} days remaining`}
      </span>
      <span className="opacity-60">·</span>
      <span className="opacity-80">Your data is always safe</span>
    </div>
  );
}
