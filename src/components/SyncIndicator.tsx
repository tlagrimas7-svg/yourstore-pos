// src/components/SyncIndicator.tsx
// A slim status bar that shows sync state. Mounts inside Layout so it's
// visible on every page after login.

import { useSyncStatus } from "@/lib/useSyncStatus";
import { useEffect, useState } from "react";

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SyncIndicator() {
  const { status, pending, lastSynced, forceSync } = useSyncStatus();
  const [visible, setVisible] = useState(false);
  const [dismissTimer, setDismissTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Show bar whenever status is not a clean "online", auto-hide after 4s when it clears
  useEffect(() => {
    if (status !== "online") {
      setVisible(true);
      if (dismissTimer) clearTimeout(dismissTimer);
      setDismissTimer(null);
    } else {
      // Just came back online — show "Synced" briefly then hide
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 4000);
      setDismissTimer(t);
    }
    return () => {
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  }, [status]);

  if (!visible) return null;

  const config = {
    online: {
      bar: "bg-emerald-500/10 border-emerald-500/20",
      dot: "bg-emerald-400 shadow-emerald-400/60",
      text: "text-emerald-400",
      label: lastSynced ? `All synced · ${formatTime(lastSynced)}` : "All synced",
      pulse: false,
    },
    syncing: {
      bar: "bg-blue-500/10 border-blue-500/20",
      dot: "bg-blue-400 shadow-blue-400/60",
      text: "text-blue-400",
      label: "Syncing…",
      pulse: true,
    },
    pending: {
      bar: "bg-amber-500/10 border-amber-500/20",
      dot: "bg-amber-400 shadow-amber-400/60",
      text: "text-amber-400",
      label: `${pending} item${pending !== 1 ? "s" : ""} waiting to sync`,
      pulse: true,
    },
    offline: {
      bar: "bg-red-500/10 border-red-500/20",
      dot: "bg-red-400 shadow-red-400/60",
      text: "text-red-400",
      label: pending > 0 ? `Offline · ${pending} pending` : "Offline · changes saved locally",
      pulse: false,
    },
  }[status];

  return (
    <div
      className={`
        fixed top-0 left-0 right-0 z-50
        flex items-center justify-between
        px-4 py-1.5
        border-b backdrop-blur-sm
        transition-all duration-300
        ${config.bar}
      `}
    >
      {/* Left: dot + label */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          {config.pulse && (
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${config.dot}`}
            />
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 shadow-sm ${config.dot}`}
          />
        </span>
        <span className={`text-xs font-medium ${config.text}`}>
          {config.label}
        </span>
      </div>

      {/* Right: force sync button (only when pending + online) */}
      {status === "pending" && (
        <button
          onClick={forceSync}
          className="text-xs text-amber-400 underline underline-offset-2 hover:text-amber-300 transition-colors"
        >
          Sync now
        </button>
      )}
    </div>
  );
}
